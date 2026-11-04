-- Finances hub, phase 3: Subscriptions.
--
-- ADDITIVE ONLY. Creates new tables/functions and adds three nullable columns
-- to goals. It does not touch bills, bill_*, payment_accounts or
-- payment_transactions (it only REFERENCES bills(id) for the optional
-- "also tracked as a bill" link, so the Bills migration must already be
-- applied). Safe to re-run.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app
-- or by CI -- Finances > Subscriptions shows an "unavailable" state until this
-- has been run.
--
-- MODEL
--   subscriptions          one row per recurring service. next_billing_date is
--                          the ANCHOR of the billing schedule; later renewals are
--                          computed from it (src/lib/subscriptions.ts), never
--                          stored, so nothing drifts and nothing needs a job.
--   subscription_payments  append-only ledger of payments the user actually
--                          recorded. A renewal is a projection; it is never
--                          "paid" just because its date passed.
--
-- STATUS: active | paused | canceled | trial. "Canceled" only updates
-- StandUp's tracking record (history is kept); it does not cancel anything with
-- the provider. A trial whose trial_ends_on has passed is treated as active by
-- the app (computed, not rewritten here).
--
-- FREQUENCY: weekly | monthly | quarterly | yearly | custom. Custom uses
-- custom_interval + custom_unit (days | weeks | months).
--
-- OVERLAP WITH BILLS: bill_id is an explicit, user-chosen link meaning "this
-- charge is also tracked as a bill". Nothing is linked, merged or deleted
-- automatically; the app only SUGGESTS possible overlaps.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  provider text check (provider is null or char_length(provider) <= 120),
  category text check (category is null or char_length(category) <= 60),
  plan_name text check (plan_name is null or char_length(plan_name) <= 120),
  -- Nullable on purpose: a subscription can be tracked before its price is known.
  amount numeric(12, 2) check (amount is null or amount >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'EUR', 'GBP', 'CAD', 'MXN')),
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly', 'custom')),
  custom_interval integer check (custom_interval is null or custom_interval between 1 and 365),
  custom_unit text check (custom_unit is null or custom_unit in ('days', 'weeks', 'months')),
  next_billing_date date not null,
  start_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'canceled', 'trial')),
  trial_ends_on date,
  remind_days_before integer not null default 3 check (remind_days_before between 0 and 60),
  notes text check (notes is null or char_length(notes) <= 1000),
  bill_id uuid references public.bills(id) on delete set null,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_custom_has_interval check (frequency <> 'custom' or (custom_interval is not null and custom_unit is not null)),
  constraint subscriptions_trial_has_end check (status <> 'trial' or trial_ends_on is not null)
);
create index if not exists idx_subscriptions_user_id on public.subscriptions (user_id);

create or replace function public.touch_subscription_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_touch_subscription_updated_at on public.subscriptions;
create trigger trg_touch_subscription_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_subscription_updated_at();

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 500),
  -- Optional: which renewal date this payment was for (informational; a payment
  -- never changes the schedule).
  billing_date date,
  reversed_at timestamptz,
  client_key uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_subscription_payments_sub_paid on public.subscription_payments (subscription_id, paid_at desc);
-- Database-enforced idempotency: the same client key can never insert twice.
create unique index if not exists subscription_payments_client_key_idx
  on public.subscription_payments (user_id, client_key) where client_key is not null;

-- Links a goal created from a subscription suggestion back to the subscription +
-- event + date, so the same renewal / trial-end is never suggested twice.
alter table public.goals
  add column if not exists source_subscription_id uuid references public.subscriptions(id) on delete set null,
  add column if not exists source_subscription_event text check (source_subscription_event is null or source_subscription_event in ('renewal', 'trial_end')),
  add column if not exists source_subscription_date date;
create index if not exists idx_goals_source_subscription on public.goals (source_subscription_id) where source_subscription_id is not null;

-- ── Row Level Security ────────────────────────────────────────────────────
alter table public.subscriptions enable row level security;
alter table public.subscription_payments enable row level security;

-- subscriptions: the owner can read / create / edit / delete. A linked bill must
-- also belong to the same user.
drop policy if exists "subscriptions_select_own" on public.subscriptions;
drop policy if exists "subscriptions_insert_own" on public.subscriptions;
drop policy if exists "subscriptions_update_own" on public.subscriptions;
drop policy if exists "subscriptions_delete_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions for select using (auth.uid() = user_id);
create policy "subscriptions_insert_own" on public.subscriptions for insert
  with check (
    auth.uid() = user_id
    and (bill_id is null or exists (select 1 from public.bills b where b.id = bill_id and b.user_id = auth.uid()))
  );
create policy "subscriptions_update_own" on public.subscriptions for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (bill_id is null or exists (select 1 from public.bills b where b.id = bill_id and b.user_id = auth.uid()))
  );
create policy "subscriptions_delete_own" on public.subscriptions for delete using (auth.uid() = user_id);

-- payments: owner can READ only. All writes go through the SECURITY DEFINER
-- functions below, which scope every statement to auth.uid().
drop policy if exists "subscription_payments_select_own" on public.subscription_payments;
create policy "subscription_payments_select_own" on public.subscription_payments for select using (auth.uid() = user_id);

-- ── Record a payment ──────────────────────────────────────────────────────
-- Inserts the payment (idempotent per p_client_key). It never changes the
-- subscription or its schedule.
create or replace function public.record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_paid_at timestamptz,
  p_note text,
  p_billing_date date,
  p_client_key uuid
)
returns table (r_payment_id uuid, r_duplicate boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_existing uuid;
  v_pay uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if p_amount <> round(p_amount, 2) or p_amount > 9999999999.99 then
    raise exception 'Payment amount must be a valid amount with at most 2 decimal places';
  end if;

  -- Lock the subscription so concurrent submits for it serialize.
  select s.user_id into v_owner
    from public.subscriptions s
    where s.id = p_subscription_id and s.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Subscription not found';
  end if;

  if p_client_key is not null then
    select p.id into v_existing
      from public.subscription_payments p
      where p.user_id = auth.uid() and p.client_key = p_client_key;
    if found then
      return query select v_existing, true;
      return;
    end if;
  end if;

  insert into public.subscription_payments (subscription_id, user_id, amount, paid_at, note, billing_date, client_key)
  values (p_subscription_id, auth.uid(), p_amount, coalesce(p_paid_at, now()), nullif(btrim(p_note), ''), p_billing_date, p_client_key)
  returning id into v_pay;

  return query select v_pay, false;
end;
$$;
revoke all on function public.record_subscription_payment(uuid, numeric, timestamptz, text, date, uuid) from public;
grant execute on function public.record_subscription_payment(uuid, numeric, timestamptz, text, date, uuid) to authenticated;

-- ── Reverse a payment ─────────────────────────────────────────────────────
-- The row is KEPT and stamped reversed_at (history is never deleted). The row
-- lock + reversed_at check make a second reversal impossible.
create or replace function public.reverse_subscription_payment(p_payment_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_sub uuid;
  v_reversed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select p.subscription_id, p.reversed_at into v_sub, v_reversed
    from public.subscription_payments p
    where p.id = p_payment_id and p.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if v_reversed is not null then
    raise exception 'This payment has already been reversed';
  end if;

  update public.subscription_payments set reversed_at = now() where id = p_payment_id;
  return v_sub;
end;
$$;
revoke all on function public.reverse_subscription_payment(uuid) from public;
grant execute on function public.reverse_subscription_payment(uuid) to authenticated;

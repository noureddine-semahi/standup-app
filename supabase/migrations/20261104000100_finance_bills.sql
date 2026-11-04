-- Finances hub, phase 2: Bills tracker.
--
-- ADDITIVE ONLY. Creates new tables/functions and adds two nullable columns to
-- goals. It does not touch payment_accounts / payment_transactions or any
-- Phase 1 function, and it never reads or reclassifies existing accounts.
-- Safe to re-run.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app
-- or by CI -- Finances > Bills shows an "unavailable" state until this has been
-- run.
--
-- MODEL
--   bills             one row per bill (the schedule + expected amount).
--   bill_occurrences  one row per billing cycle (bill_id, due_date), created
--                     lazily the first time a payment or an actual amount is
--                     recorded for that cycle. unique(bill_id, due_date)
--                     makes duplicate occurrences impossible.
--   bill_payments     the append-only payment ledger for bills. Rows are never
--                     deleted; a mistake is corrected by reversing (reversed_at).
--
-- An occurrence's STATUS is never stored: it is derived from its non-reversed
-- payments vs. amount_due, so status and payments can't contradict.
--
-- amount_due: for FIXED bills it is snapshotted from bills.expected_amount when
-- the occurrence row is created (so later edits never rewrite past cycles). For
-- VARIABLE bills it is NULL until an actual amount is entered, and
-- bills.expected_amount is only a distinguishable estimate.
--
-- Bill payments are a separate ledger from payment_transactions and NEVER touch
-- a payment account balance.
--
-- RECURRENCE RULES (mirrored by bill_is_occurrence below and by src/lib/bills.ts)
--   * Occurrence k of a monthly/quarterly/annual bill falls in the month
--     first_due_date + k*step months, on the first_due_date's day-of-month,
--     clamped to that month's last day. So a bill first due Jan 31 is due
--     Feb 28/29, Mar 31, Apr 30 ...  and one first due Feb 29 is due Feb 28 in
--     non-leap years and Feb 29 in leap years. The anchor day is never lost, so
--     the clamp never "drifts" (Feb 28 does not make later months the 28th).
--   * weekly / biweekly: every 7 / 14 days from first_due_date.
--   * once: only first_due_date.

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  amount_type text not null check (amount_type in ('fixed', 'variable')),
  -- fixed: the amount due every cycle; variable: an optional estimate.
  expected_amount numeric(12, 2) check (expected_amount is null or expected_amount >= 0),
  recurrence text not null check (recurrence in ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually')),
  first_due_date date not null,
  remind_days_before integer not null default 3 check (remind_days_before between 0 and 60),
  category text check (category is null or char_length(category) <= 60),
  notes text check (notes is null or char_length(notes) <= 1000),
  -- "Remove" archives; history is never deleted.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint bills_fixed_has_amount check (amount_type <> 'fixed' or expected_amount is not null)
);
create index if not exists idx_bills_user_id on public.bills (user_id);

create table if not exists public.bill_occurrences (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  due_date date not null,
  amount_due numeric(12, 2) check (amount_due is null or amount_due >= 0),
  created_at timestamptz not null default now(),
  unique (bill_id, due_date)
);
create index if not exists idx_bill_occurrences_user_due on public.bill_occurrences (user_id, due_date);

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  occurrence_id uuid not null references public.bill_occurrences(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 500),
  reversed_at timestamptz,
  client_key uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_bill_payments_occurrence on public.bill_payments (occurrence_id);
create index if not exists idx_bill_payments_bill_paid on public.bill_payments (bill_id, paid_at desc);
-- Database-enforced idempotency: the same client key can never insert twice.
create unique index if not exists bill_payments_client_key_idx
  on public.bill_payments (user_id, client_key) where client_key is not null;

-- Links a goal created from a bill suggestion back to its bill + cycle, so the
-- same occurrence is never suggested twice. Nullable; set only at creation.
alter table public.goals
  add column if not exists source_bill_id uuid references public.bills(id) on delete set null,
  add column if not exists source_bill_due_date date;
create index if not exists idx_goals_source_bill on public.goals (source_bill_id) where source_bill_id is not null;

-- ── Row Level Security ────────────────────────────────────────────────────
alter table public.bills enable row level security;
alter table public.bill_occurrences enable row level security;
alter table public.bill_payments enable row level security;

-- bills: owner can read / create / edit. No DELETE policy -- archive instead.
drop policy if exists "bills_select_own" on public.bills;
drop policy if exists "bills_insert_own" on public.bills;
drop policy if exists "bills_update_own" on public.bills;
create policy "bills_select_own" on public.bills for select using (auth.uid() = user_id);
create policy "bills_insert_own" on public.bills for insert with check (auth.uid() = user_id);
create policy "bills_update_own" on public.bills for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- occurrences + payments: owner can READ only. All writes go through the
-- SECURITY DEFINER functions below, which scope every statement to auth.uid().
drop policy if exists "bill_occurrences_select_own" on public.bill_occurrences;
drop policy if exists "bill_payments_select_own" on public.bill_payments;
create policy "bill_occurrences_select_own" on public.bill_occurrences for select using (auth.uid() = user_id);
create policy "bill_payments_select_own" on public.bill_payments for select using (auth.uid() = user_id);

-- ── Schedule guard ────────────────────────────────────────────────────────
-- Once any cycle has an occurrence row (a payment or an actual amount was
-- recorded), the bill's schedule is frozen: changing first_due_date or
-- recurrence would silently re-date or orphan recorded history.
create or replace function public.guard_bill_schedule()
returns trigger
language plpgsql
as $$
begin
  if (new.first_due_date is distinct from old.first_due_date or new.recurrence is distinct from old.recurrence)
     and exists (select 1 from public.bill_occurrences o where o.bill_id = old.id) then
    raise exception 'This bill''s schedule can''t be changed after payments or amounts were recorded. Add a new bill instead.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_bill_schedule on public.bills;
create trigger trg_guard_bill_schedule
  before update on public.bills
  for each row execute function public.guard_bill_schedule();

-- ── Recurrence check (see RECURRENCE RULES above) ─────────────────────────
create or replace function public.bill_is_occurrence(p_first date, p_recurrence text, p_date date)
returns boolean
language plpgsql
immutable
as $$
declare
  v_step integer;
  v_months integer;
  v_month_end integer;
begin
  if p_date < p_first then
    return false;
  end if;
  case p_recurrence
    when 'once' then
      return p_date = p_first;
    when 'weekly' then
      return (p_date - p_first) % 7 = 0;
    when 'biweekly' then
      return (p_date - p_first) % 14 = 0;
    when 'monthly' then
      v_step := 1;
    when 'quarterly' then
      v_step := 3;
    when 'annually' then
      v_step := 12;
    else
      return false;
  end case;
  v_months := (extract(year from p_date)::integer - extract(year from p_first)::integer) * 12
            + (extract(month from p_date)::integer - extract(month from p_first)::integer);
  if v_months % v_step <> 0 then
    return false;
  end if;
  v_month_end := extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::integer;
  return extract(day from p_date)::integer = least(extract(day from p_first)::integer, v_month_end);
end;
$$;

-- ── Record a payment ──────────────────────────────────────────────────────
-- Creates the occurrence row if needed (never a duplicate), optionally sets the
-- cycle's ACTUAL amount due (variable bills), and inserts the payment -- one
-- function call = one transaction. p_client_key makes retries/double-taps
-- return the original payment instead of paying twice.
create or replace function public.record_bill_payment(
  p_bill_id uuid,
  p_due_date date,
  p_amount numeric,
  p_paid_at timestamptz,
  p_note text,
  p_amount_due numeric,
  p_client_key uuid
)
returns table (r_payment_id uuid, r_occurrence_id uuid, r_duplicate boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
  v_occ uuid;
  v_existing record;
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
  if p_amount_due is not null and (p_amount_due < 0 or p_amount_due <> round(p_amount_due, 2) or p_amount_due > 9999999999.99) then
    raise exception 'Amount due must be zero or more, with at most 2 decimal places';
  end if;

  -- Lock the bill so concurrent submits for it serialize.
  select * into v_bill from public.bills b where b.id = p_bill_id and b.user_id = auth.uid() for update;
  if not found then
    raise exception 'Bill not found';
  end if;
  if v_bill.archived_at is not null then
    raise exception 'This bill has been removed';
  end if;
  if not public.bill_is_occurrence(v_bill.first_due_date, v_bill.recurrence, p_due_date) then
    raise exception 'That due date is not part of this bill''s schedule';
  end if;
  if p_due_date > current_date + 366 then
    raise exception 'That due date is too far in the future';
  end if;

  if p_client_key is not null then
    select p.id, p.occurrence_id into v_existing
      from public.bill_payments p
      where p.user_id = auth.uid() and p.client_key = p_client_key;
    if found then
      return query select v_existing.id, v_existing.occurrence_id, true;
      return;
    end if;
  end if;

  insert into public.bill_occurrences (bill_id, user_id, due_date, amount_due)
  values (v_bill.id, auth.uid(), p_due_date,
          case when v_bill.amount_type = 'fixed' then v_bill.expected_amount else null end)
  on conflict (bill_id, due_date) do nothing;

  select o.id into v_occ from public.bill_occurrences o where o.bill_id = v_bill.id and o.due_date = p_due_date;

  if p_amount_due is not null then
    update public.bill_occurrences set amount_due = p_amount_due where id = v_occ;
  end if;

  insert into public.bill_payments (bill_id, occurrence_id, user_id, amount, paid_at, note, client_key)
  values (v_bill.id, v_occ, auth.uid(), p_amount, coalesce(p_paid_at, now()), nullif(btrim(p_note), ''), p_client_key)
  returning id into v_pay;

  return query select v_pay, v_occ, false;
end;
$$;
revoke all on function public.record_bill_payment(uuid, date, numeric, timestamptz, text, numeric, uuid) from public;
grant execute on function public.record_bill_payment(uuid, date, numeric, timestamptz, text, numeric, uuid) to authenticated;

-- ── Set / correct a cycle's actual amount (variable bills) ───────────────
create or replace function public.set_bill_occurrence_amount(p_bill_id uuid, p_due_date date, p_amount numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
  v_occ uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount is null or p_amount < 0 or p_amount <> round(p_amount, 2) or p_amount > 9999999999.99 then
    raise exception 'Amount must be zero or more, with at most 2 decimal places';
  end if;

  select * into v_bill from public.bills b where b.id = p_bill_id and b.user_id = auth.uid() for update;
  if not found then
    raise exception 'Bill not found';
  end if;
  if v_bill.archived_at is not null then
    raise exception 'This bill has been removed';
  end if;
  if not public.bill_is_occurrence(v_bill.first_due_date, v_bill.recurrence, p_due_date) then
    raise exception 'That due date is not part of this bill''s schedule';
  end if;
  if p_due_date > current_date + 366 then
    raise exception 'That due date is too far in the future';
  end if;

  insert into public.bill_occurrences (bill_id, user_id, due_date, amount_due)
  values (v_bill.id, auth.uid(), p_due_date, p_amount)
  on conflict (bill_id, due_date) do update set amount_due = excluded.amount_due
  returning id into v_occ;

  return v_occ;
end;
$$;
revoke all on function public.set_bill_occurrence_amount(uuid, date, numeric) from public;
grant execute on function public.set_bill_occurrence_amount(uuid, date, numeric) to authenticated;

-- ── Reverse a payment ─────────────────────────────────────────────────────
-- The row is KEPT and stamped reversed_at. The row lock + reversed_at check
-- make a second reversal impossible. Outstanding amount / status are derived
-- from non-reversed payments, so they recalculate automatically.
create or replace function public.reverse_bill_payment(p_payment_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_occ uuid;
  v_reversed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select p.occurrence_id, p.reversed_at into v_occ, v_reversed
    from public.bill_payments p
    where p.id = p_payment_id and p.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if v_reversed is not null then
    raise exception 'This payment has already been reversed';
  end if;

  update public.bill_payments set reversed_at = now() where id = p_payment_id;
  return v_occ;
end;
$$;
revoke all on function public.reverse_bill_payment(uuid) from public;
grant execute on function public.reverse_bill_payment(uuid) to authenticated;

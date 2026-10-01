-- Payment confirmation + balance tracking: completing a payment-reminder
-- goal now requires confirming the actual amount paid (defaults to the
-- minimum payment, but editable) and subtracts it from the account's
-- balance, logged to a ledger. Confirmed with the user: overpayment is
-- allowed to go negative (a credit) rather than clamping at zero -- the
-- ledger stays a mathematically honest record of what was actually paid.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

-- Links a goal back to the payment account it was auto-created from --
-- same shape as source_template_id for recurring templates. Only ever
-- set once, at creation, by addGoalFromPaymentReminder.
alter table public.goals
  add column if not exists source_payment_account_id uuid references public.payment_accounts(id) on delete set null;

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.payment_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  amount numeric(10,2) not null check (amount >= 0),
  paid_at timestamptz not null default now()
);
create index payment_transactions_account_idx on public.payment_transactions (account_id, paid_at desc);

alter table public.payment_transactions enable row level security;

-- Read/insert only, owner-scoped -- a ledger row is a record of what
-- happened, not something to edit afterward (same reasoning closed-day
-- history isn't editable elsewhere in this app).
create policy "payment_transactions_select_own" on public.payment_transactions
  for select using (user_id = auth.uid());
create policy "payment_transactions_insert_own" on public.payment_transactions
  for insert with check (user_id = auth.uid());

-- Atomically marks the goal completed, logs the payment, and updates the
-- account's balance -- one round trip so a mid-way failure can't leave
-- the goal "completed" with no ledger entry (or vice versa). Returns the
-- new balance so the client doesn't need a second fetch to show it.
create or replace function public.confirm_payment_goal_completion(p_goal_id uuid, p_amount numeric)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_new_balance numeric;
begin
  if p_amount < 0 then
    raise exception 'Amount must be zero or positive';
  end if;

  select source_payment_account_id into v_account_id
    from public.goals where id = p_goal_id and user_id = auth.uid();

  if v_account_id is null then
    raise exception 'This goal is not linked to a payment account';
  end if;

  update public.goals set status = 'completed' where id = p_goal_id and user_id = auth.uid();

  insert into public.payment_transactions (account_id, user_id, goal_id, amount)
  values (v_account_id, auth.uid(), p_goal_id, p_amount);

  update public.payment_accounts set balance = balance - p_amount
    where id = v_account_id and user_id = auth.uid()
    returning balance into v_new_balance;

  return v_new_balance;
end;
$$;
revoke all on function public.confirm_payment_goal_completion(uuid, numeric) from public;
grant execute on function public.confirm_payment_goal_completion(uuid, numeric) to authenticated;

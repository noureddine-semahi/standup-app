-- FIN-02.1: confirm_payment_goal_completion() accepted amounts with more than two decimal places. The ledger column payment_transactions.amount is
-- numeric(10,2) and ROUNDS on insert, while the balance was reduced by the RAW amount: a payment of 25.005 was recorded as 25.01 but deducted 25.005,
-- and a later reversal added back 25.01, so the balance drifted by a fraction of a cent.
--
-- Fix: validate the amount exactly as record_payment() does (same condition, same message): at most two decimal places and at most 99999999.99. An
-- invalid amount raises BEFORE the goal is locked or anything is written, so the ledger, the goal and the balance are unchanged. A valid amount has no
-- fractional cents, so the value written to the ledger and the value subtracted from the balance are the same number, and a reversal restores it exactly.
--
-- ONLY that validation is added. Everything else is carried over exactly from 20261127000100_confirm_payment_goal_lock.sql (FIN-01): the
-- zero-or-positive check (a $0 confirmation is still allowed), the FOR UPDATE row lock, the ownership scoping, the link check, the already-confirmed
-- check, the balance_mode handling, the transaction-local flag for the guard trigger (20261016000100), the ledger insert, the return value, and the
-- SECURITY DEFINER / search_path / grants. record_payment() and reverse_payment() are NOT touched. Forward-only and safe to re-run.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

create or replace function public.confirm_payment_goal_completion(p_goal_id uuid, p_amount numeric)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_already_completed boolean;
  v_mode text;
  v_new_balance numeric;
begin
  if p_amount < 0 then
    raise exception 'Amount must be zero or positive';
  end if;
  if p_amount <> round(p_amount, 2) or p_amount > 99999999.99 then
    raise exception 'Payment amount must be a valid amount with at most 2 decimal places';
  end if;

  select source_payment_account_id, status = 'completed'
    into v_account_id, v_already_completed
    from public.goals where id = p_goal_id and user_id = auth.uid()
    for update;

  if v_account_id is null then
    raise exception 'This goal is not linked to a payment account';
  end if;

  if v_already_completed then
    raise exception 'This payment has already been confirmed for this Task.';
  end if;

  select balance_mode into v_mode from public.payment_accounts
    where id = v_account_id and user_id = auth.uid();

  perform set_config('app.allow_payment_goal_complete', 'true', true);
  update public.goals set status = 'completed' where id = p_goal_id and user_id = auth.uid();

  insert into public.payment_transactions (account_id, user_id, goal_id, amount, balance_applied)
  values (v_account_id, auth.uid(), p_goal_id, p_amount, coalesce(v_mode, 'auto') = 'auto');

  if coalesce(v_mode, 'auto') = 'auto' then
    update public.payment_accounts set balance = balance - p_amount
      where id = v_account_id and user_id = auth.uid()
      returning balance into v_new_balance;
  else
    select balance into v_new_balance from public.payment_accounts
      where id = v_account_id and user_id = auth.uid();
  end if;

  return v_new_balance;
end;
$$;
revoke all on function public.confirm_payment_goal_completion(uuid, numeric) from public;
grant execute on function public.confirm_payment_goal_completion(uuid, numeric) to authenticated;

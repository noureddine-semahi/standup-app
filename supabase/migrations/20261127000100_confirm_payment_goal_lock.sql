-- FIN-01: two simultaneous confirmations of the SAME payment goal could each record a payment and each subtract from the balance.
--
-- Cause: confirm_payment_goal_completion() read the goal's status with a plain SELECT. Two concurrent calls both saw "not completed"; the second
-- then waited on the first's row lock, and once it was released went on to insert a second ledger row and subtract again (the guard trigger does
-- not stop it: by then the row is already 'completed', so the transition check passes).
--
-- Fix: lock the goal row with SELECT ... FOR UPDATE BEFORE reading its status. The second caller now waits for the first to finish, then reads the
-- committed status 'completed' and raises the existing "already been confirmed" error, so no second payment is recorded and the balance is
-- deducted once.
--
-- ONLY that one clause changes. Everything else is carried over exactly from 20261103000100_finance_payment_ledger.sql: the amount check, the
-- ownership scoping (auth.uid()), the link check, the already-confirmed check, the balance_mode handling (auto subtracts; manual leaves the balance
-- alone), the transaction-local flag that lets the guard trigger (20261016000100) allow the completion, the ledger insert, the return value, and
-- the SECURITY DEFINER / search_path / grants. No other function, table or trigger is touched. Forward-only and safe to re-run.
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

-- FIN-02.2 hardening 2 of 3: confirm_payment_goal_completion() allocates and stamps a per-account ledger version for each genuinely new goal payment.
--
-- WHAT CHANGES (and nothing else): after the goal and the account are locked and the already-confirmed check has passed, and after the goal is marked completed,
-- the function (1) increments payment_accounts.ledger_version by exactly one for the account being paid and (2) writes that value into the new
-- payment_transactions row's ledger_version. The same step refuses to write an unstamped payment: if the account row cannot be updated the call raises
-- "Account not found" (unreachable for consistent data, because the account is already locked just above).
--
-- LOCKING AND ALLOCATION: lock order is unchanged (goal FOR UPDATE, then account FOR UPDATE, then the writes). The increment happens under the account lock, so
-- it is serialized with record_payment() and reverse_payment() on the same account: each reads the committed counter and adds one.
--
-- IDEMPOTENCY / FAILURE: a repeated or concurrent confirmation of the same goal still raises "already been confirmed" from the FIN-01 goal lock and the
-- completed-status check, BEFORE any version is allocated, so it consumes none. The increment, the goal update, the ledger insert and the balance update are one
-- function call (one transaction): if anything fails, all of it, including the increment, rolls back, so a failed confirmation consumes no version.
--
-- UNCHANGED (carried over exactly from 20261130000100_confirm_payment_goal_account_lock.sql): the signature, SECURITY DEFINER, the search path, the amount
-- rules (zero allowed; at most two decimals; FIN-02.1), the FIN-01 goal lock, the account lock and its position, ownership scoping, the link and already-confirmed
-- checks, the guard-trigger flag, the goal update, the balance_mode behaviour, the balance update, and the returned balance. Permissions are NOT touched:
-- CREATE OR REPLACE keeps the existing grants (authenticated can execute; anon and PUBLIC cannot).
--
-- Forward-only and safe to re-run (CREATE OR REPLACE). Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

create or replace function public.confirm_payment_goal_completion(p_goal_id uuid, p_amount numeric)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_already_completed boolean;
  v_mode text;
  v_new_balance numeric;
  v_version bigint;
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
    where id = v_account_id and user_id = auth.uid()
    for update;

  perform set_config('app.allow_payment_goal_complete', 'true', true);
  update public.goals set status = 'completed' where id = p_goal_id and user_id = auth.uid();

  -- Allocate this payment's ledger version: exactly one increment per genuinely new payment, under the account lock taken above.
  update public.payment_accounts set ledger_version = ledger_version + 1
    where id = v_account_id and user_id = auth.uid()
    returning ledger_version into v_version;
  if v_version is null then
    raise exception 'Account not found';
  end if;

  insert into public.payment_transactions (account_id, user_id, goal_id, amount, balance_applied, ledger_version)
  values (v_account_id, auth.uid(), p_goal_id, p_amount, coalesce(v_mode, 'auto') = 'auto', v_version);

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

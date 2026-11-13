-- FIN-02.2 Step 3: lock the payment account BEFORE the ledger row is inserted in confirm_payment_goal_completion().
--
-- Before: the function locked the goal (FIN-01), read the account's balance_mode with a plain SELECT, set the guard flag, updated the goal, INSERTED the
-- ledger row, and only then took the account row lock (through its UPDATE of the balance). record_payment() already locks the account first, then inserts.
-- So a future reconciliation checkpoint (which will take the account lock and then read the ledger and balance) could interleave with a goal confirmation:
-- the confirmation's ledger row exists with an earlier timestamp, but its balance change lands after the checkpoint's snapshot, and the checkpoint would
-- miscount it. The plain SELECT of balance_mode was also read without a lock, so a balance_mode switch could slip in between the read and the update.
--
-- After: the same SELECT now carries FOR UPDATE. The lock order is goal -> account -> (ledger insert, goal update, balance update), and the balance_mode
-- is read under the account lock. A checkpoint that takes the account lock first can no longer fall between the ledger insert and the balance change.
--
-- ONLY that one clause changes ("for update" on the balance_mode SELECT). Everything else is carried over exactly from
-- 20261128000100_confirm_payment_goal_precision.sql: the zero-or-positive and two-decimal checks (FIN-02.1), the FOR UPDATE goal lock (FIN-01), the
-- ownership scoping, the link and already-confirmed checks, the balance_mode handling, the guard-trigger flag (20261016000100), the ledger insert, the return
-- value, and the SECURITY DEFINER / search_path / grants. record_payment() and reverse_payment() are NOT touched.
--
-- DEADLOCK CHECK (lock acquisition order, first lock first):
--   confirm_payment_goal_completion : goal -> account            (unchanged pair: it already took goal, then account at the balance UPDATE; now earlier)
--   record_payment                  : account
--   reverse_payment                 : ledger row -> account
-- The wait-for graph has the edges goal -> account and ledger row -> account only, and nothing ever locks an account and then a goal or a ledger row,
-- so there is no cycle. Two confirmations of different goals on one account both take their own goal lock first and then queue on the account.
-- (A concurrent DELETE of the account cascades to its goals and ledger rows and could deadlock with a confirmation; that was true before this change and
-- the database resolves it by aborting one statement, never by corrupting data.)
--
-- Forward-only and safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

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
    where id = v_account_id and user_id = auth.uid()
    for update;

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

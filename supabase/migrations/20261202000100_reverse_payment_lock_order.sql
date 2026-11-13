-- FIN-02.2 Step 4B: reverse_payment() takes the payment ACCOUNT lock before it locks and updates the payment row, and stamps reversed_at with clock_timestamp().
--
-- Before: it locked the ledger row first (SELECT ... FOR UPDATE on payment_transactions), stamped reversed_at with now() (the TRANSACTION START), and only then
-- took the account row lock through its UPDATE of the balance. record_payment() and (since 20261130000100) confirm_payment_goal_completion() lock the account
-- first and write afterwards, so reverse_payment was the one balance writer that did not. A future reconciliation checkpoint that serializes on the account lock
-- could therefore interleave with a reversal, and the now() stamp can be earlier than the moment the reversal's balance change actually lands.
--
-- After:  (1) an initial lookup WITHOUT a lock finds the payment's account_id (it is only a hint: it cannot be authoritative before any lock is held);
--         (2) the account row is locked (FOR UPDATE);
--         (3) the ledger row is then locked (FOR UPDATE) and RE-READ: the payment is revalidated under both locks (it still exists, still belongs to the caller,
--             still sits on the account that was locked, and is still not reversed), because it may have changed or been reversed while this call waited;
--         (4) the row is stamped reversed_at = clock_timestamp() and the balance is restored exactly as before.
-- Lock order: account -> ledger row. The second call of two simultaneous reversals of the same payment waits on the account lock, then re-reads the row under
-- the lock, sees reversed_at set, and raises "already been reversed", so the amount is added back at most once.
--
-- UNCHANGED (carried over exactly from 20261103000100_finance_payment_ledger.sql): the authentication check, ownership scoping (auth.uid()), the error messages,
-- the exactly-once rule, the balance restore (+amount ONLY if the payment had been applied to the balance, otherwise the balance is just read), the return
-- value, and the SECURITY DEFINER / search_path / grants. record_payment() and confirm_payment_goal_completion() are NOT touched, and neither is any table.
--
-- DEADLOCK CHECK (lock acquisition order, first lock first):
--   confirm_payment_goal_completion : goal -> account
--   record_payment                  : account
--   reverse_payment (this change)   : account -> ledger row            (was: ledger row -> account)
-- Resources are always taken in the order goal < account < ledger row. No function locks a ledger row and then an account or a goal, and no function locks an
-- account and then a goal, so the wait-for graph cannot contain a cycle. Inserting a new ledger row (record_payment, confirm) never locks an EXISTING ledger row.
-- (A concurrent DELETE of the account cascades to its goals and ledger rows; that interaction was true before this change and is resolved by the database
-- aborting one statement, never by corrupting data.)
--
-- Forward-only and safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

create or replace function public.reverse_payment(p_transaction_id uuid)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_hint_account uuid;
  v_locked_account uuid;
  v_account uuid;
  v_amount numeric;
  v_applied boolean;
  v_reversed timestamptz;
  v_balance numeric;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- (1) initial lookup, NO lock: only tells us which account to lock first. It is not trusted.
  select t.account_id into v_hint_account
    from public.payment_transactions t
    where t.id = p_transaction_id and t.user_id = auth.uid();
  if not found then
    raise exception 'Payment not found';
  end if;

  -- (2) the account lock comes first
  select a.id into v_locked_account
    from public.payment_accounts a
    where a.id = v_hint_account and a.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Payment not found';
  end if;

  -- (3) lock the ledger row and re-read it: everything is revalidated under both locks
  select t.account_id, t.amount, t.balance_applied, t.reversed_at
    into v_account, v_amount, v_applied, v_reversed
    from public.payment_transactions t
    where t.id = p_transaction_id and t.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if v_account is distinct from v_locked_account then
    raise exception 'Payment not found';
  end if;
  if v_reversed is not null then
    raise exception 'This payment has already been reversed';
  end if;

  -- (4) stamp the reversal at the actual moment (not the transaction start) and restore the balance exactly as before
  update public.payment_transactions set reversed_at = clock_timestamp() where id = p_transaction_id;

  if v_applied then
    update public.payment_accounts a set balance = a.balance + v_amount
      where a.id = v_account and a.user_id = auth.uid()
      returning a.balance into v_balance;
  else
    select a.balance into v_balance from public.payment_accounts a
      where a.id = v_account and a.user_id = auth.uid();
  end if;

  return v_balance;
end;
$$;
revoke all on function public.reverse_payment(uuid) from public;
-- anon can keep EXECUTE through Supabase's default function privileges even after PUBLIC is revoked. Production was verified with anon = false, so this explicit,
-- idempotent statement keeps the repository equal to that verified state (the function rejects unauthenticated callers regardless).
revoke all on function public.reverse_payment(uuid) from anon;
grant execute on function public.reverse_payment(uuid) to authenticated;

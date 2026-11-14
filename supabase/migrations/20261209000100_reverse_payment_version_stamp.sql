-- FIN-02.2 hardening 3 of 3: reverse_payment() allocates a new per-account ledger version for each successful reversal and stamps it on the payment row.
--
-- WHAT CHANGES (and nothing else): after the payment has been found and revalidated under BOTH locks (account first, then the ledger row) and is confirmed not yet
-- reversed, the function (1) increments payment_accounts.ledger_version by exactly one and (2) stamps that value into the row's reversed_version in the same
-- UPDATE that sets reversed_at. The reversal is therefore its own versioned event, later than the payment's own ledger_version, which is exactly what the table
-- constraints require (reversed_version > 0, only with reversed_at, and greater than the row's ledger_version when it has one).
--
-- LEGACY ROWS: a payment recorded before versioning (ledger_version NULL) is reversed normally and receives a reversed_version; a payment already reversed
-- before this migration keeps its NULL reversed_version.
--
-- LOCKING, DUPLICATES, FAILURE: lock order is unchanged (an unlocked lookup as a hint, then the account FOR UPDATE, then the ledger row FOR UPDATE with
-- revalidation). The allocation happens under the account lock, serialized with record_payment() and confirm_payment_goal_completion(). The checks that
-- raise "Payment not found" and "This payment has already been reversed" all come BEFORE the allocation, so a missing payment or a duplicate reversal consumes
-- no version. The increment, the stamp and the balance restore are one function call (one transaction): if anything fails they roll back together.
--
-- UNCHANGED (carried over exactly from 20261202000100_reverse_payment_lock_order.sql): the signature, SECURITY DEFINER, the search path, authentication and
-- ownership scoping, the error messages, the lookup/lock/revalidate sequence, clock_timestamp() for reversed_at, the balance restore (+amount only if the
-- payment had been applied), and the returned balance. Permissions are NOT touched: CREATE OR REPLACE keeps the existing grants (authenticated can execute;
-- anon and PUBLIC cannot).
--
-- Forward-only and safe to re-run (CREATE OR REPLACE). Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

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
  v_version bigint;
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

  -- (4) allocate the reversal's ledger version (one increment per successful reversal, under the account lock), stamp the reversal at the actual moment and
  -- with that version, and restore the balance exactly as before
  update public.payment_accounts a set ledger_version = a.ledger_version + 1
    where a.id = v_account and a.user_id = auth.uid()
    returning a.ledger_version into v_version;

  update public.payment_transactions set reversed_at = clock_timestamp(), reversed_version = v_version where id = p_transaction_id;

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

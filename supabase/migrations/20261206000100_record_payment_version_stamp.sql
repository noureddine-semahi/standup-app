-- FIN-02.2 Step 4C.2B: record_payment() allocates and stamps a per-account ledger version for every genuinely new payment.
--
-- WHAT CHANGES (and nothing else): after the idempotency check, record_payment() now (1) increments payment_accounts.ledger_version by exactly one for the
-- account being paid, returning the new value, and (2) writes that value into the new payment_transactions row's ledger_version column.
--
-- LOCKING AND ALLOCATION: the account row is already locked FOR UPDATE at the top of the function (before the idempotency lookup, before anything is written),
-- so the increment happens under that lock and concurrent record_payment() calls on one account are fully serialized: each one reads the committed counter,
-- adds one, and stamps its own row, so versions on one account are consecutive and unique (1, 2, 3, ...) and are assigned in lock order.
--
-- IDEMPOTENT RETRIES: a retry carrying a client_key that already exists RETURNS BEFORE the version is allocated (it still returns the original transaction id,
-- the current balance and was_duplicate = true), so it never consumes a version.
--
-- ROLLBACK SEMANTICS: the counter update, the ledger insert and the balance update are statements of ONE function call, i.e. one transaction. If anything
-- fails (a check constraint, an error in the insert or the balance update, a cancelled request), the whole call rolls back, including the counter increment,
-- so a failed or rolled-back payment never consumes a version. The input validation raises before any row is touched.
--
-- UNCHANGED (carried over exactly from 20261103000100_finance_payment_ledger.sql): the signature and the returned table, SECURITY DEFINER, the search path,
-- authentication and ownership scoping, the amount rules (FIN-02.1), the account FOR UPDATE lock and its position, the duplicate lookup, the balance_mode rule
-- (auto subtracts; manual subtracts only when p_apply_balance is true), the balance_applied flag, the returned values. Permissions are NOT touched: CREATE OR REPLACE
-- keeps the function's existing grants (authenticated can execute; anon and PUBLIC cannot). The trusted-owner UPDATE of ledger_version is allowed because the
-- function runs with its owner's privileges, while clients cannot write that column (20261205000100).
--
-- NOT STAMPED YET: confirm_payment_goal_completion() and reverse_payment() are untouched, so payments confirmed from a goal and reversals still carry NULL
-- versions and do not advance the counter. Until every writer stamps, the version is not a complete ordering and NO checkpoint may be created.
--
-- WHAT STATIC TESTS CANNOT PROVE: the serialization of simultaneous calls, that the increment and the insert commit or roll back together, and that retries
-- never advance the counter. Those rest on PostgreSQL's row-lock and transaction semantics and need a real PostgreSQL test (see the verification notes).
--
-- Forward-only and safe to re-run (CREATE OR REPLACE). Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

create or replace function public.record_payment(
  p_account_id uuid,
  p_amount numeric,
  p_paid_at timestamptz,
  p_note text,
  p_apply_balance boolean,
  p_client_key uuid
)
returns table (transaction_id uuid, new_balance numeric, was_duplicate boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_mode text;
  v_balance numeric;
  v_existing uuid;
  v_txn uuid;
  v_apply boolean;
  v_version bigint;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if p_amount <> round(p_amount, 2) or p_amount > 99999999.99 then
    raise exception 'Payment amount must be a valid amount with at most 2 decimal places';
  end if;

  -- Lock the account first so two concurrent submits with the same key
  -- serialize here and the second one sees the first's row.
  select a.balance_mode, a.balance into v_mode, v_balance
    from public.payment_accounts a
    where a.id = p_account_id and a.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Account not found';
  end if;

  if p_client_key is not null then
    select t.id into v_existing
      from public.payment_transactions t
      where t.user_id = auth.uid() and t.client_key = p_client_key;
    if found then
      return query select v_existing, v_balance, true;
      return;
    end if;
  end if;

  v_apply := (v_mode = 'auto') or coalesce(p_apply_balance, false);

  -- Allocate this payment's ledger version: exactly one increment per genuinely new payment, under the account lock taken above. A retry returned before here.
  update public.payment_accounts a set ledger_version = a.ledger_version + 1
    where a.id = p_account_id and a.user_id = auth.uid()
    returning a.ledger_version into v_version;

  insert into public.payment_transactions (account_id, user_id, amount, paid_at, note, balance_applied, client_key, ledger_version)
  values (p_account_id, auth.uid(), p_amount, coalesce(p_paid_at, now()), nullif(btrim(p_note), ''), v_apply, p_client_key, v_version)
  returning id into v_txn;

  if v_apply then
    update public.payment_accounts a set balance = a.balance - p_amount
      where a.id = p_account_id and a.user_id = auth.uid()
      returning a.balance into v_balance;
  end if;

  return query select v_txn, v_balance, false;
end;
$$;

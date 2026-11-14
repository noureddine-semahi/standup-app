-- FIN-02.2 hardening 1 of 3: record_payment() rejects a reused client key whose existing payment is for a DIFFERENT account or a DIFFERENT amount.
--
-- Before: the duplicate lookup was "where user_id = auth.uid() and client_key = p_client_key" with no account filter and no comparison. A key already used for a
-- payment on account A and submitted again for account B (or with another amount) found the original row and returned it as a successful duplicate: it came
-- back with the original transaction id, the balance of the account named in the NEW request, and was_duplicate = true, while nothing was recorded for the new
-- request. A caller (for example a payment modal where the amount was edited after a lost response) could believe the new payment was recorded.
--
-- After: when the key is found, the existing row's account_id and amount are compared with the request. If either differs, the call raises
-- "This request key was already used for a different payment" and changes nothing. A genuine retry (same account, same amount) is unchanged: it returns the
-- original transaction id, the current balance and was_duplicate = true. The comparison is deliberately limited to the account and the amount (numeric
-- comparison, so 10 equals 10.00); the apply-to-balance flag, paid_at and note are NOT compared, so a retry that differs only in those is still a retry.
--
-- STILL TRUE, NOT CHANGED: the check runs after the account lock and BEFORE the version allocation, so neither a retry nor a rejected request consumes a ledger
-- version. The unique index (user_id, client_key) is unchanged; two first submits of one key for two different accounts at the same moment still end with one
-- unique-violation error (rolled back together with its would-be version) rather than this message, because they hold different account locks.
--
-- UNCHANGED (carried over exactly from 20261206000100_record_payment_version_stamp.sql): the signature and returned table, SECURITY DEFINER, the search path,
-- authentication and ownership, the amount rules, the account FOR UPDATE lock and its position, the balance_mode rule, the version allocation and stamp, and the
-- returned values. Permissions are NOT touched: CREATE OR REPLACE keeps the existing grants (authenticated can execute; anon and PUBLIC cannot).
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
  v_existing_account uuid;
  v_existing_amount numeric;
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
    select t.id, t.account_id, t.amount into v_existing, v_existing_account, v_existing_amount
      from public.payment_transactions t
      where t.user_id = auth.uid() and t.client_key = p_client_key;
    if found then
      -- a key may only repeat the SAME payment: same account, same amount
      if v_existing_account is distinct from p_account_id or v_existing_amount is distinct from p_amount then
        raise exception 'This request key was already used for a different payment';
      end if;
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

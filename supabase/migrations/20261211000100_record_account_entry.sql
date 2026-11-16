-- FIN-02.2 Step 4C.3 (2 of 3): record_account_entry() records ONE interest charge, fee or balance adjustment on a payment account.
--
-- NEW FUNCTION (the only way to create a row in payment_account_entries; clients have no write privilege on that table):
--   record_account_entry(p_account_id uuid, p_kind text, p_amount numeric, p_entry_date date, p_statement_date date, p_reason text, p_note text,
--                        p_direction text, p_apply_balance boolean, p_client_key uuid)
--   returns table (entry_id uuid, new_balance numeric, was_duplicate boolean)
--
-- INPUT RULES: p_kind is interest, fee or adjustment (a checkpoint is NOT creatable here). p_amount is a positive magnitude with at most two decimals and at
-- most 99999999.99 (same rule as payments). p_entry_date is required. Interest requires p_statement_date. An adjustment requires p_direction ('increase' or
-- 'decrease') and a non-blank reason; for interest and fee p_direction must be NULL. Reason and note are trimmed, blank becomes NULL, and each may be at most
-- 500 characters. All of this raises BEFORE any row is touched.
--
-- BALANCE EFFECT (the tracked balance is the amount OWED): interest and fee RAISE it by the amount; an adjustment raises or lowers it by the amount according to
-- p_direction and is always applied. On an automatic account interest/fee are always applied; on a manual account they are applied only when p_apply_balance is
-- true (otherwise the row is recorded with balance_delta 0 and balance_applied false). The signed effect is stored in balance_delta and added to the balance in
-- the same call.
--
-- LOCKING AND VERSION: the account row is locked FOR UPDATE first (ownership checked in the same statement), before anything is read or written, exactly like
-- record_payment. The ledger version is allocated under that lock, once per genuinely new entry, and stamped on the row; so entries are serialized with
-- payments, goal payments and reversals on the same account and share the same counter.
--
-- IDEMPOTENCY: with a p_client_key the lookup runs after the account lock. If the key already exists for this user the call NEVER writes: it returns the original
-- entry id, the current balance and was_duplicate = true when the existing entry is the same request (same account, kind, amount, entry date, statement date and
-- signed balance effect); if any of those differ it raises "This request key was already used for a different entry". A retry or a rejected request returns
-- before the version is allocated, so it consumes none. (The signed balance effect includes the apply flag on a manual account and the direction of an
-- adjustment; reason and note are not compared.) Two first submits of one key for two different accounts at the same moment end with one unique-violation
-- error that rolls back with its would-be version.
--
-- ATOMICITY: the version increment, the insert and the balance update are one function call, i.e. one transaction; any failure rolls all of it back.
--
-- PERMISSIONS: SECURITY DEFINER with search_path = public, owner postgres. Execute is revoked from PUBLIC and anon and granted to authenticated only, like the
-- payment functions. Ownership comes from auth.uid(): a caller can only touch their own accounts.
--
-- NOT DONE HERE: reversal (next migration), checkpoints and any reconciliation. Forward-only; safe to re-run (CREATE OR REPLACE, idempotent grants).
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

create or replace function public.record_account_entry(
  p_account_id uuid,
  p_kind text,
  p_amount numeric,
  p_entry_date date,
  p_statement_date date,
  p_reason text,
  p_note text,
  p_direction text,
  p_apply_balance boolean,
  p_client_key uuid
)
returns table (entry_id uuid, new_balance numeric, was_duplicate boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_mode text;
  v_balance numeric;
  v_reason text;
  v_note text;
  v_apply boolean;
  v_delta numeric;
  v_existing uuid;
  v_existing_account uuid;
  v_existing_kind text;
  v_existing_amount numeric;
  v_existing_delta numeric;
  v_existing_entry_date date;
  v_existing_statement_date date;
  v_entry uuid;
  v_version bigint;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_kind is null or p_kind not in ('interest', 'fee', 'adjustment') then
    raise exception 'Entry kind must be interest, fee or adjustment';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Entry amount must be greater than zero';
  end if;
  if p_amount <> round(p_amount, 2) or p_amount > 99999999.99 then
    raise exception 'Entry amount must be a valid amount with at most 2 decimal places';
  end if;
  if p_entry_date is null then
    raise exception 'Entry date is required';
  end if;
  if p_kind = 'interest' and p_statement_date is null then
    raise exception 'Interest requires a statement date';
  end if;
  v_reason := nullif(btrim(p_reason), '');
  v_note := nullif(btrim(p_note), '');
  if char_length(v_reason) > 500 then
    raise exception 'Reason must be at most 500 characters';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'Note must be at most 500 characters';
  end if;
  if p_kind = 'adjustment' then
    if p_direction is null or p_direction not in ('increase', 'decrease') then
      raise exception 'An adjustment requires a direction (increase or decrease)';
    end if;
    if v_reason is null then
      raise exception 'An adjustment requires a reason';
    end if;
  elsif p_direction is not null then
    raise exception 'A direction applies only to adjustments';
  end if;

  -- The account lock comes first (ownership checked here), before the idempotency lookup and before anything is written.
  select a.balance_mode, a.balance into v_mode, v_balance
    from public.payment_accounts a
    where a.id = p_account_id and a.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Account not found';
  end if;

  v_apply := p_kind = 'adjustment' or v_mode = 'auto' or coalesce(p_apply_balance, false);
  v_delta := case when not v_apply then 0 when p_direction = 'decrease' then -p_amount else p_amount end;

  if p_client_key is not null then
    select e.id, e.account_id, e.kind, e.amount, e.balance_delta, e.entry_date, e.statement_date
      into v_existing, v_existing_account, v_existing_kind, v_existing_amount, v_existing_delta, v_existing_entry_date, v_existing_statement_date
      from public.payment_account_entries e
      where e.user_id = auth.uid() and e.client_key = p_client_key;
    if found then
      -- a key may only repeat the SAME entry
      if v_existing_account is distinct from p_account_id
         or v_existing_kind is distinct from p_kind
         or v_existing_amount is distinct from p_amount
         or v_existing_delta is distinct from v_delta
         or v_existing_entry_date is distinct from p_entry_date
         or v_existing_statement_date is distinct from p_statement_date then
        raise exception 'This request key was already used for a different entry';
      end if;
      return query select v_existing, v_balance, true;
      return;
    end if;
  end if;

  -- Allocate this entry's ledger version: exactly one increment per genuinely new entry, under the account lock taken above. A retry returned before here.
  update public.payment_accounts a set ledger_version = a.ledger_version + 1
    where a.id = p_account_id and a.user_id = auth.uid()
    returning a.ledger_version into v_version;

  insert into public.payment_account_entries
    (account_id, user_id, kind, amount, balance_delta, balance_applied, entry_date, statement_date, reason, note, client_key, ledger_version)
  values
    (p_account_id, auth.uid(), p_kind, p_amount, v_delta, v_apply, p_entry_date, p_statement_date, v_reason, v_note, p_client_key, v_version)
  returning id into v_entry;

  if v_delta <> 0 then
    update public.payment_accounts a set balance = a.balance + v_delta
      where a.id = p_account_id and a.user_id = auth.uid()
      returning a.balance into v_balance;
  end if;

  return query select v_entry, v_balance, false;
end;
$$;

revoke all on function public.record_account_entry(uuid, text, numeric, date, date, text, text, text, boolean, uuid) from public, anon;
grant execute on function public.record_account_entry(uuid, text, numeric, date, date, text, text, text, boolean, uuid) to authenticated;

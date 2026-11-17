-- FIN-02.2 Step 4C.4 (1 of 2): create_opening_checkpoint() records ONE explicitly confirmed opening checkpoint for a payment account.
--
-- NEW FUNCTION (the only way to create a checkpoint row; clients cannot write payment_account_entries):
--   create_opening_checkpoint(p_account_id uuid, p_confirmed_balance numeric, p_expected_ledger_version bigint, p_statement_date date, p_note text,
--                             p_client_key uuid)
--   returns table (entry_id uuid, checkpoint_version bigint, account_balance numeric, was_duplicate boolean)
--
-- WHAT AN OPENING CHECKPOINT IS: the user's explicit statement "at this ledger version this account's tracked balance is X, and I confirm it". It is the
-- baseline that reconcile_payment_account() (next migration) counts forward from. Nothing creates one automatically: no migration, trigger or backfill calls
-- this function, and existing accounts have none until their owner confirms one.
--
-- EXPLICIT CONFIRMATION: the caller must pass BOTH the balance they confirm (p_confirmed_balance) and the ledger version they were looking at
-- (p_expected_ledger_version). Under the account lock the function compares them with the account's CURRENT balance and ledger_version; if either differs
-- (a payment, entry, reversal or direct edit happened meanwhile) it raises and writes nothing, so a stale confirmation can never be recorded. The function
-- never changes the balance and never "corrects" it.
--
-- THE BOUNDARY IS A VERSION, NOT A DATE: one account ledger version is allocated for the checkpoint (under the account lock, after every rejection) and
-- stamped on its row. Every ledger row with a version at or below it, and every legacy row with a NULL version (recorded before versioning), is covered by
-- the confirmed balance; rows stamped above it are counted by the reconciliation. p_statement_date is the "as of" date the user gives; it is stored (also as
-- entry_date, because the table requires one) for display only and is never used to order or reconcile anything.
--
-- ONE PER ACCOUNT: an account that already has any checkpoint is rejected ("This account already has an opening checkpoint"). Later statement checkpoints are
-- NOT part of this step. The table's own unique index (account, statement date) and its shape constraint (amount 0, balance_delta 0, balance_after set,
-- never reversible, immutable by trigger) still apply.
--
-- IDEMPOTENCY: with a p_client_key, after the account lock: the same checkpoint (same account, confirmed balance and as-of date) returns the original entry
-- with was_duplicate = true and the current balance, even if the account has changed since; a key already used for anything different raises "This request
-- key was already used for a different checkpoint". Retries and rejected requests consume no version.
--
-- LOCKING / ATOMICITY: account row FOR UPDATE first (ownership checked by auth.uid() in the same statement), then lookups, then one allocation, one insert; one
-- function call = one transaction, so any failure rolls everything back, including the version.
--
-- PERMISSIONS: SECURITY DEFINER, search_path = public. Execute revoked from PUBLIC and anon, granted to authenticated only.
--
-- NOT DONE HERE: no UI, no statement checkpoints, no automatic correction, no data changes. Forward-only; safe to re-run (CREATE OR REPLACE, idempotent grants).
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

create or replace function public.create_opening_checkpoint(
  p_account_id uuid,
  p_confirmed_balance numeric,
  p_expected_ledger_version bigint,
  p_statement_date date,
  p_note text,
  p_client_key uuid
)
returns table (entry_id uuid, checkpoint_version bigint, account_balance numeric, was_duplicate boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_balance numeric;
  v_counter bigint;
  v_note text;
  v_existing uuid;
  v_existing_account uuid;
  v_existing_kind text;
  v_existing_balance numeric;
  v_existing_date date;
  v_existing_version bigint;
  v_entry uuid;
  v_version bigint;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_confirmed_balance is null then
    raise exception 'A confirmed balance is required';
  end if;
  if p_expected_ledger_version is null or p_expected_ledger_version < 0 then
    raise exception 'The ledger version being confirmed is required';
  end if;
  if p_statement_date is null then
    raise exception 'An as-of date is required';
  end if;
  if p_confirmed_balance <> round(p_confirmed_balance, 2) or abs(p_confirmed_balance) > 99999999.99 then
    raise exception 'Confirmed balance must be a valid amount with at most 2 decimal places';
  end if;
  v_note := nullif(btrim(p_note), '');
  if char_length(v_note) > 500 then
    raise exception 'Note must be at most 500 characters';
  end if;

  -- The account lock comes first (ownership checked here).
  select a.balance, a.ledger_version into v_balance, v_counter
    from public.payment_accounts a
    where a.id = p_account_id and a.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Account not found';
  end if;

  if p_client_key is not null then
    select e.id, e.account_id, e.kind, e.balance_after, e.statement_date, e.ledger_version
      into v_existing, v_existing_account, v_existing_kind, v_existing_balance, v_existing_date, v_existing_version
      from public.payment_account_entries e
      where e.user_id = auth.uid() and e.client_key = p_client_key;
    if found then
      if v_existing_account is distinct from p_account_id
         or v_existing_kind is distinct from 'checkpoint'
         or v_existing_balance is distinct from p_confirmed_balance
         or v_existing_date is distinct from p_statement_date then
        raise exception 'This request key was already used for a different checkpoint';
      end if;
      return query select v_existing, v_existing_version, v_balance, true;
      return;
    end if;
  end if;

  if exists (select 1 from public.payment_account_entries e where e.account_id = p_account_id and e.kind = 'checkpoint') then
    raise exception 'This account already has an opening checkpoint';
  end if;

  -- explicit, current confirmation: nothing may have changed since the user looked
  if p_confirmed_balance <> v_balance then
    raise exception 'The confirmed balance does not match the current tracked balance';
  end if;
  if p_expected_ledger_version <> v_counter then
    raise exception 'The account changed since it was confirmed; review it and confirm again';
  end if;

  -- Allocate the checkpoint's ledger version (one increment, under the account lock). Every rejection above returned before here.
  update public.payment_accounts a set ledger_version = a.ledger_version + 1
    where a.id = p_account_id and a.user_id = auth.uid()
    returning a.ledger_version into v_version;

  insert into public.payment_account_entries
    (account_id, user_id, kind, amount, balance_delta, balance_applied, balance_after, entry_date, statement_date, note, client_key, ledger_version)
  values
    (p_account_id, auth.uid(), 'checkpoint', 0, 0, true, p_confirmed_balance, p_statement_date, p_statement_date, v_note, p_client_key, v_version)
  returning id into v_entry;

  return query select v_entry, v_version, v_balance, false;
end;
$$;

revoke all on function public.create_opening_checkpoint(uuid, numeric, bigint, date, text, uuid) from public, anon;
grant execute on function public.create_opening_checkpoint(uuid, numeric, bigint, date, text, uuid) to authenticated;

-- FIN-02.2 Step 4C.4 (follow-up): create_opening_checkpoint() refuses to create a checkpoint while clients can still edit payment_accounts.balance directly.
--
-- WHY: a checkpoint blesses the tracked balance as the baseline that reconcile_payment_account() counts forward from. While the 'authenticated' role can still
-- UPDATE payment_accounts.balance (the column grant of 20261205000100, used today by the app's account edit form), a balance change can happen outside the
-- versioned ledger, invisible to the version counter, so a baseline taken now could not be defended. reconcile_payment_account() already reports
-- balance_write_path_open / reliable = false for the same condition; this makes the checkpoint itself refuse it, using the same has_column_privilege test.
--
-- WHAT CHANGES (and nothing else): create_opening_checkpoint() gains ONE guard that raises "Opening checkpoints are disabled while the balance can still be
-- edited directly" when 'authenticated' holds UPDATE on payment_accounts.balance. It sits AFTER the account lock, AFTER the idempotent-retry return and AFTER the
-- "already has an opening checkpoint" check, and BEFORE the confirmation checks and the version allocation, so: a legitimate retry of an already-created
-- checkpoint still returns the original; a refused request writes nothing and consumes no version; and no other check is weakened.
--
-- EFFECT IN PRODUCTION: until the balance column is revoked from clients (a later step, together with the UI change that replaces direct balance edits), no
-- checkpoint can be created. Nothing is lost: no checkpoint exists yet and nothing in the app calls this function.
--
-- UNCHANGED (carried over exactly from 20261213000100_create_opening_checkpoint.sql): the signature and returned table, SECURITY DEFINER, the search path, all
-- input validation, the account lock and its position, the idempotency rules, the one-checkpoint rule, the explicit balance and version confirmation, the
-- version allocation and the insert. Permissions are NOT touched: CREATE OR REPLACE keeps the existing grants (authenticated can execute; anon and PUBLIC cannot).
--
-- Forward-only and safe to re-run (CREATE OR REPLACE). Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

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

  -- A checkpoint blesses the tracked balance, so refuse to create one while clients can still write that balance outside the versioned ledger.
  if has_column_privilege('authenticated', 'public.payment_accounts', 'balance', 'UPDATE') then
    raise exception 'Opening checkpoints are disabled while the balance can still be edited directly';
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

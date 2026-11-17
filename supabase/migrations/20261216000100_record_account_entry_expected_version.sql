-- FIN-02.2 Step 4C.4B (1 of 2): record_account_entry() gains an optional expected-ledger-version check, so a caller that computed an amount from a balance it
-- LOADED can refuse to apply it on top of a newer balance.
--
-- WHY: the app is replacing direct balance edits with adjustments. "Set the balance to X" is turned into an adjustment of (X - the balance the user saw). If
-- the balance moved in between (another tab or device, a payment, a reversal, interest), applying that difference would NOT leave the balance at X and would
-- silently overwrite the newer change. Every balance-changing operation bumps the account's ledger_version under the account lock, so "the version I loaded is
-- still the current version" proves "the balance I loaded is still the current balance", atomically with the write.
--
-- WHAT CHANGES: a new LAST parameter p_expected_ledger_version bigint DEFAULT NULL.
--   * NULL (the default): no check; behaviour is exactly the previous function.
--   * not NULL: after the account lock and AFTER the idempotent-retry return, and BEFORE the version allocation, the call raises "The account changed since it was
--     loaded; review it and try again" when it differs from the account's current ledger_version, writing nothing and consuming no version.
-- Placed after the retry return on purpose: a retry of an entry that already succeeded returns the original even though the version has moved since.
-- The lock select now also reads ledger_version. Everything else is carried over exactly from 20261211000100_record_account_entry.sql: validation, the signed
-- balance effect, the account lock and its position, the key-mismatch rule, the single version allocation, the insert, the balance update and the result.
--
-- REPLACING THE FUNCTION: adding a parameter creates a second overload, and a call that omits the new argument would then match both. So the previous 10-argument
-- function is DROPPED in the same script and the 11-argument one is created, with its permissions re-stated (revoke from PUBLIC and anon, grant to authenticated
-- only, SECURITY DEFINER, search_path = public). Nothing in the app calls record_account_entry yet, so no caller is affected; the 4C.4B UI is its first one.
-- Run the whole file in ONE execution (Supabase Dashboard -> SQL Editor -> New query). Forward-only and safe to re-run. NOT applied by the app or by CI.
--
-- ATOMIC: the statements below are wrapped in an explicit BEGIN / COMMIT, so the DROP and the CREATE (and the permission statements) succeed or fail together; if
-- anything fails, nothing is dropped and the previous 10-argument function stays in place.

begin;

drop function if exists public.record_account_entry(uuid, text, numeric, date, date, text, text, text, boolean, uuid);

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
  p_client_key uuid,
  p_expected_ledger_version bigint default null
)
returns table (entry_id uuid, new_balance numeric, was_duplicate boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_mode text;
  v_balance numeric;
  v_counter bigint;
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
  select a.balance_mode, a.balance, a.ledger_version into v_mode, v_balance, v_counter
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

  -- The caller computed its amount from the version it loaded: refuse to apply it on top of anything newer.
  if p_expected_ledger_version is not null and p_expected_ledger_version <> v_counter then
    raise exception 'The account changed since it was loaded; review it and try again';
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

revoke all on function public.record_account_entry(uuid, text, numeric, date, date, text, text, text, boolean, uuid, bigint) from public, anon;
grant execute on function public.record_account_entry(uuid, text, numeric, date, date, text, text, text, boolean, uuid, bigint) to authenticated;

commit;

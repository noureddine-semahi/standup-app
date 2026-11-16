-- FIN-02.2 Step 4C.3 (3 of 3): reverse_account_entry() reverses ONE interest, fee or adjustment entry.
--
-- NEW FUNCTION: reverse_account_entry(p_entry_id uuid) returns numeric (the account's balance after the reversal).
--
-- BEHAVIOUR: the entry is STAMPED reversed (reversed_at = clock_timestamp(), reversed_version = the new account ledger version); it is never deleted or edited.
-- The balance effect it had is undone: balance = balance - balance_delta (so a reversed interest/fee lowers the balance again, a reversed increase-adjustment
-- lowers it, a reversed decrease-adjustment raises it, and an entry recorded with balance_delta 0 leaves the balance alone). The reversal is its own versioned
-- event: exactly one account version is allocated per successful reversal.
--
-- LOCKING (same order as reverse_payment): an unlocked lookup only to learn which account to lock; the account row FOR UPDATE first; then the entry row FOR UPDATE,
-- re-read and revalidated under both locks (same account, not already reversed). Ownership is checked at each step through auth.uid().
--
-- REJECTIONS, all BEFORE the version is allocated so none consumes a version: not authenticated; entry not found or not the caller's ("Entry not found");
-- a reconciliation checkpoint ("A reconciliation checkpoint cannot be reversed"; the table also forbids it); an entry already reversed
-- ("This entry has already been reversed"), including a concurrent second reversal, which waits on the locks and then sees the stamp.
--
-- ATOMICITY: the version increment, the stamp and the balance restore are one function call, i.e. one transaction; any failure rolls all of it back.
--
-- PERMISSIONS: SECURITY DEFINER with search_path = public, owner postgres. Execute is revoked from PUBLIC and anon and granted to authenticated only.
--
-- Forward-only; safe to re-run (CREATE OR REPLACE, idempotent grants). Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

create or replace function public.reverse_account_entry(p_entry_id uuid)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_hint_account uuid;
  v_locked_account uuid;
  v_account uuid;
  v_kind text;
  v_delta numeric;
  v_reversed timestamptz;
  v_balance numeric;
  v_version bigint;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- (1) initial lookup, NO lock: only tells us which account to lock first. It is not trusted.
  select e.account_id into v_hint_account
    from public.payment_account_entries e
    where e.id = p_entry_id and e.user_id = auth.uid();
  if not found then
    raise exception 'Entry not found';
  end if;

  -- (2) the account lock comes first
  select a.id into v_locked_account
    from public.payment_accounts a
    where a.id = v_hint_account and a.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Entry not found';
  end if;

  -- (3) lock the entry row and re-read it: everything is revalidated under both locks
  select e.account_id, e.kind, e.balance_delta, e.reversed_at
    into v_account, v_kind, v_delta, v_reversed
    from public.payment_account_entries e
    where e.id = p_entry_id and e.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Entry not found';
  end if;
  if v_account is distinct from v_locked_account then
    raise exception 'Entry not found';
  end if;
  if v_kind = 'checkpoint' then
    raise exception 'A reconciliation checkpoint cannot be reversed';
  end if;
  if v_reversed is not null then
    raise exception 'This entry has already been reversed';
  end if;

  -- (4) allocate the reversal's ledger version (one increment per successful reversal, under the account lock), stamp the entry, undo its balance effect
  update public.payment_accounts a set ledger_version = a.ledger_version + 1
    where a.id = v_account and a.user_id = auth.uid()
    returning a.ledger_version into v_version;

  update public.payment_account_entries set reversed_at = clock_timestamp(), reversed_version = v_version where id = p_entry_id;

  if v_delta <> 0 then
    update public.payment_accounts a set balance = a.balance - v_delta
      where a.id = v_account and a.user_id = auth.uid()
      returning a.balance into v_balance;
  else
    select a.balance into v_balance from public.payment_accounts a
      where a.id = v_account and a.user_id = auth.uid();
  end if;

  return v_balance;
end;
$$;

revoke all on function public.reverse_account_entry(uuid) from public, anon;
grant execute on function public.reverse_account_entry(uuid) to authenticated;

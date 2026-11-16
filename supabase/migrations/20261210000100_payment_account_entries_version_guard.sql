-- FIN-02.2 Step 4C.3 (1 of 3): extend the entries immutability trigger to the ledger version columns.
--
-- WHAT CHANGES: the existing trigger function payment_account_entries_immutable() (20261201000100) froze every business column of a payment_account_entries
-- row except the one-time reversed_at stamp, but it predates the version columns (20261204000100) and does not list them. Replaced here, the function now ALSO:
--   * freezes ledger_version (the version a row was written at can never be edited, in either direction, including from NULL to a value or back);
--   * allows reversed_version to be set exactly once and never changed or cleared afterwards;
--   * requires that a reversal stamp carry a version: setting reversed_at on a row that was not yet reversed is refused unless reversed_version is set in the
--     same UPDATE (the table is empty of reversals today, because no function writes it yet, so this cannot conflict with existing data; it makes every
--     future reversal a versioned event).
-- Everything it already enforced is kept exactly: all other columns frozen, reversed_at stamped once and never changed, same error texts for those cases.
--
-- WHY: clients already have no INSERT/UPDATE/DELETE privilege on the table and no write policy (20261201000100); this is defence in depth so that not even a
-- privileged path other than the entry functions of the next two migrations can rewrite a version or a reversal.
--
-- NOT CHANGED: the trigger itself (name, timing, BEFORE UPDATE FOR EACH ROW), the table, its constraints, RLS, privileges. The function is SECURITY INVOKER as
-- before. No data is read or written. Forward-only and safe to re-run (CREATE OR REPLACE). Run in Supabase Dashboard -> SQL Editor -> New query.

create or replace function public.payment_account_entries_immutable()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.account_id, new.user_id, new.kind, new.amount, new.balance_delta, new.balance_applied, new.balance_after, new.entry_date,
      new.statement_date, new.reason, new.note, new.client_key, new.created_at, new.seq, new.ledger_version)
     is distinct from
     (old.id, old.account_id, old.user_id, old.kind, old.amount, old.balance_delta, old.balance_applied, old.balance_after, old.entry_date,
      old.statement_date, old.reason, old.note, old.client_key, old.created_at, old.seq, old.ledger_version) then
    raise exception 'Ledger entries cannot be edited';
  end if;
  if old.reversed_at is not null and new.reversed_at is distinct from old.reversed_at then
    raise exception 'This entry has already been reversed';
  end if;
  if old.reversed_version is not null and new.reversed_version is distinct from old.reversed_version then
    raise exception 'This entry has already been reversed';
  end if;
  if old.reversed_at is null and new.reversed_at is not null and new.reversed_version is null then
    raise exception 'A reversal must carry a ledger version';
  end if;
  return new;
end;
$$;

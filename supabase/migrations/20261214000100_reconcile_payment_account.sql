-- FIN-02.2 Step 4C.4 (2 of 2): reconcile_payment_account() READ-ONLY reconciliation of one account against its latest checkpoint.
--
-- NEW FUNCTION: reconcile_payment_account(p_account_id uuid, p_statement_balance numeric default null)
--   returns table (checkpoint_id uuid, checkpoint_version bigint, checkpoint_balance numeric, current_ledger_version bigint, calculated_balance numeric,
--                  tracked_balance numeric, statement_balance numeric, tracked_difference numeric, statement_difference numeric,
--                  version_gap boolean, balance_write_path_open boolean, reliable boolean, status text)
--
-- IT WRITES NOTHING. It never changes a balance, never creates an entry, a checkpoint or an adjustment, and never allocates a version. A difference is only
-- REPORTED; resolving one is a separate, explicit action by the user (for example an adjustment entry).
--
-- THE CALCULATION (versions only, never dates; V = the latest checkpoint's ledger_version, B = its confirmed balance):
--   calculated = B
--     - sum(amount)        of APPLIED payments stamped above V                  (a payment recorded after the checkpoint)
--     + sum(amount)        of APPLIED payments whose reversal is stamped above V (a reversal after the checkpoint, even of an older payment)
--     + sum(balance_delta) of entries stamped above V                           (interest, fees, adjustments; unapplied ones have delta 0)
--     - sum(balance_delta) of entries whose reversal is stamped above V
--   Payments recorded without balance effect (balance_applied false) are excluded. Legacy rows (ledger_version NULL) and rows at or below V are covered by B and
--   never counted again; a legacy payment reversed AFTER the checkpoint carries a reversed_version above V and is counted by its reversal. statement dates play
--   no part. The latest checkpoint is the one with the highest ledger_version; an account with no checkpoint returns status 'no_checkpoint' and no numbers.
--
-- COMPLETENESS CHECK (version_gap): every version above V up to the account's counter must be stamped on exactly one ledger event (a payment, an entry, or a
-- reversal of either). Any missing, duplicated or out-of-range version sets version_gap and status 'ledger_incomplete'.
--
-- COMPARISONS: tracked_difference = tracked balance - calculated; statement_difference = the user's reported balance - calculated (NULL when none given).
-- p_statement_balance is the balance the user reports for the account NOW, i.e. covering all activity recorded so far. A statement's own date does not map to a
-- ledger version, so a statement from an earlier date must not be compared here unless nothing has been recorded since.
--   status: 'no_checkpoint' | 'ledger_incomplete' | 'tracked_mismatch' | 'statement_mismatch' | 'reconciled' (in that priority).
--
-- HONESTY FLAGS: balance_write_path_open is TRUE while the 'authenticated' role can still UPDATE payment_accounts.balance directly (today the column grant of
-- 20261205000100 allows it, and the app's account edit form uses it); such an edit is invisible to the versions. reliable = (NOT version_gap AND NOT
-- balance_write_path_open); while it is false, even 'reconciled' must not be presented as a guarantee: an unversioned edit could mask or mimic a discrepancy.
--
-- LOCKING: the account row is locked FOR SHARE (ownership by auth.uid()) before anything is read, so no ledger writer (they all take FOR UPDATE on the account
-- first) can commit between the reads; concurrent reconciliations do not block each other.
--
-- PERMISSIONS: SECURITY DEFINER, search_path = public. Execute revoked from PUBLIC and anon, granted to authenticated only.
-- Forward-only; safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

create or replace function public.reconcile_payment_account(p_account_id uuid, p_statement_balance numeric default null)
returns table (
  checkpoint_id uuid,
  checkpoint_version bigint,
  checkpoint_balance numeric,
  current_ledger_version bigint,
  calculated_balance numeric,
  tracked_balance numeric,
  statement_balance numeric,
  tracked_difference numeric,
  statement_difference numeric,
  version_gap boolean,
  balance_write_path_open boolean,
  reliable boolean,
  status text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_tracked numeric;
  v_counter bigint;
  v_cp_id uuid;
  v_cp_version bigint;
  v_cp_balance numeric;
  v_calc numeric;
  v_n bigint;
  v_distinct bigint;
  v_min bigint;
  v_max bigint;
  v_gap boolean;
  v_open boolean;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_statement_balance is not null and (p_statement_balance <> round(p_statement_balance, 2) or abs(p_statement_balance) > 99999999.99) then
    raise exception 'Statement balance must be a valid amount with at most 2 decimal places';
  end if;

  select a.balance, a.ledger_version into v_tracked, v_counter
    from public.payment_accounts a
    where a.id = p_account_id and a.user_id = auth.uid()
    for share;
  if not found then
    raise exception 'Account not found';
  end if;

  v_open := has_column_privilege('authenticated', 'public.payment_accounts', 'balance', 'UPDATE');

  select e.id, e.ledger_version, e.balance_after into v_cp_id, v_cp_version, v_cp_balance
    from public.payment_account_entries e
    where e.account_id = p_account_id and e.user_id = auth.uid() and e.kind = 'checkpoint'
    order by e.ledger_version desc
    limit 1;
  if not found then
    return query select null::uuid, null::bigint, null::numeric, v_counter, null::numeric, v_tracked, p_statement_balance, null::numeric, null::numeric,
                        false, v_open, false, 'no_checkpoint'::text;
    return;
  end if;

  select
    v_cp_balance
    - coalesce((select sum(t.amount) from public.payment_transactions t where t.account_id = p_account_id and t.balance_applied and t.ledger_version > v_cp_version), 0)
    + coalesce((select sum(t.amount) from public.payment_transactions t where t.account_id = p_account_id and t.balance_applied and t.reversed_version > v_cp_version), 0)
    + coalesce((select sum(e.balance_delta) from public.payment_account_entries e where e.account_id = p_account_id and e.ledger_version > v_cp_version), 0)
    - coalesce((select sum(e.balance_delta) from public.payment_account_entries e where e.account_id = p_account_id and e.reversed_version > v_cp_version), 0)
  into v_calc;

  select count(*), count(distinct x.v), min(x.v), max(x.v) into v_n, v_distinct, v_min, v_max
    from (
      select t.ledger_version v from public.payment_transactions t where t.account_id = p_account_id and t.ledger_version > v_cp_version
      union all
      select t.reversed_version from public.payment_transactions t where t.account_id = p_account_id and t.reversed_version > v_cp_version
      union all
      select e.ledger_version from public.payment_account_entries e where e.account_id = p_account_id and e.ledger_version > v_cp_version
      union all
      select e.reversed_version from public.payment_account_entries e where e.account_id = p_account_id and e.reversed_version > v_cp_version
    ) x;
  v_gap := not (v_n = v_counter - v_cp_version and v_n = v_distinct and (v_n = 0 or (v_min = v_cp_version + 1 and v_max = v_counter)));

  v_status := case
    when v_gap then 'ledger_incomplete'
    when v_tracked <> v_calc then 'tracked_mismatch'
    when p_statement_balance is not null and p_statement_balance <> v_calc then 'statement_mismatch'
    else 'reconciled'
  end;

  return query select v_cp_id, v_cp_version, v_cp_balance, v_counter, v_calc, v_tracked, p_statement_balance,
                      v_tracked - v_calc, case when p_statement_balance is null then null else p_statement_balance - v_calc end,
                      v_gap, v_open, (not v_gap and not v_open), v_status;
end;
$$;

revoke all on function public.reconcile_payment_account(uuid, numeric) from public, anon;
grant execute on function public.reconcile_payment_account(uuid, numeric) to authenticated;

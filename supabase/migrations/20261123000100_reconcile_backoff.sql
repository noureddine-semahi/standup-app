-- Phase 5.6 step 9.2: retry/backoff memory for subscription reconciliation.
--
-- WHY A MIGRATION: reconciliation (POST /api/billing/reconcile) picks the oldest-checked billing records first. A record Stripe can't answer for
-- (subscription missing, customer mismatch, repeated Stripe errors) is left untouched, so it stays the oldest forever and takes a slot in EVERY
-- batch, starving healthy records. Nothing in the existing schema can remember "this one failed, try again later". The only column that looks
-- usable, subscription_synced_at, must NOT be reused: it is the snapshot time the stale-snapshot guard in sync_stripe_subscription compares
-- against (moving it would make a newer webhook look stale) and moving it would also make a failure look like a successful check.
--
-- WHAT IT ADDS (narrow): four columns on public.account_billing that only reconciliation reads and writes, and one service-role-only function
-- that can touch ONLY those four columns. It does not touch status, plan, price, period, cancellation or any other billing field, never an
-- entitlement, trial or admin grant, and sync_stripe_subscription (the webhook/reconcile writer) is not changed at all: its upsert never names
-- these columns, so a webhook and a backoff update cannot overwrite each other.
--
-- The columns also serve as the operational record of failures (nothing is discarded):
--   select user_id, reconcile_last_outcome, reconcile_failures, reconcile_last_failed_at, reconcile_next_attempt_at
--   from public.account_billing where reconcile_failures > 0 order by reconcile_last_failed_at desc;
--
-- PRIVACY / SECURITY: same table, same protection: RLS on with no policies, all privileges revoked from anon and authenticated. The function is
-- executable by the service role only. Idempotent: safe to run twice.

alter table public.account_billing add column if not exists reconcile_failures integer not null default 0;
alter table public.account_billing add column if not exists reconcile_last_outcome text;
alter table public.account_billing add column if not exists reconcile_last_failed_at timestamptz;
alter table public.account_billing add column if not exists reconcile_next_attempt_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'account_billing_reconcile_failures_range') then
    alter table public.account_billing add constraint account_billing_reconcile_failures_range check (reconcile_failures between 0 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'account_billing_reconcile_last_outcome_values') then
    alter table public.account_billing add constraint account_billing_reconcile_last_outcome_values
      check (reconcile_last_outcome is null or reconcile_last_outcome in ('missing', 'conflict', 'stripe_error', 'ignored'));
  end if;
end $$;

-- Records one reconciliation result for the record that holds this Stripe subscription ID.
--   p_outcome 'ok'                      -> the check worked: forget any earlier failures (the record becomes eligible on the normal cooldown).
--   p_outcome missing|conflict|stripe_error|ignored -> count one more failure, remember what kind, and do not retry before p_next_attempt_at.
-- The retry time is chosen by the caller but bounded here: never in the past, never more than 7 days ahead, 1 hour if omitted.
-- Returns 'recorded', 'unknown' (no record holds that subscription) or 'invalid'.
create or replace function public.record_reconcile_result(p_subscription_id text, p_outcome text, p_next_attempt_at timestamptz)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_subscription_id is null or p_subscription_id not like 'sub\_%'
     or p_outcome is null or p_outcome not in ('ok', 'missing', 'conflict', 'stripe_error', 'ignored') then
    return 'invalid';
  end if;

  if p_outcome = 'ok' then
    update public.account_billing
       set reconcile_failures = 0,
           reconcile_last_outcome = null,
           reconcile_last_failed_at = null,
           reconcile_next_attempt_at = null
     where stripe_subscription_id = p_subscription_id;
  else
    update public.account_billing
       set reconcile_failures = least(reconcile_failures + 1, 1000),
           reconcile_last_outcome = p_outcome,
           reconcile_last_failed_at = now(),
           reconcile_next_attempt_at = greatest(now(), least(coalesce(p_next_attempt_at, now() + interval '1 hour'), now() + interval '7 days'))
     where stripe_subscription_id = p_subscription_id;
  end if;

  get diagnostics v_updated = row_count;
  return case when v_updated > 0 then 'recorded' else 'unknown' end;
end;
$$;

revoke all on function public.record_reconcile_result(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_reconcile_result(text, text, timestamptz) to service_role;

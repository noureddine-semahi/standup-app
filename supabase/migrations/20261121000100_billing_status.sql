-- Phase 5.6 step 4: a read-only, member-scoped billing status for Profile & Settings. NOTHING IS WRITTEN and no policy changes.
--
-- ONE new read function. It creates no table, changes no row, and leaves subscription synchronisation, entitlement precedence, the billing
-- status policy and the feature flags exactly as they are (it only READS through account_effective_tier / billing_grants_premium).
-- Safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- SCOPE: it takes NO parameters and answers only for auth.uid(): there is no way to ask about another account. account_billing itself is
-- still unreachable from browsers (RLS on, no policies, privileges revoked); this function is the only door, and it returns a summary
-- WITHOUT any Stripe identifier (no customer, subscription, price or event IDs) and without any internal account ID.
--
-- WHAT IT REPORTS
--   r_access / r_access_source   the effective tier right now, and WHY: 'manual' (admin grant), 'subscription' (billing-derived),
--                               'trial' (the one-time trial) or 'none' (Free). Derived from the existing precedence, not re-decided here.
--   r_plan, r_status, r_period_end, r_cancel_at_period_end, r_canceled_at, r_ended_at
--                               the member's own subscription record as Stripe last reported it (null when they have none).
--   r_subscription_grants_premium  whether THIS SUBSCRIPTION grants Premium right now. It is separate from r_access on purpose:
--                               an account can have Premium from an admin grant or a trial while its subscription is canceled, so
--                               "has Premium" must never be read as "has an active subscription".
--   r_grace_ends_at             for past_due only: the end of the 7-day grace period (current_period_end + 7 days), the same constant
--                               billing_grants_premium uses (a test pins them together).
--   r_trial_ends_at             the end of a still-running one-time trial.

create or replace function public.get_my_billing_status()
returns table (
  r_access text,
  r_access_source text,
  r_plan text,
  r_status text,
  r_period_end timestamptz,
  r_cancel_at_period_end boolean,
  r_canceled_at timestamptz,
  r_ended_at timestamptz,
  r_grace_ends_at timestamptz,
  r_subscription_grants_premium boolean,
  r_trial_ends_at timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.account_entitlements%rowtype;
  v_b public.account_billing%rowtype;
  v_has_ent boolean;
  v_has_b boolean;
  v_access text;
  v_grants boolean;
  v_source text;
begin
  if v_uid is null then
    return query select 'free'::text, 'none'::text, null::text, null::text, null::timestamptz, false, null::timestamptz, null::timestamptz, null::timestamptz, false, null::timestamptz;
    return;
  end if;

  select * into v_ent from public.account_entitlements where user_id = v_uid;
  v_has_ent := found;
  select * into v_b from public.account_billing where user_id = v_uid;
  v_has_b := found;

  v_access := public.account_effective_tier(v_uid);
  v_grants := public.billing_grants_premium(v_uid);
  v_source := case
    when v_access = 'free' then 'none'
    when v_has_ent and v_ent.tier = 'premium' then 'manual'
    when v_grants then 'subscription'
    else 'trial'
  end;

  return query select
    v_access,
    v_source,
    case when v_has_b then v_b.plan end,
    case when v_has_b then v_b.subscription_status end,
    case when v_has_b then v_b.current_period_end end,
    case when v_has_b then v_b.cancel_at_period_end else false end,
    case when v_has_b then v_b.canceled_at end,
    case when v_has_b then v_b.ended_at end,
    case when v_has_b and v_b.subscription_status = 'past_due' and v_b.current_period_end is not null then v_b.current_period_end + interval '7 days' end,
    v_grants,
    case when v_has_ent and v_ent.tier = 'premium_trial' and v_ent.trial_ends_at > now() then v_ent.trial_ends_at end;
end;
$$;

revoke all on function public.get_my_billing_status() from public, anon;
grant execute on function public.get_my_billing_status() to authenticated;

-- Phase 5.6 step 3: billing-derived Premium. A verified Stripe subscription (recorded in account_billing) grants Premium; it ends by itself.
--
-- NOTHING IS WRITTEN. Billing-derived Premium is COMPUTED when it is needed, from the billing record and the clock. This migration only
-- replaces functions: it creates no table, changes no row, and never writes account_entitlements, account_trial_history or any user
-- content. So it cannot overwrite a manual admin grant or a trial, cannot touch trial history, and cannot delete or deactivate anything.
-- Duplicate, out-of-order and concurrent webhook events are already made safe by sync_stripe_subscription (older snapshots are refused);
-- since the result here is a pure function of the stored billing record, it is atomic and idempotent by construction.
-- Safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- ENTITLEMENT PRECEDENCE (highest first); the account's effective tier is the first that applies:
--   1. 'premium'       a manual admin grant (account_entitlements.tier = 'premium'). Never affected by Stripe in any way.
--   2. 'premium'       a billing-derived grant (see the policy below).
--   3. 'premium_trial' an active one-time trial (account_entitlements.tier = 'premium_trial' and now < trial_ends_at).
--   4. 'free'          everything else.
-- Premium from any source lifts the Free creation limits; when the last source ends the account is Free again and the limits apply to
-- NEW creations and reactivations only (existing Goals, routines and notes are kept, exactly as when a trial ends).
--
-- BILLING STATUS POLICY (account_billing.subscription_status; current_period_end = the end of the period already paid for):
--   active, trialing   Premium, as long as now <= current_period_end + 3 days. The 3 days only absorb a late renewal update; a missing
--                      period end (not expected) is treated as in-period.
--   past_due           A renewal payment failed and Stripe is retrying. GRACE: Premium until current_period_end + 7 days, then Free even if
--                      Stripe is still retrying. A temporary payment failure never revokes access immediately.
--   unpaid             Stripe has given up collecting: NOT Premium.
--   canceled           Ended (cancel-at-period-end subscriptions stay 'active' until their period ends, then become 'canceled'): NOT Premium.
--   incomplete         The first payment never completed: NOT Premium.
--   incomplete_expired Same: NOT Premium.
--   paused             Not billing: NOT Premium.
--   anything else      Unknown or future statuses: NOT Premium (fail closed).
-- A Stripe cancellation therefore only ends the billing-derived grant (rule 2); a manual grant (rule 1) or a trial (rule 3) is untouched.
--
-- ACCESS: both new functions are internal (service role only). Callers learn only their OWN tier, through get_my_account_entitlement().

create or replace function public.billing_grants_premium(p_user_id uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select case
      when b.subscription_status in ('active', 'trialing') then
        b.current_period_end is null or p_now <= b.current_period_end + interval '3 days'
      when b.subscription_status = 'past_due' then
        b.current_period_end is not null and p_now <= b.current_period_end + interval '7 days'
      else false
    end
    from public.account_billing b
    where b.user_id = p_user_id
  ), false)
$$;

create or replace function public.account_effective_tier(p_user_id uuid, p_now timestamptz default now())
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when e.tier = 'premium' then 'premium'
    when public.billing_grants_premium(p_user_id, p_now) then 'premium'
    when e.tier = 'premium_trial' and e.trial_ends_at is not null and p_now < e.trial_ends_at then 'premium_trial'
    else 'free'
  end
  from (select 1) as one
  left join public.account_entitlements e on e.user_id = p_user_id
$$;

revoke all on function public.billing_grants_premium(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.account_effective_tier(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_grants_premium(uuid, timestamptz) to service_role;
grant execute on function public.account_effective_tier(uuid, timestamptz) to service_role;

-- What the app calls: the caller's own tier (now including billing-derived Premium). Same shape as before.
create or replace function public.get_my_account_entitlement()
returns table (r_tier text, r_stored_tier text, r_trial_started_at timestamptz, r_trial_ends_at timestamptz)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.account_entitlements%rowtype;
  v_found boolean;
  v_tier text;
begin
  if v_uid is null then
    return query select 'free'::text, 'free'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  select * into v_row from public.account_entitlements where user_id = v_uid;
  v_found := found;
  v_tier := public.account_effective_tier(v_uid);
  if not v_found then
    return query select v_tier, 'free'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  return query select v_tier, v_row.tier, v_row.trial_started_at, v_row.trial_ends_at;
end;
$$;

-- The three Free-tier limit triggers: identical to before, except that Premium from ANY source (manual, billing or trial) lifts the limit.
create or replace function public.enforce_note_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    return new;
  end if;

  if public.account_effective_tier(new.user_id) <> 'free' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('notes_free_limit:' || new.user_id::text, 0));

  select count(*) into v_count from public.notes where user_id = new.user_id;
  if v_count >= 10 then
    raise exception 'NOTE_LIMIT_REACHED'
      using errcode = '53400',
            detail = 'Free accounts can save up to 10 notes.',
            hint = 'Upgrade to Premium for unlimited notes.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_routine_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  -- Only actions that make a routine active matter: a new active row, or an inactive row turned active.
  if new.active is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active is true then
    return new;
  end if;

  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    return new;
  end if;

  if public.account_effective_tier(new.user_id) <> 'free' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('routines_free_limit:' || new.user_id::text, 0));

  select count(*) into v_count from public.recurring_goal_templates where user_id = new.user_id and active is true;
  if v_count >= 3 then
    raise exception 'ROUTINE_LIMIT_REACHED'
      using errcode = '53400',
            detail = 'Free accounts can have up to 3 active routines.',
            hint = 'Retire a routine or upgrade to Premium for unlimited routines.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_goal_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  -- Only actions that make a Goal active matter: a new active row, or a non-active row turned active.
  if new.status is distinct from 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' then
    return new;
  end if;

  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    return new;
  end if;

  if public.account_effective_tier(new.user_id) <> 'free' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('goals_free_limit:' || new.user_id::text, 0));

  select count(*) into v_count from public.outcome_goals where user_id = new.user_id and status = 'active';
  if v_count >= 3 then
    raise exception 'GOAL_LIMIT_REACHED'
      using errcode = '53400',
            detail = 'Free accounts can have up to 3 active Goals.',
            hint = 'Complete or archive a Goal, or upgrade to Premium for unlimited Goals.';
  end if;
  return new;
end;
$$;

-- Starting the one-time trial: unchanged (feature flag, one per account, refused for Premium), except that billing-derived Premium also
-- counts as Premium, so a subscriber cannot burn the one-time trial.
create or replace function public.start_my_premium_trial()
returns table (r_tier text, r_stored_tier text, r_trial_started_at timestamptz, r_trial_ends_at timestamptz)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_ends timestamptz;
  v_stored text;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '28000';
  end if;

  if not public.feature_enabled('premium_trial_activation_enabled') then
    raise exception 'TRIAL_ACTIVATION_DISABLED'
      using detail = 'Free trials are not available right now.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('premium_trial:' || v_uid::text, 0));

  if exists (select 1 from public.account_trial_history where user_id = v_uid) then
    raise exception 'TRIAL_ALREADY_USED'
      using detail = 'Each account can have one Premium trial.';
  end if;

  select e.tier into v_stored from public.account_entitlements e where e.user_id = v_uid;
  if v_stored = 'premium' or public.billing_grants_premium(v_uid) then
    raise exception 'ALREADY_PREMIUM'
      using detail = 'This account is already Premium.';
  end if;

  v_ends := v_now + interval '336 hours';

  insert into public.account_trial_history (user_id, started_at, ends_at) values (v_uid, v_now, v_ends);

  insert into public.account_entitlements (user_id, tier, trial_started_at, trial_ends_at)
  values (v_uid, 'premium_trial', v_now, v_ends)
  on conflict (user_id) do update
    set tier = 'premium_trial', trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at;

  return query select public.effective_account_tier('premium_trial', v_ends, v_now), 'premium_trial'::text, v_now, v_ends;
end;
$$;

-- The admin plan screens report the same effective tier the member gets (billing included). Same shape, same authorization, same writes.
create or replace function public.admin_get_entitlement(p_user_id uuid)
returns table (
  r_stored_tier text,
  r_effective_tier text,
  r_trial_started_at timestamptz,
  r_trial_ends_at timestamptz,
  r_trial_used boolean,
  r_updated_at timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_row public.account_entitlements%rowtype;
  v_used boolean;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  select * into v_row from public.account_entitlements where user_id = p_user_id;
  select exists (select 1 from public.account_trial_history where user_id = p_user_id) into v_used;

  return query select
    coalesce(v_row.tier, 'free'),
    public.account_effective_tier(p_user_id),
    v_row.trial_started_at,
    v_row.trial_ends_at,
    v_used,
    v_row.updated_at;
end;
$$;

create or replace function public.admin_set_entitlement(p_user_id uuid, p_tier text)
returns table (
  r_stored_tier text,
  r_effective_tier text,
  r_trial_started_at timestamptz,
  r_trial_ends_at timestamptz,
  r_trial_used boolean,
  r_updated_at timestamptz
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.account_entitlements%rowtype;
  v_old_stored text;
  v_old_effective text;
  v_new_effective text;
  v_used boolean;
begin
  if not public.is_sys_admin() then
    raise exception 'sys admin access required';
  end if;
  if p_tier is null or p_tier not in ('free', 'premium') then
    raise exception 'invalid tier';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('premium_trial:' || p_user_id::text, 0));

  select * into v_row from public.account_entitlements where user_id = p_user_id;
  v_old_stored := coalesce(v_row.tier, 'free');
  v_old_effective := public.account_effective_tier(p_user_id);

  if v_old_stored <> p_tier then
    insert into public.account_entitlements (user_id, tier)
    values (p_user_id, p_tier)
    on conflict (user_id) do update set tier = excluded.tier;

    select * into v_row from public.account_entitlements where user_id = p_user_id;
    v_new_effective := public.account_effective_tier(p_user_id);

    insert into public.admin_audit_log (admin_id, target_user_id, action, details)
    values (
      auth.uid(), p_user_id, 'set_entitlement',
      jsonb_build_object(
        'old_stored_tier', v_old_stored,
        'new_stored_tier', v_row.tier,
        'old_effective_tier', v_old_effective,
        'new_effective_tier', v_new_effective,
        'trial_started_at', v_row.trial_started_at,
        'trial_ends_at', v_row.trial_ends_at
      )
    );
  end if;

  select exists (select 1 from public.account_trial_history where user_id = p_user_id) into v_used;

  return query select
    coalesce(v_row.tier, 'free'),
    public.account_effective_tier(p_user_id),
    v_row.trial_started_at,
    v_row.trial_ends_at,
    v_used,
    v_row.updated_at;
end;
$$;

-- Grants are unchanged by create or replace; restated so this file alone documents who may call what.
revoke all on function public.get_my_account_entitlement() from public, anon;
grant execute on function public.get_my_account_entitlement() to authenticated;
revoke all on function public.start_my_premium_trial() from public, anon;
grant execute on function public.start_my_premium_trial() to authenticated;
revoke all on function public.admin_get_entitlement(uuid) from public, anon;
grant execute on function public.admin_get_entitlement(uuid) to authenticated;
revoke all on function public.admin_set_entitlement(uuid, text) from public, anon;
grant execute on function public.admin_set_entitlement(uuid, text) to authenticated;

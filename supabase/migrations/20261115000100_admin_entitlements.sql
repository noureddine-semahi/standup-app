-- Phase 4.5A: admin controls for account entitlements (view, and explicit Free / Premium grants and revocations).
--
-- ADDITIVE ONLY. Two functions. It creates no table and changes no existing table, policy or function. Safe to re-run.
--
-- Requires 20261110000100_account_entitlements.sql and 20261114000100_premium_trial.sql, and the existing admin infrastructure
-- (public.is_admin(), public.is_sys_admin(), public.admin_audit_log, the same pieces admin_set_role / admin_set_points use).
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- WHO CAN DO WHAT (checked inside the database; the UI is only a convenience):
--   admin_get_entitlement   any admin (is_admin())       read a user's stored tier, effective tier and trial status
--   admin_set_entitlement   sys admins only (is_sys_admin()), the same owner-level role that alone may grant roles
-- A regular user can call neither: both raise before reading or writing anything. Users still cannot write account_entitlements
-- directly (no policy, privileges revoked), so there is no path by which anyone can grant themselves Premium.
--
-- WHAT A CHANGE DOES: sets the stored tier to 'premium' (grant) or 'free' (revoke), nothing else. It leaves trial_started_at and
-- trial_ends_at exactly as they were and never touches account_trial_history, so trial-use history is preserved: revoking
-- Premium, or granting it, never lets anyone start a second trial. It touches no other table, so Goals, routines, notes and all
-- history are kept: nothing is deleted, deactivated or edited. When an account falls back to Free, the limit triggers only block
-- NEW creations and reactivations; everything that exists stays.
--
-- ONLY real changes are recorded. Setting a tier an account already has returns the current state and writes nothing. Every
-- change adds one admin_audit_log row (action 'set_entitlement'): who (admin_id), whom (target_user_id), when (created_at), and
-- the previous and new stored and effective tiers and the trial dates in details.
--
-- CONCURRENCY: the change takes the same per-user advisory lock as start_my_premium_trial(), so an admin change and a trial
-- activation for one user are serialized and cannot overwrite each other.

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
    public.effective_account_tier(coalesce(v_row.tier, 'free'), v_row.trial_ends_at),
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
  v_old_effective := public.effective_account_tier(v_old_stored, v_row.trial_ends_at);

  if v_old_stored <> p_tier then
    insert into public.account_entitlements (user_id, tier)
    values (p_user_id, p_tier)
    on conflict (user_id) do update set tier = excluded.tier;

    select * into v_row from public.account_entitlements where user_id = p_user_id;
    v_new_effective := public.effective_account_tier(v_row.tier, v_row.trial_ends_at);

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
    public.effective_account_tier(coalesce(v_row.tier, 'free'), v_row.trial_ends_at),
    v_row.trial_started_at,
    v_row.trial_ends_at,
    v_used,
    v_row.updated_at;
end;
$$;

revoke all on function public.admin_get_entitlement(uuid) from public, anon;
grant execute on function public.admin_get_entitlement(uuid) to authenticated;
revoke all on function public.admin_set_entitlement(uuid, text) from public, anon;
grant execute on function public.admin_set_entitlement(uuid, text) to authenticated;

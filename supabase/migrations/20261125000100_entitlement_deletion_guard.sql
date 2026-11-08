-- Phase 5.8.2B (OPTIONAL hardening, NOT required for the admin billing screen to work): refuse a MANUAL Premium grant for an account whose deletion is in progress,
-- at the DATABASE level, so that no caller of admin_set_entitlement can bypass the check.
--
-- The admin billing endpoint (/api/admin/billing-premium) already refuses such a grant before calling this function. Without this migration, the older Plans
-- screen, which calls admin_set_entitlement directly, can still grant Premium to an account that is being deleted. Applying it closes that path.
--
-- The ONLY change from the 20261120000100 version is the 'account is being deleted' check, and only for tier = 'premium'. Revoking ('free') is always allowed.
-- The function is security definer, so it may call account_deletion_pending (executable by service_role only). Grants are unchanged.

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
  if p_tier = 'premium' and public.account_deletion_pending(p_user_id) then
    raise exception 'account deletion in progress';
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

revoke all on function public.admin_set_entitlement(uuid, text) from public, anon;
grant execute on function public.admin_set_entitlement(uuid, text) to authenticated;

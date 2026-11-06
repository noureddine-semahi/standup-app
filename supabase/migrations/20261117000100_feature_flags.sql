-- Phase 5.3: server-controlled feature flags for the free beta and monetization.
--
-- Three flags, ALL OFF by default:
--   premium_promotion_enabled         show Premium comparison/pricing and "upgrade to Premium" messaging
--   premium_trial_activation_enabled  allow new 14-day trials to be started (enforced below, in the database)
--   billing_checkout_enabled          reserved for paid checkout (nothing implements checkout yet)
--
-- Safe to re-run. It adds a table, two helper functions and replaces start_my_premium_trial() with the SAME logic plus one early check.
-- It deletes nothing and touches no entitlement, trial history, subscription/billing row or user content: existing Premium accounts,
-- active trials and the Free-tier limits are unchanged. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or CI.
--
-- WHO CAN CHANGE A FLAG: only someone running SQL on the project (the SQL Editor / service role). Browsers have no access to the table at
-- all (RLS on, no policies, privileges revoked); they can only ask get_feature_flags() what the flags are. Example:
--   update public.feature_flags set enabled = true where key = 'premium_trial_activation_enabled';

create table if not exists public.feature_flags (
  key text primary key check (key in ('premium_promotion_enabled', 'premium_trial_activation_enabled', 'billing_checkout_enabled')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.feature_flags (key, enabled) values
  ('premium_promotion_enabled', false),
  ('premium_trial_activation_enabled', false),
  ('billing_checkout_enabled', false)
on conflict (key) do nothing;

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;

create or replace function public.touch_feature_flag()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_feature_flag on public.feature_flags;
create trigger trg_touch_feature_flag
  before update on public.feature_flags
  for each row execute function public.touch_feature_flag();

-- One flag, false when it doesn't exist. Used by the server-side checks (and by a future checkout route).
create or replace function public.feature_enabled(p_key text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select enabled from public.feature_flags where key = p_key), false)
$$;

-- What the app reads, to decide what to show. Signed-in users only.
create or replace function public.get_feature_flags()
returns table (r_key text, r_enabled boolean)
language sql
stable
security definer set search_path = public
as $$
  select f.key, f.enabled from public.feature_flags f where auth.uid() is not null
$$;

revoke all on function public.feature_enabled(text) from public, anon, authenticated;
revoke all on function public.get_feature_flags() from public, anon;
grant execute on function public.get_feature_flags() to authenticated;

-- The trial function, unchanged except for the flag check right after the sign-in check. When trial activation is off, nobody can
-- START a trial (whatever the browser does); active trials, history and entitlements are not touched.
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
  if v_stored = 'premium' then
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

revoke all on function public.start_my_premium_trial() from public, anon;
grant execute on function public.start_my_premium_trial() to authenticated;

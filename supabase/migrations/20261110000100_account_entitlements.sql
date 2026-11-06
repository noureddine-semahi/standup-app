-- Phase 4.2: persisted account tier (Free / Premium Trial / Premium) and its trial window.
--
-- ADDITIVE ONLY. One new table, two functions, one trigger. It does not touch any existing table, so profiles and every
-- user's data are unchanged. Safe to re-run.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI. Until it is applied the app treats
-- every account as Free (see src/lib/supabase/entitlements.ts).
--
-- MODEL
--   account_entitlements  at most one row per user. A user with NO row is Free, so every new user and every existing user
--                         defaults to Free with nothing to do; the backfill below only writes explicit 'free' rows for the
--                         users who exist today.
--                         tier              free | premium_trial | premium (what was granted)
--                         trial_started_at  optional; when a trial began
--                         trial_ends_at     optional; when it ends (the app's default trial is 14 days, not forced here)
--   effective tier        worked out HERE, by the database, never trusted from a client: premium is premium; premium_trial is
--                         premium_trial only while now() < trial_ends_at; anything else, including an EXPIRED trial, is free.
--
-- WHO CAN CHANGE IT: nobody from the app. Users can READ their own row; no client can insert, update or delete it (RLS has no
-- write policy, and the write privileges are revoked as well). Rows are written only by the service role / SQL editor, which
-- is how billing and trial activation will do it later. The app asks for its tier through get_my_account_entitlement().

create table if not exists public.account_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'premium_trial', 'premium')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_entitlements_trial_window check (trial_started_at is null or trial_ends_at is null or trial_ends_at > trial_started_at),
  constraint account_entitlements_trial_has_dates check (tier <> 'premium_trial' or (trial_started_at is not null and trial_ends_at is not null))
);

alter table public.account_entitlements enable row level security;

drop policy if exists "account_entitlements_select_own" on public.account_entitlements;
create policy "account_entitlements_select_own" on public.account_entitlements for select using (auth.uid() = user_id);

-- No insert / update / delete policy exists, so RLS already refuses those for every signed-in user. Revoking the privileges
-- too means that stays true even if a policy were ever added by mistake.
revoke insert, update, delete, truncate on public.account_entitlements from anon, authenticated;

create or replace function public.touch_account_entitlement()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_account_entitlement on public.account_entitlements;
create trigger trg_touch_account_entitlement
  before update on public.account_entitlements
  for each row execute function public.touch_account_entitlement();

-- The one rule for turning what was granted into what applies right now. Pure and immutable.
create or replace function public.effective_account_tier(p_tier text, p_trial_ends_at timestamptz, p_now timestamptz default now())
returns text
language sql
immutable
as $$
  select case
    when p_tier = 'premium' then 'premium'
    when p_tier = 'premium_trial' and p_trial_ends_at is not null and p_now < p_trial_ends_at then 'premium_trial'
    else 'free'
  end
$$;

-- What the app calls. Scoped to the caller (auth.uid()); returns Free when there is no row or nobody is signed in.
create or replace function public.get_my_account_entitlement()
returns table (r_tier text, r_stored_tier text, r_trial_started_at timestamptz, r_trial_ends_at timestamptz)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.account_entitlements%rowtype;
begin
  if v_uid is null then
    return query select 'free'::text, 'free'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  select * into v_row from public.account_entitlements where user_id = v_uid;
  if not found then
    return query select 'free'::text, 'free'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  return query select public.effective_account_tier(v_row.tier, v_row.trial_ends_at), v_row.tier, v_row.trial_started_at, v_row.trial_ends_at;
end;
$$;

revoke all on function public.get_my_account_entitlement() from public, anon;
grant execute on function public.get_my_account_entitlement() to authenticated;

-- Existing users get an explicit Free row (new users need none: no row means Free). Never overwrites an existing row.
insert into public.account_entitlements (user_id)
select id from auth.users
on conflict (user_id) do nothing;

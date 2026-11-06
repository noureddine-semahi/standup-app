-- Phase 4.4A: the 14-day Premium trial lifecycle (backend only).
--
-- ADDITIVE ONLY. One new table and one function. It changes no existing table, column or policy and it never touches Goals,
-- Routines, Notes or any history. Safe to re-run.
--
-- Requires 20261110000100_account_entitlements.sql.
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- HOW A TRIAL STARTS: only by calling start_my_premium_trial(). It is the single place a trial can begin, it runs as the database
-- (security definer) scoped to the caller (auth.uid()), and no client can write the trial or the entitlement tables directly.
-- Billing, checkout, upgrade screens and email are NOT part of this migration.
--
-- ONE TRIAL PER USER, EVER: account_trial_history has one row per user (user_id is its primary key) and is permanent: nothing the
-- app can do removes it, and it is not changed when a trial expires, a user downgrades, or an entitlement row is edited. A user with
-- a history row can never start another trial. The primary key also makes a second row impossible even if two requests race.
--
-- EXACTLY 14 DAYS: ends_at = started_at + 336 hours. Hours are used on purpose (a "14 days" interval can drift by an hour across a
-- daylight-saving change in some time zones). The app's TRIAL_DAYS constant (14) is kept equal to this by a test.
--
-- WHAT A TRIAL GRANTS: it writes the caller's account_entitlements row as tier 'premium_trial' with the two dates. While
-- now() < trial_ends_at the effective tier is premium_trial (get_my_account_entitlement / effective_account_tier from the
-- entitlements migration); at the end instant it resolves to free by itself, with no job and nothing deleted. The stored row is left
-- as it was, so the history of what was granted is kept.
--
-- WHO CAN CHANGE ANYTHING DIRECTLY: nobody from the app. Users may only READ their own history row; RLS has no write policy for any
-- client, and the write privileges are revoked as well.
--
-- CONCURRENT ATTEMPTS: a per-user advisory lock is held for the whole transaction, so two simultaneous activations are serialized:
-- the first starts the trial, the second sees its history row and is refused with TRIAL_ALREADY_USED.
--
-- REFUSALS (exceptions the app can show): TRIAL_ALREADY_USED, ALREADY_PREMIUM (a paid account does not need a trial),
-- NOT_SIGNED_IN.

create table if not exists public.account_trial_history (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint account_trial_history_window check (ends_at > started_at)
);

alter table public.account_trial_history enable row level security;

drop policy if exists "account_trial_history_select_own" on public.account_trial_history;
create policy "account_trial_history_select_own" on public.account_trial_history for select using (auth.uid() = user_id);

revoke insert, update, delete, truncate on public.account_trial_history from anon, authenticated;

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

-- Anyone who already has trial dates on their entitlement row (set by hand earlier) counts as having used their trial, so they
-- cannot start a second one. Never overwrites an existing history row.
insert into public.account_trial_history (user_id, started_at, ends_at)
select user_id, trial_started_at, trial_ends_at
from public.account_entitlements
where trial_started_at is not null and trial_ends_at is not null
on conflict (user_id) do nothing;

-- Weekly streak passes: reviewing/closing at least 5 of 7 days in a
-- Sunday-Saturday calendar week (0=Sunday..6=Saturday, matching this app's
-- existing days_of_week convention) grants 2 passes. A pass can be spent to
-- retroactively cover one missed day so it stops breaking the streak.
--
-- Deliberately no stored balance: "earned" is a live aggregate over
-- daily_plans.reviewed_at (the same source of truth getStreak/
-- getLifetimeStats already use), "used" is a row count on this log table,
-- "available" = earned - used, all computed on read -- matches this app's
-- existing preference for deriving computed state rather than maintaining
-- counters that can drift.
--
-- A pass-covered day is unioned into streak-continuity date sets
-- client-side but must never feed totalDaysClosed or any achievement, and
-- must never itself count toward earning more passes (earning stays keyed
-- to reviewed_at only) -- avoids a self-reinforcing loop.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.streak_pass_uses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- plan_id AND plan_date stored together, same as posts.plan_id/plan_date
  -- -- avoids ever joining back through daily_plans' owner-only RLS from a
  -- context where that would silently return nothing.
  plan_id uuid not null references public.daily_plans(id) on delete cascade,
  plan_date date not null,
  covered_at timestamptz not null default now(),
  unique (user_id, plan_date),
  unique (plan_id)
);
create index if not exists idx_streak_pass_uses_user on public.streak_pass_uses (user_id);

alter table public.streak_pass_uses enable row level security;

-- Owner-only, append-only (no update/delete policies, matching
-- goal_notes) -- every write still goes through use_streak_pass() below
-- for its validation, but that function runs security invoker (the row
-- written is always the caller's own), so a real insert policy is still
-- required for it to succeed.
drop policy if exists "streak_pass_uses_select_own" on public.streak_pass_uses;
create policy "streak_pass_uses_select_own" on public.streak_pass_uses
  for select using (user_id = auth.uid());

drop policy if exists "streak_pass_uses_insert_own" on public.streak_pass_uses;
create policy "streak_pass_uses_insert_own" on public.streak_pass_uses
  for insert with check (user_id = auth.uid());

-- Earned/used/available, always for the caller. security invoker: every
-- table read here is scoped to auth.uid() under that table's own RLS, no
-- boundary to cross.
--
-- Week bucketing: extract(dow from plan_date) returns 0=Sunday..6=Saturday
-- in Postgres, which already matches the app's JS-based days_of_week
-- convention, so date - extract(dow ...) gives that date's Sunday without
-- date_trunc('week', ...) (ISO/Monday-based, would silently misalign).
create or replace function public.get_streak_pass_balance()
returns table(earned int, used int, available int)
language sql security invoker set search_path = public stable
as $$
  with reviewed as (
    select plan_date, (plan_date - (extract(dow from plan_date))::int) as week_start
    from public.daily_plans
    where user_id = auth.uid() and reviewed_at is not null
  ),
  weekly_counts as (
    select week_start, count(*) as n from reviewed group by week_start
  ),
  earned_calc as (
    select coalesce(sum(case when n >= 5 then 2 else 0 end), 0)::int as earned
    from weekly_counts
  ),
  used_calc as (
    select count(*)::int as used from public.streak_pass_uses where user_id = auth.uid()
  )
  select e.earned, u.used, greatest(e.earned - u.used, 0)
  from earned_calc e, used_calc u;
$$;
revoke all on function public.get_streak_pass_balance() from public;
grant execute on function public.get_streak_pass_balance() to authenticated;

-- Spends one pass to cover p_plan_id, if eligible. p_today is passed in
-- from the client's own toISODate(new Date()) rather than read from the
-- database -- this app never trusts DB-side now()/current_date for "is
-- this a past day" checks (browser-local date, not DB timezone), matching
-- how getStreak/getOverdueDays already take todayISO as a parameter.
--
-- pg_advisory_xact_lock serializes concurrent calls for the same user for
-- the duration of the transaction -- without it, two near-simultaneous
-- calls covering two different dates could both read the same
-- (now-stale) `available` count and both succeed even with only one pass
-- actually available.
create or replace function public.use_streak_pass(p_plan_id uuid, p_today date)
returns public.streak_pass_uses
language plpgsql security invoker set search_path = public
as $$
declare
  v_plan public.daily_plans%rowtype;
  v_available int;
  v_row public.streak_pass_uses%rowtype;
begin
  select * into v_plan from public.daily_plans where id = p_plan_id;
  if not found then
    raise exception 'plan not found';
  end if;
  if v_plan.user_id <> auth.uid() then
    raise exception 'not your plan';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  if v_plan.plan_date >= p_today then
    raise exception 'streak passes can only cover a past day';
  end if;
  if v_plan.reviewed_at is not null then
    raise exception 'day was already reviewed, nothing to cover';
  end if;
  if exists (select 1 from public.streak_pass_uses where plan_id = p_plan_id) then
    raise exception 'day already covered by a streak pass';
  end if;

  select available into v_available from public.get_streak_pass_balance();
  if coalesce(v_available, 0) <= 0 then
    raise exception 'no streak passes available';
  end if;

  insert into public.streak_pass_uses (user_id, plan_id, plan_date)
  values (auth.uid(), p_plan_id, v_plan.plan_date)
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.use_streak_pass(uuid, date) from public;
grant execute on function public.use_streak_pass(uuid, date) to authenticated;

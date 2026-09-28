-- Lets a streak pass cover a FUTURE day in advance (e.g. "I know I'll be
-- traveling tomorrow, cover it now"), not just retroactively fix an
-- already-missed past day. Scoped to future days specifically (today
-- itself has no UI for this -- /standup/date/[date] redirects today away
-- to /standup/today, which has its own review flow).
--
-- No new columns/tables needed -- use_streak_pass already just needs its
-- "past day only" guard removed; the remaining checks (not already
-- reviewed, not already covered, a pass actually available) apply
-- identically regardless of whether the date is past or future.
--
-- get_streak_pass_balance() is untouched: "earned"/"used" are already
-- keyed to reviewed_at and a plain row count on streak_pass_uses,
-- neither of which cares what date a covered row's plan_date is.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

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

  -- Today itself is deliberately still excluded -- covering "in progress"
  -- makes little sense while the day's own review flow is still the
  -- normal path, and no UI ever calls this for today anyway.
  if v_plan.plan_date = p_today then
    raise exception 'use today''s own review flow to close today, not a streak pass';
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

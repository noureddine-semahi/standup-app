-- Reconstructed RPC functions. See ../README.md for confidence levels — these
-- bodies were never inspected in the live project; they're inferred from call
-- sites and (for award_closure_points only) one live-tested response.

-- RECONSTRUCTED FROM BEHAVIOR: exact logic not verified against live source.
-- Inferred from every call site in db.ts (getOrCreatePlan) and
-- rescheduleGoalToDate: pulls in pending goal_reschedules targeting this plan's
-- date, creates the corresponding goals rows, marks them materialized.
create or replace function public.materialize_reschedules(p_plan_id uuid, p_plan_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_count integer := 0;
  v_next_sort integer;
  v_new_goal_id uuid;
  r record;
begin
  select user_id into v_user_id from public.daily_plans where id = p_plan_id;
  if v_user_id is null then
    raise exception 'daily_plans row % not found', p_plan_id;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort
  from public.goals where plan_id = p_plan_id;

  for r in
    select * from public.goal_reschedules
    where to_date = p_plan_date
      and materialized = false
      and user_id = v_user_id
    order by created_at asc
  loop
    insert into public.goals (user_id, plan_id, title, details, status, sort_order, priority)
    values (v_user_id, p_plan_id, r.snapshot_title, r.snapshot_details, 'not_started', v_next_sort, r.snapshot_priority)
    returning id into v_new_goal_id;

    update public.goal_reschedules
    set materialized = true, materialized_goal_id = v_new_goal_id
    where id = r.id;

    v_next_sort := v_next_sort + 1;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- UNVERIFIED SHAPE: the client casts this RPC's result to {awarded, new_points},
-- but never actually branches on those fields (see today/page.tsx refresh()) —
-- so that cast was never exercised or confirmed. Reconstructed here to mirror
-- award_closure_points' *live-tested* {success, points} shape instead, since
-- that's the one verified data point we have for this pair of sibling
-- functions, and the client's own type annotation is now known to be wrong
-- for the sibling. Do not trust either shape without checking the live source.
create or replace function public.award_awareness_points(p_plan_id uuid, p_points integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_already boolean;
begin
  select user_id, awareness_awarded into v_user_id, v_already
  from public.daily_plans where id = p_plan_id;

  if v_user_id is null then
    raise exception 'daily_plans row % not found', p_plan_id;
  end if;

  if v_already then
    return json_build_object('success', false, 'points', 0);
  end if;

  update public.daily_plans
  set awareness_awarded = true, awareness_points = p_points
  where id = p_plan_id;

  update public.profiles
  set points = points + p_points
  where id = v_user_id;

  return json_build_object('success', true, 'points', p_points);
end;
$$;

-- LIVE-TESTED RESPONSE SHAPE (confirmed 2026-08 against the real project):
-- {"success": true, "points": 5}. Confirmed to NOT set daily_plans.reviewed_at
-- itself — the client (today/page.tsx closeOutDay()) compensates with a
-- separate .update({reviewed_at: ...}) call afterward. This reconstruction
-- intentionally mirrors that observed behavior; it is not an endorsement of
-- it, and "fixing" it here (e.g. having this function set reviewed_at) would
-- make the migration diverge from what the live project actually does.
create or replace function public.award_closure_points(p_plan_id uuid, p_points integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_already boolean;
begin
  select user_id, closure_awarded into v_user_id, v_already
  from public.daily_plans where id = p_plan_id;

  if v_user_id is null then
    raise exception 'daily_plans row % not found', p_plan_id;
  end if;

  if v_already then
    return json_build_object('success', false, 'points', 0);
  end if;

  update public.daily_plans
  set closure_awarded = true, closure_points = p_points
  where id = p_plan_id;

  update public.profiles
  set points = points + p_points
  where id = v_user_id;

  return json_build_object('success', true, 'points', p_points);
end;
$$;

-- DEAD/LEGACY: zero call sites anywhere in src/ as of this audit (2026-08).
-- Signature is unverifiable from usage — this is a documented placeholder
-- only, not a reconstruction. Do not assume it's correct if you need it.
create or replace function public.award_points(p_points integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  update public.profiles set points = points + p_points where id = v_user_id;
  return json_build_object('success', true, 'points', p_points);
end;
$$;

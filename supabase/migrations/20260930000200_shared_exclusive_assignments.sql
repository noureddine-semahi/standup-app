-- Shared vs exclusive goal assignments. Shared: both sides independently
-- track their own copy, exactly like a normal goal (no lock at all).
-- Exclusive: only the recipient can act on it -- the assigner is fully
-- locked out, including status/review, and it no longer counts toward
-- their own day's review-before-close requirement.

alter table public.goal_assignments
  add column if not exists assignment_type text not null default 'shared'
  check (assignment_type in ('shared', 'exclusive'));

create or replace function public.create_goal_assignment(
  p_goal_id uuid, p_recipient_id uuid, p_assignment_type text default 'shared'
)
returns public.goal_assignments
language plpgsql security invoker set search_path = public
as $$
declare
  v_goal record;
  v_row public.goal_assignments;
begin
  if p_assignment_type not in ('shared', 'exclusive') then
    raise exception 'assignment_type must be shared or exclusive';
  end if;
  if p_recipient_id = auth.uid() then
    raise exception 'Cannot assign a goal to yourself';
  end if;

  select g.id, g.user_id, g.title, g.details, g.priority, dp.plan_date
    into v_goal
    from public.goals g
    join public.daily_plans dp on dp.id = g.plan_id
    where g.id = p_goal_id;

  if v_goal.id is null then
    raise exception 'Goal % not found', p_goal_id;
  end if;
  if v_goal.user_id <> auth.uid() then
    raise exception 'You can only assign your own goals';
  end if;

  if not exists (
    select 1 from public.connections c where c.status = 'accepted'
      and ((c.requester_id = auth.uid() and c.recipient_id = p_recipient_id)
        or (c.recipient_id = auth.uid() and c.requester_id = p_recipient_id))
  ) then
    raise exception 'You can only assign goals to an accepted connection';
  end if;

  insert into public.goal_assignments (
    assigner_id, recipient_id, assigner_goal_id,
    snapshot_title, snapshot_details, snapshot_priority, plan_date, assignment_type
  ) values (
    auth.uid(), p_recipient_id, p_goal_id,
    v_goal.title, v_goal.details, coalesce(v_goal.priority, 3), v_goal.plan_date, p_assignment_type
  )
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.create_goal_assignment(uuid, uuid, text) from public;
grant execute on function public.create_goal_assignment(uuid, uuid, text) to authenticated;
-- Old 2-arg overload is superseded once db.ts always passes the third
-- param -- drop it so there's exactly one create_goal_assignment.
drop function if exists public.create_goal_assignment(uuid, uuid);

drop function if exists public.get_my_goal_assignments();
create or replace function public.get_my_goal_assignments()
returns table(
  assignment_id uuid, status text, created_at timestamptz, responded_at timestamptz, plan_date date,
  snapshot_title text, snapshot_details text, snapshot_priority integer,
  assigner_id uuid, assigner_display_name text,
  recipient_id uuid, recipient_display_name text,
  assigner_goal_status text, recipient_goal_status text,
  assigner_seen_at timestamptz, assigner_goal_id uuid, assignment_type text
)
language sql security definer set search_path = public stable
as $$
  select
    ga.id, ga.status, ga.created_at, ga.responded_at, ga.plan_date,
    ga.snapshot_title, ga.snapshot_details, ga.snapshot_priority,
    ga.assigner_id, ap.display_name,
    ga.recipient_id, rp.display_name,
    ag.status, rg.status,
    ga.assigner_seen_at, ga.assigner_goal_id, ga.assignment_type
  from public.goal_assignments ga
  join public.profiles ap on ap.id = ga.assigner_id
  join public.profiles rp on rp.id = ga.recipient_id
  left join public.goals ag on ag.id = ga.assigner_goal_id
  left join public.goals rg on rg.id = ga.recipient_goal_id
  where auth.uid() in (ga.assigner_id, ga.recipient_id)
  order by ga.created_at desc;
$$;
revoke all on function public.get_my_goal_assignments() from public;
grant execute on function public.get_my_goal_assignments() to authenticated;

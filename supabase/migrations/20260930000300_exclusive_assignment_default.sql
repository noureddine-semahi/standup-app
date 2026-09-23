-- Default assignment type flips from 'shared' to 'exclusive': a newly
-- assigned goal is locked to the recipient by default (the assigner
-- can't act on their own copy once accepted) unless they explicitly
-- choose "shared" via the Lock/Unlock toggle. Existing rows are left
-- untouched -- only the default for future inserts changes.

alter table public.goal_assignments alter column assignment_type set default 'exclusive';

create or replace function public.create_goal_assignment(
  p_goal_id uuid, p_recipient_id uuid, p_assignment_type text default 'exclusive'
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

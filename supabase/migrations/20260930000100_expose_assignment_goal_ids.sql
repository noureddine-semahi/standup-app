-- Lets Today/Tomorrow match a GoalAssignment row back to the assigner's
-- own goals.id, so that goal's row can switch to read-only and show the
-- recipient's live status. assigner_goal_id/recipient_goal_id already
-- exist on goal_assignments and were already used internally for the
-- status joins below -- just never exposed as output columns.

drop function if exists public.get_my_goal_assignments();
create or replace function public.get_my_goal_assignments()
returns table(
  assignment_id uuid, status text, created_at timestamptz, responded_at timestamptz, plan_date date,
  snapshot_title text, snapshot_details text, snapshot_priority integer,
  assigner_id uuid, assigner_display_name text,
  recipient_id uuid, recipient_display_name text,
  assigner_goal_status text, recipient_goal_status text,
  assigner_seen_at timestamptz,
  assigner_goal_id uuid
)
language sql security definer set search_path = public stable
as $$
  select
    ga.id, ga.status, ga.created_at, ga.responded_at, ga.plan_date,
    ga.snapshot_title, ga.snapshot_details, ga.snapshot_priority,
    ga.assigner_id, ap.display_name,
    ga.recipient_id, rp.display_name,
    ag.status, rg.status,
    ga.assigner_seen_at,
    ga.assigner_goal_id
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

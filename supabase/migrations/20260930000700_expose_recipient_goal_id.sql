-- "If a goal has been assigned to you, we can not re-assign the goal --
-- assign should be locked if the goal was assigned." Today/Tomorrow can
-- already tell when THIS user assigned a goal OUT (assigner_goal_id was
-- exposed by 20260930000100_expose_assignment_goal_ids.sql), but had no
-- way to tell when one of THIS user's own goals is itself the materialized
-- product of an assignment they RECEIVED and accepted -- so that goal's
-- row rendered as a completely ordinary goal, "Assign to" control included,
-- letting the recipient forward it to a third person the data model has
-- no representation for. Same fix as assigner_goal_id, mirrored for the
-- other side: expose recipient_goal_id too.
--
-- 7th time this function has needed drop-then-recreate for a return-shape
-- change -- CREATE OR REPLACE can't change a function's output columns.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

drop function if exists public.get_my_goal_assignments();
create or replace function public.get_my_goal_assignments()
returns table(
  assignment_id uuid, status text, created_at timestamptz, responded_at timestamptz, plan_date date,
  snapshot_title text, snapshot_details text, snapshot_priority integer,
  assigner_id uuid, assigner_display_name text,
  recipient_id uuid, recipient_display_name text,
  assigner_goal_status text, recipient_goal_status text,
  assigner_seen_at timestamptz, assigner_goal_id uuid, assignment_type text,
  recipient_goal_id uuid
)
language sql security definer set search_path = public stable
as $$
  select
    ga.id, ga.status, ga.created_at, ga.responded_at, ga.plan_date,
    ga.snapshot_title, ga.snapshot_details, ga.snapshot_priority,
    ga.assigner_id, ap.display_name,
    ga.recipient_id, rp.display_name,
    ag.status, rg.status,
    ga.assigner_seen_at, ga.assigner_goal_id, ga.assignment_type,
    ga.recipient_goal_id
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

-- "If user 1 has assigned a goal for user 2, user 2 reschedules the goal
-- for another date -- when the date comes the goal should show on both
-- Review Today for both users, even if only user 2 gets to take actions.
-- User 1 gets at least the chance to view the updates."
--
-- goal_assignments.plan_date is a frozen SNAPSHOT of the date the goal
-- was on at the moment it was assigned -- it never updates when the
-- recipient reschedules their own materialized copy forward. Today's page
-- already mirrors the recipient's live STATUS onto the assigner's own
-- (never-moving) goal row for that original date, but the assigner has no
-- way to know the recipient's copy moved to a DIFFERENT date at all, let
-- alone see it show up on THAT date once it arrives. Expose the
-- recipient's goal's actual current plan_date (live, via its plan_id ->
-- daily_plans), not the assignment's own frozen snapshot.
--
-- 8th time this function has needed drop-then-recreate for a return-shape
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
  recipient_goal_id uuid, recipient_plan_date date
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
    ga.recipient_goal_id, rdp.plan_date
  from public.goal_assignments ga
  join public.profiles ap on ap.id = ga.assigner_id
  join public.profiles rp on rp.id = ga.recipient_id
  left join public.goals ag on ag.id = ga.assigner_goal_id
  left join public.goals rg on rg.id = ga.recipient_goal_id
  left join public.daily_plans rdp on rdp.id = rg.plan_id
  where auth.uid() in (ga.assigner_id, ga.recipient_id)
  order by ga.created_at desc;
$$;
revoke all on function public.get_my_goal_assignments() from public;
grant execute on function public.get_my_goal_assignments() to authenticated;

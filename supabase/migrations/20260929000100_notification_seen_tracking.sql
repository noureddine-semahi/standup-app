-- Dashboard "pending notifications" section: lets the side that DIDN'T
-- respond to a connection request / goal assignment acknowledge the
-- resolution (accepted/declined). Neither side has an UPDATE grant on a
-- resolved row today (the only UPDATE policy on each table is
-- responder-only, and only while status = 'pending'), so acknowledging
-- needs a security definer RPC rather than a plain client update.

alter table public.connections add column if not exists requester_seen_at timestamptz;
alter table public.goal_assignments add column if not exists assigner_seen_at timestamptz;

create or replace function public.mark_connection_seen(p_connection_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.connections
  set requester_seen_at = now()
  where id = p_connection_id and requester_id = auth.uid() and status <> 'pending';
end; $$;
revoke all on function public.mark_connection_seen(uuid) from public;
grant execute on function public.mark_connection_seen(uuid) to authenticated;

create or replace function public.mark_goal_assignment_seen(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.goal_assignments
  set assigner_seen_at = now()
  where id = p_assignment_id and assigner_id = auth.uid() and status <> 'pending';
end; $$;
revoke all on function public.mark_goal_assignment_seen(uuid) from public;
grant execute on function public.mark_goal_assignment_seen(uuid) to authenticated;

-- Return-shape change (new output column) needs an explicit drop first --
-- CREATE OR REPLACE FUNCTION cannot change a function's return row shape.
drop function if exists public.get_my_goal_assignments();
create or replace function public.get_my_goal_assignments()
returns table(
  assignment_id uuid, status text, created_at timestamptz, responded_at timestamptz, plan_date date,
  snapshot_title text, snapshot_details text, snapshot_priority integer,
  assigner_id uuid, assigner_display_name text,
  recipient_id uuid, recipient_display_name text,
  assigner_goal_status text, recipient_goal_status text,
  assigner_seen_at timestamptz
)
language sql security definer set search_path = public stable
as $$
  select
    ga.id, ga.status, ga.created_at, ga.responded_at, ga.plan_date,
    ga.snapshot_title, ga.snapshot_details, ga.snapshot_priority,
    ga.assigner_id, ap.display_name,
    ga.recipient_id, rp.display_name,
    ag.status, rg.status,
    ga.assigner_seen_at
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

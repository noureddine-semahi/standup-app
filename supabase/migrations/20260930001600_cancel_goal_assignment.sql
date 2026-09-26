-- Lets either party retract/cancel a goal assignment, at the user's
-- request: a mistaken assignment needs a real undo, not just a silent
-- "Dismiss" of the tracking row (removeGoalAssignment) that left the
-- recipient's materialized goal sitting there untouched and never told
-- the other person anything happened.
--
-- Confirmed design: canceling pulls the goal from BOTH sides. If the
-- assignment was still pending, there's nothing on the recipient's side
-- yet -- it just never gets accepted. If it was already accepted, the
-- recipient's materialized goal (checklist/attachments included, via the
-- existing ON DELETE CASCADE) is deleted outright, and the assigner's own
-- original goal automatically reverts to fully normal/unlocked too --
-- for free, since "assigned out" locking everywhere in the app is
-- DERIVED from status <> 'declined' (see assignedOutByGoalId in Today/
-- Tomorrow/Dashboard), so adding 'canceled' to that same exclusion list
-- (done alongside this migration, client-side) makes a canceled
-- assignment revert identically to how a declined one already does.
--
-- An optional reason is attached, and the OTHER party (not whoever
-- triggered the cancellation) gets a Dashboard notification with it --
-- same "Got it" acknowledgment idiom assigner_seen_at/resolvedAssignments
-- already established, just made symmetric now that the ASSIGNER can be
-- the one causing a state change the RECIPIENT needs to be told about
-- (previously only ever the reverse: recipient accepts/declines, assigner
-- gets notified).
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

-- Finds and drops whatever the status check constraint is actually named
-- (rather than assuming Postgres's default auto-generated name) --  this
-- app has been bitten more than once this session by assuming a name/
-- shape instead of checking it, and a wrong guess here wouldn't error,
-- it would just silently leave the OLD constraint in place alongside a
-- new one, permanently blocking every 'canceled' insert with a check
-- violation.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.goal_assignments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.goal_assignments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.goal_assignments add constraint goal_assignments_status_check
  check (status in ('pending', 'accepted', 'declined', 'canceled'));

alter table public.goal_assignments add column if not exists canceled_by uuid references auth.users(id);
alter table public.goal_assignments add column if not exists cancel_reason text;
-- Mirrors assigner_seen_at exactly, but for the new direction: set when
-- the RECIPIENT acknowledges a change the ASSIGNER caused (cancellation),
-- vs assigner_seen_at being set when the ASSIGNER acknowledges a change
-- the RECIPIENT caused (accept/decline/cancel-after-accepting). Only ever
-- meaningful for status = 'canceled' -- there's no other case where the
-- assigner causes a state change the recipient wasn't already looking at.
alter table public.goal_assignments add column if not exists recipient_seen_at timestamptz;

-- Same "declined never blocks reassigning the same goal" precedent, now
-- extended to canceled too.
drop index if exists goal_assignments_one_active_per_goal;
create unique index goal_assignments_one_active_per_goal
  on public.goal_assignments (assigner_goal_id)
  where status not in ('declined', 'canceled');

-- security definer: canceling an ACCEPTED assignment must delete the
-- RECIPIENT's goal even when the ASSIGNER is the one calling this (goals'
-- own RLS is select/update/delete-own-only) -- safe because the only id
-- ever touched (recipient_goal_id) comes from the already-validated
-- goal_assignments row (auth.uid() confirmed as a participant, status
-- confirmed cancelable, checked explicitly below), never arbitrary client
-- input. Same justification respond_to_goal_assignment already relies on.
create or replace function public.cancel_goal_assignment(p_assignment_id uuid, p_reason text default null)
returns public.goal_assignments
language plpgsql security definer set search_path = public
as $$
declare
  v_assignment public.goal_assignments;
begin
  select * into v_assignment from public.goal_assignments
    where id = p_assignment_id and auth.uid() in (assigner_id, recipient_id) and status in ('pending', 'accepted')
    for update;

  if v_assignment.id is null then
    raise exception 'Cancelable assignment % not found for this user', p_assignment_id;
  end if;

  if v_assignment.recipient_goal_id is not null then
    delete from public.goals where id = v_assignment.recipient_goal_id;
  end if;

  update public.goal_assignments
    set status = 'canceled',
        canceled_by = auth.uid(),
        cancel_reason = nullif(trim(p_reason), ''),
        responded_at = now(),
        recipient_goal_id = null,
        -- Whichever side triggered this already knows why -- only the
        -- OTHER party needs a notification.
        assigner_seen_at = case when auth.uid() = assigner_id then now() else assigner_seen_at end,
        recipient_seen_at = case when auth.uid() = recipient_id then now() else recipient_seen_at end
    where id = p_assignment_id
    returning * into v_assignment;

  return v_assignment;
end;
$$;
revoke all on function public.cancel_goal_assignment(uuid, text) from public;
grant execute on function public.cancel_goal_assignment(uuid, text) to authenticated;

create or replace function public.mark_goal_assignment_seen_by_recipient(p_assignment_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.goal_assignments set recipient_seen_at = now()
  where id = p_assignment_id and recipient_id = auth.uid();
$$;
revoke all on function public.mark_goal_assignment_seen_by_recipient(uuid) from public;
grant execute on function public.mark_goal_assignment_seen_by_recipient(uuid) to authenticated;

-- get_my_goal_assignments gains 3 output columns -- 9th time this
-- function has needed drop-then-recreate for a return-shape change.
drop function if exists public.get_my_goal_assignments();
create or replace function public.get_my_goal_assignments()
returns table(
  assignment_id uuid, status text, created_at timestamptz, responded_at timestamptz, plan_date date,
  snapshot_title text, snapshot_details text, snapshot_priority integer,
  assigner_id uuid, assigner_display_name text,
  recipient_id uuid, recipient_display_name text,
  assigner_goal_status text, recipient_goal_status text,
  assigner_seen_at timestamptz, assigner_goal_id uuid, assignment_type text,
  recipient_goal_id uuid, recipient_plan_date date,
  canceled_by uuid, cancel_reason text, recipient_seen_at timestamptz
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
    ga.recipient_goal_id, rdp.plan_date,
    ga.canceled_by, ga.cancel_reason, ga.recipient_seen_at
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

-- Goal sharing/assignment: assign one of your own goals to an accepted
-- connection. They accept or decline; on accept, an independent copy of
-- the goal materializes into their own plan for the same date -- never a
-- shared row, same "materialize an independent copy, link back to origin"
-- idiom goal_reschedules/addGoalFromTemplate already use, just across two
-- users instead of one.
--
-- Snapshot columns (mirroring goal_reschedules' snapshot_title/details/
-- priority) exist for a stronger reason than they do there: goals' RLS is
-- select-own-only with NO cross-user policy at all, so the recipient
-- structurally cannot read the assigner's live goals row. The assignment
-- record must carry its own frozen copy of what's being proposed.
--
-- assigner_goal_id/recipient_goal_id are ON DELETE SET NULL, not CASCADE
-- -- this table is the durable cross-user record of "who asked whom, did
-- they accept," and must outlive either side's own goal being later
-- rescheduled/deleted/backlogged.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table public.goal_assignments (
  id uuid primary key default gen_random_uuid(),
  assigner_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  assigner_goal_id uuid references public.goals(id) on delete set null,
  recipient_goal_id uuid references public.goals(id) on delete set null,
  snapshot_title text not null,
  snapshot_details text,
  snapshot_priority integer not null default 3,
  plan_date date not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (assigner_id <> recipient_id)
);

-- Mirrors connections_unique_pair's "where status <> 'declined'" precedent:
-- at most one still-live assignment per source goal, but a declined one
-- never blocks reassigning the same goal afterward.
create unique index goal_assignments_one_active_per_goal
  on public.goal_assignments (assigner_goal_id)
  where status <> 'declined';
create index goal_assignments_recipient_status_idx on public.goal_assignments (recipient_id, status);
create index goal_assignments_assigner_idx on public.goal_assignments (assigner_id);
create index goal_assignments_recipient_goal_idx on public.goal_assignments (recipient_goal_id);

alter table public.goal_assignments enable row level security;

create policy "goal_assignments_select_participant" on public.goal_assignments
  for select using (auth.uid() in (assigner_id, recipient_id));

-- No client-facing insert path is offered (create_goal_assignment is the
-- only way in, and it does the real validation), but a WITH CHECK is
-- included anyway for defense in depth, matching the connections/posts
-- tables' own posture.
create policy "goal_assignments_insert_assigner" on public.goal_assignments
  for insert with check (assigner_id = auth.uid());

-- Mirrors connections_update_recipient_pending exactly: only the pending
-- assignment's recipient can move it, and only into a terminal state.
create policy "goal_assignments_update_recipient_pending" on public.goal_assignments
  for update
  using (recipient_id = auth.uid() and status = 'pending')
  with check (recipient_id = auth.uid() and status in ('accepted','declined'));

-- Mirrors connections_delete_participant: either side can dismiss a
-- record regardless of status. Safe by construction -- deleting the
-- assignment (child) can never cascade to a goals row (parent), and both
-- goal FKs above are ON DELETE SET NULL regardless.
create policy "goal_assignments_delete_participant" on public.goal_assignments
  for delete using (auth.uid() in (assigner_id, recipient_id));

-- security invoker: every row touched (the assigner's own goal, the
-- caller's own connections/goal_assignments row) is already covered by
-- existing owner-scoped RLS -- same reasoning upsert_daily_glimpse
-- already relies on for its own multi-table write.
create or replace function public.create_goal_assignment(p_goal_id uuid, p_recipient_id uuid)
returns public.goal_assignments
language plpgsql security invoker set search_path = public
as $$
declare
  v_goal record;
  v_row public.goal_assignments;
begin
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
    snapshot_title, snapshot_details, snapshot_priority, plan_date
  ) values (
    auth.uid(), p_recipient_id, p_goal_id,
    v_goal.title, v_goal.details, coalesce(v_goal.priority, 3), v_goal.plan_date
  )
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.create_goal_assignment(uuid, uuid) from public;
grant execute on function public.create_goal_assignment(uuid, uuid) to authenticated;

-- security invoker: on accept, every write is to the caller's OWN
-- daily_plans/goals rows, already covered by owner-scoped RLS.
create or replace function public.respond_to_goal_assignment(p_assignment_id uuid, p_accept boolean)
returns public.goal_assignments
language plpgsql security invoker set search_path = public
as $$
declare
  v_assignment public.goal_assignments;
  v_plan_id uuid;
  v_next_sort integer;
  v_new_goal_id uuid;
begin
  select * into v_assignment from public.goal_assignments
    where id = p_assignment_id and recipient_id = auth.uid() and status = 'pending'
    for update;

  if v_assignment.id is null then
    raise exception 'Pending assignment % not found for this user', p_assignment_id;
  end if;

  if not p_accept then
    update public.goal_assignments
      set status = 'declined', responded_at = now()
      where id = p_assignment_id
      returning * into v_assignment;
    return v_assignment;
  end if;

  -- Get-or-create the recipient's own plan for this date -- same
  -- unique(user_id, plan_date) constraint getOrCreatePlan() relies on
  -- client-side.
  select id into v_plan_id from public.daily_plans
    where user_id = auth.uid() and plan_date = v_assignment.plan_date;

  if v_plan_id is null then
    insert into public.daily_plans (user_id, plan_date)
      values (auth.uid(), v_assignment.plan_date)
      on conflict (user_id, plan_date) do nothing
      returning id into v_plan_id;
    if v_plan_id is null then
      select id into v_plan_id from public.daily_plans
        where user_id = auth.uid() and plan_date = v_assignment.plan_date;
    end if;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort
    from public.goals where plan_id = v_plan_id;

  insert into public.goals (user_id, plan_id, title, details, status, sort_order, priority)
    values (auth.uid(), v_plan_id, v_assignment.snapshot_title, v_assignment.snapshot_details,
            'not_started', v_next_sort, v_assignment.snapshot_priority)
    returning id into v_new_goal_id;

  update public.goal_assignments
    set status = 'accepted', responded_at = now(), recipient_goal_id = v_new_goal_id
    where id = p_assignment_id
    returning * into v_assignment;

  return v_assignment;
end;
$$;
revoke all on function public.respond_to_goal_assignment(uuid, boolean) from public;
grant execute on function public.respond_to_goal_assignment(uuid, boolean) to authenticated;

-- security definer: the one place this feature reads ANOTHER user's live
-- goals.status (via assigner_goal_id/recipient_goal_id), which goals' RLS
-- structurally blocks -- mirrors get_feed's own justification exactly.
create or replace function public.get_my_goal_assignments()
returns table(
  assignment_id uuid, status text, created_at timestamptz, responded_at timestamptz, plan_date date,
  snapshot_title text, snapshot_details text, snapshot_priority integer,
  assigner_id uuid, assigner_display_name text,
  recipient_id uuid, recipient_display_name text,
  assigner_goal_status text, recipient_goal_status text
)
language sql security definer set search_path = public stable
as $$
  select
    ga.id, ga.status, ga.created_at, ga.responded_at, ga.plan_date,
    ga.snapshot_title, ga.snapshot_details, ga.snapshot_priority,
    ga.assigner_id, ap.display_name,
    ga.recipient_id, rp.display_name,
    ag.status, rg.status
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

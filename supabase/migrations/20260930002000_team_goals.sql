-- Team Goals: a goal that needs participation from multiple connections,
-- distinct from goal_assignments (a 1:1 handoff to exactly one other
-- person's own independent copy). Posted to the feed as an open invite --
-- anyone who can see the post can opt in -- and tracked as a single
-- shared checklist any participant can add to or check off. The goal
-- completes once every item is checked, by anyone, not when one specific
-- person finishes "their part." Deliberately does NOT touch the daily
-- plan/points/priority system -- lives entirely in Social, confirmed
-- with the user.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table public.team_goals (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  details text,
  status text not null default 'open' check (status in ('open', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.team_goal_participants (
  team_goal_id uuid not null references public.team_goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_goal_id, user_id)
);
create index team_goal_participants_user_idx on public.team_goal_participants (user_id);

create table public.team_goal_checklist_items (
  id uuid primary key default gen_random_uuid(),
  team_goal_id uuid not null references public.team_goals(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  added_by uuid not null references auth.users(id) on delete cascade,
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index team_goal_checklist_items_goal_idx on public.team_goal_checklist_items (team_goal_id);

-- posts gains a 4th type. The composite payload CHECK is one unnamed
-- table-level constraint with no stable name to ALTER selectively, so
-- every check constraint on posts is dropped and re-added in full here --
-- same reasoning image/video's own columns already folded into one
-- check rather than bolting on separate ones.
alter table public.posts add column if not exists team_goal_id uuid references public.team_goals(id) on delete cascade;

do $$
declare
  r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.posts'::regclass and contype = 'c'
  loop
    execute format('alter table public.posts drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.posts add constraint posts_type_check check (type in ('goal_glimpse','achievement','motivational','team_goal'));
alter table public.posts add constraint posts_visibility_check check (visibility in ('connections','everyone','individual'));
alter table public.posts add constraint posts_individual_target_check check (
  (visibility = 'individual' and target_user_id is not null)
  or (visibility <> 'individual' and target_user_id is null)
);
alter table public.posts add constraint posts_payload_check check (
  (type = 'goal_glimpse' and plan_id is not null and plan_date is not null and achievement_id is null and body is null and team_goal_id is null)
  or (type = 'achievement' and achievement_id is not null and plan_id is null and plan_date is null and body is null and team_goal_id is null)
  or (type = 'motivational' and body is not null and plan_id is null and plan_date is null and achievement_id is null and team_goal_id is null)
  or (type = 'team_goal' and team_goal_id is not null and plan_id is null and plan_date is null and achievement_id is null and body is null)
);

alter table public.team_goals enable row level security;
alter table public.team_goal_participants enable row level security;
alter table public.team_goal_checklist_items enable row level security;

-- Visibility mirrors the parent post's can_view_post() -- a team_goal row
-- has exactly one posts row pointing at it (created together, never
-- repointed), so routing every read through that one post is sufficient.
create policy "team_goals_select_visible" on public.team_goals
  for select using (
    creator_id = auth.uid()
    or exists (select 1 from public.team_goal_participants tgp where tgp.team_goal_id = team_goals.id and tgp.user_id = auth.uid())
    or exists (select 1 from public.posts p where p.team_goal_id = team_goals.id and public.can_view_post(p.id))
  );

create policy "team_goal_participants_select_visible" on public.team_goal_participants
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.posts p where p.team_goal_id = team_goal_participants.team_goal_id and public.can_view_post(p.id))
  );

create policy "team_goal_checklist_items_select_visible" on public.team_goal_checklist_items
  for select using (
    exists (select 1 from public.posts p where p.team_goal_id = team_goal_checklist_items.team_goal_id and public.can_view_post(p.id))
  );

-- No insert/update policies on any of the three tables -- every write
-- goes through a security-definer RPC below so "can you see it" and "are
-- you actually a participant" are both re-checked server-side, the same
-- reasoning create_goal_assignment/respond_to_goal_assignment already
-- established for goal_assignments.

create or replace function public.create_team_goal(
  p_title text, p_details text, p_visibility text, p_items text[]
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_goal_id uuid;
  v_item text;
  v_sort int := 0;
begin
  if p_visibility not in ('connections', 'everyone') then
    raise exception 'A team goal can only be posted to connections or everyone';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Title is required';
  end if;

  insert into public.team_goals (creator_id, title, details)
  values (auth.uid(), trim(p_title), nullif(trim(coalesce(p_details, '')), ''))
  returning id into v_goal_id;

  insert into public.team_goal_participants (team_goal_id, user_id) values (v_goal_id, auth.uid());

  if p_items is not null then
    foreach v_item in array p_items loop
      if trim(v_item) <> '' then
        insert into public.team_goal_checklist_items (team_goal_id, text, added_by, sort_order)
        values (v_goal_id, trim(v_item), auth.uid(), v_sort);
        v_sort := v_sort + 1;
      end if;
    end loop;
  end if;

  insert into public.posts (user_id, type, visibility, team_goal_id)
  values (auth.uid(), 'team_goal', p_visibility, v_goal_id);

  return v_goal_id;
end;
$$;
revoke all on function public.create_team_goal(text, text, text, text[]) from public;
grant execute on function public.create_team_goal(text, text, text, text[]) to authenticated;

create or replace function public.join_team_goal(p_team_goal_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.posts p where p.team_goal_id = p_team_goal_id and public.can_view_post(p.id)
  ) then
    raise exception 'You cannot join a team goal you cannot see';
  end if;
  if not exists (select 1 from public.team_goals tg where tg.id = p_team_goal_id and tg.status = 'open') then
    raise exception 'This team goal is already completed';
  end if;

  insert into public.team_goal_participants (team_goal_id, user_id)
  values (p_team_goal_id, auth.uid())
  on conflict do nothing;
end;
$$;
revoke all on function public.join_team_goal(uuid) from public;
grant execute on function public.join_team_goal(uuid) to authenticated;

-- Returns the newly created row (with its author's display name already
-- resolved) in one round trip -- safe to RETURNING here despite the
-- INSERT+RETURNING/SELECT-policy bug hit earlier on posts, because this
-- happens inside a SECURITY DEFINER function body (full RLS bypass), not
-- a client-side .insert().select().
create or replace function public.add_team_goal_item(p_team_goal_id uuid, p_text text)
returns table(item_id uuid, item_text text, done boolean, added_by_display_name text)
language plpgsql security definer set search_path = public
as $$
declare
  v_next_sort int;
  v_id uuid;
begin
  if not exists (
    select 1 from public.team_goal_participants tgp where tgp.team_goal_id = p_team_goal_id and tgp.user_id = auth.uid()
  ) then
    raise exception 'Join this team goal before adding to it';
  end if;
  if coalesce(trim(p_text), '') = '' then
    raise exception 'Item text is required';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort
    from public.team_goal_checklist_items where team_goal_id = p_team_goal_id;

  insert into public.team_goal_checklist_items (team_goal_id, text, added_by, sort_order)
  values (p_team_goal_id, trim(p_text), auth.uid(), v_next_sort)
  returning id into v_id;

  return query
    select i.id, i.text, i.done, pr.display_name
    from public.team_goal_checklist_items i
    join public.profiles pr on pr.id = i.added_by
    where i.id = v_id;
end;
$$;
revoke all on function public.add_team_goal_item(uuid, text) from public;
grant execute on function public.add_team_goal_item(uuid, text) to authenticated;

-- Toggles one item and, inside the same transaction, decides the parent
-- team goal's status -- the ONE place "done" is decided, so two
-- participants checking the last two items near-simultaneously both run
-- this function and are simply serialized by Postgres' normal row
-- locking rather than racing on the client. Returns the resulting status
-- so the client reflects the server's actual decision instead of
-- recomputing "all checked?" itself from a possibly-stale item list.
create or replace function public.toggle_team_goal_item(p_item_id uuid, p_done boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_team_goal_id uuid;
  v_remaining int;
  v_total int;
  v_status text;
begin
  select team_goal_id into v_team_goal_id from public.team_goal_checklist_items where id = p_item_id;
  if v_team_goal_id is null then
    raise exception 'Checklist item not found';
  end if;
  if not exists (
    select 1 from public.team_goal_participants tgp where tgp.team_goal_id = v_team_goal_id and tgp.user_id = auth.uid()
  ) then
    raise exception 'Join this team goal before updating it';
  end if;

  update public.team_goal_checklist_items
    set done = p_done, done_by = case when p_done then auth.uid() else null end, done_at = case when p_done then now() else null end
    where id = p_item_id;

  select count(*) filter (where not done), count(*) into v_remaining, v_total
    from public.team_goal_checklist_items where team_goal_id = v_team_goal_id;

  if v_total > 0 and v_remaining = 0 then
    update public.team_goals set status = 'completed', completed_at = now() where id = v_team_goal_id and status = 'open';
  else
    update public.team_goals set status = 'open', completed_at = null where id = v_team_goal_id and status = 'completed';
  end if;

  select status into v_status from public.team_goals where id = v_team_goal_id;
  return v_status;
end;
$$;
revoke all on function public.toggle_team_goal_item(uuid, boolean) from public;
grant execute on function public.toggle_team_goal_item(uuid, boolean) to authenticated;

-- get_feed's return row shape is changing (7 new output columns) -- same
-- drop-then-recreate this function has needed every prior time.
drop function if exists public.get_feed(int, timestamptz);
create or replace function public.get_feed(p_limit int default 30, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, my_reaction text, goals jsonb,
  target_user_id uuid, target_display_name text, image_path text, video_path text,
  shared_by_id uuid, shared_by_display_name text,
  reaction_counts jsonb, comment_count int,
  team_goal_id uuid, team_goal_title text, team_goal_details text, team_goal_status text,
  team_goal_participant_count int, team_goal_joined boolean, team_goal_items jsonb
)
language plpgsql security definer set search_path = public stable
as $$
begin
  return query
  select p.id, p.user_id, pr.display_name, pr.avatar_url, p.type, p.visibility, p.created_at, p.plan_date, p.achievement_id, p.body,
    (select rx.reaction from public.post_reactions rx where rx.post_id = p.id and rx.viewer_id = auth.uid()),
    case when p.type = 'goal_glimpse' then (
      select jsonb_agg(jsonb_build_object(
        'goal_id', g.id, 'title', g.title, 'priority', g.priority,
        'status', g.status, 'is_all_day', g.is_all_day, 'time_of_day', g.time_of_day
      ) order by g.sort_order)
      from public.goals g where g.plan_id = p.plan_id
    ) else null end,
    p.target_user_id, tpr.display_name, p.image_path, p.video_path,
    (select ps.shared_by from public.post_shares ps where ps.post_id = p.id and ps.shared_with = auth.uid() limit 1),
    (select spr.display_name from public.post_shares ps join public.profiles spr on spr.id = ps.shared_by
      where ps.post_id = p.id and ps.shared_with = auth.uid() limit 1),
    (select jsonb_object_agg(t.reaction, t.cnt) from (
      select prx.reaction, count(*) as cnt from public.post_reactions prx where prx.post_id = p.id group by prx.reaction
    ) t),
    (select count(*)::int from public.post_comments c where c.post_id = p.id),
    tg.id, tg.title, tg.details, tg.status,
    case when p.type = 'team_goal' then (
      select count(*)::int from public.team_goal_participants tgp where tgp.team_goal_id = p.team_goal_id
    ) else null end,
    case when p.type = 'team_goal' then exists (
      select 1 from public.team_goal_participants tgp where tgp.team_goal_id = p.team_goal_id and tgp.user_id = auth.uid()
    ) else null end,
    case when p.type = 'team_goal' then (
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'text', i.text, 'done', i.done,
        'added_by_display_name', apr.display_name, 'done_by_display_name', dpr.display_name
      ) order by i.sort_order)
      from public.team_goal_checklist_items i
      join public.profiles apr on apr.id = i.added_by
      left join public.profiles dpr on dpr.id = i.done_by
      where i.team_goal_id = p.team_goal_id
    ) else null end
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  left join public.profiles tpr on tpr.id = p.target_user_id
  left join public.team_goals tg on tg.id = p.team_goal_id
  where (p_before is null or p.created_at < p_before)
    and public.can_view_post(p.id)
  order by p.created_at desc
  limit p_limit;
end; $$;
revoke all on function public.get_feed(int, timestamptz) from public;
grant execute on function public.get_feed(int, timestamptz) to authenticated;

-- admin_get_feed just needs enough to identify/preview a team_goal post
-- for moderation -- not the full checklist, participants aren't the
-- thing being moderated.
drop function if exists public.admin_get_feed(int, timestamptz);
create or replace function public.admin_get_feed(p_limit int default 50, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, image_path text, video_path text, goals jsonb,
  target_user_id uuid, target_display_name text,
  reaction_count int, comment_count int,
  team_goal_id uuid, team_goal_title text, team_goal_status text
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  return query
  select p.id, p.user_id, pr.display_name, pr.avatar_url, p.type, p.visibility, p.created_at,
    p.plan_date, p.achievement_id, p.body, p.image_path, p.video_path,
    case when p.type = 'goal_glimpse' then (
      select jsonb_agg(jsonb_build_object(
        'goal_id', g.id, 'title', g.title, 'priority', g.priority,
        'status', g.status, 'is_all_day', g.is_all_day, 'time_of_day', g.time_of_day
      ) order by g.sort_order)
      from public.goals g where g.plan_id = p.plan_id
    ) else null end,
    p.target_user_id, tpr.display_name,
    (select count(*)::int from public.post_reactions rx where rx.post_id = p.id),
    (select count(*)::int from public.post_comments pc where pc.post_id = p.id),
    tg.id, tg.title, tg.status
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  left join public.profiles tpr on tpr.id = p.target_user_id
  left join public.team_goals tg on tg.id = p.team_goal_id
  where (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit p_limit;
end; $$;
revoke all on function public.admin_get_feed(int, timestamptz) from public;
grant execute on function public.admin_get_feed(int, timestamptz) to authenticated;

-- admin_delete_post's audit-log preview fell back to NULL for a team_goal
-- post (body/achievement_id/plan_date are all null for that type) --
-- widened to also try the team goal's own title. Signature is unchanged
-- so a plain create-or-replace is enough, no drop needed.
create or replace function public.admin_delete_post(p_post_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_type text; v_preview text;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  select user_id, type, coalesce(body, achievement_id, (select tg.title from public.team_goals tg where tg.id = posts.team_goal_id), 'goal_glimpse ' || plan_date::text)
    into v_owner, v_type, v_preview
    from public.posts where id = p_post_id;
  if v_owner is null then
    raise exception 'post not found';
  end if;

  delete from public.posts where id = p_post_id;

  insert into public.admin_audit_log (admin_id, target_user_id, action, details)
  values (
    auth.uid(), v_owner, 'delete_post',
    jsonb_build_object('post_id', p_post_id, 'type', v_type, 'preview', left(coalesce(v_preview, ''), 200))
  );
end; $$;
revoke all on function public.admin_delete_post(uuid) from public;
grant execute on function public.admin_delete_post(uuid) to authenticated;

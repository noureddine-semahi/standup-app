-- Audience dropdown: adds a third post-visibility tier ("individual" --
-- shared with exactly one accepted connection). This is also the moment
-- to close a gap the comments migration's own comment flagged but didn't
-- fix: posts_select_visible, get_feed, and set_post_reaction each
-- independently duplicate the "own OR everyone OR (connections AND
-- accepted)" check, rather than calling can_view_post() the way every
-- comment-related policy/RPC already does. Adding a third case by hand
-- in three more places would repeat exactly that bug class. This
-- migration consolidates all three onto can_view_post() instead.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

alter table public.posts add column if not exists target_user_id uuid references auth.users(id) on delete cascade;

alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check check (visibility in ('connections','everyone','individual'));

alter table public.posts drop constraint if exists posts_individual_target_check;
alter table public.posts add constraint posts_individual_target_check check (
  (visibility = 'individual' and target_user_id is not null)
  or (visibility <> 'individual' and target_user_id is null)
);

-- Single source of truth for "can the current user see this post" --
-- extended with the individual case, and the ONLY branch that requires
-- individual visibility to still be a currently-accepted connection at
-- read time (matching how the 'connections' branch already re-checks
-- live acceptance rather than a frozen-at-share-time grant) -- removing
-- someone as a connection should actually revoke what you'd shared with
-- them individually too, not just future connections-tier posts.
--
-- security definer: reads public.posts directly inside itself, which is
-- safe -- this role bypasses RLS entirely (posts never has FORCE ROW
-- LEVEL SECURITY set), so it never re-enters posts_select_visible even
-- though that policy now calls this same function. Same mechanism
-- get_feed/the comments RPCs already rely on, just used one hop earlier.
create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.posts p where p.id = p_post_id and (
      p.user_id = auth.uid()
      or p.visibility = 'everyone'
      or (p.visibility = 'connections' and exists (
        select 1 from public.connections c where c.status = 'accepted'
          and ((c.requester_id = auth.uid() and c.recipient_id = p.user_id)
            or (c.recipient_id = auth.uid() and c.requester_id = p.user_id))
      ))
      or (p.visibility = 'individual' and p.target_user_id = auth.uid() and exists (
        select 1 from public.connections c where c.status = 'accepted'
          and ((c.requester_id = auth.uid() and c.recipient_id = p.user_id)
            or (c.recipient_id = auth.uid() and c.requester_id = p.user_id))
      ))
    )
  );
$$;
revoke all on function public.can_view_post(uuid) from public;
grant execute on function public.can_view_post(uuid) to authenticated;

drop policy if exists "posts_select_visible" on public.posts;
create policy "posts_select_visible" on public.posts
  for select using (public.can_view_post(id));

create or replace function public.set_post_reaction(p_post_id uuid, p_reaction text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.posts where id = p_post_id;
  if v_owner is null then raise exception 'post not found'; end if;
  if v_owner = auth.uid() then raise exception 'cannot react to your own post'; end if;
  if not public.can_view_post(p_post_id) then raise exception 'post not visible'; end if;

  if p_reaction is null then
    delete from public.post_reactions where post_id = p_post_id and viewer_id = auth.uid();
  else
    if p_reaction not in ('like','support','fire','clap') then raise exception 'invalid reaction'; end if;
    insert into public.post_reactions (post_id, viewer_id, reaction, updated_at)
      values (p_post_id, auth.uid(), p_reaction, now())
      on conflict (post_id, viewer_id) do update set reaction = excluded.reaction, updated_at = now();
  end if;
end; $$;
revoke all on function public.set_post_reaction(uuid, text) from public;
grant execute on function public.set_post_reaction(uuid, text) to authenticated;

create or replace function public.get_feed(p_limit int default 30, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, my_reaction text, goals jsonb,
  target_user_id uuid, target_display_name text
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
    p.target_user_id, tpr.display_name
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  left join public.profiles tpr on tpr.id = p.target_user_id
  where (p_before is null or p.created_at < p_before)
    and public.can_view_post(p.id)
  order by p.created_at desc
  limit p_limit;
end; $$;
revoke all on function public.get_feed(int, timestamptz) from public;
grant execute on function public.get_feed(int, timestamptz) to authenticated;

-- Signature is changing (a 4th parameter) -- drop the old 3-arg overload
-- first. CREATE OR REPLACE on a different parameter list creates a
-- second overload instead of replacing this one, which would leave two
-- ambiguous candidates once callers start omitting p_target_user_id.
drop function if exists public.upsert_daily_glimpse(uuid, date, text);
create or replace function public.upsert_daily_glimpse(
  p_plan_id uuid, p_plan_date date, p_visibility text, p_target_user_id uuid default null
)
returns public.posts
language plpgsql security invoker set search_path = public
as $$
declare v_row public.posts;
begin
  if p_visibility = 'individual' then
    if p_target_user_id is null then
      raise exception 'target_user_id is required when visibility is individual';
    end if;
    -- Defense in depth: the UI only ever offers accepted connections, but
    -- the RPC shouldn't trust that.
    if not exists (
      select 1 from public.connections c where c.status = 'accepted'
        and ((c.requester_id = auth.uid() and c.recipient_id = p_target_user_id)
          or (c.recipient_id = auth.uid() and c.requester_id = p_target_user_id))
    ) then
      raise exception 'target_user_id must be an accepted connection';
    end if;
  elsif p_target_user_id is not null then
    raise exception 'target_user_id is only valid when visibility is individual';
  end if;

  insert into public.posts (user_id, type, plan_id, plan_date, visibility, target_user_id)
  values (auth.uid(), 'goal_glimpse', p_plan_id, p_plan_date, p_visibility, p_target_user_id)
  on conflict (user_id, plan_date) where type = 'goal_glimpse'
  do update set plan_id = excluded.plan_id, visibility = excluded.visibility, target_user_id = excluded.target_user_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.upsert_daily_glimpse(uuid, date, text, uuid) to authenticated;

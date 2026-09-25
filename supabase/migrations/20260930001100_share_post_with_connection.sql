-- Share a post you can see with one of your own connections, even if
-- they couldn't otherwise see it (a "Connections"-only post from someone
-- they're not connected to, for example). Deliberate choice, confirmed
-- with the user: sharing EXTENDS visibility within your own network
-- rather than being a no-op nudge on already-visible posts only --
-- matches how sharing works on most social platforms (you're vouching
-- for it within your own circle), not a permissions leak: it only ever
-- reaches people YOU are actually connected to, and only for posts you
-- yourself can currently see.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.post_shares (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  shared_by uuid not null references auth.users(id) on delete cascade,
  shared_with uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, shared_by, shared_with)
);
create index if not exists post_shares_shared_with_idx on public.post_shares (shared_with);

alter table public.post_shares enable row level security;

-- Either party can see a share row (the sharer to know what they've
-- shared, the recipient to know who shared it with them -- get_feed
-- surfaces this as "shared by {name}" per post below).
drop policy if exists "post_shares_select_party" on public.post_shares;
create policy "post_shares_select_party" on public.post_shares
  for select using (shared_by = auth.uid() or shared_with = auth.uid());

-- Insert-only (no update; no delete UI exists yet -- unsharing wasn't
-- asked for). security invoker on share_post() below relies on this
-- policy plus can_view_post()/connections' own RLS for authorization,
-- rather than needing a security definer wrapper.
drop policy if exists "post_shares_insert_own" on public.post_shares;
create policy "post_shares_insert_own" on public.post_shares
  for insert with check (shared_by = auth.uid());

-- Single source of truth for "can the current user see this post" --
-- extended with the share case. Re-checks live connection acceptance
-- between the SHARER and the recipient at read time (not the original
-- post owner) -- same "don't freeze a grant at share-time" principle
-- the individual-visibility case already established: if the sharer and
-- recipient are no longer connected, the share stops granting access.
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
      or exists (
        select 1 from public.post_shares ps
        where ps.post_id = p.id and ps.shared_with = auth.uid()
          and exists (
            select 1 from public.connections c where c.status = 'accepted'
              and ((c.requester_id = ps.shared_by and c.recipient_id = ps.shared_with)
                or (c.recipient_id = ps.shared_by and c.requester_id = ps.shared_with))
          )
      )
    )
  );
$$;
revoke all on function public.can_view_post(uuid) from public;
grant execute on function public.can_view_post(uuid) to authenticated;

create or replace function public.share_post(p_post_id uuid, p_recipient_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if p_recipient_id = auth.uid() then
    raise exception 'Cannot share a post with yourself';
  end if;

  if not public.can_view_post(p_post_id) then
    raise exception 'You cannot share a post you cannot see';
  end if;

  if not exists (
    select 1 from public.connections c where c.status = 'accepted'
      and ((c.requester_id = auth.uid() and c.recipient_id = p_recipient_id)
        or (c.recipient_id = auth.uid() and c.requester_id = p_recipient_id))
  ) then
    raise exception 'You can only share with an accepted connection';
  end if;

  insert into public.post_shares (post_id, shared_by, shared_with)
  values (p_post_id, auth.uid(), p_recipient_id)
  on conflict (post_id, shared_by, shared_with) do nothing;
end; $$;
revoke all on function public.share_post(uuid, uuid) from public;
grant execute on function public.share_post(uuid, uuid) to authenticated;

-- get_feed's return row shape is changing (four new output columns:
-- share attribution + per-type reaction counts + a total comment count,
-- the last two answering "how much attraction is this post getting") --
-- same drop-then-recreate this function has needed each prior time.
drop function if exists public.get_feed(int, timestamptz);
create or replace function public.get_feed(p_limit int default 30, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, my_reaction text, goals jsonb,
  target_user_id uuid, target_display_name text, image_path text,
  shared_by_id uuid, shared_by_display_name text,
  reaction_counts jsonb, comment_count int
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
    p.target_user_id, tpr.display_name, p.image_path,
    -- Only surfaced when THIS viewer reached the post via a share (not
    -- the post owner, and not another viewer's own separate share of the
    -- same post) -- null for every other row, including the post owner's
    -- own view of their own post.
    (select ps.shared_by from public.post_shares ps where ps.post_id = p.id and ps.shared_with = auth.uid() limit 1),
    (select spr.display_name from public.post_shares ps join public.profiles spr on spr.id = ps.shared_by
      where ps.post_id = p.id and ps.shared_with = auth.uid() limit 1),
    -- {"like": 2, "fire": 1, ...} -- a type with zero reactions is simply
    -- absent from the object rather than present at 0; the client
    -- defaults any missing key to 0.
    (select jsonb_object_agg(t.reaction, t.cnt) from (
      select reaction, count(*) as cnt from public.post_reactions where post_id = p.id group by reaction
    ) t),
    (select count(*)::int from public.post_comments c where c.post_id = p.id)
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

-- get_post_comments gains the same per-type reaction counts, so a
-- comment's own engagement is visible too, not just the post's.
drop function if exists public.get_post_comments(uuid);
create or replace function public.get_post_comments(p_post_id uuid)
returns table(
  comment_id uuid, post_id uuid, user_id uuid, display_name text, avatar_url text,
  parent_comment_id uuid, body text, created_at timestamptz, my_reaction text, reaction_counts jsonb
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.can_view_post(p_post_id) then
    raise exception 'post not visible';
  end if;

  return query
  select c.id, c.post_id, c.user_id, pr.display_name, pr.avatar_url, c.parent_comment_id, c.body, c.created_at,
    (select rx.reaction from public.comment_reactions rx where rx.comment_id = c.id and rx.viewer_id = auth.uid()),
    (select jsonb_object_agg(t.reaction, t.cnt) from (
      select reaction, count(*) as cnt from public.comment_reactions where comment_id = c.id group by reaction
    ) t)
  from public.post_comments c
  join public.profiles pr on pr.id = c.user_id
  where c.post_id = p_post_id
  order by c.created_at asc;
end; $$;
revoke all on function public.get_post_comments(uuid) from public;
grant execute on function public.get_post_comments(uuid) to authenticated;

-- Comments on posts, replies on comments (one level deep, Facebook-style),
-- and reactions on comments -- the remaining piece of the original Social
-- vision (unified feed + connections shipped 2026-09-18).
--
-- posts_select_visible, get_feed, and set_post_reaction each already
-- duplicate the same three-clause visibility check (own / everyone /
-- connections+accepted) independently. Comments add several more call
-- sites -- past this point, duplicating it again risks the same bug class
-- this app hit once already (an RLS/query subquery quietly checking the
-- wrong identity). So this factors it into one function, can_view_post(),
-- and every new policy/RPC below calls that instead of re-deriving it.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_comment_id uuid references public.post_comments(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 and length(body) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);
create index if not exists post_comments_parent_idx on public.post_comments (parent_comment_id) where parent_comment_id is not null;

-- Postgres CHECK constraints can't contain subqueries, so the one-level
-- reply rule (a reply's parent must itself be top-level) is enforced here
-- instead -- a real DB guarantee, not just client-side policing.
create or replace function public.assert_comment_parent_is_top_level()
returns trigger
language plpgsql
as $$
declare v_parent_post uuid; v_parent_parent uuid;
begin
  if new.parent_comment_id is not null then
    select post_id, parent_comment_id into v_parent_post, v_parent_parent
      from public.post_comments where id = new.parent_comment_id;
    if v_parent_post is null then
      raise exception 'parent comment not found';
    end if;
    if v_parent_parent is not null then
      raise exception 'replies cannot themselves be replied to';
    end if;
    if v_parent_post <> new.post_id then
      raise exception 'parent comment belongs to a different post';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists post_comments_depth_check on public.post_comments;
create trigger post_comments_depth_check
  before insert on public.post_comments
  for each row execute function public.assert_comment_parent_is_top_level();

create table if not exists public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('like','support','fire','clap')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comment_id, viewer_id)
);
create index if not exists comment_reactions_comment_idx on public.comment_reactions (comment_id);

-- Single source of truth for "can the current user see this post". security
-- definer: must read posts/connections rows the caller may not otherwise
-- have a select policy for (e.g. a connections row between two other users
-- isn't visible to the caller directly, but the caller is allowed to know
-- whether *they* have an accepted connection to the post's owner).
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
    )
  );
$$;
revoke all on function public.can_view_post(uuid) from public;
grant execute on function public.can_view_post(uuid) to authenticated;

alter table public.post_comments enable row level security;

drop policy if exists "post_comments_select_if_post_visible" on public.post_comments;
create policy "post_comments_select_if_post_visible" on public.post_comments
  for select using (public.can_view_post(post_id));

-- Insert is gated by can_view_post (can't comment on a post you can't
-- see) AND user_id = auth.uid() -- both required directly in RLS since
-- this insert never needs to write anyone else's row, unlike reactions
-- which need an upsert-on-conflict the client can't express.
drop policy if exists "post_comments_insert_if_post_visible" on public.post_comments;
create policy "post_comments_insert_if_post_visible" on public.post_comments
  for insert with check (user_id = auth.uid() and public.can_view_post(post_id));

-- Delete-own allowed, no edit -- comments are public-facing (unlike
-- goal_notes' private append-only audit trail), so retraction matters.
drop policy if exists "post_comments_delete_own" on public.post_comments;
create policy "post_comments_delete_own" on public.post_comments
  for delete using (user_id = auth.uid());

alter table public.comment_reactions enable row level security;

-- A comment reaction is exactly as public as the comment itself.
drop policy if exists "comment_reactions_select_if_visible" on public.comment_reactions;
create policy "comment_reactions_select_if_visible" on public.comment_reactions
  for select using (
    viewer_id = auth.uid()
    or exists (select 1 from public.post_comments pc where pc.id = comment_reactions.comment_id and pc.user_id = auth.uid())
    or exists (select 1 from public.post_comments pc where pc.id = comment_reactions.comment_id and public.can_view_post(pc.post_id))
  );
-- All writes go through set_comment_reaction() below, same reasoning as
-- post_reactions: one audited place doing the visibility check.

-- profiles RLS is select-own only, so a plain client join from post_comments
-- to profiles would silently null out every commenter's name except the
-- viewer's own -- this must be security definer, exactly like get_feed.
create or replace function public.get_post_comments(p_post_id uuid)
returns table(
  comment_id uuid, post_id uuid, user_id uuid, display_name text, avatar_url text,
  parent_comment_id uuid, body text, created_at timestamptz, my_reaction text
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.can_view_post(p_post_id) then
    raise exception 'post not visible';
  end if;

  return query
  select c.id, c.post_id, c.user_id, pr.display_name, pr.avatar_url, c.parent_comment_id, c.body, c.created_at,
    (select rx.reaction from public.comment_reactions rx where rx.comment_id = c.id and rx.viewer_id = auth.uid())
  from public.post_comments c
  join public.profiles pr on pr.id = c.user_id
  where c.post_id = p_post_id
  order by c.created_at asc;
end; $$;
revoke all on function public.get_post_comments(uuid) from public;
grant execute on function public.get_post_comments(uuid) to authenticated;

-- Batched so the collapsed "Comments (N)" toggle can show a count for a
-- whole feed page (~30 posts) in one call instead of one per post.
create or replace function public.get_post_comment_counts(p_post_ids uuid[])
returns table(post_id uuid, comment_count int)
language sql security definer set search_path = public stable
as $$
  select c.post_id, count(*)::int
  from public.post_comments c
  where c.post_id = any(p_post_ids) and public.can_view_post(c.post_id)
  group by c.post_id;
$$;
revoke all on function public.get_post_comment_counts(uuid[]) from public;
grant execute on function public.get_post_comment_counts(uuid[]) to authenticated;

-- The depth-1 rule is enforced twice on purpose: the trigger above is the
-- real guarantee (holds even for a future direct-insert bug), this
-- explicit re-check just turns that into a friendlier error message
-- before the insert is attempted.
create or replace function public.add_post_comment(p_post_id uuid, p_body text, p_parent_comment_id uuid default null)
returns public.post_comments
language plpgsql security invoker set search_path = public
as $$
declare v_row public.post_comments; v_trimmed text; v_parent_parent uuid; v_parent_post uuid;
begin
  v_trimmed := trim(p_body);
  if v_trimmed = '' or length(v_trimmed) > 500 then
    raise exception 'comment body must be 1-500 characters';
  end if;

  if p_parent_comment_id is not null then
    select post_id, parent_comment_id into v_parent_post, v_parent_parent
      from public.post_comments where id = p_parent_comment_id;
    if v_parent_post is null then raise exception 'parent comment not found'; end if;
    if v_parent_post <> p_post_id then raise exception 'parent comment belongs to a different post'; end if;
    if v_parent_parent is not null then raise exception 'replies cannot themselves be replied to'; end if;
  end if;

  insert into public.post_comments (post_id, user_id, parent_comment_id, body)
  values (p_post_id, auth.uid(), p_parent_comment_id, v_trimmed)
  returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.add_post_comment(uuid, text, uuid) from public;
grant execute on function public.add_post_comment(uuid, text, uuid) to authenticated;

-- security invoker is enough (post_comments_delete_own covers it) -- an
-- RPC wrapper isn't structurally required here, but matches the
-- symmetrical add_*/delete_* pair convention elsewhere in this app.
create or replace function public.delete_post_comment(p_comment_id uuid)
returns void
language sql security invoker set search_path = public
as $$
  delete from public.post_comments where id = p_comment_id and user_id = auth.uid();
$$;
revoke all on function public.delete_post_comment(uuid) from public;
grant execute on function public.delete_post_comment(uuid) to authenticated;

-- Mirrors set_post_reaction exactly, keyed on comment_id -- own-comment
-- reactions are blocked the same way, visibility is re-derived via
-- can_view_post through the comment's post_id rather than duplicated.
create or replace function public.set_comment_reaction(p_comment_id uuid, p_reaction text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_post_id uuid;
begin
  select user_id, post_id into v_owner, v_post_id from public.post_comments where id = p_comment_id;
  if v_owner is null then raise exception 'comment not found'; end if;
  if v_owner = auth.uid() then raise exception 'cannot react to your own comment'; end if;
  if not public.can_view_post(v_post_id) then raise exception 'comment not visible'; end if;

  if p_reaction is null then
    delete from public.comment_reactions where comment_id = p_comment_id and viewer_id = auth.uid();
  else
    if p_reaction not in ('like','support','fire','clap') then raise exception 'invalid reaction'; end if;
    insert into public.comment_reactions (comment_id, viewer_id, reaction, updated_at)
      values (p_comment_id, auth.uid(), p_reaction, now())
      on conflict (comment_id, viewer_id) do update set reaction = excluded.reaction, updated_at = now();
  end if;
end; $$;
revoke all on function public.set_comment_reaction(uuid, text) from public;
grant execute on function public.set_comment_reaction(uuid, text) to authenticated;

-- @mention someone to get their attention on a post or comment. Scoped
-- the same way share_post() was: the autocomplete only ever offers your
-- own accepted connections (never arbitrary users), and add_mention()
-- re-validates that server-side rather than trusting the client, same
-- "defense in depth" reasoning create_goal_assignment/share_post already
-- use. One shared table for both post-level and comment-level mentions
-- (comment_id null = a direct post mention) rather than two near-
-- identical tables.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.mentions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  mentioned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Set once the mentioned user acknowledges it on the Dashboard's
  -- notifications section -- same "Got it" pattern connections/
  -- assignments already use, not a delete.
  seen_at timestamptz
);
create index if not exists mentions_mentioned_user_idx on public.mentions (mentioned_user_id);

alter table public.mentions enable row level security;

drop policy if exists "mentions_select_party" on public.mentions;
create policy "mentions_select_party" on public.mentions
  for select using (mentioned_user_id = auth.uid() or mentioned_by = auth.uid());

-- No insert/update policy at all -- every write goes through the two
-- RPCs below (security definer), since add_mention needs to validate
-- against connections/can_view_post before writing, not just check
-- "is this my own row" the way a plain RLS check could.

create or replace function public.add_mention(p_post_id uuid, p_mentioned_user_id uuid, p_comment_id uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_mentioned_user_id = auth.uid() then
    raise exception 'Cannot mention yourself';
  end if;

  if not public.can_view_post(p_post_id) then
    raise exception 'Cannot mention someone on a post you cannot see';
  end if;

  if p_comment_id is not null and not exists (
    select 1 from public.post_comments where id = p_comment_id and post_id = p_post_id
  ) then
    raise exception 'comment not found on this post';
  end if;

  -- Defense in depth: the composer's autocomplete only ever offers
  -- accepted connections, but the RPC shouldn't trust that.
  if not exists (
    select 1 from public.connections c where c.status = 'accepted'
      and ((c.requester_id = auth.uid() and c.recipient_id = p_mentioned_user_id)
        or (c.recipient_id = auth.uid() and c.requester_id = p_mentioned_user_id))
  ) then
    raise exception 'You can only mention an accepted connection';
  end if;

  insert into public.mentions (post_id, comment_id, mentioned_user_id, mentioned_by)
  values (p_post_id, p_comment_id, p_mentioned_user_id, auth.uid());
end; $$;
revoke all on function public.add_mention(uuid, uuid, uuid) from public;
grant execute on function public.add_mention(uuid, uuid, uuid) to authenticated;

-- Every mention of the caller, newest first, with enough context (who,
-- what post/comment preview) to show a real notification row rather than
-- a bare "you were mentioned." security definer: needs the mentioning
-- user's display_name and the post/comment preview, which profiles'/
-- posts' own RLS wouldn't otherwise let the caller read directly for
-- posts they don't have standing access to review here.
create or replace function public.get_my_mentions()
returns table(
  mention_id uuid, post_id uuid, comment_id uuid,
  mentioned_by uuid, mentioned_by_display_name text,
  preview text, created_at timestamptz, seen_at timestamptz
)
language sql security definer set search_path = public stable
as $$
  select
    m.id, m.post_id, m.comment_id,
    m.mentioned_by, mp.display_name,
    coalesce(
      (select pc.body from public.post_comments pc where pc.id = m.comment_id),
      (select p.body from public.posts p where p.id = m.post_id),
      (select 'goal_glimpse ' || p.plan_date::text from public.posts p where p.id = m.post_id)
    ),
    m.created_at, m.seen_at
  from public.mentions m
  join public.profiles mp on mp.id = m.mentioned_by
  where m.mentioned_user_id = auth.uid()
  order by m.created_at desc;
$$;
revoke all on function public.get_my_mentions() from public;
grant execute on function public.get_my_mentions() to authenticated;

create or replace function public.mark_mention_seen(p_mention_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.mentions set seen_at = now()
  where id = p_mention_id and mentioned_user_id = auth.uid();
$$;
revoke all on function public.mark_mention_seen(uuid) from public;
grant execute on function public.mark_mention_seen(uuid) to authenticated;

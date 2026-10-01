-- Notify a post/comment owner when someone else comments, replies, or
-- reacts to it -- comments and reactions currently generate zero
-- notification unless the commenter explicitly types an @mention. This
-- is the "someone engaged with your stuff" counterpart to
-- post_comment_mentions.sql, same seen_at "Got it" acknowledgment
-- pattern, surfaced through the same Dashboard notification buckets and
-- header bell count.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.post_activity_notifications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null check (activity_type in ('comment', 'reply', 'post_reaction', 'comment_reaction')),
  reaction text check (reaction in ('like', 'support', 'fire', 'clap')),
  preview text,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists post_activity_notifications_recipient_idx on public.post_activity_notifications (recipient_id);

alter table public.post_activity_notifications enable row level security;

drop policy if exists "post_activity_notifications_select_own" on public.post_activity_notifications;
create policy "post_activity_notifications_select_own" on public.post_activity_notifications
  for select using (recipient_id = auth.uid());

-- No insert/update policy at all -- every row is written as a side effect
-- inside add_post_comment / set_post_reaction / set_comment_reaction
-- below (all security definer, table-owner-bypasses-RLS the same way
-- add_mention already writes mentions on the mentioned user's behalf).

create or replace function public.add_post_comment(p_post_id uuid, p_body text, p_parent_comment_id uuid default null)
returns public.post_comments
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.post_comments;
  v_trimmed text;
  v_parent_parent uuid;
  v_parent_post uuid;
  v_parent_owner uuid;
  v_post_owner uuid;
  v_recipient uuid;
  v_activity text;
begin
  v_trimmed := trim(p_body);
  if v_trimmed = '' or length(v_trimmed) > 500 then
    raise exception 'comment body must be 1-500 characters';
  end if;

  if not public.can_view_post(p_post_id) then
    raise exception 'post not visible';
  end if;

  if p_parent_comment_id is not null then
    select post_id, parent_comment_id, user_id into v_parent_post, v_parent_parent, v_parent_owner
      from public.post_comments where id = p_parent_comment_id;
    if v_parent_post is null then raise exception 'parent comment not found'; end if;
    if v_parent_post <> p_post_id then raise exception 'parent comment belongs to a different post'; end if;
    if v_parent_parent is not null then raise exception 'replies cannot themselves be replied to'; end if;
  end if;

  insert into public.post_comments (post_id, user_id, parent_comment_id, body)
  values (p_post_id, auth.uid(), p_parent_comment_id, v_trimmed)
  returning * into v_row;

  if p_parent_comment_id is not null then
    v_recipient := v_parent_owner;
    v_activity := 'reply';
  else
    select user_id into v_post_owner from public.posts where id = p_post_id;
    v_recipient := v_post_owner;
    v_activity := 'comment';
  end if;

  -- Commenting/replying on your own stuff is common and shouldn't notify
  -- yourself.
  if v_recipient is not null and v_recipient <> auth.uid() then
    insert into public.post_activity_notifications (post_id, comment_id, recipient_id, actor_id, activity_type, preview)
    values (p_post_id, v_row.id, v_recipient, auth.uid(), v_activity, v_trimmed);
  end if;

  return v_row;
end; $$;
revoke all on function public.add_post_comment(uuid, text, uuid) from public;
grant execute on function public.add_post_comment(uuid, text, uuid) to authenticated;

create or replace function public.set_post_reaction(p_post_id uuid, p_reaction text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_existed boolean;
begin
  select user_id into v_owner from public.posts where id = p_post_id;
  if v_owner is null then raise exception 'post not found'; end if;
  if v_owner = auth.uid() then raise exception 'cannot react to your own post'; end if;
  if not public.can_view_post(p_post_id) then raise exception 'post not visible'; end if;

  if p_reaction is null then
    delete from public.post_reactions where post_id = p_post_id and viewer_id = auth.uid();
  else
    if p_reaction not in ('like', 'support', 'fire', 'clap') then raise exception 'invalid reaction'; end if;
    v_existed := exists (select 1 from public.post_reactions where post_id = p_post_id and viewer_id = auth.uid());
    insert into public.post_reactions (post_id, viewer_id, reaction, updated_at)
      values (p_post_id, auth.uid(), p_reaction, now())
      on conflict (post_id, viewer_id) do update set reaction = excluded.reaction, updated_at = now();
    -- Only the first reaction notifies -- switching between like/fire/etc.
    -- on the same post would otherwise spam a fresh row every tap.
    if not v_existed then
      insert into public.post_activity_notifications (post_id, recipient_id, actor_id, activity_type, reaction)
      values (p_post_id, v_owner, auth.uid(), 'post_reaction', p_reaction);
    end if;
  end if;
end; $$;
revoke all on function public.set_post_reaction(uuid, text) from public;
grant execute on function public.set_post_reaction(uuid, text) to authenticated;

create or replace function public.set_comment_reaction(p_comment_id uuid, p_reaction text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_post_id uuid; v_existed boolean;
begin
  select user_id, post_id into v_owner, v_post_id from public.post_comments where id = p_comment_id;
  if v_owner is null then raise exception 'comment not found'; end if;
  if v_owner = auth.uid() then raise exception 'cannot react to your own comment'; end if;
  if not public.can_view_post(v_post_id) then raise exception 'comment not visible'; end if;

  if p_reaction is null then
    delete from public.comment_reactions where comment_id = p_comment_id and viewer_id = auth.uid();
  else
    if p_reaction not in ('like', 'support', 'fire', 'clap') then raise exception 'invalid reaction'; end if;
    v_existed := exists (select 1 from public.comment_reactions where comment_id = p_comment_id and viewer_id = auth.uid());
    insert into public.comment_reactions (comment_id, viewer_id, reaction, updated_at)
      values (p_comment_id, auth.uid(), p_reaction, now())
      on conflict (comment_id, viewer_id) do update set reaction = excluded.reaction, updated_at = now();
    if not v_existed then
      insert into public.post_activity_notifications (post_id, comment_id, recipient_id, actor_id, activity_type, reaction)
      values (v_post_id, p_comment_id, v_owner, auth.uid(), 'comment_reaction', p_reaction);
    end if;
  end if;
end; $$;
revoke all on function public.set_comment_reaction(uuid, text) from public;
grant execute on function public.set_comment_reaction(uuid, text) to authenticated;

-- Every comment/reply/reaction notification for the caller, newest first,
-- with enough context (who, what post/comment preview, which reaction)
-- to render a real notification row. security definer: needs the
-- actor's display_name, which profiles' own select-own RLS wouldn't
-- otherwise let the caller read directly.
create or replace function public.get_my_post_activity_notifications()
returns table(
  notification_id uuid, post_id uuid, comment_id uuid,
  actor_id uuid, actor_display_name text,
  activity_type text, reaction text, preview text,
  created_at timestamptz, seen_at timestamptz
)
language sql security definer set search_path = public stable
as $$
  select
    n.id, n.post_id, n.comment_id,
    n.actor_id, ap.display_name,
    n.activity_type, n.reaction, n.preview,
    n.created_at, n.seen_at
  from public.post_activity_notifications n
  join public.profiles ap on ap.id = n.actor_id
  where n.recipient_id = auth.uid()
  order by n.created_at desc;
$$;
revoke all on function public.get_my_post_activity_notifications() from public;
grant execute on function public.get_my_post_activity_notifications() to authenticated;

create or replace function public.mark_post_activity_notification_seen(p_notification_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.post_activity_notifications set seen_at = now()
  where id = p_notification_id and recipient_id = auth.uid();
$$;
revoke all on function public.mark_post_activity_notification_seen(uuid) from public;
grant execute on function public.mark_post_activity_notification_seen(uuid) to authenticated;

-- Video attachment on motivational posts -- same shape as post_images
-- (20260927000200_post_images.sql), a second optional media column
-- rather than a generalized "media" table, since a post still carries at
-- most one attachment (client enforces image XOR video, never both).
--
-- Bucket-level file_size_limit/allowed_mime_types are set this time (post-
-- images didn't bother) as a backstop behind the client's own checks --
-- video is the first upload type in this app where a validation bug or a
-- bypassed client could meaningfully inflate storage/bandwidth cost.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

alter table public.posts add column if not exists video_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-videos', 'post-videos', false, 31457280, array['video/mp4', 'video/webm'])
on conflict (id) do nothing;

create policy "post_videos_storage_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'post-videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "post_videos_storage_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'post-videos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Same visibility reasoning as post_images_storage_select_visible: read
-- access follows the post's own visibility (can_view_post), not just the
-- uploader.
create policy "post_videos_storage_select_visible"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-videos'
    and exists (
      select 1 from public.posts p
      where p.video_path = storage.objects.name
        and public.can_view_post(p.id)
    )
  );

-- get_feed's return row shape is changing (one new output column) --
-- same drop-then-recreate this function has needed every prior time.
drop function if exists public.get_feed(int, timestamptz);
create or replace function public.get_feed(p_limit int default 30, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, my_reaction text, goals jsonb,
  target_user_id uuid, target_display_name text, image_path text, video_path text,
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
    p.target_user_id, tpr.display_name, p.image_path, p.video_path,
    (select ps.shared_by from public.post_shares ps where ps.post_id = p.id and ps.shared_with = auth.uid() limit 1),
    (select spr.display_name from public.post_shares ps join public.profiles spr on spr.id = ps.shared_by
      where ps.post_id = p.id and ps.shared_with = auth.uid() limit 1),
    (select jsonb_object_agg(t.reaction, t.cnt) from (
      select prx.reaction, count(*) as cnt from public.post_reactions prx where prx.post_id = p.id group by prx.reaction
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

-- admin_get_feed needs to see videos too -- moderation exists specifically
-- to catch guideline violations, and a video is at least as likely a
-- vector for one as a photo.
drop function if exists public.admin_get_feed(int, timestamptz);
create or replace function public.admin_get_feed(p_limit int default 50, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, image_path text, video_path text, goals jsonb,
  target_user_id uuid, target_display_name text,
  reaction_count int, comment_count int
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
    (select count(*)::int from public.post_comments pc where pc.post_id = p.id)
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  left join public.profiles tpr on tpr.id = p.target_user_id
  where (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit p_limit;
end; $$;
revoke all on function public.admin_get_feed(int, timestamptz) from public;
grant execute on function public.admin_get_feed(int, timestamptz) to authenticated;

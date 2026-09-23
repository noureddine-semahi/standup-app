-- Photo attachment on motivational posts -- one optional image per post.
--
-- Neither existing storage precedent fits: avatars' public bucket would
-- leak a connections-only/individual post's image to anyone with the URL,
-- and goal-attachments' owner-only read would block other users from
-- seeing an image on a post that's actually been shared with them. Posts
-- already have a single source of truth for "can the current user see
-- this post" -- can_view_post(), added in
-- 20260926000200_individual_post_visibility.sql -- so this bucket's
-- SELECT policy calls that directly instead of re-deriving visibility a
-- fourth time. A storage.objects RLS policy invoking a security-definer
-- Postgres function via a subquery is no different in kind from any other
-- policy calling a function (see post_comments_select_if_post_visible for
-- the identical pattern applied to a regular table).
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

alter table public.posts add column if not exists image_path text;
-- Deliberately no CHECK tying this to type = 'motivational' -- only the
-- client composer ever sets it, and there's no second column it could
-- conflict with the way plan_id/achievement_id/body do (that CHECK exists
-- to prevent a genuine data-integrity conflict; image_path has none).

insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', false)
on conflict (id) do nothing;

-- Files are stored as "<user_id>/<random-id>.<ext>", same shape as
-- goal-attachments -- insert/delete stay folder-scoped to the uploader.
create policy "post_images_storage_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "post_images_storage_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Unlike insert/delete, read access is NOT owner-scoped -- other users who
-- can see the post need to see its image too. can_view_post() is the same
-- function posts_select_visible/get_feed/comments already call, so image
-- visibility can't drift from post visibility. Note: between a successful
-- upload and the posts row being inserted, no posts row references this
-- object's path yet, so this policy denies everyone (including the
-- uploader) during that gap -- harmless, since nothing reads the image
-- back before the post exists (upload returns the path directly).
create policy "post_images_storage_select_visible"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and exists (
      select 1 from public.posts p
      where p.image_path = storage.objects.name
        and public.can_view_post(p.id)
    )
  );

-- get_feed's return row shape is changing (one new output column) --
-- Postgres refuses to CREATE OR REPLACE a function across a return-type
-- change (the same lesson already hit once this session), so drop first.
drop function if exists public.get_feed(int, timestamptz);
create or replace function public.get_feed(p_limit int default 30, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, my_reaction text, goals jsonb,
  target_user_id uuid, target_display_name text, image_path text
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
    p.target_user_id, tpr.display_name, p.image_path
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

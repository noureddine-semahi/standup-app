-- Bugfix: get_feed()'s and get_post_comments()'s new reaction_counts
-- subqueries referenced "post_id"/"comment_id" unqualified, which
-- collides with the function's own RETURNS TABLE output column of the
-- same name (post_id, comment_id) -- Postgres can't tell whether you
-- mean the table column or the OUT parameter, hence "column reference
-- ... is ambiguous". Fix is qualifying every column in those subqueries
-- with a table alias. No signature change, so create or replace is
-- enough -- no drop needed.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

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
      select crx.reaction, count(*) as cnt from public.comment_reactions crx where crx.comment_id = c.id group by crx.reaction
    ) t)
  from public.post_comments c
  join public.profiles pr on pr.id = c.user_id
  where c.post_id = p_post_id
  order by c.created_at asc;
end; $$;
revoke all on function public.get_post_comments(uuid) from public;
grant execute on function public.get_post_comments(uuid) to authenticated;

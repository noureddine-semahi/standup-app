-- Admin moderation of Community: full visibility into every post and
-- comment regardless of normal visibility rules (connections/everyone/
-- individual), plus the ability to remove anything that violates the
-- rules -- so an admin can actually enforce them, not just watch.
--
-- Mirrors get_feed()/get_post_comments() closely, but every function here
-- checks is_admin() first (same "if not public.is_admin() then raise
-- exception 'admin access required'; end if;" pattern admin_list_members/
-- admin_set_points/admin_wipe_member_data already use) and deliberately
-- has NO can_view_post() filter -- that filter is the entire point of the
-- non-admin version; admin moderation exists specifically to see past it.
-- Deletions log to the existing admin_audit_log table, same as every
-- other admin action (set_points, set_role, wipe_data).
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create or replace function public.admin_get_feed(p_limit int default 50, p_before timestamptz default null)
returns table(
  post_id uuid, user_id uuid, display_name text, avatar_url text, type text, visibility text, created_at timestamptz,
  plan_date date, achievement_id text, body text, image_path text, goals jsonb,
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
    p.plan_date, p.achievement_id, p.body, p.image_path,
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

create or replace function public.admin_delete_post(p_post_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_type text; v_preview text;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  select user_id, type, coalesce(body, achievement_id, 'goal_glimpse ' || plan_date::text)
    into v_owner, v_type, v_preview
    from public.posts where id = p_post_id;
  if v_owner is null then
    raise exception 'post not found';
  end if;

  delete from public.posts where id = p_post_id;

  insert into public.admin_audit_log (admin_id, target_user_id, action, details)
  values (
    auth.uid(), v_owner, 'delete_post',
    jsonb_build_object('post_id', p_post_id, 'type', v_type, 'preview', left(v_preview, 200))
  );
end; $$;
revoke all on function public.admin_delete_post(uuid) from public;
grant execute on function public.admin_delete_post(uuid) to authenticated;

-- Admin equivalent of get_post_comments -- same shape, no can_view_post
-- gate, so an admin can review comments on a post they wouldn't normally
-- be able to see at all (e.g. an individual-visibility share).
create or replace function public.admin_get_post_comments(p_post_id uuid)
returns table(
  comment_id uuid, post_id uuid, user_id uuid, display_name text, avatar_url text,
  parent_comment_id uuid, body text, created_at timestamptz
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  return query
  select c.id, c.post_id, c.user_id, pr.display_name, pr.avatar_url, c.parent_comment_id, c.body, c.created_at
  from public.post_comments c
  join public.profiles pr on pr.id = c.user_id
  where c.post_id = p_post_id
  order by c.created_at asc;
end; $$;
revoke all on function public.admin_get_post_comments(uuid) from public;
grant execute on function public.admin_get_post_comments(uuid) to authenticated;

create or replace function public.admin_delete_comment(p_comment_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_post_id uuid; v_preview text;
begin
  if not public.is_admin() then
    raise exception 'admin access required';
  end if;

  select user_id, post_id, body into v_owner, v_post_id, v_preview
    from public.post_comments where id = p_comment_id;
  if v_owner is null then
    raise exception 'comment not found';
  end if;

  delete from public.post_comments where id = p_comment_id;

  insert into public.admin_audit_log (admin_id, target_user_id, action, details)
  values (
    auth.uid(), v_owner, 'delete_comment',
    jsonb_build_object('comment_id', p_comment_id, 'post_id', v_post_id, 'preview', left(v_preview, 200))
  );
end; $$;
revoke all on function public.admin_delete_comment(uuid) from public;
grant execute on function public.admin_delete_comment(uuid) to authenticated;

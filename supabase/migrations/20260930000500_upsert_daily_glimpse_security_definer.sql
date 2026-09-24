-- Sharing a day's goals (any audience -- connections/everyone/individual)
-- has been failing with "new row violates row-level security policy for
-- table posts" on every attempt, even a brand-new day with no prior post
-- and no actual ON CONFLICT collision. Root-caused via a live SQL repro:
-- this is the ONE write RPC in the whole app still declared SECURITY
-- INVOKER (every sibling -- create_goal_assignment, get_my_connections,
-- mark_connection_seen, etc. -- is already SECURITY DEFINER). Postgres's
-- RLS handling of INSERT ... ON CONFLICT DO UPDATE against an invoker-run
-- statement rejected the write even with zero conflicting rows present;
-- switching to SECURITY DEFINER (confirmed fixed via a live repro in the
-- SQL editor) bypasses that entirely, matching the pattern every other
-- write RPC here already relies on. Safe the same way those are: every
-- read/write inside is already keyed to auth.uid(), never a
-- caller-supplied id, so a caller still can't touch another user's row.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create or replace function public.upsert_daily_glimpse(
  p_plan_id uuid, p_plan_date date, p_visibility text, p_target_user_id uuid default null
)
returns public.posts
language plpgsql security definer set search_path = public
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
revoke all on function public.upsert_daily_glimpse(uuid, date, text, uuid) from public;
grant execute on function public.upsert_daily_glimpse(uuid, date, text, uuid) to authenticated;

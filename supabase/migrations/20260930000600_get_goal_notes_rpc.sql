-- "If you assign a goal you should be able to track progress and view
-- actions taken on the goal" -- today, the assigner's expanded "Actions &
-- notes" timeline only ever shows their OWN goal row's log ("Goal created"
-- and nothing else for an exclusive assignment, since they never touch
-- their own copy again once handed off) even though the recipient has a
-- full, real history of logged actions (status changes, reviews, etc.) on
-- their own separate goal row. goal_notes' own RLS (`user_id = auth.uid()`)
-- correctly blocks a plain client query from ever reading someone else's
-- notes, so this needs a security-definer RPC, same pattern as
-- get_my_connections/get_feed/etc.
--
-- Returns notes for a batch of goal ids, keyed under the id the CALLER
-- asked about (`request_goal_id`) rather than the note's real underlying
-- goal_id -- so when a requested id is the assigner's own goal, and that
-- goal has been assigned out, the recipient's notes on their own separate
-- copy come back tagged under the SAME requested id, letting the client's
-- existing "notes keyed by goal id" map absorb them with no restructuring.
-- `actor_display_name` is null for the caller's own notes, and the
-- recipient's display name for notes merged in from a handoff, so the
-- client can prefix accordingly.
--
-- Directional on purpose: the assigner can see the recipient's actions on
-- a goal they handed off (this is about VIEWING progress, unrelated to
-- the exclusive lock, which only ever governed editing). The reverse
-- (recipient seeing the assigner's own separate copy) isn't included --
-- not what was asked for, and the assigner's own copy of an exclusive
-- assignment never has any real activity on it anyway.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create or replace function public.get_goal_notes(p_goal_ids uuid[])
returns table(
  request_goal_id uuid,
  note text,
  created_at timestamptz,
  kind text,
  actor_display_name text
)
language plpgsql security definer set search_path = public stable
as $$
begin
  return query
  -- Caller's own notes on goals they actually own.
  select gn.goal_id, gn.note, gn.created_at, gn.kind, null::text
  from public.goal_notes gn
  join public.goals g on g.id = gn.goal_id
  where gn.goal_id = any(p_goal_ids)
    and gn.user_id = auth.uid()
    and g.user_id = auth.uid()

  union all

  -- Recipient's notes on a goal this caller assigned out, surfaced under
  -- the assigner's own goal_id so it merges into the same timeline.
  select ga.assigner_goal_id, gn.note, gn.created_at, gn.kind, rp.display_name
  from public.goal_assignments ga
  join public.goal_notes gn on gn.goal_id = ga.recipient_goal_id
  join public.profiles rp on rp.id = ga.recipient_id
  where ga.assigner_goal_id = any(p_goal_ids)
    and ga.assigner_id = auth.uid()
    and ga.recipient_goal_id is not null;
end;
$$;
revoke all on function public.get_goal_notes(uuid[]) from public;
grant execute on function public.get_goal_notes(uuid[]) to authenticated;

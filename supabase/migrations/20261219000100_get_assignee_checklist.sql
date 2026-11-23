-- CORE-03C: read-only visibility of an ASSIGNEE's checklist for the ASSIGNER.
--
-- goal_checklist_items (and goals) are owner-only under RLS, so an assigner cannot read the
-- checklist on the recipient's own copy of a handed-off Task. This adds ONE narrowly scoped
-- read-only function; no table, column, trigger or RLS policy changes, no writes of any kind.
--
-- Authorization (per assignment id, resolved from stored rows only -- never from client-supplied goal ids):
--   * goal_assignments.assigner_id = auth.uid()   (only the assigner; the recipient cannot read the reverse direction)
--   * goal_assignments.status = 'accepted'         (pending / declined / canceled return nothing)
--   * goal_assignments.recipient_goal_id is not null
--
-- The recipient's CURRENT goal is found by following the recipient's own materialized reschedule
-- edges (goal_reschedules.from_goal_id -> materialized_goal_id) from the stored recipient_goal_id,
-- so a rescheduled Task shows its live checklist, not the pre-reschedule copy. The walk is
-- recursive with a visited-set (cycle-proof) and a hard depth cap (cannot run unbounded).
--
-- Output, one row per checklist item: assignment_id, item_id, text, status, position.
-- An authorized assignment whose current goal exists but has NO items yields ONE row with null
-- item columns, so "empty checklist" can be told apart from "unavailable" (no rows at all).
--
-- SECURITY DEFINER with an empty search_path and fully schema-qualified references.
-- Execute is revoked from PUBLIC and anon and granted to authenticated only.
--
-- Run in Supabase Dashboard -> SQL Editor. Depends on goal_checklist_items.status (CORE-03A).
-- Run BEFORE deploying the matching app code. Safe to re-run.

create or replace function public.get_assignee_checklist(p_assignment_ids uuid[])
returns table (assignment_id uuid, item_id uuid, text text, status text, "position" integer)
language sql
security definer
set search_path = ''
stable
as $$
  with recursive authorized as (
    select ga.id as assignment_id, ga.recipient_id, ga.recipient_goal_id
      from public.goal_assignments ga
      join public.goals rg on rg.id = ga.recipient_goal_id and rg.user_id = ga.recipient_id -- the starting goal must be the recipient's own
     where ga.id = any (p_assignment_ids)
       and ga.assigner_id = auth.uid()
       and ga.status = 'accepted'
       and ga.recipient_goal_id is not null
  ),
  chain as (
    select a.assignment_id, a.recipient_id, a.recipient_goal_id as goal_id, 0 as depth,
           array[a.recipient_goal_id] as seen
      from authorized a
    union all
    select c.assignment_id, c.recipient_id, gr.materialized_goal_id, c.depth + 1,
           c.seen || gr.materialized_goal_id
      from chain c
      join public.goal_reschedules gr
        on gr.from_goal_id = c.goal_id
       and gr.user_id = c.recipient_id
       and gr.materialized
       and gr.materialized_goal_id is not null
     where c.depth < 50
       and not (gr.materialized_goal_id = any (c.seen))
  ),
  current_goal as (
    -- The end of the chain (deepest hop); id as a deterministic tie-break.
    select distinct on (ch.assignment_id) ch.assignment_id, ch.goal_id
      from chain ch
      join public.goals g on g.id = ch.goal_id and g.user_id = ch.recipient_id
     order by ch.assignment_id, ch.depth desc, ch.goal_id
  )
  select cg.assignment_id, i.id, i.text, i.status, i.position
    from current_goal cg
    join public.goals g on g.id = cg.goal_id
    left join public.goal_checklist_items i
      on i.goal_id = cg.goal_id and i.user_id = g.user_id
   order by cg.assignment_id, i.position, i.id;
$$;

revoke all on function public.get_assignee_checklist(uuid[]) from public;
revoke all on function public.get_assignee_checklist(uuid[]) from anon;
grant execute on function public.get_assignee_checklist(uuid[]) to authenticated;

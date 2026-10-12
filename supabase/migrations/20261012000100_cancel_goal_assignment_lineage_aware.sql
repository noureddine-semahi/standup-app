-- EXCLUSIVE ASSIGNMENTS -- LINEAGE SAFETY FIX (cancel-assignment hole).
--
-- Confirmed defect in cancel_goal_assignment (20260930001600_cancel_goal_
-- assignment.sql): it hard-deletes `goal_assignments.recipient_goal_id`
-- directly. That stored id is a write-once lineage ANCHOR (see
-- GoalAssignment.recipientGoalId's own comment in db.ts) -- if the
-- recipient has since rescheduled their materialized copy forward
-- (B -> B2, or further), the stored id is stale. Deleting just the stale
-- id leaves the real current continuation (B2) sitting there untouched
-- and now orphaned: nothing ever removes/cancels it, no reschedule edge
-- points at a live assignment anymore, and (per this same phase's
-- separate delete-guard audit) it remains correctly blocked from manual
-- hard-delete forever via isRescheduleTarget, with no other path back
-- to a resolved state.
--
-- Fix: before touching anything, walk FORWARD through goal_reschedules'
-- materialized edges from the stored recipient_goal_id to the CURRENT
-- continuation -- the same lineage resolution collapseGoalLineages/
-- walkMaterializedChain already perform client-side, mirrored here in
-- plpgsql since this RPC has no access to that TypeScript. Once the
-- current continuation is found, CANCEL it via a status update rather
-- than deleting it -- the exact same convention cancelOrphanedReschedules
-- (db.ts) already established for removing a conceptual Task ("a
-- continuation stays visible/inspectable... instead of silently
-- vanishing"), plus the same idempotency guard
-- filterUnresolvedDescendants already established: a continuation that
-- already reached its OWN independent terminal resolution (completed/
-- canceled) is left untouched rather than overwritten.
--
-- Every other field/behavior of cancel_goal_assignment (auth checks,
-- status/canceled_by/cancel_reason/responded_at/recipient_goal_id=null,
-- the seen-at mirrors) is preserved byte-for-byte from the prior
-- migration -- only the "what happens to the recipient's goal" step
-- changes, from an unconditional DELETE of a possibly-stale id to a
-- lineage-aware cancel of the real current one.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then:
--   NOTIFY pgrst, 'reload schema';

create or replace function public.cancel_goal_assignment(p_assignment_id uuid, p_reason text default null)
returns public.goal_assignments
language plpgsql security definer set search_path = public
as $$
declare
  v_assignment public.goal_assignments;
  v_current_id uuid;
  v_next_id uuid;
  v_current_status text;
  v_hops integer := 0;
begin
  select * into v_assignment from public.goal_assignments
    where id = p_assignment_id and auth.uid() in (assigner_id, recipient_id) and status in ('pending', 'accepted')
    for update;

  if v_assignment.id is null then
    raise exception 'Cancelable assignment % not found for this user', p_assignment_id;
  end if;

  if v_assignment.recipient_goal_id is not null then
    v_current_id := v_assignment.recipient_goal_id;

    -- Forward-walk to the current continuation. A hop cap guards against
    -- a malformed cycle (not reachable through the normal reschedule
    -- flow -- materialized_goal_id is always a freshly created row --
    -- same defensive-only reasoning the client-side resolver documents
    -- for its own cycle case) so this can never hang.
    loop
      v_hops := v_hops + 1;
      exit when v_hops > 1000;
      select materialized_goal_id into v_next_id
        from public.goal_reschedules
        where from_goal_id = v_current_id and materialized = true and materialized_goal_id is not null
        limit 1;
      exit when v_next_id is null;
      v_current_id := v_next_id;
    end loop;

    select status into v_current_status from public.goals where id = v_current_id;

    if v_current_status is not null and v_current_status not in ('completed', 'canceled') then
      update public.goals set status = 'canceled' where id = v_current_id;
    end if;
  end if;

  update public.goal_assignments
    set status = 'canceled',
        canceled_by = auth.uid(),
        cancel_reason = nullif(trim(p_reason), ''),
        responded_at = now(),
        recipient_goal_id = null,
        -- Whichever side triggered this already knows why -- only the
        -- OTHER party needs a notification.
        assigner_seen_at = case when auth.uid() = assigner_id then now() else assigner_seen_at end,
        recipient_seen_at = case when auth.uid() = recipient_id then now() else recipient_seen_at end
    where id = p_assignment_id
    returning * into v_assignment;

  return v_assignment;
end;
$$;
revoke all on function public.cancel_goal_assignment(uuid, text) from public;
grant execute on function public.cancel_goal_assignment(uuid, text) to authenticated;

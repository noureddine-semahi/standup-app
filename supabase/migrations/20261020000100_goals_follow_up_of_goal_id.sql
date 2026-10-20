-- Lets a resolved goal (Completed/Blocked/Canceled/Missed) spawn a
-- "follow-up" goal for tomorrow directly from Today's page, linked back
-- to the original for lineage. Same idiom already used for
-- outcome_goal_id/source_template_id -- a nullable, self-referencing FK,
-- ON DELETE SET NULL so deleting the original goal never cascades away
-- the follow-up; once created, the follow-up is a fully independent goal.
--
-- Existing rows are unaffected (column defaults to null); no backfill.
-- No reverse-lineage UI reads this yet -- v1 scope is creation only.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then
-- `NOTIFY pgrst, 'reload schema';`.

alter table public.goals
  add column if not exists follow_up_of_goal_id uuid references public.goals(id) on delete set null;

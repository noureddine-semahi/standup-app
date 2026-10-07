-- Goal Engine Phase 2: link existing Task rows (public.goals) to an
-- Outcome, optionally. Same idiom already used for source_template_id/
-- source_payment_account_id -- a nullable FK, ON DELETE SET NULL so
-- deleting (or abandoning) an Outcome never cascades away its Tasks;
-- once created, a Task is independent, same philosophy as
-- source_template_id's own comment.
--
-- Existing rows are unaffected (column defaults to null); no backfill,
-- no UI, no write path added yet -- that's a later phase.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then
-- `NOTIFY pgrst, 'reload schema';`.

alter table public.goals
  add column if not exists outcome_goal_id uuid references public.outcome_goals(id) on delete set null;

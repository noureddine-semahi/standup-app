-- Long-term goals (Phase 2 of the recurring/long-term goals roadmap):
-- reuses goal_backlog as-is rather than a new table. A row with
-- target_date set is a "Long-Term Goal" (shown in its own section on the
-- Backlog page); a row with target_date null is a plain backlog item,
-- same as before. promoteBacklogGoal()/deleteBacklogGoal() work
-- unchanged on both. This table's own migration isn't wired into
-- CI/deploy -- run manually via the Supabase SQL editor, then
-- `NOTIFY pgrst, 'reload schema';`.
--
-- No RLS changes needed: goal_backlog's four existing policies
-- (select/insert/update/delete, all auth.uid() = user_id) are row-level,
-- not column-scoped, so they cover these two new columns automatically.

alter table public.goal_backlog
  add column if not exists target_date date,
  add column if not exists category text;

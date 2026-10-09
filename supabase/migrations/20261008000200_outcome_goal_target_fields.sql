-- Goal Engine Phase 2D-2: Target Goal data foundation.
--
-- Additive only -- three nullable columns, no default, no backfill.
-- Every existing row (and every existing one_time/ongoing/recurring Goal
-- going forward) stays valid with all three null; nothing reads or
-- writes them unless a caller explicitly supplies a value. V1's update
-- model is manual (current_value is set directly by the user, never
-- derived from Tasks) -- see this phase's own read-only inspection for
-- why Task-driven increments and automatic completion-at-100% are
-- explicitly deferred, not implemented here.
--
-- Deliberately no CHECK/constraint coupling these columns to goal_type
-- ('target' vs anything else) -- goal_type is editable today (Edit Goal
-- dropdown), and a constraint requiring target_value/current_value only
-- when goal_type = 'target' would make switching a Goal's type into a
-- multi-step, order-dependent operation (clear the type before the
-- fields, or vice versa) for no real safety benefit. The UI layer
-- decides what to show/require per type; the schema stays permissive.
--
-- No start_value -- not requested for V1.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then
-- `NOTIFY pgrst, 'reload schema';`.

alter table public.outcome_goals
  add column if not exists target_value numeric,
  add column if not exists current_value numeric,
  add column if not exists target_unit text;

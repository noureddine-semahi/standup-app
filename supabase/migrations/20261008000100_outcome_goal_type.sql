-- Goal Engine Phase 2B-1: persistent Major Goal Types.
--
-- Additive only -- a new NOT NULL column with a constant DEFAULT backfills
-- every existing row with 'one_time' as part of the ALTER itself (no
-- separate UPDATE pass, no data touched/deleted), same "nullable-FK-added-
-- later" style of additive migration already used for outcome_goal_id,
-- just a text+check column instead of a FK. text+check (not a native
-- Postgres enum) matches this table's own `status` column and every
-- other enum-like column in this schema (goal_assignments.assignment_type,
-- daily_plans.status, goals.status) -- enums are harder to extend later,
-- this schema has deliberately never used one.
--
-- Recurring schedules (frequency/cycle) and Target values/units are later
-- phases, layered on without touching this column's shape -- this phase
-- is only the classification itself.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then
-- `NOTIFY pgrst, 'reload schema';`.

alter table public.outcome_goals
  add column if not exists goal_type text not null default 'one_time'
  check (goal_type in ('one_time', 'ongoing', 'recurring', 'target'));

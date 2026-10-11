-- Progress & Insights / Tools -> Goals Phase 1: "Hide from Quick Add"
-- preference for an Outcome Goal.
--
-- Additive only -- one boolean column, NOT NULL DEFAULT false, so every
-- existing Goal stays visible in Quick Add exactly as it is today with
-- no backfill needed. Deliberately not derived from/coupled to `status`
-- (still "active" | "completed" | "abandoned") -- this is purely a
-- display preference for the Quick Add candidate list, not a lifecycle
-- state: it must never affect Dashboard, Progress & Insights, recurring
-- cycle resolution, assignments, or Task history, all of which read
-- Goals independently of this column.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then
-- `NOTIFY pgrst, 'reload schema';`.

alter table public.outcome_goals
  add column if not exists hidden_from_quick_add boolean not null default false;

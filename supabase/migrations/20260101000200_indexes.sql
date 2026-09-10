-- Indexes supporting every observed query pattern in src/. See ../README.md.

-- Redundant with the implicit index backing daily_plans_user_id_plan_date_key,
-- kept anyway so this file documents the lookup pattern on its own.
create index if not exists idx_daily_plans_user_date
  on public.daily_plans (user_id, plan_date);

create index if not exists idx_goals_plan_id_sort_order
  on public.goals (plan_id, sort_order);

create index if not exists idx_goal_notes_goal_id
  on public.goal_notes (goal_id);

-- Supports materialize_reschedules()'s pending-reschedule lookup
-- (goal_reschedules where to_date = :date and materialized = false).
create index if not exists idx_goal_reschedules_to_date_materialized
  on public.goal_reschedules (to_date, materialized);

-- Supports the "origin" and "destination" reschedule-banner lookups in
-- today/page.tsx, tomorrow/page.tsx, and date/[date]/page.tsx.
create index if not exists idx_goal_reschedules_from_goal_id
  on public.goal_reschedules (from_goal_id);

create index if not exists idx_goal_reschedules_materialized_goal_id
  on public.goal_reschedules (materialized_goal_id);

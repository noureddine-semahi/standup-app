-- Goal Engine Phase 2D-5A: Recurring Goal cycle data foundation.
--
-- Additive only. Three nullable recurrence columns on outcome_goals (no
-- default, no backfill -- every existing Goal of every type stays valid
-- with all three null), a new outcome_goal_cycles table for explicit,
-- historically-frozen cycle records, and a nullable goals.outcome_goal_cycle_id
-- FK identifying which cycle a PHYSICAL Task row belongs to.
--
-- No Task/reschedule wiring yet -- outcome_goal_cycle_id exists after this
-- migration but nothing writes to it. That's Phase 2D-5B.
--
-- Cycle rows are created lazily (resolveOrCreateCycle, db.ts) and are
-- NEVER updated afterward: cycle_start/cycle_end/target_count_snapshot
-- are frozen at creation so a later change to the Goal's own recurrence
-- config (target count, frequency) never retroactively changes a past
-- cycle's history. See this phase's own read-only inspection for why.
--
-- Deliberately no CHECK coupling recurrence_frequency/_start_date/
-- _target_count to goal_type = 'recurring' -- same reasoning as Target's
-- own fields (20261008000200_outcome_goal_target_fields.sql): goal_type
-- is editable today, and the UI layer decides what to show/require per
-- type, not the schema.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query -- the trailing
-- NOTIFY below is part of this script, so no separate follow-up step
-- is needed.

alter table public.outcome_goals
  add column if not exists recurrence_frequency text
    check (recurrence_frequency in ('daily', 'weekly', 'monthly')),
  add column if not exists recurrence_start_date date,
  add column if not exists recurrence_target_count integer
    check (recurrence_target_count > 0);

create table if not exists public.outcome_goal_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  outcome_goal_id uuid not null references public.outcome_goals (id) on delete cascade,
  cycle_start date not null,
  cycle_end date not null,
  -- Frozen copy of outcome_goals.recurrence_target_count at the moment
  -- this cycle row was created -- never re-synced afterward. Null when
  -- the Goal had no target configured yet at that point.
  target_count_snapshot integer check (target_count_snapshot > 0),
  created_at timestamptz not null default now(),
  unique (outcome_goal_id, cycle_start),
  check (cycle_end >= cycle_start)
);

create index if not exists idx_outcome_goal_cycles_outcome_goal_id
  on public.outcome_goal_cycles (outcome_goal_id);

alter table public.outcome_goal_cycles enable row level security;

-- Owner-only, same direct-user_id-column shape as goal_reschedules/
-- outcome_goals -- no update/delete policy: cycle rows are insert-once,
-- append-only from the client (see header comment), matching
-- goal_reschedules' own "insert never update/delete" convention.
create policy "outcome_goal_cycles_select_own" on public.outcome_goal_cycles
  for select using (auth.uid() = user_id);

create policy "outcome_goal_cycles_insert_own" on public.outcome_goal_cycles
  for insert with check (auth.uid() = user_id);

alter table public.goals
  add column if not exists outcome_goal_cycle_id uuid
    references public.outcome_goal_cycles (id) on delete set null;

create index if not exists idx_goals_outcome_goal_cycle_id
  on public.goals (outcome_goal_cycle_id);

NOTIFY pgrst, 'reload schema';

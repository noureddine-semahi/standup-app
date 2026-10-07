-- Goal Engine Phase 1: a dedicated, persistent Goal/Outcome entity.
--
-- Deliberately NOT goal_backlog -- that table's entire lifecycle is
-- consume-and-destroy (promoteBacklogGoal() inserts a new `goals` row
-- then deletes the backlog row; Long-Term Goals reuse that exact same
-- path), the opposite of what an Outcome needs: survive and keep
-- accumulating linked Tasks (existing `goals` rows) over time. See this
-- session's architecture comparison for the full reasoning.
--
-- Phase 1 scope is intentionally just the standalone entity + its own
-- lifecycle -- no goals.outcome_goal_id, no Task linking, no progress/
-- milestones/proof/sharing. Those are later phases, layered on without
-- touching this table's shape (same "nullable FK added later, ON DELETE
-- SET NULL" idiom already used for source_template_id/assigner_goal_id/
-- recipient_goal_id elsewhere in this schema).
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then
-- `NOTIFY pgrst, 'reload schema';` -- same as every other post-2026-08
-- migration in this folder (not wired to CI/deploy, see ../README.md).

create table if not exists public.outcome_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  details text,
  priority integer not null default 3,
  -- Own lifecycle, independent of any (future) linked Task's status.
  -- 'completed'/'abandoned' are terminal but rows are never deleted on
  -- reaching them -- unlike goal_backlog, an Outcome's history matters.
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outcome_goals_user_status
  on public.outcome_goals (user_id, status);

alter table public.outcome_goals enable row level security;

-- Owner-only CRUD, same shape as goal_backlog/recurring_goal_templates.
create policy "outcome_goals_select_own" on public.outcome_goals
  for select using (auth.uid() = user_id);

create policy "outcome_goals_insert_own" on public.outcome_goals
  for insert with check (auth.uid() = user_id);

create policy "outcome_goals_update_own" on public.outcome_goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "outcome_goals_delete_own" on public.outcome_goals
  for delete using (auth.uid() = user_id);

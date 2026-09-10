-- Per-goal checklist items (sub-items like a grocery list under "Go to
-- HEB") — see ../README.md. Run this once in the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query). Not wired into any CI/deploy
-- pipeline.

create table if not exists public.goal_checklist_items (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  is_checked boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_goal_checklist_items_goal_id
  on public.goal_checklist_items (goal_id);

alter table public.goal_checklist_items enable row level security;

create policy "goal_checklist_items_select_own" on public.goal_checklist_items
  for select using (auth.uid() = user_id);

create policy "goal_checklist_items_insert_own" on public.goal_checklist_items
  for insert with check (auth.uid() = user_id);

create policy "goal_checklist_items_update_own" on public.goal_checklist_items
  for update using (auth.uid() = user_id);

create policy "goal_checklist_items_delete_own" on public.goal_checklist_items
  for delete using (auth.uid() = user_id);

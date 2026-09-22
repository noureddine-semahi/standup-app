-- Recurring goal templates (Phase 1 of the recurring/long-term goals
-- roadmap): a tap-to-add suggestion, never silent auto-creation. Owner-only
-- table, same RLS pattern as goal_backlog -- no cross-user visibility here.

create table public.recurring_goal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  details text,
  priority int,
  time_of_day text,
  -- 0=Sunday..6=Saturday, matching JS Date.getDay().
  days_of_week int[] not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index recurring_goal_templates_user_idx on public.recurring_goal_templates (user_id, active);

alter table public.recurring_goal_templates enable row level security;
create policy "recurring_goal_templates_select_own" on public.recurring_goal_templates
  for select using (user_id = auth.uid());
create policy "recurring_goal_templates_insert_own" on public.recurring_goal_templates
  for insert with check (user_id = auth.uid());
create policy "recurring_goal_templates_update_own" on public.recurring_goal_templates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "recurring_goal_templates_delete_own" on public.recurring_goal_templates
  for delete using (user_id = auth.uid());

-- Clean "already added today" dedupe check, rather than fuzzy-matching by
-- title. ON DELETE SET NULL: retiring/deleting a template must not cascade
-- away goals that were already created from it -- once created, a goal is
-- independent.
alter table public.goals
  add column if not exists source_template_id uuid references public.recurring_goal_templates(id) on delete set null;

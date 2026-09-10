-- Undated goal backlog — a holding pen for goals you know you want to do but
-- haven't scheduled to a specific day yet. See ../README.md: like the other
-- recent migrations here, this is NOT wired into any CI/deploy pipeline —
-- run it once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query), then `NOTIFY pgrst, 'reload schema';` so PostgREST picks it up.

create table if not exists public.goal_backlog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  details text,
  priority integer not null default 3,
  created_at timestamptz not null default now()
);

create index if not exists idx_goal_backlog_user_id
  on public.goal_backlog (user_id);

alter table public.goal_backlog enable row level security;

create policy "goal_backlog_select_own" on public.goal_backlog
  for select using (auth.uid() = user_id);
create policy "goal_backlog_insert_own" on public.goal_backlog
  for insert with check (auth.uid() = user_id);
create policy "goal_backlog_update_own" on public.goal_backlog
  for update using (auth.uid() = user_id);
create policy "goal_backlog_delete_own" on public.goal_backlog
  for delete using (auth.uid() = user_id);

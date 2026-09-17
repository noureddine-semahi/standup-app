-- Two more optional fields on goals, both display-only (no reminders):
-- an "All day" flag that overrides showing a specific time, and a single
-- attached link URL. See ../README.md: not wired into any CI/deploy
-- pipeline — run this once in the Supabase SQL editor (Dashboard -> SQL
-- Editor -> New query), then `NOTIFY pgrst, 'reload schema';` so
-- PostgREST picks up the new columns (a stale schema cache is exactly
-- what produces "Could not find the 'is_all_day' column of 'goals' in
-- the schema cache").

alter table public.goals
  add column if not exists is_all_day boolean not null default false;

alter table public.goals
  add column if not exists link_url text;

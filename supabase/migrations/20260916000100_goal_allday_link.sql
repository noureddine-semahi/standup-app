-- Two more optional fields on goals, both display-only (no reminders):
-- an "All day" flag that overrides showing a specific time, and a single
-- attached link URL. Run this once in the Supabase SQL editor. Not wired
-- into any CI/deploy pipeline.

alter table public.goals
  add column if not exists is_all_day boolean not null default false;

alter table public.goals
  add column if not exists link_url text;

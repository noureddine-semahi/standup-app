-- Free-tier usage cap for the Dashboard AI assistant — see ../README.md.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query). Not wired into any CI/deploy pipeline.
--
-- No new RLS policy needed: profiles_update_own already lets a user update
-- their own row, which covers incrementing/resetting these two columns.

alter table public.profiles
  add column if not exists assistant_uses_this_period integer not null default 0;

alter table public.profiles
  add column if not exists assistant_period_reset_at timestamptz not null default now();

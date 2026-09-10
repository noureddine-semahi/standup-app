-- Optional time-of-day for a goal (e.g. "7:30 AM dentist"), display-only —
-- no reminders/notifications attached to it. See ../README.md: not wired
-- into any CI/deploy pipeline, run this once in the Supabase SQL editor,
-- then `NOTIFY pgrst, 'reload schema';`.

alter table public.goals
  add column if not exists time_of_day time;

-- Records WHICH exact saved plan was most recently explicitly submitted.
--
-- daily_plans only ever stored status = 'submitted' + submitted_at, while
-- the goals stay live/mutable rows, so nothing could tell the last
-- submitted plan apart from edits, additions or deletions made afterwards.
-- submitted_hash holds the app's canonical plan serialization
-- (computeHashForSave on the Tomorrow page: id, sort_order, title,
-- priority, time_of_day, is_all_day, link_url, outcome_goal_id per
-- commitment) as it stood at the instant a submit succeeded. The client
-- compares it with the plan it just loaded, so "submitted plan changed"
-- survives reloads, logins and devices.
--
-- Written only by submitPlan(), in the same UPDATE that sets status/
-- submitted_at, so it is never recorded for a submission that failed.
--
-- Existing rows are unaffected (column defaults to null); NO backfill.
-- A null hash on an already-submitted plan means "submitted before this
-- tracking existed" -- the client never treats it as matching the current
-- goals, so the user re-establishes it once via Save -> Submit.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then
-- `NOTIFY pgrst, 'reload schema';`.

alter table public.daily_plans
  add column if not exists submitted_hash text;

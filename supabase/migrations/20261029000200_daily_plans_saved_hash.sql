-- Records WHICH exact plan state the user EXPLICITLY saved (pressed Save plan).
--
-- Companion to daily_plans.submitted_hash (20261029000100). Tomorrow's
-- acceptance flow is CREATE/EDIT -> explicit SAVE -> explicit SUBMIT, and
-- both checkpoints must survive navigation, reloads and other devices, so
-- both live in the database. saved_hash holds the same canonical plan
-- serialization (computeHashForSave on the Tomorrow page). The client
-- treats the plan as "saved" only while its current persisted state equals
-- this value; any later add/edit/remove/reorder changes the hash and
-- requires pressing Save plan again. Autosave never writes it.
--
-- Independent of submitted_hash: a plan can be saved but not yet submitted
-- (or saved at a newer state than the last submission).
--
-- Existing rows are unaffected (column defaults to null); NO backfill. A
-- null saved_hash means "never explicitly saved", so existing plans simply
-- show Save plan once until the user presses it.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query, then
-- `NOTIFY pgrst, 'reload schema';`.

alter table public.daily_plans
  add column if not exists saved_hash text;

notify pgrst, 'reload schema';

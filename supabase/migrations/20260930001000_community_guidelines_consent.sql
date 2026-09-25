-- Hard-gate acknowledgment before Community is usable, same pattern as
-- privacy_accepted_at (20260928000100_privacy_consent.sql) -- a single
-- nullable timestamp, no backfill for existing users (they'll see the
-- gate the first time they open Community after this ships, which is
-- correct: "the first time someone clicks in to get in this space").
-- Set via a plain client-side update to the caller's own profile row
-- (profiles_update_own already covers it), not a dedicated RPC --
-- there's no cross-user logic here, unlike the admin_* functions above.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

alter table public.profiles add column if not exists community_guidelines_accepted_at timestamptz;

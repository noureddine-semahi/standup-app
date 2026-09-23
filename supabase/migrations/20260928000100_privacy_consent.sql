-- Privacy Policy consent at signup (Social batch-2 roadmap, item 5).
-- Nullable: existing users have no value here, and this consent gate
-- applies only to new signups, not a retroactive backfill.
alter table public.profiles add column if not exists privacy_accepted_at timestamptz;

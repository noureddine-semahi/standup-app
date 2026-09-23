-- Privacy/discoverability toggle: lets a user opt out of being found by
-- another user's email-based connection request (sendConnectionRequest ->
-- find_user_by_email). Default true is load-bearing: find_user_by_email
-- today has no discoverability gate at all, so defaulting to false would
-- silently make every existing user unfindable until they opted back in.
-- This only gates *future* email lookups; it never touches the
-- connections table, so already-established/pending connections are
-- entirely unaffected.
alter table public.profiles
  add column if not exists discoverable boolean not null default true;

-- Same signature as the original (20260918000100_glimpse_sharing.sql).
-- "No such email" and "email exists but not discoverable" both fall out
-- of this single statement's predicate list as zero rows -- not a
-- separate existence check -- so a hidden account is indistinguishable
-- from a non-existent one to whoever is searching.
create or replace function public.find_user_by_email(p_email text)
returns table(id uuid, display_name text)
language sql security definer set search_path = public stable
as $$
  select p.id, p.display_name
  from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
    and u.id <> auth.uid()
    and p.discoverable = true
  limit 1;
$$;

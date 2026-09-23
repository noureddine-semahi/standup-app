-- Connections discovery: browse discoverable users instead of manual
-- email search. Mirrors two already-proven patterns: find_user_by_email's
-- "security definer join against auth.users + profiles, respecting
-- discoverable" for the gate, and get_feed's "security definer, paginated
-- via a timestamp cursor, joins profiles despite its select-own RLS" for
-- the list shape.
--
-- Exclusion logic (the actual design work, not the schema):
-- - excludes self and anyone with discoverable = false
-- - excludes anyone with an ACCEPTED connection either direction (they
--   belong in "Your Connections")
-- - excludes anyone with a PENDING INCOMING connection (they already have
--   their own actionable "Incoming Requests" section)
-- - INCLUDES anyone with a PENDING OUTGOING connection, flagged via
--   invited=true so the UI shows "Invitation sent" instead of "Invite"
-- - a declined connection blocks nothing -- it falls through every check
--   here exactly like it falls through the unique index's own
--   `where status <> 'declined'`, so a previously-declined pair is fully
--   re-inviteable.
--
-- Cursor is (created_at, id) rather than created_at alone -- a
-- plain-timestamp cursor can silently skip a user forever if two
-- profiles share the exact same created_at and the page boundary falls
-- between them (strict `<` on the boundary excludes the tied sibling
-- too). Caught in review before shipping.

create or replace function public.get_discoverable_users(
  p_limit int default 30,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table(id uuid, display_name text, avatar_url text, invited boolean, created_at timestamptz)
language sql security definer set search_path = public stable
as $$
  select p.id, p.display_name, p.avatar_url,
    exists (
      select 1 from public.connections c
      where c.requester_id = auth.uid() and c.recipient_id = p.id and c.status = 'pending'
    ) as invited,
    u.created_at
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.discoverable = true
    and u.id <> auth.uid()
    and (p_before is null or (u.created_at, u.id) < (p_before, p_before_id))
    and not exists (
      select 1 from public.connections c
      where ((c.requester_id = auth.uid() and c.recipient_id = p.id)
          or (c.recipient_id = auth.uid() and c.requester_id = p.id))
        and (c.status = 'accepted' or (c.status = 'pending' and c.recipient_id = auth.uid()))
    )
  order by u.created_at desc, u.id desc
  limit p_limit;
$$;
revoke all on function public.get_discoverable_users(int, timestamptz, uuid) from public;
grant execute on function public.get_discoverable_users(int, timestamptz, uuid) to authenticated;

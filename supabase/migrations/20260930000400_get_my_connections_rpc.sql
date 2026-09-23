-- listConnections() has always tried to read the OTHER party's
-- profiles.display_name/avatar_url via a plain client query -- but the
-- only SELECT policy on profiles is `auth.uid() = id` (read your own row
-- only), so that query has always silently returned zero rows for
-- anyone but the caller. otherDisplayName has been null for the other
-- party in every connection, for every user, since this feature
-- shipped -- masked first by a since-removed email-derived fallback,
-- then by a generic "A StandUp user" placeholder, neither of which
-- fixed the actual read. This RPC does the join server-side as
-- security definer, matching the pattern get_feed/get_my_goal_assignments/
-- get_discoverable_users already use for exactly this situation.

create or replace function public.get_my_connections()
returns table(
  id uuid,
  requester_id uuid,
  recipient_id uuid,
  status text,
  created_at timestamptz,
  responded_at timestamptz,
  requester_email text,
  recipient_email text,
  requester_seen_at timestamptz,
  other_display_name text,
  other_avatar_url text
)
language sql security definer set search_path = public stable
as $$
  select
    c.id, c.requester_id, c.recipient_id, c.status, c.created_at, c.responded_at,
    c.requester_email, c.recipient_email, c.requester_seen_at,
    op.display_name,
    op.avatar_url
  from public.connections c
  join public.profiles op
    on op.id = (case when c.requester_id = auth.uid() then c.recipient_id else c.requester_id end)
  where auth.uid() in (c.requester_id, c.recipient_id)
  order by c.created_at desc;
$$;
revoke all on function public.get_my_connections() from public;
grant execute on function public.get_my_connections() to authenticated;

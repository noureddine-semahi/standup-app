-- Display-name fallback for connections: display_name is optional at
-- signup, so a connection row also captures both parties' email at the
-- time the request is made -- the requester's own email (known from their
-- session) and the recipient's email (the exact text they were found by).
-- Lets the UI fall back to an email's local part instead of a raw user id
-- when display_name is null, matching the fallback pattern used everywhere
-- else in the app (see Header.tsx).
alter table public.connections add column if not exists requester_email text;
alter table public.connections add column if not exists recipient_email text;

-- Optional personal-info fields on profiles, plus avatar photo storage.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Not wired into any CI/deploy pipeline — see ../README.md.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists date_of_birth date,
  add column if not exists address text,
  add column if not exists phone_number text,
  add column if not exists avatar_url text;

-- Public bucket so uploaded avatars can be shown via a plain <img src>
-- without generating signed URLs client-side. Objects are still writable
-- only by their owner (policies below) — "public" only affects read access.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Files are stored as "<user_id>/<filename>" — these policies key off that
-- first path segment matching the requesting user's own id.
create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_read_public"
  on storage.objects for select
  using (bucket_id = 'avatars');

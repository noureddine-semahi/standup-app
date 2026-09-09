-- Per-goal file attachments (receipts, documents, etc.) — see ../README.md.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Not wired into any CI/deploy pipeline.

create table if not exists public.goal_attachments (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_goal_attachments_goal_id
  on public.goal_attachments (goal_id);

alter table public.goal_attachments enable row level security;

create policy "goal_attachments_select_own" on public.goal_attachments
  for select using (auth.uid() = user_id);
create policy "goal_attachments_insert_own" on public.goal_attachments
  for insert with check (auth.uid() = user_id);
create policy "goal_attachments_delete_own" on public.goal_attachments
  for delete using (auth.uid() = user_id);

-- Private bucket (unlike avatars) — files are receipts/documents, read via
-- short-lived signed URLs generated client-side (getAttachmentUrl in db.ts),
-- never a plain public <img src>.
insert into storage.buckets (id, name, public)
values ('goal-attachments', 'goal-attachments', false)
on conflict (id) do nothing;

-- Files are stored as "<user_id>/<random-id>.<ext>" — these policies key off
-- that first path segment matching the requesting user's own id. The goal_id
-- is intentionally NOT part of the path: a rescheduled goal gets a new id
-- (see materializeReschedules), and reusing the same storage object across
-- the old and new goal_attachments rows avoids re-uploading/duplicating the
-- file on every reschedule.
create policy "goal_attachments_storage_select_own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'goal-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "goal_attachments_storage_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'goal-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "goal_attachments_storage_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'goal-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

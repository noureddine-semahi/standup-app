-- Tools > Notes (milestone 1): plain-text notes with a title, a body and a pin.
--
-- ADDITIVE ONLY. Creates one new table, one trigger function and one trigger. It does not touch any existing table.
-- Safe to re-run.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI -- Tools > Notes shows an
-- "unavailable" state until this has been run.
--
-- MODEL
--   notes   one row per note, owned by one user. Plain text only (no rich text, folders, attachments or links).
--           revision    optimistic-concurrency counter. Bumped by the database ONLY when title, body or pinned really
--                       changes; a client cannot set it. The app saves with "... where id = <id> and revision = <the one
--                       it loaded>" and treats zero updated rows as "someone else saved first", so a stale tab or device
--                       can never silently overwrite newer text.
--           updated_at  the "last edited" time shown on the cards. Moved by the database only when title or body changes,
--                       so pinning or unpinning a note does not make it look edited.
--
-- ACCESS: owner-only row level security for SELECT, INSERT, UPDATE and DELETE (auth.uid() = user_id). A user cannot read,
-- change, move or delete another user's note, and cannot reassign a note's owner.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 20000),
  pinned boolean not null default false,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_notes_user_order on public.notes (user_id, pinned desc, updated_at desc);

alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
drop policy if exists "notes_insert_own" on public.notes;
drop policy if exists "notes_update_own" on public.notes;
drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_select_own" on public.notes for select using (auth.uid() = user_id);
create policy "notes_insert_own" on public.notes for insert with check (auth.uid() = user_id);
create policy "notes_update_own" on public.notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes_delete_own" on public.notes for delete using (auth.uid() = user_id);

-- The database, not the client, owns revision and updated_at. A new row always starts at revision 0; an update that
-- changes nothing the user can see leaves both untouched; an update that changes the text or the pin bumps the revision,
-- and a text change also moves updated_at. Whatever a client sends for these two columns is ignored.
create or replace function public.touch_note()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 0;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  if new.title is distinct from old.title or new.body is distinct from old.body then
    new.revision := old.revision + 1;
    new.updated_at := now();
  elsif new.pinned is distinct from old.pinned then
    new.revision := old.revision + 1;
    new.updated_at := old.updated_at;
  else
    new.revision := old.revision;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_note on public.notes;
create trigger trg_touch_note
  before insert or update on public.notes
  for each row execute function public.touch_note();

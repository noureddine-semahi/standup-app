-- Standing lists (grocery lists, packing lists, anything recurring) --
-- separate from goals entirely, so you can add to "HEB" or "Costco"
-- throughout the week without it being tied to any day. When you're ready
-- to shop, either push a list to become a new goal (title = list name,
-- items copied into that goal's checklist) or attach it to an existing
-- goal's checklist. Either way COPIES the items -- the list itself is
-- left untouched, ready to fill again next week, matching the explicit
-- "copy, not consume" decision (a store list is naturally recurring;
-- clearing it every time would mean rebuilding "milk, eggs, bread" from
-- scratch weekly).
--
-- No RPCs needed -- push/attach are plain multi-step client-side inserts,
-- same idiom addGoalFromTemplate already uses for "append one new goal to
-- a plan", since everything here is the same user acting on their own
-- rows under plain owner-only RLS.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_lists_user_id on public.lists (user_id);

alter table public.lists enable row level security;

create policy "lists_select_own" on public.lists for select using (auth.uid() = user_id);
create policy "lists_insert_own" on public.lists for insert with check (auth.uid() = user_id);
create policy "lists_delete_own" on public.lists for delete using (auth.uid() = user_id);

create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_list_items_list_id on public.list_items (list_id);

alter table public.list_items enable row level security;

create policy "list_items_select_own" on public.list_items for select using (auth.uid() = user_id);
create policy "list_items_insert_own" on public.list_items for insert with check (auth.uid() = user_id);
create policy "list_items_delete_own" on public.list_items for delete using (auth.uid() = user_id);

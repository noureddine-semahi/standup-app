-- CORE-03A: three-state checklist items (pending / completed / missing).
--
-- Adds goal_checklist_items.status and keeps it synchronized with the legacy
-- is_checked boolean IN THE DATABASE, so older clients that still write only
-- is_checked (and server paths such as respond_to_goal_assignment, which insert
-- is_checked = false) keep working unchanged.
--
-- Invariant after every write:  is_checked = (status = 'completed').
--   * 'missing' and 'pending' both have is_checked = false.
--
-- Rule on UPDATE: if status changed, status wins (is_checked is derived). Otherwise, if only is_checked
-- changed, it is a legacy boolean write and is translated (true -> completed, false -> pending).
-- Writing a status identical to the current one together with a flipped is_checked counts as the
-- latter; the app always writes a consistent pair, so it never does that.
--
-- The sync is a single BEFORE INSERT OR UPDATE row trigger that only edits NEW.
-- It issues no statements of its own, so it cannot fire itself or recurse.
--
-- Safe to re-run. Wrapped in one transaction: all or nothing.
-- Run in Supabase Dashboard -> SQL Editor BEFORE deploying the matching app code.

begin;

-- 1. Column. Existing rows get 'pending' for the moment (constant default, no table rewrite problems).
alter table public.goal_checklist_items
  add column if not exists status text not null default 'pending';

-- 2. Backfill from the existing boolean (before the sync trigger exists, so this is a plain data fix).
update public.goal_checklist_items
   set status = case when is_checked then 'completed' else 'pending' end
 where status is distinct from (case when is_checked then 'completed' else 'pending' end)
   and status <> 'missing';

-- 3. Allowed values.
alter table public.goal_checklist_items
  drop constraint if exists goal_checklist_items_status_check;
alter table public.goal_checklist_items
  add constraint goal_checklist_items_status_check
  check (status in ('pending', 'completed', 'missing'));

-- 4. Synchronization.
create or replace function public.goal_checklist_items_sync_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Legacy insert with is_checked = true and no explicit status (status defaults to 'pending').
    if new.status = 'pending' and new.is_checked then
      new.status := 'completed';
    end if;
  else
    if new.status is distinct from old.status then
      -- Status was written (new clients, or both columns at once): status wins.
      null;
    elsif new.is_checked is distinct from old.is_checked then
      -- Legacy boolean-only write: translate it.
      new.status := case when new.is_checked then 'completed' else 'pending' end;
    end if;
  end if;

  new.is_checked := (new.status = 'completed');
  return new;
end;
$$;

drop trigger if exists goal_checklist_items_sync_status on public.goal_checklist_items;
create trigger goal_checklist_items_sync_status
  before insert or update on public.goal_checklist_items
  for each row execute function public.goal_checklist_items_sync_status();

commit;

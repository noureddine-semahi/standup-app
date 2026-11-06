-- Phase 4.3A: the Free-plan limit of 10 saved notes, enforced in the database.
--
-- ADDITIVE ONLY. One trigger function and one trigger on public.notes. It changes no table, column or policy, and it never
-- touches existing notes: it only decides whether a NEW note may be inserted. Safe to re-run.
--
-- Requires the earlier migrations 20261109000100_notes.sql and 20261110000100_account_entitlements.sql.
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- RULE
--   A user whose EFFECTIVE tier is free (no entitlement row, a free row, or an expired trial) may hold at most 10 notes. The
--   insert of an 11th is refused with error NOTE_LIMIT_REACHED (SQLSTATE 53400). premium and an active premium_trial are
--   unlimited. The effective tier comes from public.effective_account_tier, the same rule get_my_account_entitlement() uses.
--   The limit mirrors FREE_LIMITS.notes in src/lib/entitlements.ts; a test keeps the two equal.
--
-- WHY A TRIGGER, NOT THE UI: the check runs inside the insert itself, so no client, script or stale tab can get around it.
--
-- CONCURRENT REQUESTS: the trigger takes a per-user advisory lock before it counts and holds it until the inserting
-- transaction ends. Two creations racing for the last free slot are therefore serialized: the second one counts after the
-- first has committed and is refused. Different users never block each other.
--
-- WHOSE NOTES ARE COUNTED: only the inserting user's (where user_id = new.user_id). An insert that claims someone else's
-- user_id is passed straight through so the existing insert policy rejects it; the trigger never counts, reveals or reacts to
-- another user's notes.
--
-- EXISTING DATA: a user who already has more than 10 notes keeps all of them; editing, pinning and deleting are untouched
-- (this fires on INSERT only). They simply cannot add more until they are under the limit or on Premium.

create or replace function public.enforce_note_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tier text;
  v_ends timestamptz;
  v_count integer;
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    return new;
  end if;

  select e.tier, e.trial_ends_at into v_tier, v_ends
    from public.account_entitlements e
   where e.user_id = new.user_id;
  if public.effective_account_tier(coalesce(v_tier, 'free'), v_ends) <> 'free' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('notes_free_limit:' || new.user_id::text, 0));

  select count(*) into v_count from public.notes where user_id = new.user_id;
  if v_count >= 10 then
    raise exception 'NOTE_LIMIT_REACHED'
      using errcode = '53400',
            detail = 'Free accounts can save up to 10 notes.',
            hint = 'Upgrade to Premium for unlimited notes.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_note_limit on public.notes;
create trigger trg_enforce_note_limit
  before insert on public.notes
  for each row execute function public.enforce_note_limit();

-- Phase 4.3B: the Free-plan limit of 3 ACTIVE routines, enforced in the database.
--
-- ADDITIVE ONLY. One trigger function and one trigger on public.recurring_goal_templates (the table behind Tools > Routines).
-- It changes no table, column or policy, and it never deletes, deactivates or edits a routine. Safe to re-run.
--
-- Requires 20261110000100_account_entitlements.sql (for the effective-tier rule).
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- MODEL: a routine is a recurring_goal_templates row; it is ACTIVE while active = true and RETIRED (inactive) while
-- active = false. Retiring keeps the row, its schedule and every goal that came from it. Only active routines count.
--
-- RULE
--   A user whose EFFECTIVE tier is free (no entitlement row, a free row, or an expired trial) may have at most 3 active
--   routines. Anything that would ADD an active routine is refused with ROUTINE_LIMIT_REACHED (SQLSTATE 53400) once they
--   already have 3 or more:
--     - creating a routine (it starts active), and
--     - reactivating a retired routine (active false -> true).
--   premium and an active premium_trial are unlimited. The limit mirrors FREE_LIMITS.routines in src/lib/entitlements.ts; a
--   test keeps the two equal.
--
-- DOWNGRADE: nothing is ever deleted or deactivated. A user who falls back to Free with, say, 5 active routines keeps all 5 and
-- their schedules and history. They can retire, edit and delete as before; only actions that would increase the active count
-- (create, reactivate) are blocked while it is at or above 3. Retiring down to 2 lets them add or reactivate again.
--
-- NOT CHECKED: any other update (rename, change days, retire, delete). Edits to an already-active routine, and retiring one, do not
-- increase the active count, so this trigger lets them through untouched.
--
-- CONCURRENT REQUESTS: a per-user advisory lock is taken before counting and held until the transaction ends, so two requests
-- racing for the last free slot (two creations, or a creation and a reactivation) are serialized; the later one counts after the
-- earlier has committed and is refused. Different users never block each other.
--
-- WHOSE ROUTINES ARE COUNTED: only the acting user's (where user_id = new.user_id). A row claiming someone else's user_id is
-- passed through so the existing policies reject it; the trigger never counts or reveals another user's routines.

create or replace function public.enforce_routine_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tier text;
  v_ends timestamptz;
  v_count integer;
begin
  -- Only actions that make a routine active matter: a new active row, or an inactive row turned active.
  if new.active is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active is true then
    return new;
  end if;

  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    return new;
  end if;

  select e.tier, e.trial_ends_at into v_tier, v_ends
    from public.account_entitlements e
   where e.user_id = new.user_id;
  if public.effective_account_tier(coalesce(v_tier, 'free'), v_ends) <> 'free' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('routines_free_limit:' || new.user_id::text, 0));

  select count(*) into v_count from public.recurring_goal_templates where user_id = new.user_id and active is true;
  if v_count >= 3 then
    raise exception 'ROUTINE_LIMIT_REACHED'
      using errcode = '53400',
            detail = 'Free accounts can have up to 3 active routines.',
            hint = 'Retire a routine or upgrade to Premium for unlimited routines.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_routine_limit on public.recurring_goal_templates;
create trigger trg_enforce_routine_limit
  before insert or update of active on public.recurring_goal_templates
  for each row execute function public.enforce_routine_limit();

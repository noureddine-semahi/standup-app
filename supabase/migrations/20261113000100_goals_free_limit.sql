-- Phase 4.3C: the Free-plan limit of 3 ACTIVE structured Goals, enforced in the database.
--
-- ADDITIVE ONLY. One trigger function and one trigger on public.outcome_goals. It changes no table, column or policy, and it
-- never deletes, completes, archives or edits a Goal. Safe to re-run.
--
-- Requires 20261110000100_account_entitlements.sql (for the effective-tier rule).
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- WHAT COUNTS: a structured Goal is a public.outcome_goals row (Tools > Goals; the "new Goal" flows on Today and Tomorrow create
-- the same rows), of any goal_type. It is ACTIVE while status = 'active'. 'completed' and 'abandoned' (shown as "Archived") do
-- not count. Daily tasks and commitments are public.goals rows, a different table, and are never counted or limited here; the
-- daily commitment and review experience is untouched.
--
-- RULE
--   A user whose EFFECTIVE tier is free (no entitlement row, a free row, or an expired trial) may have at most 3 active Goals.
--   Anything that would ADD an active Goal is refused with GOAL_LIMIT_REACHED (SQLSTATE 53400) once they already have 3 or more:
--     - creating a Goal (it starts active), and
--     - reactivating a completed or archived Goal (status -> active).
--   premium and an active premium_trial are unlimited. The limit mirrors FREE_LIMITS.structuredGoals in src/lib/entitlements.ts;
--   a test keeps the two equal.
--
-- DOWNGRADE: nothing is ever deleted, completed or archived for the user. Someone who falls back to Free with, say, 5 active
-- Goals keeps all 5, their linked tasks, lineage and history. They can edit, complete, archive and delete as before; only actions
-- that increase the active count (create, reactivate) are blocked while it is at or above 3.
--
-- NOT CHECKED: every other update (rename, priority, type, target or recurrence fields, completing, archiving). They do not
-- increase the active count, and this trigger only fires when status is part of the update.
--
-- CONCURRENT REQUESTS: a per-user advisory lock is taken before counting and held until the transaction ends, so racing requests
-- for the last free slot (two creations, or a creation and a reactivation) are serialized; the later one counts after the earlier
-- has committed and is refused. Different users never block each other.
--
-- WHOSE GOALS ARE COUNTED: only the acting user's (where user_id = new.user_id). A row claiming someone else's user_id is passed
-- through so the existing policies reject it; the trigger never counts or reveals another user's Goals.

create or replace function public.enforce_goal_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tier text;
  v_ends timestamptz;
  v_count integer;
begin
  -- Only actions that make a Goal active matter: a new active row, or a non-active row turned active.
  if new.status is distinct from 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' then
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

  perform pg_advisory_xact_lock(hashtextextended('goals_free_limit:' || new.user_id::text, 0));

  select count(*) into v_count from public.outcome_goals where user_id = new.user_id and status = 'active';
  if v_count >= 3 then
    raise exception 'GOAL_LIMIT_REACHED'
      using errcode = '53400',
            detail = 'Free accounts can have up to 3 active Goals.',
            hint = 'Complete or archive a Goal, or upgrade to Premium for unlimited Goals.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_goal_limit on public.outcome_goals;
create trigger trg_enforce_goal_limit
  before insert or update of status on public.outcome_goals
  for each row execute function public.enforce_goal_limit();

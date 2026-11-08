-- Phase 5.7 step 2: safe, recoverable account deletion + one-time-trial protection.
--
-- WHY A MIGRATION (nothing existing can do these):
--   1. A deletion has to SURVIVE restarts, timeouts and retries and must never delete the login before Stripe is settled. That needs durable
--      per-account state (account_deletions) with a lease, so a retry resumes where it stopped and two requests cannot run at once.
--   2. Deleting an Auth user cascades away account_trial_history, which would let a re-registered email take a second 14-day trial. A minimal
--      retained marker is needed (deleted_account_trial_marks), and it must not be a raw email or a plain hash (a plain hash of an email is
--      reversible by guessing). It is an HMAC-SHA-256 under a random key that lives ONLY inside the database (account_deletion_secrets).
--   3. Two existing foreign keys would make deleting an Auth user FAIL: goal_assignments.canceled_by (no ON DELETE action) and any
--      admin_audit_log -> auth.users keys. They are changed to ON DELETE SET NULL (the history is kept, unlinked from the person).
--
-- WHAT IT ADDS: three server-only tables, five service-role-only functions, a corrected start_my_premium_trial, and the two FK changes. Idempotent.
--
-- RETENTION / ACCESS (also stated in the Privacy Policy):
--   * account_deletions: one row per account while a deletion is in progress. It disappears with the Auth user when the deletion completes.
--   * deleted_account_trial_marks: ONLY for a deleted account that had used its free trial; one row of 64 hex characters + a date. No email, no user
--     ID, no way to recover either. Kept 24 months, purged opportunistically on each later deletion and ignored once older.
--     A deletion/erasure request can be honoured by deleting the row; the owner then loses repeat-trial protection for that email.
--   * account_deletion_secrets: the HMAC key. Never exposed: RLS on, no policies, no grants to anon/authenticated, readable only by the functions below.
--   * Payment records live with Stripe (and the owner's accounting) and are NOT touched here. Audit-log rows are kept with their account links cleared.

-- ---------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.account_deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'billing_cancelled', 'data_cleaned')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 10000),
  last_failure text check (last_failure is null or last_failure in ('billing', 'storage', 'data', 'auth', 'unexpected'))
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from anon, authenticated;

create table if not exists public.deleted_account_trial_marks (
  mark text primary key check (mark ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.deleted_account_trial_marks enable row level security;
revoke all on public.deleted_account_trial_marks from anon, authenticated;

create table if not exists public.account_deletion_secrets (
  id boolean primary key default true check (id),
  trial_mark_key bytea not null check (octet_length(trial_mark_key) >= 32)
);
alter table public.account_deletion_secrets enable row level security;
revoke all on public.account_deletion_secrets from anon, authenticated;
-- 64 random bytes from the database's CSPRNG (gen_random_uuid is core PostgreSQL, so this needs no extension); created once, never rotated here.
insert into public.account_deletion_secrets (id, trial_mark_key)
values (true, decode(replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Foreign keys that would block deleting an Auth user.
do $$
declare
  r record;
begin
  if to_regclass('public.goal_assignments') is not null then
    for r in
      select c.conname, a.attname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.conrelid = 'public.goal_assignments'::regclass and c.contype = 'f' and c.confrelid = 'auth.users'::regclass
         and a.attname = 'canceled_by' and c.confdeltype <> 'n'
    loop
      execute format('alter table public.goal_assignments drop constraint %I', r.conname);
      execute format('alter table public.goal_assignments add constraint %I foreign key (%I) references auth.users(id) on delete set null', r.conname, r.attname);
    end loop;
  end if;

  if to_regclass('public.admin_audit_log') is not null then
    for r in
      select c.conname, a.attname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.conrelid = 'public.admin_audit_log'::regclass and c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype <> 'n'
    loop
      execute format('alter table public.admin_audit_log drop constraint %I', r.conname);
      execute format('alter table public.admin_audit_log alter column %I drop not null', r.attname);
      execute format('alter table public.admin_audit_log add constraint %I foreign key (%I) references auth.users(id) on delete set null', r.conname, r.attname);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- The keyed, non-reversible trial marker for an email: lower-cased, trimmed, "+tag" removed from the local part, then HMAC-SHA-256 under the
-- database-only key. Internal: not callable by any API role (the functions below call it as their owner).
create or replace function public.trial_mark_for_email(p_email text)
returns text
language plpgsql
stable
security definer set search_path = public, extensions
as $$
declare
  v_key bytea;
  v_norm text;
begin
  if p_email is null or btrim(p_email) = '' then
    return null;
  end if;
  v_norm := regexp_replace(lower(btrim(p_email)), '^([^@+]+)\+[^@]*@', '\1@');
  select trial_mark_key into v_key from public.account_deletion_secrets where id;
  if v_key is null then
    return null;
  end if;
  return encode(hmac(convert_to(v_norm, 'UTF8'), v_key, 'sha256'), 'hex');
end;
$$;
revoke all on function public.trial_mark_for_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Start or resume a deletion. Returns:
--   'acquired' + the state to resume from  -> the caller now holds a 3-minute lease on the deletion
--   'busy'                                 -> another request holds a live lease: do nothing
--   'invalid'                              -> no such account
-- The first call also records the trial marker (only if the account had used its trial) and purges markers older than 24 months.
create or replace function public.begin_account_deletion(p_user_id uuid)
returns table (r_result text, r_state text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.account_deletions%rowtype;
  v_email text;
  v_mark text;
begin
  if p_user_id is null then
    return query select 'invalid'::text, null::text;
    return;
  end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if not found then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account_deletion:' || p_user_id::text, 0));

  select * into v_row from public.account_deletions where user_id = p_user_id for update;
  if not found then
    insert into public.account_deletions (user_id, state, lease_until, attempts) values (p_user_id, 'pending', now() + interval '3 minutes', 1);
    delete from public.deleted_account_trial_marks where created_at < now() - interval '24 months';
    if exists (select 1 from public.account_trial_history h where h.user_id = p_user_id) then
      v_mark := public.trial_mark_for_email(v_email);
      if v_mark is not null then
        insert into public.deleted_account_trial_marks (mark) values (v_mark) on conflict (mark) do update set created_at = now();
      end if;
    end if;
    return query select 'acquired'::text, 'pending'::text;
    return;
  end if;

  if v_row.lease_until is not null and v_row.lease_until > now() then
    return query select 'busy'::text, v_row.state;
    return;
  end if;

  update public.account_deletions
     set lease_until = now() + interval '3 minutes', attempts = least(attempts + 1, 10000), updated_at = now()
   where user_id = p_user_id;
  return query select 'acquired'::text, v_row.state;
end;
$$;

-- Move a deletion forward (never backward), refresh or release its lease, and record why a step failed (a category, never a message).
--   p_failure null     -> progress: the lease is renewed for 3 more minutes
--   p_failure not null -> the step failed: the lease is released so the member can retry at once
-- Returns 'ok', 'unknown' (no such deletion) or 'invalid'.
create or replace function public.advance_account_deletion(p_user_id uuid, p_state text, p_failure text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_rank integer;
  v_current integer;
  v_cur_state text;
begin
  if p_user_id is null or p_state is null or p_state not in ('pending', 'billing_cancelled', 'data_cleaned')
     or (p_failure is not null and p_failure not in ('billing', 'storage', 'data', 'auth', 'unexpected')) then
    return 'invalid';
  end if;
  select state into v_cur_state from public.account_deletions where user_id = p_user_id for update;
  if not found then
    return 'unknown';
  end if;
  v_rank := case p_state when 'pending' then 1 when 'billing_cancelled' then 2 else 3 end;
  v_current := case v_cur_state when 'pending' then 1 when 'billing_cancelled' then 2 else 3 end;
  update public.account_deletions
     set state = case when v_rank >= v_current then p_state else v_cur_state end,
         last_failure = p_failure,
         lease_until = case when p_failure is null then now() + interval '3 minutes' else null end,
         updated_at = now()
   where user_id = p_user_id;
  return 'ok';
end;
$$;

-- Is a deletion in progress for this account? (Checkout and trial activation refuse while it is.)
create or replace function public.account_deletion_pending(p_user_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.account_deletions where user_id = p_user_id);
$$;

-- Shared/team data that must not take other members' content with it, and anything that would block the Auth deletion. Idempotent.
--   * a team goal the member created that other members joined is handed to the longest-standing other participant (the goal, its checklist and
--     the others' items survive); goals with no other participant go with the member (cascade);
--   * assignment cancellations the member made keep their record, unlinked;
--   * a stored admin Premium grant or trial row is removed, so no grant survives the deletion as active Premium.
create or replace function public.cleanup_account_shared_data(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  update public.team_goals g
     set creator_id = x.user_id
    from (
      select distinct on (p.team_goal_id) p.team_goal_id, p.user_id
        from public.team_goal_participants p
       where p.user_id <> p_user_id
       order by p.team_goal_id, p.joined_at, p.user_id
    ) x
   where g.id = x.team_goal_id and g.creator_id = p_user_id;

  update public.goal_assignments set canceled_by = null where canceled_by = p_user_id;

  delete from public.account_entitlements where user_id = p_user_id;
end;
$$;

-- Server-only: executable by the service role alone.
revoke all on function public.begin_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.advance_account_deletion(uuid, text, text) from public, anon, authenticated;
revoke all on function public.account_deletion_pending(uuid) from public, anon, authenticated;
revoke all on function public.cleanup_account_shared_data(uuid) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid) to service_role;
grant execute on function public.advance_account_deletion(uuid, text, text) to service_role;
grant execute on function public.account_deletion_pending(uuid) to service_role;
grant execute on function public.cleanup_account_shared_data(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Trial activation: identical to the previous definition (20261120000100_billing_entitlements.sql) plus two refusals:
--   * ACCOUNT_DELETING  while the account is being deleted;
--   * TRIAL_ALREADY_USED  when the signed-in email matches a retained marker from a deleted account that used its trial (within 24 months).
create or replace function public.start_my_premium_trial()
returns table (r_tier text, r_stored_tier text, r_trial_started_at timestamptz, r_trial_ends_at timestamptz)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_ends timestamptz;
  v_stored text;
  v_mark text;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '28000';
  end if;

  if not public.feature_enabled('premium_trial_activation_enabled') then
    raise exception 'TRIAL_ACTIVATION_DISABLED'
      using detail = 'Free trials are not available right now.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('premium_trial:' || v_uid::text, 0));

  if exists (select 1 from public.account_deletions where user_id = v_uid) then
    raise exception 'ACCOUNT_DELETING'
      using detail = 'This account is being deleted.';
  end if;

  if exists (select 1 from public.account_trial_history where user_id = v_uid) then
    raise exception 'TRIAL_ALREADY_USED'
      using detail = 'Each account can have one Premium trial.';
  end if;

  v_mark := public.trial_mark_for_email((select u.email from auth.users u where u.id = v_uid));
  if v_mark is not null and exists (select 1 from public.deleted_account_trial_marks m where m.mark = v_mark and m.created_at > now() - interval '24 months') then
    raise exception 'TRIAL_ALREADY_USED'
      using detail = 'Each account can have one Premium trial.';
  end if;

  select e.tier into v_stored from public.account_entitlements e where e.user_id = v_uid;
  if v_stored = 'premium' or public.billing_grants_premium(v_uid) then
    raise exception 'ALREADY_PREMIUM'
      using detail = 'This account is already Premium.';
  end if;

  v_ends := v_now + interval '336 hours';

  insert into public.account_trial_history (user_id, started_at, ends_at) values (v_uid, v_now, v_ends);

  insert into public.account_entitlements (user_id, tier, trial_started_at, trial_ends_at)
  values (v_uid, 'premium_trial', v_now, v_ends)
  on conflict (user_id) do update
    set tier = 'premium_trial', trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at;

  return query select public.effective_account_tier('premium_trial', v_ends, v_now), 'premium_trial'::text, v_now, v_ends;
end;
$$;

revoke all on function public.start_my_premium_trial() from public, anon;
grant execute on function public.start_my_premium_trial() to authenticated;

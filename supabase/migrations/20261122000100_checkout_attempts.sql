-- Phase 5.6 step 5: duplicate-subscription protection. Records each member's in-flight Stripe Checkout attempt so two requests (a double click,
-- two tabs, a retry) cannot open two paid subscriptions. NOTHING here touches entitlements, trials, billing records or subscription sync.
--
-- ADDITIVE: one new table and three functions. Safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or CI.
--
-- SERVER-ONLY: browsers cannot touch the table (RLS on, no policies, privileges revoked) and the three functions are executable by the SERVICE
-- ROLE only, so a member cannot clear or forge their own attempt. The account comes from the verified sign-in the server passes in; no
-- Stripe identifier ever reaches a browser.
--
-- begin_checkout_attempt(user, plan) decides, atomically (one advisory lock per member) and BEFORE any Stripe session is created:
--   'subscription_exists'  the member already has a subscription record that is not over for good. Live = anything except canceled /
--                          incomplete_expired: active, trialing, past_due, unpaid, incomplete, paused and any unknown status (fail closed).
--                          This reads ONLY account_billing: an admin Premium grant or the one-time trial are not Stripe subscriptions and
--                          never count.
--   'in_progress'          another request is creating a session for this member right now (claimed within the last 2 minutes).
--   'pending'              an earlier session is still open (or may have just been paid and not yet synced): the server asks Stripe about it
--                          and reuses it, replaces it (different plan), or sees it was paid or expired. Stripe is the authority.
--   'claimed'              go ahead and create ONE session for the returned attempt; a stale claim for the same plan is re-adopted so the
--                          Stripe idempotency key (derived from the attempt) returns the same session instead of a second one.
-- A partial unique index guarantees at most one active (creating/open) attempt per member even if the lock were ever bypassed.

create table if not exists public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'annual')),
  status text not null default 'creating' check (status in ('creating', 'open', 'completed', 'expired', 'failed')),
  stripe_session_id text unique check (stripe_session_id is null or stripe_session_id like 'cs\_%'),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists checkout_attempts_one_active_per_member
  on public.checkout_attempts (user_id) where status in ('creating', 'open');

alter table public.checkout_attempts enable row level security;
revoke all on public.checkout_attempts from anon, authenticated;

create or replace function public.begin_checkout_attempt(p_user_id uuid, p_plan text)
returns table (r_result text, r_attempt_id uuid, r_session_id text, r_plan text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_found boolean;
  v_a public.checkout_attempts%rowtype;
  v_id uuid;
begin
  if p_user_id is null or p_plan is null or p_plan not in ('monthly', 'annual') then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('checkout_attempt:' || p_user_id::text, 0));

  -- 1. an existing subscription that is not over for good (billing records only: grants and trials never count)
  select b.subscription_status into v_status from public.account_billing b where b.user_id = p_user_id;
  v_found := found;
  if v_found and (v_status is null or v_status not in ('canceled', 'incomplete_expired')) then
    return query select 'subscription_exists'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- 2. an attempt already in flight
  select * into v_a from public.checkout_attempts where user_id = p_user_id and status in ('creating', 'open') limit 1;
  if found then
    if v_a.status = 'creating' then
      if v_a.updated_at > now() - interval '2 minutes' then
        return query select 'in_progress'::text, null::uuid, null::text, null::text;
        return;
      end if;
      -- a stale claim (the creator never finished): same plan is re-adopted so Stripe's idempotency returns the SAME session
      if v_a.plan = p_plan then
        update public.checkout_attempts set updated_at = now() where id = v_a.id;
        return query select 'claimed'::text, v_a.id, null::text, v_a.plan;
        return;
      end if;
      update public.checkout_attempts set status = 'expired', updated_at = now() where id = v_a.id;
    else
      -- open: Stripe decides whether it is still open, paid or expired (a short grace beyond its expiry covers a late payment)
      if v_a.stripe_session_id is not null and (v_a.expires_at is null or now() <= v_a.expires_at + interval '15 minutes') then
        return query select 'pending'::text, v_a.id, v_a.stripe_session_id, v_a.plan;
        return;
      end if;
      update public.checkout_attempts set status = 'expired', updated_at = now() where id = v_a.id;
    end if;
  end if;

  -- 3. nothing in flight: claim the one slot
  insert into public.checkout_attempts (user_id, plan) values (p_user_id, p_plan) returning id into v_id;
  return query select 'claimed'::text, v_id, null::text, p_plan;
end;
$$;

-- The session now exists at Stripe: remember it (claim -> open). False if the attempt is no longer the active claim.
create or replace function public.record_checkout_session(p_attempt_id uuid, p_session_id text, p_expires_at timestamptz)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_session_id is null or p_session_id not like 'cs\_%' then
    return false;
  end if;
  update public.checkout_attempts
     set status = 'open', stripe_session_id = p_session_id, expires_at = p_expires_at, updated_at = now()
   where id = p_attempt_id and status = 'creating';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- End an attempt: 'completed' (the session was paid), 'expired' (it expired or was replaced) or 'failed' (the session could not be created).
create or replace function public.finish_checkout_attempt(p_attempt_id uuid, p_status text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_status is null or p_status not in ('completed', 'expired', 'failed') then
    return false;
  end if;
  update public.checkout_attempts
     set status = p_status, updated_at = now()
   where id = p_attempt_id and status in ('creating', 'open');
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.begin_checkout_attempt(uuid, text) from public, anon, authenticated;
revoke all on function public.record_checkout_session(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_checkout_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_checkout_attempt(uuid, text) to service_role;
grant execute on function public.record_checkout_session(uuid, text, timestamptz) to service_role;
grant execute on function public.finish_checkout_attempt(uuid, text) to service_role;

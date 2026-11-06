-- Phase 5.6 step 1: record Stripe subscription state against the right StandUp account. BILLING RECORDS ONLY.
--
-- ADDITIVE: new nullable columns on public.account_billing and one new function. Safe to re-run. It changes no existing row, policy or
-- function, and nothing here reads or writes entitlements, trials, trial history, admin grants or any user content: an account's Free /
-- Premium status is decided exactly as before. Turning a verified billing record into Premium is a LATER step.
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- SERVER-ONLY: account_billing is still unreachable from browsers (RLS on, no policies, privileges revoked). The new function is
-- executable by the service role ONLY, i.e. the verified webhook's privileged connection. Browsers never supply an account ID or a plan.
--
-- OWNERSHIP RULES (sync_stripe_subscription decides, atomically, under a per-customer and per-account lock):
--   * an existing record is the strongest evidence: a known subscription or customer belongs to the account that already holds it;
--   * otherwise the account comes from the trusted hint (the Checkout metadata our own server set from the signed-in user), and it must
--     be a real account;
--   * a hint that contradicts an existing record, or a subscription/customer that two accounts both claim, is an 'ownership_conflict'
--     and changes nothing; so is an account that is already tied to a different Stripe customer;
--   * an account that already has a live (not canceled/expired) subscription cannot be moved to a different one ('subscription_conflict').
-- ORDERING: every call carries the time the server fetched the subscription from Stripe; a snapshot older than the stored one is
--   'stale' and never overwrites newer state, so duplicate and out-of-order events converge on the latest state.

alter table public.account_billing add column if not exists current_period_start timestamptz;
alter table public.account_billing add column if not exists canceled_at timestamptz;
alter table public.account_billing add column if not exists ended_at timestamptz;
alter table public.account_billing add column if not exists subscription_synced_at timestamptz;
alter table public.account_billing add column if not exists last_event_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'account_billing_last_event_id_format') then
    alter table public.account_billing add constraint account_billing_last_event_id_format check (last_event_id is null or last_event_id like 'evt\_%');
  end if;
end $$;

create or replace function public.sync_stripe_subscription(
  p_event_id text,
  p_user_hint uuid,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_plan text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_ended_at timestamptz,
  p_fetched_at timestamptz
)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_by_sub uuid;
  v_by_cust uuid;
  v_owner uuid;
  v_row public.account_billing%rowtype;
begin
  if p_plan is null or p_plan not in ('monthly', 'annual')
     or p_customer_id is null or p_customer_id not like 'cus\_%'
     or p_subscription_id is null or p_subscription_id not like 'sub\_%'
     or p_price_id is null or p_price_id not like 'price\_%'
     or p_status is null or char_length(p_status) > 40
     or p_fetched_at is null
     or (p_event_id is not null and p_event_id not like 'evt\_%') then
    return 'invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing_sync_customer:' || p_customer_id, 0));

  select user_id into v_by_sub from public.account_billing where stripe_subscription_id = p_subscription_id;
  select user_id into v_by_cust from public.account_billing where stripe_customer_id = p_customer_id;

  if v_by_sub is not null and v_by_cust is not null and v_by_sub <> v_by_cust then
    return 'ownership_conflict';
  end if;
  v_owner := coalesce(v_by_sub, v_by_cust);

  if v_owner is not null then
    if p_user_hint is not null and p_user_hint <> v_owner then
      return 'ownership_conflict';
    end if;
  else
    if p_user_hint is null then
      return 'unmapped';
    end if;
    if not exists (select 1 from auth.users where id = p_user_hint) then
      return 'unmapped';
    end if;
    v_owner := p_user_hint;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing_sync_account:' || v_owner::text, 0));

  select * into v_row from public.account_billing where user_id = v_owner for update;
  if found then
    if v_row.stripe_customer_id is not null and v_row.stripe_customer_id <> p_customer_id then
      return 'ownership_conflict';
    end if;
    if v_row.stripe_subscription_id is not null and v_row.stripe_subscription_id <> p_subscription_id then
      if coalesce(v_row.subscription_status, '') not in ('canceled', 'incomplete_expired') then
        return 'subscription_conflict';
      end if;
    elsif v_row.subscription_synced_at is not null and v_row.subscription_synced_at > p_fetched_at then
      return 'stale';
    end if;
  end if;

  insert into public.account_billing as b (
    user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan, subscription_status,
    current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at, subscription_synced_at, last_event_id
  ) values (
    v_owner, p_customer_id, p_subscription_id, p_price_id, p_plan, p_status,
    p_period_start, p_period_end, coalesce(p_cancel_at_period_end, false), p_canceled_at, p_ended_at, p_fetched_at, p_event_id
  )
  on conflict (user_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    plan = excluded.plan,
    subscription_status = excluded.subscription_status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at,
    ended_at = excluded.ended_at,
    subscription_synced_at = excluded.subscription_synced_at,
    last_event_id = excluded.last_event_id;

  return 'applied';
end;
$$;

revoke all on function public.sync_stripe_subscription(text, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_stripe_subscription(text, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, timestamptz) to service_role;

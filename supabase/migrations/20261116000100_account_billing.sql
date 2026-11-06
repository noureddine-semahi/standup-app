-- Phase 5.1: where Stripe's identifiers for an account will live. FOUNDATION ONLY: nothing reads or writes this table yet.
--
-- ADDITIVE ONLY. One new table (+ its updated_at trigger). It changes no existing table, policy or function, in particular nothing about
-- public.account_entitlements or the free trial: an account's tier is decided exactly as before. A later phase (webhooks) will be what
-- turns a paid subscription into an entitlement; this table only remembers who is who on Stripe's side.
-- Safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- PRIVACY / SECURITY: browsers never touch this table. RLS is on with NO policies, and every privilege is revoked from anon and
-- authenticated, so only the server (the service role, which bypasses RLS) can read or write it. Stripe secret keys are NOT stored here;
-- only Stripe's object IDs (cus_..., sub_..., price_...) and plain status fields.
--
-- At most one row per account, keyed by user_id; one Stripe customer and one subscription map to at most one account (unique, and
-- null until they exist). Deleting an account deletes its row (the same cascade the other account tables use).

create table if not exists public.account_billing (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique check (stripe_customer_id is null or stripe_customer_id like 'cus\_%'),
  stripe_subscription_id text unique check (stripe_subscription_id is null or stripe_subscription_id like 'sub\_%'),
  stripe_price_id text check (stripe_price_id is null or stripe_price_id like 'price\_%'),
  plan text check (plan is null or plan in ('monthly', 'annual')),
  -- Stripe's own status string (active, trialing, past_due, canceled, ...). Not constrained here so a status Stripe adds later can't break a webhook.
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_billing enable row level security;
revoke all on public.account_billing from anon, authenticated;

create or replace function public.touch_account_billing()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_account_billing on public.account_billing;
create trigger trg_touch_account_billing
  before update on public.account_billing
  for each row execute function public.touch_account_billing();

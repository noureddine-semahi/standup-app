-- Tools > Planner (Financial Planner, phase 1): the user's financial profile.
--
-- ADDITIVE ONLY. Creates one new table. It does not touch bills, subscriptions,
-- payment_accounts, goals or any existing function, and it never reads or
-- rewrites existing financial records. Safe to re-run.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app
-- or by CI -- the Planner shows an "unavailable" state until this has been run.
--
-- MODEL
--   financial_profiles   exactly ONE row per user (user_id is the primary key).
--                        Saved after every wizard step, so setup resumes where it
--                        stopped. Amounts the user has not given are NULL (never 0),
--                        and every figure that can be a guess carries a basis
--                        ('actual' | 'estimate') so estimates stay distinguishable.
--
--   Scalar answers (income, household, savings, consent flags) are typed columns
--   with CHECK constraints. The three short lists (living expenses, debts, goals)
--   are validated jsonb with size/shape limits; the app validates every entry
--   before saving (src/lib/financialPlanner.ts).
--
--   use_bills / use_accounts / use_subscriptions are the user's CONSENT to read
--   their existing Bills, Payments accounts and Subscriptions into the plan.
--   They default to false. Reading is all that ever happens: this table holds no
--   reference that lets the planner change those records.
--
-- PRIVACY
--   Row Level Security is on; every policy is scoped to auth.uid() = user_id.
--   There is no public or cross-user access, and the owner can delete their
--   profile.

create table if not exists public.financial_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_step smallint not null default 1 check (current_step between 1 and 5),
  skipped_steps smallint[] not null default '{}'
    check (skipped_steps <@ array[1, 2, 3, 4, 5]::smallint[]),

  -- Step 1: income
  pay_frequency text check (pay_frequency is null or pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'irregular')),
  take_home numeric(12, 2) check (take_home is null or take_home >= 0),
  income_typical numeric(12, 2) check (income_typical is null or income_typical >= 0),
  income_low numeric(12, 2) check (income_low is null or income_low >= 0),
  income_basis text not null default 'estimate' check (income_basis in ('actual', 'estimate')),

  -- Step 2: location and household
  country text check (country is null or char_length(country) <= 60),
  region text check (region is null or char_length(region) <= 60),
  adults smallint check (adults is null or adults between 1 and 10),
  dependents smallint check (dependents is null or dependents between 0 and 15),

  -- Step 3: living expenses  { "<category>": { "amount": n, "basis": "actual"|"estimate", "covered": bool } }
  expenses jsonb not null default '{}'::jsonb
    check (jsonb_typeof(expenses) = 'object' and octet_length(expenses::text) <= 4000),

  -- Step 4: debts and savings
  debts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(debts) = 'array' and jsonb_array_length(debts) <= 20 and octet_length(debts::text) <= 20000),
  no_debts boolean not null default false,
  savings_balance numeric(12, 2) check (savings_balance is null or savings_balance >= 0),
  savings_monthly numeric(12, 2) check (savings_monthly is null or savings_monthly >= 0),
  savings_basis text not null default 'estimate' check (savings_basis in ('actual', 'estimate')),

  -- Step 5: goals
  goals jsonb not null default '[]'::jsonb
    check (jsonb_typeof(goals) = 'array' and jsonb_array_length(goals) <= 10 and octet_length(goals::text) <= 10000),

  -- Consent to read existing records into the plan (read-only; default off)
  use_bills boolean not null default false,
  use_accounts boolean not null default false,
  use_subscriptions boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_financial_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_financial_profile_updated_at on public.financial_profiles;
create trigger trg_touch_financial_profile_updated_at
  before update on public.financial_profiles
  for each row execute function public.touch_financial_profile_updated_at();

alter table public.financial_profiles enable row level security;

-- Owner-only. The with-check clauses stop a user writing a row for someone else.
drop policy if exists "financial_profiles_select_own" on public.financial_profiles;
drop policy if exists "financial_profiles_insert_own" on public.financial_profiles;
drop policy if exists "financial_profiles_update_own" on public.financial_profiles;
drop policy if exists "financial_profiles_delete_own" on public.financial_profiles;
create policy "financial_profiles_select_own" on public.financial_profiles for select using (auth.uid() = user_id);
create policy "financial_profiles_insert_own" on public.financial_profiles for insert with check (auth.uid() = user_id);
create policy "financial_profiles_update_own" on public.financial_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "financial_profiles_delete_own" on public.financial_profiles for delete using (auth.uid() = user_id);

-- Tools > Planner, household Phase 1: a household and one optional partner profile.
--
-- ADDITIVE ONLY. Creates two new tables. It does NOT touch financial_profiles (the
-- existing personal profile stays exactly as it is), bills, subscriptions,
-- payment_accounts, goals or any existing function, and it never reads or rewrites
-- existing financial records. Safe to re-run.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI;
-- the Planner's Partner tab shows an "unavailable" state until this has been run, and the
-- personal ("Me") planner keeps working exactly as before either way.
--
-- MODEL
--   households         one row per signed-in user (owner_id unique), created the first time a
--                      partner is added. Phase 1 stores nothing about the household itself;
--                      it exists so members, and later shared costs, have a parent.
--   household_members  the optional partner. Holds the same personal-finance answers as
--                      financial_profiles (income, living expenses, debts, savings, goals and
--                      step progress), kept separate from the user's own profile.
--                      Unanswered amounts are NULL (never 0); every figure that can be a guess
--                      carries a basis ('actual' | 'estimate').
--
--   The signed-in user is the sole manager: the partner needs no StandUp account. Bills,
--   Payments and Subscriptions are NOT copied or referenced here; they stay the user's own.
--
--   linked_user_id / invite_status are reserved, unused columns for future partner invitations.
--   Nothing reads or writes them yet, and no policy grants anyone but the owner access.
--
-- PRIVACY
--   Row Level Security is on for both tables and every policy is scoped to the owner
--   (auth.uid() = owner_id). A member row can only be attached to a household the caller owns.
--   There is no public or cross-user access. Deleting a partner deletes that row only.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  -- Denormalized from the household so the RLS checks stay simple and cheap.
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'partner' check (role in ('partner')),
  display_name text not null default 'Partner' check (char_length(btrim(display_name)) between 1 and 60),
  include_in_household boolean not null default true,

  -- Reserved for future invitations / sharing. Unused in Phase 1.
  linked_user_id uuid references auth.users(id) on delete set null,
  invite_status text check (invite_status is null or invite_status in ('pending', 'accepted', 'declined')),

  current_step smallint not null default 1 check (current_step between 1 and 5),
  skipped_steps smallint[] not null default '{}'
    check (skipped_steps <@ array[1, 2, 3, 4, 5]::smallint[]),

  -- Step 1: income
  pay_frequency text check (pay_frequency is null or pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'irregular')),
  take_home numeric(12, 2) check (take_home is null or take_home >= 0),
  income_typical numeric(12, 2) check (income_typical is null or income_typical >= 0),
  income_low numeric(12, 2) check (income_low is null or income_low >= 0),
  income_basis text not null default 'estimate' check (income_basis in ('actual', 'estimate')),

  -- Step 2: location (household size is a household-level answer, added in a later phase)
  country text check (country is null or char_length(country) <= 60),
  region text check (region is null or char_length(region) <= 60),

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

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One partner per household for now (relax this index later to allow more members).
create unique index if not exists household_members_one_partner_idx
  on public.household_members (household_id) where role = 'partner';
create index if not exists household_members_owner_idx on public.household_members (owner_id);

create or replace function public.touch_household_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_households_updated_at on public.households;
create trigger trg_touch_households_updated_at
  before update on public.households
  for each row execute function public.touch_household_updated_at();

drop trigger if exists trg_touch_household_members_updated_at on public.household_members;
create trigger trg_touch_household_members_updated_at
  before update on public.household_members
  for each row execute function public.touch_household_updated_at();

alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- households: owner-only.
drop policy if exists "households_select_own" on public.households;
drop policy if exists "households_insert_own" on public.households;
drop policy if exists "households_update_own" on public.households;
drop policy if exists "households_delete_own" on public.households;
create policy "households_select_own" on public.households for select using (auth.uid() = owner_id);
create policy "households_insert_own" on public.households for insert with check (auth.uid() = owner_id);
create policy "households_update_own" on public.households for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "households_delete_own" on public.households for delete using (auth.uid() = owner_id);

-- household_members: owner-only, and a member can only live in a household the caller owns.
drop policy if exists "household_members_select_own" on public.household_members;
drop policy if exists "household_members_insert_own" on public.household_members;
drop policy if exists "household_members_update_own" on public.household_members;
drop policy if exists "household_members_delete_own" on public.household_members;
create policy "household_members_select_own" on public.household_members for select using (auth.uid() = owner_id);
create policy "household_members_insert_own" on public.household_members for insert
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid())
  );
create policy "household_members_update_own" on public.household_members for update
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid())
  );
create policy "household_members_delete_own" on public.household_members for delete using (auth.uid() = owner_id);

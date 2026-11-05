-- Tools > Planner, household Phase 2: shared expenses, joint debts, shared goals and basic household composition.
--
-- ADDITIVE ONLY. Adds nullable/defaulted columns to public.households. It creates no table, drops nothing, and
-- does NOT touch household_members (the partner profile and include_in_household stay as they are),
-- financial_profiles, bills, subscriptions, payment_accounts or any existing function. It never reads or rewrites
-- existing rows' data: every new column has a default, so existing households simply read as "nothing entered yet".
-- Safe to re-run (each column is added only if missing; the trigger and function are replaced in place).
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI. Until it has been run the
-- app treats shared household data as "unavailable" and the personal ("Me") and Partner planners keep working
-- exactly as before.
--
-- MODEL (one row per household; the three lists are small jsonb arrays, each item with a stable string id)
--   shared_expenses   [{ id, category, label, amount, basis, contributions:{me,partner}, links:[...] }]   <= 30
--   shared_debts      [{ id, name, balance, monthlyPayment, basis, contributions:{me,partner}, links:[...] }]   <= 10
--   shared_goals      [{ id, name, targetAmount, targetDate, savedAmount, contributions, countedInSavings }]   <= 10
--   no_shared_expenses / no_shared_debts   "the household has none" is an answer, distinct from an empty list.
--   adults / children / other_members      household SIZE (who lives there). NULL = not answered (never 0).
--                                          This is not tax-dependent eligibility.
--   revision          optimistic-concurrency counter. Bumped by the database ONLY when one of the columns above
--                     actually changes; a client cannot set it. The app saves with "... where revision = <the one it
--                     read>", so a stale tab cannot silently overwrite a newer save.
--
--   Unanswered amounts are JSON null (never 0); an explicit 0 is kept as 0. Amounts are USD.
--   Deeper validation (unique ids, contribution <= amount, link shapes) is done by the app before saving and again
--   when reading; the database enforces types, sizes and ranges as the last line of defence.
--
-- PRIVACY
--   The existing owner-only row level security on public.households (auth.uid() = owner_id) already covers every
--   column, new ones included, for select / insert / update / delete. No policy is added, widened or dropped, and
--   there is no public or cross-user access.

alter table public.households
  add column if not exists shared_expenses jsonb not null default '[]'::jsonb
    check (jsonb_typeof(shared_expenses) = 'array' and jsonb_array_length(shared_expenses) <= 30 and octet_length(shared_expenses::text) <= 40000),
  add column if not exists no_shared_expenses boolean not null default false,
  add column if not exists shared_debts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(shared_debts) = 'array' and jsonb_array_length(shared_debts) <= 10 and octet_length(shared_debts::text) <= 20000),
  add column if not exists no_shared_debts boolean not null default false,
  add column if not exists shared_goals jsonb not null default '[]'::jsonb
    check (jsonb_typeof(shared_goals) = 'array' and jsonb_array_length(shared_goals) <= 10 and octet_length(shared_goals::text) <= 20000),
  add column if not exists adults smallint check (adults is null or adults between 1 and 10),
  add column if not exists children smallint check (children is null or children between 0 and 15),
  add column if not exists other_members smallint check (other_members is null or other_members between 0 and 15),
  add column if not exists revision integer not null default 0 check (revision >= 0);

-- The revision moves only when the household's shared data really changes, and only the database moves it. An update
-- that touches nothing relevant (for example the app's idempotent "make sure the household exists" upsert) leaves it
-- alone, so it cannot cause a false conflict. Whatever a client sends for revision is ignored: a new row always starts
-- at 0, and an update can only keep or advance it from the stored value.
create or replace function public.bump_household_revision()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 0;
    return new;
  end if;
  if (new.shared_expenses, new.no_shared_expenses, new.shared_debts, new.no_shared_debts, new.shared_goals, new.adults, new.children, new.other_members)
     is distinct from
     (old.shared_expenses, old.no_shared_expenses, old.shared_debts, old.no_shared_debts, old.shared_goals, old.adults, old.children, old.other_members) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bump_household_revision on public.households;
create trigger trg_bump_household_revision
  before insert or update on public.households
  for each row execute function public.bump_household_revision();

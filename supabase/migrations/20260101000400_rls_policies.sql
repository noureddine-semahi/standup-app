-- ASSUMED: exact policy definitions are not inspectable from client code.
-- Every query in src/ is scoped by user_id/auth.uid(), which implies (but does
-- not prove) "users can only touch their own rows" policies exist. Compare
-- against the actual policies in the Supabase dashboard before applying this
-- file to the live project. See ../README.md.

alter table public.profiles enable row level security;
alter table public.daily_plans enable row level security;
alter table public.goals enable row level security;
alter table public.goal_notes enable row level security;
alter table public.goal_reschedules enable row level security;

-- profiles
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- daily_plans
create policy "daily_plans_select_own" on public.daily_plans
  for select using (auth.uid() = user_id);
create policy "daily_plans_insert_own" on public.daily_plans
  for insert with check (auth.uid() = user_id);
create policy "daily_plans_update_own" on public.daily_plans
  for update using (auth.uid() = user_id);

-- goals
create policy "goals_select_own" on public.goals
  for select using (auth.uid() = user_id);
create policy "goals_insert_own" on public.goals
  for insert with check (auth.uid() = user_id);
create policy "goals_update_own" on public.goals
  for update using (auth.uid() = user_id);
create policy "goals_delete_own" on public.goals
  for delete using (auth.uid() = user_id);

-- goal_notes: insert-only/append-only from the client (no update/delete call
-- sites anywhere in src/), so only select+insert policies are included.
create policy "goal_notes_select_own" on public.goal_notes
  for select using (auth.uid() = user_id);
create policy "goal_notes_insert_own" on public.goal_notes
  for insert with check (auth.uid() = user_id);

-- goal_reschedules: the client only ever selects and inserts directly; the
-- materialized/materialized_goal_id columns are updated exclusively by the
-- SECURITY DEFINER materialize_reschedules() RPC, which bypasses RLS
-- entirely — so no client-facing UPDATE policy is strictly required. One is
-- included anyway for symmetry with the other tables, scoped to own rows.
create policy "goal_reschedules_select_own" on public.goal_reschedules
  for select using (auth.uid() = user_id);
create policy "goal_reschedules_insert_own" on public.goal_reschedules
  for insert with check (auth.uid() = user_id);
create policy "goal_reschedules_update_own" on public.goal_reschedules
  for update using (auth.uid() = user_id);

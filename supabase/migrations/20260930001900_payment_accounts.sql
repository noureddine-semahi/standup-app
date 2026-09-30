-- Credit-card/bill payment tracking: account name, balance, minimum
-- payment, and a day-of-month due date, so nothing gets missed. No stored
-- "next due date" column -- like streaks/points elsewhere in this app,
-- it's computed on read from due_day + today (see computeNextDueDate in
-- db.ts), so it never needs updating and can't drift.
--
-- last_reminder_due_date tracks which cycle's suggestion chip has already
-- been turned into a goal, so it doesn't keep reoffering the same cycle
-- every day within the reminder window once you've acted on it once.
--
-- Reminders surface as a tap-to-add suggestion chip on Plan Tomorrow /
-- the date-detail page (same slot recurring goal templates already use),
-- deliberately never a silently auto-created goal -- matches this app's
-- established "awareness is a gate, not a silent convenience" principle.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  balance numeric not null default 0,
  minimum_payment numeric not null default 0,
  due_day integer not null check (due_day between 1 and 31),
  remind_days_before integer not null default 3 check (remind_days_before >= 0),
  last_reminder_due_date date,
  created_at timestamptz not null default now()
);
create index if not exists idx_payment_accounts_user_id on public.payment_accounts (user_id);

alter table public.payment_accounts enable row level security;

create policy "payment_accounts_select_own" on public.payment_accounts for select using (auth.uid() = user_id);
create policy "payment_accounts_insert_own" on public.payment_accounts for insert with check (auth.uid() = user_id);
create policy "payment_accounts_update_own" on public.payment_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "payment_accounts_delete_own" on public.payment_accounts for delete using (auth.uid() = user_id);

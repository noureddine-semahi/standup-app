-- FIN-02.2 Step 4A: the ledger table for manually recorded interest, fees, balance adjustments and reconciliation checkpoints.
--
-- SCHEMA ONLY. It adds one table, its indexes, its RLS and an immutability trigger, plus one unique index on payment_accounts. It writes no data, creates no
-- function that writes, and does not touch payment_transactions, the payment History, the payment functions (record_payment, reverse_payment,
-- confirm_payment_goal_completion) or any balance. Estimated interest is never stored here: only actual, user-entered charges and corrections are.
--
-- WHY A SEPARATE TABLE: payment_transactions is payments-only and its reverse_payment() always ADDS a row's amount back to the balance, so interest/fee/
-- adjustment rows there would be reversed the wrong way and shown as payments. A separate table keeps every existing screen and function exactly as it is.
--
-- SIGN CONVENTION: the tracked balance is the amount OWED. interest and fee RAISE it (balance_delta = +amount); an adjustment moves it either way
-- (balance_delta = +/-amount); a checkpoint changes nothing (balance_delta = 0) and records the reconciled balance in balance_after.
--
-- OWNERSHIP: (account_id, user_id) is a COMPOSITE foreign key to payment_accounts(id, user_id), so a row can never carry a user_id that differs from the
-- account's owner (payment_transactions has no such guarantee). Deleting an account, or its user, cascades to its entries.
--
-- WRITES: clients get SELECT only (owner-scoped RLS) and no INSERT/UPDATE/DELETE/TRUNCATE privilege and no write policy. Rows will be created and
-- reversed only by SECURITY DEFINER functions added in later steps. A trigger also freezes every column except the one-time reversed_at stamp.
--
-- ORDERING / CHECKPOINTS: created_at (clock_timestamp()) and seq are INFORMATIONAL only. They give a display order and a per-table sequence. They do NOT
-- establish a reliable order between payment_transactions rows and entries rows, and nothing here may be used as a checkpoint boundary: timestamps taken
-- in different transactions (and now() versus clock_timestamp() stamps) do not line up with lock order, and seq exists only in this table.
-- Checkpoint reconciliation therefore requires, in a LATER step:
--   (1) every operation that changes a balance or writes either ledger is serialized on the account row lock, taken BEFORE it writes. record_payment and,
--       since 20261130000100, confirm_payment_goal_completion already do; reverse_payment does not yet (it locks the ledger row first) and must be aligned
--       first; and
--   (2) an explicit boundary strategy, defined and reviewed then (for example a per-account sequence assigned under that lock, or a boundary captured in
--       the checkpoint itself).
-- No reconciliation rule or formula is defined or implied by this table.
--
-- Forward-only and safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

-- Lets entries reference (id, user_id). id is already the primary key, so this index is trivially unique and cannot fail on existing data.
create unique index if not exists payment_accounts_id_user_id_key on public.payment_accounts (id, user_id);

create table if not exists public.payment_account_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('interest', 'fee', 'adjustment', 'checkpoint')),
  -- magnitude of the charge/correction (0 for a checkpoint); the signed effect on the balance is balance_delta
  amount numeric(12, 2) not null check (amount >= 0 and amount <= 99999999.99),
  balance_delta numeric(12, 2) not null default 0 check (balance_delta between -99999999.99 and 99999999.99),
  -- whether balance_delta was applied to payment_accounts.balance (false only for interest/fee on a manual-mode account the user did not tick)
  balance_applied boolean not null default true,
  -- checkpoints only: the reconciled balance
  balance_after numeric(12, 2) check (balance_after is null or balance_after between -99999999.99 and 99999999.99),
  -- the day the charge/correction takes effect (user supplied) and, for interest and checkpoints, the statement it belongs to
  entry_date date not null,
  statement_date date,
  -- required for adjustments
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 500),
  note text check (note is null or char_length(note) <= 500),
  -- one client-generated key per submit intent: a repeated tap or retried request can never create a second row
  client_key uuid,
  -- a reversal STAMPS the row (history is never deleted); only the reversing function sets it, once
  reversed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  seq bigint generated always as identity,

  constraint payment_account_entries_account_owner_fk
    foreign key (account_id, user_id) references public.payment_accounts (id, user_id) on delete cascade,

  -- each kind has exactly one valid shape
  constraint payment_account_entries_kind_shape check (coalesce(
    case kind
      when 'interest' then amount > 0 and statement_date is not null and balance_after is null
                           and balance_delta = case when balance_applied then amount else 0 end
      when 'fee' then amount > 0 and balance_after is null
                      and balance_delta = case when balance_applied then amount else 0 end
      when 'adjustment' then amount > 0 and balance_applied and balance_delta <> 0 and abs(balance_delta) = amount
                             and balance_after is null and reason is not null
      when 'checkpoint' then amount = 0 and balance_delta = 0 and balance_applied
                             and balance_after is not null and statement_date is not null
    end, false)),
  -- a reconciliation point is never reversed
  constraint payment_account_entries_checkpoint_final check (kind <> 'checkpoint' or reversed_at is null)
);

-- duplicate prevention: a repeated submit (client_key) and one checkpoint per account and statement
create unique index if not exists payment_account_entries_client_key_idx
  on public.payment_account_entries (user_id, client_key) where client_key is not null;
create unique index if not exists payment_account_entries_checkpoint_per_statement_idx
  on public.payment_account_entries (account_id, statement_date) where kind = 'checkpoint';
-- reads and checkpoint ordering
create index if not exists payment_account_entries_account_created_idx
  on public.payment_account_entries (account_id, created_at desc, seq desc);

-- security: owner-scoped reads only; no client writes of any kind
alter table public.payment_account_entries enable row level security;

drop policy if exists "payment_account_entries_select_own" on public.payment_account_entries;
create policy "payment_account_entries_select_own" on public.payment_account_entries for select using (user_id = auth.uid());

revoke all on public.payment_account_entries from anon, authenticated;
grant select on public.payment_account_entries to authenticated;

-- defence in depth: a row is immutable except for stamping reversed_at once (not on a checkpoint)
create or replace function public.payment_account_entries_immutable()
returns trigger
language plpgsql
as $$
begin
  if (new.id, new.account_id, new.user_id, new.kind, new.amount, new.balance_delta, new.balance_applied, new.balance_after, new.entry_date,
      new.statement_date, new.reason, new.note, new.client_key, new.created_at, new.seq)
     is distinct from
     (old.id, old.account_id, old.user_id, old.kind, old.amount, old.balance_delta, old.balance_applied, old.balance_after, old.entry_date,
      old.statement_date, old.reason, old.note, old.client_key, old.created_at, old.seq) then
    raise exception 'Ledger entries cannot be edited';
  end if;
  if old.reversed_at is not null and new.reversed_at is distinct from old.reversed_at then
    raise exception 'This entry has already been reversed';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_payment_account_entries_immutable on public.payment_account_entries;
create trigger trg_payment_account_entries_immutable
  before update on public.payment_account_entries
  for each row execute function public.payment_account_entries_immutable();

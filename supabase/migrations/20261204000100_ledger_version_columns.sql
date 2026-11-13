-- FIN-02.2 Step 4C.1: the per-account ledger version columns (SCHEMA ONLY).
--
-- WHAT THIS ADDS: a version counter on each payment account, and nullable version stamps on every ledger row, so that a later step can define checkpoint
-- boundaries deterministically. The planned design (FIN-02.2 Step 4C): every operation that writes a ledger row or changes the balance already holds the
-- account row lock; later migrations will make each one bump payment_accounts.ledger_version under that lock and stamp the row it writes with the new value
-- (ledger_version) and, when it reverses a row, stamp that row's reversed_version. A checkpoint's boundary is then a version number: rows stamped above it
-- are post-checkpoint, rows stamped at or below it (and legacy rows, which have no stamp) are covered by the checkpoint's reconciled balance. Versions come
-- from one counter under one lock, so unlike timestamps or per-table sequences they cannot tie, go backwards, or differ between tables.
--
-- THIS MIGRATION DOES NOT USE THE COLUMNS. Nothing increments, stamps, reads or interprets them yet. It does not backfill any row, create opening
-- checkpoints, change any balance or existing transaction data, touch record_payment / reverse_payment / confirm_payment_goal_completion, or change any RLS
-- policy, grant, index or existing constraint. Existing rows simply read NULL (rows) or 0 (accounts): NULL on a row means "legacy: recorded before versioning".
--
-- VALUE RULES (constraints, added as separate ALTER TABLE ... ADD CONSTRAINT ... CHECK statements after the columns exist):
--   payment_accounts.ledger_version        bigint NOT NULL DEFAULT 0, >= 0      0 = no versioned operation has happened yet; the first one produces 1.
--   <ledger tables>.ledger_version         bigint NULL, > 0 when set            the version the row was written at (NULL = legacy).
--   <ledger tables>.reversed_version       bigint NULL, > 0 when set            the version the row was reversed at. It may only be set on a row that has
--                                                                               reversed_at, and must be greater than the row's own ledger_version when both are set.
--   A legacy row (ledger_version NULL) may later be reversed with a reversed_version; a row reversed before versioning has reversed_at but NULL reversed_version.
--
-- RUN ONCE: this migration is intended to be applied exactly once, through the Supabase migration process. The ADD COLUMN IF NOT EXISTS statements would be
-- harmless on a second run, but the ADD CONSTRAINT statements are NOT idempotent and would fail with "constraint already exists" (nothing would change).
-- It is data-preserving: every existing row satisfies every new constraint, because the new row columns are NULL and the account column is 0.
--
-- NOTE for the follow-up steps: payment_accounts keeps its owner UPDATE policy for now, so an owner could still write ledger_version directly. That is
-- harmless while nothing reads it, and the planned trigger that blocks direct client edits of balance must cover ledger_version too before it is relied on.
-- The immutability trigger on payment_account_entries does not yet list the two new columns; it must be extended when the entry functions are added.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query (once), or through the Supabase migration tooling. NOT applied by the app or by CI.

-- 1. the columns (no inline constraints)
alter table public.payment_accounts
  add column if not exists ledger_version bigint not null default 0;

alter table public.payment_transactions
  add column if not exists ledger_version bigint,
  add column if not exists reversed_version bigint;

alter table public.payment_account_entries
  add column if not exists ledger_version bigint,
  add column if not exists reversed_version bigint;

-- 2. the constraints, as separate statements
alter table public.payment_accounts
  add constraint payment_accounts_ledger_version_nonneg check (ledger_version >= 0);

alter table public.payment_transactions
  add constraint payment_transactions_ledger_version_positive check (ledger_version is null or ledger_version > 0);

alter table public.payment_transactions
  add constraint payment_transactions_reversed_version_valid check (
    reversed_version is null
    or (reversed_version > 0 and reversed_at is not null and (ledger_version is null or reversed_version > ledger_version)));

alter table public.payment_account_entries
  add constraint payment_account_entries_ledger_version_positive check (ledger_version is null or ledger_version > 0);

alter table public.payment_account_entries
  add constraint payment_account_entries_reversed_version_valid check (
    reversed_version is null
    or (reversed_version > 0 and reversed_at is not null and (ledger_version is null or reversed_version > ledger_version)));

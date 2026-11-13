-- FIN-02.2 Hardening A: make payment_transactions writable only through the payment functions, and give it an ordering timestamp.
--
-- Verified in Production before this migration: 6 payment accounts and 7 transactions; no transaction sits on someone else's account; none lacks both a
-- goal and a client key; payment_transactions has no created_at; both client roles (anon, authenticated) hold table-level write privileges; and the
-- RLS policy "payment_transactions_insert_own" lets any signed-in user insert ledger rows directly, with any amount, balance_applied, reversed_at or
-- client_key. The application never does this (its only access is a SELECT in getPaymentTransactions): every row is written by record_payment(),
-- reverse_payment() or confirm_payment_goal_completion(), which are SECURITY DEFINER and owned by postgres, so they keep working without client
-- privileges. The foreign-key actions (cascade on account deletion, set null on a deleted goal) run as the table owner and are unaffected too.
--
-- WHAT THIS CHANGES (and nothing else):
--   1. Adds a NULLABLE created_at column WITHOUT backfilling: the 7 existing rows stay NULL, which later means "before the first reconciliation
--      checkpoint". Its default is set separately so that adding the column does not rewrite or timestamp existing rows. Future inserts get
--      clock_timestamp() (the actual insert moment, not the transaction start), so they can be ordered against a checkpoint.
--   2. Drops the insert policy "payment_transactions_insert_own".
--   3. Revokes INSERT, UPDATE, DELETE and TRUNCATE on the table from anon and authenticated. SELECT and the select_own policy stay, so the History
--      list is unchanged. No function, grant on a function, balance logic, FIN-01 lock or FIN-02.1 validation is touched.
--
-- ROLLBACK (only if something unexpected needs direct writes; created_at may simply stay):
--   grant insert, update, delete, truncate on public.payment_transactions to anon, authenticated;
--   create policy "payment_transactions_insert_own" on public.payment_transactions for insert with check (user_id = auth.uid());
--   -- optional: alter table public.payment_transactions drop column created_at;
--
-- Forward-only and safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

alter table public.payment_transactions add column if not exists created_at timestamptz;
alter table public.payment_transactions alter column created_at set default clock_timestamp();

drop policy if exists "payment_transactions_insert_own" on public.payment_transactions;

revoke insert, update, delete, truncate on public.payment_transactions from anon, authenticated;

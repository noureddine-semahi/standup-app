-- FIN-02.2 Step 4C.2A: stop clients from writing payment_accounts.ledger_version (and any other column they have no reason to write) directly.
--
-- CURRENT STATE (from the migrations; the live grants are to be confirmed with the verification query that accompanies this file):
--   * payment_accounts has owner-only RLS policies for SELECT, INSERT, UPDATE and DELETE (20260930001900), no trigger, and no GRANT/REVOKE anywhere in the
--     repository, so the table-level privileges are Supabase's defaults: INSERT and UPDATE on EVERY column for anon and authenticated.
--   * RLS decides which ROWS a user may touch; it says nothing about COLUMNS. So an owner can UPDATE or INSERT payment_accounts.ledger_version (the Step 4C.1
--     counter) directly, exactly as they can UPDATE balance today.
--
-- WHY COLUMN PRIVILEGES: a column-level REVOKE does nothing while a table-level UPDATE/INSERT grant exists, so the table-level privilege is revoked first and
-- only the columns clients legitimately write are granted back. This is enforced by PostgreSQL's privilege check before any row is considered, it does not depend
-- on RLS, on a trigger, or on current_user inside a SECURITY DEFINER function, and a column added later is NOT client-writable until a migration grants it.
--
-- THE COLUMNS GRANTED BACK are exactly the ones the application writes (src/lib/supabase/db.ts):
--   INSERT (createPaymentAccount):   user_id, name, balance, minimum_payment, due_day, remind_days_before, balance_mode
--   UPDATE (updatePaymentAccount and addGoalFromPaymentReminder):
--                                    name, balance, minimum_payment, due_day, remind_days_before, last_reminder_due_date, balance_mode
-- NOT granted to clients any more: ledger_version (INSERT and UPDATE), and for UPDATE also id, user_id and created_at (no client ever changes them).
-- SELECT, DELETE, the RLS policies and every other privilege are untouched. anon loses INSERT/UPDATE it never legitimately used (RLS already blocked it).
--
-- TRUSTED WRITERS ARE UNAFFECTED: record_payment(), reverse_payment() and confirm_payment_goal_completion() are SECURITY DEFINER and owned by postgres, which
-- owns the table, so they run with the owner's privileges and can update balance today and ledger_version in the next steps under the account lock. service_role
-- is untouched.
--
-- balance is deliberately STILL client-writable here (the account form edits it today). A later step replaces that with a reasoned adjustment function and then
-- removes balance from the UPDATE list below; with column privileges that is a one-line change.
--
-- WHAT STATIC TESTS CANNOT PROVE: that the live privileges end up as described, that PostgREST's insert/update/RETURNING calls keep working with column-level
-- privileges, and that the definer functions still write. Those need the live verification that accompanies this migration.
--
-- Permission statements only: no data, balance, row, function, policy, trigger or schema change. Idempotent (REVOKE and GRANT can be repeated).
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

revoke insert, update on public.payment_accounts from anon, authenticated;

grant insert (user_id, name, balance, minimum_payment, due_day, remind_days_before, balance_mode)
  on public.payment_accounts to authenticated;

grant update (name, balance, minimum_payment, due_day, remind_days_before, last_reminder_due_date, balance_mode)
  on public.payment_accounts to authenticated;

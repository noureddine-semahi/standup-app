-- FIN-02.2 security cleanup: anon must not be able to EXECUTE the payment functions.
--
-- Supabase's default function privileges can leave anon with EXECUTE even after PUBLIC is revoked, and the migrations that created record_payment() and
-- confirm_payment_goal_completion() revoked only PUBLIC. Both functions already reject unauthenticated callers, so this was low risk, but anon has no use
-- for them. This statement set was already applied and verified in Production; this file only brings the repository in line with that state.
--
-- ONLY these two permission changes. No function body, security setting, grant to authenticated, table or data is touched. Idempotent and safe to re-run.
-- (reverse_payment() already carries the same revoke in 20261202000100_reverse_payment_lock_order.sql.)
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.

revoke execute on function public.record_payment(uuid, numeric, timestamptz, text, boolean, uuid) from anon;

revoke execute on function public.confirm_payment_goal_completion(uuid, numeric) from anon;

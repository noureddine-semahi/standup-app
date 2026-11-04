-- Finances hub, phase 1: a real "Record Payment" workflow for payment
-- accounts, with an explicit per-account balance policy, notes, reversal
-- (never deletion) and duplicate-submission protection.
--
-- ADDITIVE ONLY: no table/column is dropped or renamed, no existing row is
-- rewritten except by the defaults noted below. Safe to re-run.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the
-- app or by CI -- the Finances > Payments "Record Payment" / "Reverse"
-- actions and the balance-mode switch will error until this has been run.
--
-- BALANCE POLICY (payment_accounts.balance_mode)
--   'auto'   : recorded payments AND confirmed payment-reminder goals
--              subtract from the stored balance (the behavior every existing
--              account already has, since confirm_payment_goal_completion has
--              always subtracted).
--   'manual' : the stored balance is never changed by a payment unless the
--              user explicitly ticks "also reduce balance" on that payment.
-- Existing accounts are grandfathered as 'auto' (their current behavior is
-- unchanged); accounts created after this migration default to 'manual'.
-- Switching an account's mode is always an explicit user action in the UI.

alter table public.payment_accounts
  add column if not exists balance_mode text not null default 'auto'
    check (balance_mode in ('auto', 'manual'));
-- Existing rows were just backfilled as 'auto'; new rows default to 'manual'.
alter table public.payment_accounts alter column balance_mode set default 'manual';

-- Ledger additions. Existing rows keep balance_applied = true, which is
-- accurate: every pre-existing ledger row subtracted from its balance.
alter table public.payment_transactions
  add column if not exists note text check (note is null or char_length(note) <= 500),
  add column if not exists balance_applied boolean not null default true,
  add column if not exists reversed_at timestamptz,
  add column if not exists client_key uuid;

-- One client-generated key per "submit" intent: a repeated tap or a retried
-- request carrying the same key can never create a second row.
create unique index if not exists payment_transactions_client_key_idx
  on public.payment_transactions (user_id, client_key) where client_key is not null;

-- The ledger stays insert-only for clients (no update/delete policy). Both
-- functions below are SECURITY DEFINER, scope every statement to auth.uid(),
-- and are the only way a row is created (new payments) or marked reversed.

-- Records one payment (full, partial, multiple per cycle, or historical) and,
-- when the account's policy says so, applies it to the balance -- in a single
-- statement-level transaction, so the ledger row and balance can't diverge.
create or replace function public.record_payment(
  p_account_id uuid,
  p_amount numeric,
  p_paid_at timestamptz,
  p_note text,
  p_apply_balance boolean,
  p_client_key uuid
)
returns table (transaction_id uuid, new_balance numeric, was_duplicate boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_mode text;
  v_balance numeric;
  v_existing uuid;
  v_txn uuid;
  v_apply boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if p_amount <> round(p_amount, 2) or p_amount > 99999999.99 then
    raise exception 'Payment amount must be a valid amount with at most 2 decimal places';
  end if;

  -- Lock the account first so two concurrent submits with the same key
  -- serialize here and the second one sees the first's row.
  select a.balance_mode, a.balance into v_mode, v_balance
    from public.payment_accounts a
    where a.id = p_account_id and a.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Account not found';
  end if;

  if p_client_key is not null then
    select t.id into v_existing
      from public.payment_transactions t
      where t.user_id = auth.uid() and t.client_key = p_client_key;
    if found then
      return query select v_existing, v_balance, true;
      return;
    end if;
  end if;

  v_apply := (v_mode = 'auto') or coalesce(p_apply_balance, false);

  insert into public.payment_transactions (account_id, user_id, amount, paid_at, note, balance_applied, client_key)
  values (p_account_id, auth.uid(), p_amount, coalesce(p_paid_at, now()), nullif(btrim(p_note), ''), v_apply, p_client_key)
  returning id into v_txn;

  if v_apply then
    update public.payment_accounts a set balance = a.balance - p_amount
      where a.id = p_account_id and a.user_id = auth.uid()
      returning a.balance into v_balance;
  end if;

  return query select v_txn, v_balance, false;
end;
$$;
revoke all on function public.record_payment(uuid, numeric, timestamptz, text, boolean, uuid) from public;
grant execute on function public.record_payment(uuid, numeric, timestamptz, text, boolean, uuid) to authenticated;

-- Reverses one payment: the row is KEPT and stamped reversed_at (history is
-- never deleted), and the amount is added back ONLY if that payment actually
-- reduced the balance (balance_applied). The row lock + reversed_at check
-- make a second reversal impossible, so the balance can't be restored twice.
create or replace function public.reverse_payment(p_transaction_id uuid)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid;
  v_amount numeric;
  v_applied boolean;
  v_reversed timestamptz;
  v_balance numeric;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select t.account_id, t.amount, t.balance_applied, t.reversed_at
    into v_account, v_amount, v_applied, v_reversed
    from public.payment_transactions t
    where t.id = p_transaction_id and t.user_id = auth.uid()
    for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if v_reversed is not null then
    raise exception 'This payment has already been reversed';
  end if;

  update public.payment_transactions set reversed_at = now() where id = p_transaction_id;

  if v_applied then
    update public.payment_accounts a set balance = a.balance + v_amount
      where a.id = v_account and a.user_id = auth.uid()
      returning a.balance into v_balance;
  else
    select a.balance into v_balance from public.payment_accounts a
      where a.id = v_account and a.user_id = auth.uid();
  end if;

  return v_balance;
end;
$$;
revoke all on function public.reverse_payment(uuid) from public;
grant execute on function public.reverse_payment(uuid) to authenticated;

-- Re-create the goal-confirmation function so it honors balance_mode. For
-- every existing account (all 'auto') behavior is identical to before; a
-- 'manual' account's ledger row is written with balance_applied = false and
-- its balance is left alone. Everything else (trigger bypass flag, double-
-- confirm guard, zero-or-positive check) is carried over unchanged.
create or replace function public.confirm_payment_goal_completion(p_goal_id uuid, p_amount numeric)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_already_completed boolean;
  v_mode text;
  v_new_balance numeric;
begin
  if p_amount < 0 then
    raise exception 'Amount must be zero or positive';
  end if;

  select source_payment_account_id, status = 'completed'
    into v_account_id, v_already_completed
    from public.goals where id = p_goal_id and user_id = auth.uid();

  if v_account_id is null then
    raise exception 'This goal is not linked to a payment account';
  end if;

  if v_already_completed then
    raise exception 'This payment has already been confirmed for this Task.';
  end if;

  select balance_mode into v_mode from public.payment_accounts
    where id = v_account_id and user_id = auth.uid();

  perform set_config('app.allow_payment_goal_complete', 'true', true);
  update public.goals set status = 'completed' where id = p_goal_id and user_id = auth.uid();

  insert into public.payment_transactions (account_id, user_id, goal_id, amount, balance_applied)
  values (v_account_id, auth.uid(), p_goal_id, p_amount, coalesce(v_mode, 'auto') = 'auto');

  if coalesce(v_mode, 'auto') = 'auto' then
    update public.payment_accounts set balance = balance - p_amount
      where id = v_account_id and user_id = auth.uid()
      returning balance into v_new_balance;
  else
    select balance into v_new_balance from public.payment_accounts
      where id = v_account_id and user_id = auth.uid();
  end if;

  return v_new_balance;
end;
$$;
revoke all on function public.confirm_payment_goal_completion(uuid, numeric) from public;
grant execute on function public.confirm_payment_goal_completion(uuid, numeric) to authenticated;

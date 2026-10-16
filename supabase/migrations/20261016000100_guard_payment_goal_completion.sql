-- Bug fix: a payment-linked goal (goals.source_payment_account_id set)
-- could be marked "completed" through ANY plain status update -- Today's
-- page is the only UI that checks for this client-side before calling
-- updateGoalStatus(); every other caller (the Dashboard's broken-lineage
-- resolver, the Dashboard assistant's update_goal_status tool, and any
-- future caller) just ran a plain `update goals set status = 'completed'`,
-- silently skipping confirm_payment_goal_completion() entirely -- no
-- amount-paid prompt, no payment_transactions row, no balance update.
--
-- Fixed at the database layer so it's enforced regardless of which
-- client-side code path reaches it: a BEFORE UPDATE trigger on goals
-- rejects any transition into 'completed' for a payment-linked goal
-- unless the current transaction has explicitly opted in via a
-- transaction-local flag -- which only confirm_payment_goal_completion()
-- itself sets, immediately before its own update, so it's the only path
-- that can ever complete a payment-linked goal.
--
-- Also hardens confirm_payment_goal_completion() itself against being
-- invoked twice for the same already-completed goal (double-deduction
-- protection) -- it previously had no such check.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query.

create or replace function public.guard_payment_goal_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.source_payment_account_id is not null
     and coalesce(current_setting('app.allow_payment_goal_complete', true), '') <> 'true'
  then
    raise exception 'This Task is linked to a saved Payment -- confirm the amount paid before completing it.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_payment_goal_completion on public.goals;
create trigger trg_guard_payment_goal_completion
  before update on public.goals
  for each row execute function public.guard_payment_goal_completion();

-- Re-create confirm_payment_goal_completion with the two fixes: it now
-- flips the trigger-bypass flag (transaction-scoped, so it can never leak
-- into any other statement) before its own update, and refuses to run
-- again against a goal that's already completed.
create or replace function public.confirm_payment_goal_completion(p_goal_id uuid, p_amount numeric)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_already_completed boolean;
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

  perform set_config('app.allow_payment_goal_complete', 'true', true);
  update public.goals set status = 'completed' where id = p_goal_id and user_id = auth.uid();

  insert into public.payment_transactions (account_id, user_id, goal_id, amount)
  values (v_account_id, auth.uid(), p_goal_id, p_amount);

  update public.payment_accounts set balance = balance - p_amount
    where id = v_account_id and user_id = auth.uid()
    returning balance into v_new_balance;

  return v_new_balance;
end;
$$;
revoke all on function public.confirm_payment_goal_completion(uuid, numeric) from public;
grant execute on function public.confirm_payment_goal_completion(uuid, numeric) to authenticated;

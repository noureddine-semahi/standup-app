-- Finance > Subscriptions > "Unsubscribe Me": cancellation requests and outcomes.
-- Additive. Requires 20261105000100_finance_subscriptions.sql.
--
-- Honesty model (enforced here, not just in the UI):
--   * 'provider_confirmed' means a provider acknowledged the cancellation through an
--     authorized integration. No such integration exists yet, so NOTHING a signed-in
--     client can call is able to write that status or the 'automatic' mode; the table
--     has no client write policies and the RPC below only accepts 'assisted'/'manual'
--     with 'in_progress' / 'user_reported' / 'failed'.
--   * 'user_reported' is exactly that: the user says they canceled. It is never shown
--     as provider-confirmed.
--   * Provider passwords are never requested or stored; there is no column for them.
--   * Rows are history: they are never updated away or deleted by the client, and
--     canceling a subscription keeps its payment history.

alter table public.subscriptions
  add column if not exists cancel_url text
    check (cancel_url is null or (cancel_url ~* '^https://[^@\s]+$' and char_length(cancel_url) <= 500));

create table if not exists public.subscription_cancellations (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('automatic', 'assisted', 'manual')),
  status text not null check (status in ('in_progress', 'user_reported', 'provider_confirmed', 'failed')),
  requested_at timestamptz not null default now(),
  -- the day the cancellation happened (user-reported) or was acknowledged (provider-confirmed)
  completed_on date,
  -- the https page the user was sent to, when the assisted flow was used
  guide_url text check (guide_url is null or (guide_url ~* '^https://[^@\s]+$' and char_length(guide_url) <= 500)),
  -- an identifier from the provider's acknowledgment (reserved for authorized integrations)
  provider_reference text check (provider_reference is null or char_length(provider_reference) <= 200),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_cancellations_reported_has_date check (status not in ('user_reported', 'provider_confirmed') or completed_on is not null),
  constraint subscription_cancellations_confirmed_is_automatic check (status <> 'provider_confirmed' or (mode = 'automatic' and provider_reference is not null)),
  constraint subscription_cancellations_manual_is_reported check (mode <> 'manual' or status in ('user_reported', 'failed'))
);

create index if not exists subscription_cancellations_sub_idx
  on public.subscription_cancellations (subscription_id, requested_at desc);

drop trigger if exists subscription_cancellations_touch on public.subscription_cancellations;
create trigger subscription_cancellations_touch
  before update on public.subscription_cancellations
  for each row execute function public.touch_subscription_updated_at();

alter table public.subscription_cancellations enable row level security;

-- Read-only for clients: every write goes through record_subscription_cancellation.
drop policy if exists "subscription_cancellations_select_own" on public.subscription_cancellations;
create policy "subscription_cancellations_select_own"
  on public.subscription_cancellations for select using (auth.uid() = user_id);

-- ── Record / resolve a cancellation request ───────────────────────────────
-- p_request_id null  -> start a new row.
-- p_request_id given -> resolve that user's own 'in_progress' row (assisted flow).
-- Outcome 'user_reported' also marks the subscription canceled in StandUp (the record
-- and its payments are kept) in the same transaction, so the two can't disagree.
create or replace function public.record_subscription_cancellation(
  p_subscription_id uuid,
  p_mode text,
  p_status text,
  p_request_id uuid default null,
  p_completed_on date default null,
  p_guide_url text default null,
  p_error text default null,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_existing record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_mode not in ('assisted', 'manual') then
    raise exception 'Automatic cancellation is not available';
  end if;
  if p_status not in ('in_progress', 'user_reported', 'failed') then
    raise exception 'Invalid cancellation status';
  end if;
  if p_status = 'in_progress' and (p_mode <> 'assisted' or p_request_id is not null) then
    raise exception 'Only a new assisted request can be in progress';
  end if;
  if p_status = 'user_reported' and (p_completed_on is null or p_completed_on > current_date + 1) then
    raise exception 'A reported cancellation needs a date that is not in the future';
  end if;

  perform 1 from public.subscriptions s where s.id = p_subscription_id and s.user_id = auth.uid() for update;
  if not found then
    raise exception 'Subscription not found';
  end if;

  if p_request_id is null then
    insert into public.subscription_cancellations
      (subscription_id, user_id, mode, status, completed_on, guide_url, error_message, note)
    values
      (p_subscription_id, auth.uid(), p_mode, p_status, p_completed_on, p_guide_url,
       nullif(btrim(p_error), ''), nullif(btrim(p_note), ''))
    returning id into v_id;
  else
    select * into v_existing from public.subscription_cancellations
      where id = p_request_id and user_id = auth.uid() and subscription_id = p_subscription_id
      for update;
    if not found then
      raise exception 'Cancellation request not found';
    end if;
    if v_existing.status <> 'in_progress' then
      raise exception 'This cancellation request was already resolved';
    end if;
    update public.subscription_cancellations
       set status = p_status,
           completed_on = p_completed_on,
           error_message = nullif(btrim(p_error), ''),
           note = coalesce(nullif(btrim(p_note), ''), v_existing.note)
     where id = p_request_id
    returning id into v_id;
  end if;

  if p_status = 'user_reported' then
    update public.subscriptions
       set status = 'canceled', canceled_at = coalesce(canceled_at, now())
     where id = p_subscription_id and user_id = auth.uid();
  end if;

  return v_id;
end;
$$;
revoke all on function public.record_subscription_cancellation(uuid, text, text, uuid, date, text, text, text) from public;
grant execute on function public.record_subscription_cancellation(uuid, text, text, uuid, date, text, text, text) to authenticated;

-- Phase 5.5: persistent deduplication of Stripe webhook events. FOUNDATION ONLY.
--
-- ADDITIVE ONLY. One new table and three functions. It changes no existing table, policy or function, and nothing here reads or writes
-- entitlements, trials, billing rows or any user data: it only remembers which Stripe event IDs have been received and how processing went.
-- Safe to re-run. Run in Supabase Dashboard -> SQL Editor -> New query. NOT applied by the app or by CI.
--
-- SERVER-ONLY: browsers can never touch this. RLS is on with NO policies, every privilege is revoked from anon and authenticated, and the
-- three functions are executable by the service role ONLY (the webhook endpoint's privileged server connection).
--
-- HOW A DELIVERY IS HANDLED (claim_stripe_event is one atomic statement, so concurrent deliveries of the same event cannot both win):
--   first time seen                               -> 'claimed'      (the caller processes it, then calls complete_ or fail_)
--   already processed                             -> 'duplicate'    (acknowledge, do nothing)
--   being processed right now (claimed < 5 min)   -> 'in_progress'  (the caller answers "retry later"; Stripe re-delivers)
--   earlier attempt failed                        -> 'claimed'      (retry after a processing failure)
--   a claim older than 5 minutes (a crashed run)  -> 'claimed'      (the lease expired, so it can be retried)

create table if not exists public.stripe_webhook_events (
  event_id text primary key check (event_id like 'evt\_%'),
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  -- a short machine code such as 'handler_error', never an error message, payload or customer data
  last_error text check (last_error is null or char_length(last_error) <= 100)
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;

create or replace function public.claim_stripe_event(p_event_id text, p_event_type text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
begin
  insert into public.stripe_webhook_events as e (event_id, event_type, status, attempts, claimed_at)
  values (p_event_id, p_event_type, 'processing', 1, now())
  on conflict (event_id) do update
    set status = 'processing', attempts = e.attempts + 1, claimed_at = now(), event_type = excluded.event_type, last_error = null
    where e.status = 'failed' or (e.status = 'processing' and e.claimed_at < now() - interval '5 minutes');
  if found then
    return 'claimed';
  end if;

  select status into v_status from public.stripe_webhook_events where event_id = p_event_id;
  return case when v_status = 'processed' then 'duplicate' else 'in_progress' end;
end;
$$;

create or replace function public.complete_stripe_event(p_event_id text)
returns void
language sql
security definer set search_path = public
as $$
  update public.stripe_webhook_events
  set status = 'processed', processed_at = now(), last_error = null
  where event_id = p_event_id and status = 'processing';
$$;

create or replace function public.fail_stripe_event(p_event_id text, p_error text)
returns void
language sql
security definer set search_path = public
as $$
  update public.stripe_webhook_events
  set status = 'failed', last_error = left(coalesce(p_error, 'error'), 100)
  where event_id = p_event_id and status = 'processing';
$$;

revoke all on function public.claim_stripe_event(text, text) from public, anon, authenticated;
revoke all on function public.complete_stripe_event(text) from public, anon, authenticated;
revoke all on function public.fail_stripe_event(text, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text) to service_role;
grant execute on function public.complete_stripe_event(text) to service_role;
grant execute on function public.fail_stripe_event(text, text) to service_role;

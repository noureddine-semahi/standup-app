# Stripe billing setup (Phase 5.1: foundation only)

This phase prepares StandUp for Stripe subscriptions. It adds the server-side SDK, validated configuration and a place to keep Stripe's
identifiers. It does **not** add checkout, webhooks, a customer portal or any way to become Premium by paying. The 14-day trial and the
existing entitlement rules are unchanged, and the Settings screen is unchanged (it still says paid subscriptions aren't available yet).

## Plans

| Plan    | Price  | Stripe Price                              |
| ------- | ------ | ----------------------------------------- |
| Monthly | $5.99  | recurring, every 1 month, USD, $5.99      |
| Annual  | $49.99 | recurring, every 1 year, USD, $49.99      |

The in-app prices come from `PRICING` in `src/lib/entitlements.ts`; `src/lib/billing/plans.ts` maps the same amounts to the two plans.

## Environment variables (server only)

Set these in `.env.local` for local work and in the Vercel project settings (Preview/Development) for deployed test builds.
**Never** prefix them with `NEXT_PUBLIC_`, and never commit them. A test fails if any Stripe variable is read outside `src/lib/billing`
or given a `NEXT_PUBLIC_` name.

| Variable                | Required | Value                                                                   |
| ----------------------- | -------- | ----------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | yes      | A **test-mode** secret key: `sk_test_...` (or restricted `rk_test_...`) |
| `STRIPE_PRICE_MONTHLY`  | yes      | Test-mode Price ID for the $5.99 monthly plan: `price_...`              |
| `STRIPE_PRICE_ANNUAL`   | yes      | Test-mode Price ID for the $49.99 annual plan: `price_...`              |
| `STRIPE_WEBHOOK_SECRET` | not yet  | `whsec_...`; only needed when webhooks are added                        |

Live keys (`sk_live_...`, `rk_live_...`) are **rejected** by the configuration code on purpose. Do not put production keys anywhere yet.

## One-time setup in Stripe (test mode)

1. In the Stripe Dashboard, switch to **Test mode**.
2. Products > Add product > "StandUp Premium".
3. Add two recurring prices in USD: **$5.99 every month** and **$49.99 every year**.
4. Copy each Price ID (`price_...`) into `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`.
5. Developers > API keys > copy the **test** secret key into `STRIPE_SECRET_KEY`.
6. Do not create a webhook endpoint yet; that belongs to the next phase.

Do not add a Stripe free trial to either price: the 14-day trial is StandUp's own and is already implemented.

## Database

Run `supabase/migrations/20261116000100_account_billing.sql` once in the Supabase SQL Editor. It adds `public.account_billing`
(Stripe customer, subscription and price IDs, plan, status, period end), one row per account. It is additive and safe to re-run, and
changes nothing about entitlements or the trial. Browsers cannot read or write it (RLS on, no policies, privileges revoked); only the
server's service role can, and nothing uses it yet.

## Code

- `src/lib/billing/plans.ts`: the two plans and their prices (safe anywhere; no secrets).
- `src/lib/billing/config.ts`: validates the environment; refuses live keys; errors name variables, never values. Server-only.
- `src/lib/billing/stripe.ts`: lazy server-side Stripe client. Server-only. Importing it from a client component fails the build.

## Next phases (not done)

Checkout session creation, webhook handling that turns an active subscription into a Premium entitlement, and the customer portal.

## Checkout endpoint (Phase 5.4: sandbox, blocked during the beta)

`POST /api/billing/checkout` creates a Stripe Checkout session (subscription mode, test mode) for the signed-in user.

- **Request:** headers `Authorization: Bearer <Supabase access token>` and a trusted `Origin`; JSON body `{ "plan": "monthly" | "annual" }`. Nothing
  else is accepted: any extra field (a price, amount, customer or redirect URL) is rejected.
- **Response:** `200 { "url": "https://checkout.stripe.com/..." }`, or `{ "error": code }`: `403 forbidden_origin`, `401 unauthenticated`,
  `403 checkout_disabled`, `400 invalid_request`, `503 billing_unavailable`, `502 checkout_failed`.
- **Blocked in the beta:** it requires **both** `billing_checkout_enabled` and `premium_promotion_enabled` (see `docs/feature-flags.md`). All flags are off, so every
  request is refused with `checkout_disabled` before Stripe is contacted.
- **Redirects:** built on the server from the request's `Origin`, only if it is trusted (the production origin; localhost outside production; plus any
  origins listed in `BILLING_TRUSTED_ORIGINS`, comma-separated, https only), with fixed paths `/standup/settings?checkout=success|cancelled`.
- **Retries:** a repeat of the same request within 5 minutes reuses the same Stripe idempotency key, so Stripe returns the same session.
- **Grants nothing:** creating a session changes no entitlement. Turning a paid subscription into Premium belongs to the webhook phase.

## Webhook endpoint (Phase 5.5: verification and deduplication only)

`POST /api/stripe/webhook`: `https://standup-app-two.vercel.app/api/stripe/webhook`

It **verifies, deduplicates and records** Stripe events. It does **not** grant or revoke Premium, sync subscriptions or change any trial, billing
record or account yet (the handlers are placeholders for the next phase). Checkout stays disabled by the feature flags.

- **Signature:** verified against the raw request body with `STRIPE_WEBHOOK_SECRET`. Missing, malformed, wrong, tampered or replayed (older than 5 minutes)
  signatures get `400`; a missing or invalid webhook configuration gets `503`. Live-mode events are rejected (sandbox only).
- **Supported events** (acknowledged and recorded): `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Any other verified event gets `200`
  with nothing stored or changed.
- **Deduplication:** each event ID is claimed atomically in `public.stripe_webhook_events`. A duplicate gets `200 { duplicate: true }`; a delivery that arrives while the
  first is still processing gets `409` (Stripe retries); a failed event is re-claimed on Stripe's retry; a claim left by a crashed run expires after 5 minutes.
- **Logs:** event ID, type and outcome only.

### Setup (one time)
1. Run `supabase/migrations/20261118000100_stripe_webhook_events.sql` in the Supabase SQL Editor (a table plus three functions, executable by the service role only).
2. Add the server-only variable **`SUPABASE_SERVICE_ROLE_KEY`** (Supabase > Project Settings > API) to `.env.local` and to Vercel. It is used only by the
   webhook's event ledger. Never prefix it `NEXT_PUBLIC_`.
3. Stripe Dashboard (**test mode**) > Developers > Webhooks > Add endpoint: URL above; select the six events listed; copy the signing secret
   (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` (`.env.local` and Vercel).
4. Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints a temporary `whsec_...` to use in `.env.local`.

Until steps 1 and 2 are done the endpoint answers `503` and Stripe simply retries; nothing is lost or changed.

## Subscription-to-account mapping (Phase 5.6 step 1: billing records only)

Verified webhook events now record each subscription in `public.account_billing` (customer, subscription and price IDs, plan, status, billing
period, cancel/end timestamps). **Premium is not activated or revoked by this step**, and entitlements, trials and admin grants are untouched:
turning a verified billing record into an entitlement is the next step. Checkout and the beta flags are unchanged.

- **Source of truth:** the event only says *which* subscription changed; the handler then fetches that subscription from Stripe and records
  its current state, so duplicate and out-of-order events converge on the latest state. Every write carries its fetch time and the
  database refuses an older snapshot (`stale`).
- **Plan:** taken from the Price ID, matched against `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`. Metadata or anything a browser sent is never used for the plan.
  A subscription on any other Price, or in live mode, is ignored.
- **Account:** an existing billing record always wins; otherwise the account comes from the Checkout metadata set by our own server
  (`client_reference_id` / `metadata.user_id`) and must be a real account. Contradictory hints, a subscription or customer claimed by two accounts, an account tied to a different
  customer, or a second live subscription change nothing (`ownership_conflict` / `subscription_conflict`; logged, not retried).
- **Needs in Vercel Production:** `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL` (and `STRIPE_SECRET_KEY`) in addition to the webhook variables; without them a subscription event fails
  and Stripe retries it until they are set.
- **Migration:** run `supabase/migrations/20261119000100_billing_sync.sql` (new nullable columns + one service-role-only function).
- **Privacy policy (EN/ES)** now has a "Payments & billing" section describing exactly what is stored.

## Billing-derived Premium (Phase 5.6 step 3)

A verified Stripe subscription in `account_billing` grants Premium; it ends by itself. **Billing-derived Premium is computed, never stored**: nothing is
written to `account_entitlements` or trial history, so a Stripe event cannot overwrite a manual admin grant or a trial, and ending it needs no write.
Duplicate, out-of-order and concurrent events are already made safe by the billing sync (older snapshots are refused); the result is a pure function of the
stored billing record and the clock, so it is atomic and idempotent by construction.

**Precedence** (the first that applies): 1. manual admin grant (`account_entitlements.tier = 'premium'`), 2. billing-derived Premium, 3. an active one-time trial,
4. Free. A Stripe cancellation only ends rule 2.

**Billing status policy** (`current_period_end` = the end of the period already paid for):

| Stripe status | Premium? |
| --- | --- |
| `active`, `trialing` | Yes, while `now <= current_period_end + 3 days` (the 3 days only absorb a late renewal update) |
| `past_due` | **Grace:** yes until `current_period_end + 7 days`, then Free even if Stripe is still retrying. A temporary payment failure never revokes access immediately |
| `unpaid`, `canceled`, `incomplete`, `incomplete_expired`, `paused` | No |
| anything else (unknown/future) | No (fail closed) |

A subscription set to cancel at period end stays `active` (so Premium) until the period ends, then becomes `canceled`.

**On downgrade:** nothing is deleted or deactivated. The Free creation limits (3 active Goals, 3 active routines, 10 notes) apply to *new* creations and reactivations
only, exactly as when a trial ends. The one-time trial history is never touched, and a subscriber cannot start the one-time trial (`ALREADY_PREMIUM`).

**Migration:** run `supabase/migrations/20261120000100_billing_entitlements.sql` (functions only; no tables or rows change). It adds `billing_grants_premium` and
`account_effective_tier` (service-role only) and redefines `get_my_account_entitlement`, the three limit triggers, `start_my_premium_trial` and the two admin
entitlement functions to use the combined tier. The policy as readable code is in `src/lib/billingEntitlement.ts`.

**Checkout and promotion stay off:** the three beta flags are unchanged, so nobody can subscribe yet. The FAQ answer about plans appears only when promotion is on.

## Member-visible billing status (Phase 5.6 step 4)

Settings > Premium now has a read-only **Subscription** section (`src/components/BillingStatus.tsx`). It appears only when there is something to say: a subscription record, or Premium
granted by an admin. A plain Free account, or one on the free trial only, sees nothing extra (the trial card already covers it).

- **What it shows:** the plan (Monthly/Annual), the subscription's own status, the renewal or end date, whether it is set to cancel, whether *this subscription* currently gives Premium (On/Off),
  and, for a failed payment, the 7-day grace period and the date it ends (or ended).
- **Why they have Premium:** a separate line says whether Premium comes from the subscription, an admin grant or the free trial. The subscription is always described from its **own**
  status: having Premium from an admin grant or a trial never makes a canceled subscription look active. An unrecognised status reads "Status unavailable".
- **No actions:** no Checkout, cancel or portal buttons. No Stripe or account identifiers are ever returned or shown.
- **Data:** `get_my_billing_status()` (migration `20261121000100_billing_status.sql`): read-only, no parameters, answers only for the signed-in member, reuses
  `account_effective_tier` / `billing_grants_premium` (no policy of its own), and returns no identifiers. `account_billing` itself stays unreachable from browsers.
- Until the migration is applied the section simply doesn't appear.

## Duplicate-subscription protection (Phase 5.6 step 5)

`POST /api/billing/checkout` can no longer open a second paid subscription. The guard runs **after** the flags and body checks and **before** any Stripe session is created, so
with the beta flags off nothing changes (requests are still refused with `checkout_disabled`). It does not rely on the browser or on the billing record alone (which lags the webhook).

- **Existing subscription** → `409 already_subscribed`. A subscription blocks unless it is over for good: `active`, `trialing`, `past_due`, `unpaid`, `incomplete`, `paused` and any unknown
  status block; only `canceled` and `incomplete_expired` allow a new one. An admin Premium grant or the one-time StandUp trial are not subscriptions and never count.
- **Concurrent requests** → one request per member claims the single slot in `checkout_attempts` (an advisory lock plus a one-active-attempt-per-member unique index); the others get
  `409 checkout_in_progress` or continue the same checkout. A claim older than 2 minutes is stale and is re-adopted (same plan) so Stripe's idempotency key returns the same session.
- **An unfinished checkout** → Stripe is asked about the earlier session (it is the authority): still open and the same plan → the **same URL** is returned; open and the other plan → it is expired first
  so only one session can ever be paid; complete → `already_subscribed` if its subscription is live (paid but not yet synced), otherwise a new checkout may start; expired → a new one starts.
- **Idempotency** → the Stripe idempotency key is derived from the claimed attempt, never from the client.
- **If the attempt ledger is unavailable** the request fails with `503 billing_unavailable` and no session is created (no protection means no checkout).
- **Privacy:** the ledger holds only the member, the plan, a status, a Stripe session reference and times. Browsers can't read or write it, and no Stripe identifier is ever returned.
- **Migration:** run `supabase/migrations/20261122000100_checkout_attempts.sql` (one table, three service-role-only functions; touches nothing else). Needs `SUPABASE_SERVICE_ROLE_KEY` in the
  environment (already used by the webhook).
- **Messages:** `src/lib/checkoutMessages.ts` maps each refusal to an EN/ES message for the future Subscribe button; the FAQ answer appears only when promotion is on.

## Subscribe button and Checkout return (Phase 5.6 step 6)

Settings > Premium can now take a member to Stripe Checkout and back. **It is invisible during the beta**: the button needs BOTH `premium_promotion_enabled` and `billing_checkout_enabled`
(all flags are off). With only promotion on, the plans show with the "not available yet" note, exactly as before.

- **Subscribe** (`PremiumPlans`) uses the existing endpoint through one helper (`src/lib/startCheckout.ts`): it sends only the plan with the member's token and follows only a
  `https://checkout.stripe.com/` URL. The server re-checks the sign-in, both flags and the duplicate-subscription guard; hiding the button is a courtesy, never the protection. A member who
  already has a subscription isn't offered the button, and a refusal (`already_subscribed`, `checkout_in_progress`, disabled, failed) shows its EN/ES message and allows a retry.
- **Returning** (`CheckoutReturn`): `?checkout=success` is **never proof of payment** (anyone can type it). It shows "checking", then polls the member-scoped billing status the verified webhook
  fills in (every 4s, up to 15 times). Only when THIS SUBSCRIPTION gives Premium does it say "confirmed" (and refreshes the plan). A payment still being completed says so; if nothing arrives
  it says "we haven't received confirmation yet" with a **Check again** button. Premium from an admin grant or a trial is never mistaken for a confirmed payment.
  `?checkout=cancelled` only says the member left checkout and changed nothing (no claim about money). The parameter is removed from the address bar once read.
- **Expired sign-in:** `AuthGate` and the Subscribe button send the member to `/login?next=<path>`; after signing in they return to it (e.g. Settings with the checkout parameter). Only in-app
  paths under `/standup` are accepted (`src/lib/safeReturn.ts`); anything else (another site, `//host`, schemes, backslashes, control characters) falls back to Today.
- **No migration** for this step. FAQ (shown only when promotion is on) and the privacy policy describe the flow in EN/ES.

## Reconciliation (missed or delayed webhooks)

If a webhook is missed, `account_billing` can drift from Stripe. `POST /api/billing/reconcile` re-reads each stored subscription from Stripe and records it
through the same code the webhooks use (including the scheduled-cancellation normalisation and the stale-snapshot guard in `sync_stripe_subscription`).

- **Authorization:** set `BILLING_RECONCILE_SECRET` (at least 32 random characters) in Vercel. Without it the endpoint answers 503 and does nothing.
  Call it with `Authorization: Bearer <secret>`, no `Origin` header, and an empty body, `{}` or `{"limit": 1-25}`. It accepts no account, customer or subscription.
- **Example:** `curl -s -X POST https://standup-app-two.vercel.app/api/billing/reconcile -H "Authorization: Bearer $BILLING_RECONCILE_SECRET"`
- **Bounded:** up to 10 records per run by default (25 max), a 20 s budget, oldest synchronisation first, skipping records synchronised in the last 10 minutes and
  subscriptions already canceled for good. The response holds counts only (`changed`, `unchanged`, `stale`, `missing`, `conflict`, `ignored`, `stripe_error`, `store_error`, `moreDue`).
- **Safe:** it creates no subscription, Checkout session or entitlement and changes no trial, admin grant or Free limit. A Stripe failure leaves a record as it was; the next run retries it.
- **Scheduling (step 9.3):** `vercel.json` runs it once a day (04:17 UTC; on the Hobby plan Vercel starts a daily job somewhere within that hour). Vercel Cron can only send a GET, and it authenticates it with the project variable `CRON_SECRET` (at least 32 random characters, set for Production), which it sends as `Authorization: Bearer <value>`. Set that variable in Vercel and redeploy; until then the scheduled call gets 401 and nothing runs. The scheduled call carries no body or query string and uses the default bound (10 records, 20 s budget). Either `CRON_SECRET` or `BILLING_RECONCILE_SECRET` is accepted on both GET and POST. A second request while a run is in progress is answered 409 `already_running`; across instances an overlap is safe anyway (database locks, the stale-snapshot guard and the 10-minute cooldown).
- **Retry backoff (step 9.2, needs `supabase/migrations/20261123000100_reconcile_backoff.sql`):** a record Stripe cannot answer for (`missing`, `conflict`, `ignored`, or repeated
  `stripe_error`) is remembered in four `reconcile_*` columns and skipped until a retry time that doubles per consecutive failure (Stripe errors 5 min to 1 h, becoming
  persistent after 5 in a row; missing/conflict/ignored 1 h to 24 h). Healthy records are always ahead of retries in a batch, a success clears the memory, and the response
  adds `backedOff` (records waiting). The columns never touch billing status, entitlements, trials or grants. To investigate:
  `select user_id, reconcile_last_outcome, reconcile_failures, reconcile_last_failed_at, reconcile_next_attempt_at from public.account_billing where reconcile_failures > 0;`
- **Monitoring:** Vercel dashboard > the project > **Settings > Cron Jobs** shows each scheduled run and its HTTP status (200 = ran; 401 = `CRON_SECRET` missing/wrong; 503 = database or Stripe configuration problem; 409 = overlapped a running run). **Logs** (filter `billing reconcile`) hold one line per run: `info "billing reconcile"` with `trigger`, `examined`, the outcome counts, `moreDue`, `backedOff`, `aborted`; `error "billing reconcile failed"` with `category` (`not_configured` | `database` | `unexpected`); `warn "billing reconcile rejected"` with a `reason`. Nothing logged contains an identifier or secret. Watch for: `moreDue: true` on consecutive days (more subscribers than one run covers: raise the schedule frequency or the limit), a growing `backedOff` or non-zero `missing`/`conflict` (investigate with the SQL above), and any 4xx/5xx in Cron Jobs.

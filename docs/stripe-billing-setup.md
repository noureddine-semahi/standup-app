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

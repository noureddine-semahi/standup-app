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

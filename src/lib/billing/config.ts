import "server-only";
import { BILLING_PLANS, type BillingPlan } from "@/lib/billing/plans";

// Stripe configuration, read from environment variables on the SERVER only (this module cannot be bundled for the browser: the
// `server-only` import makes the build fail if a client component ever imports it). Nothing here is exposed with a NEXT_PUBLIC_ name.
//
// TEST MODE ONLY for now: a live key is refused outright, so production billing can't be switched on by accident before checkout,
// webhooks and entitlement activation exist and have been verified.
//
// Errors name the variable that is wrong, never its value, so a misconfigured secret can't leak into logs.

export const STRIPE_ENV = {
  secretKey: "STRIPE_SECRET_KEY",
  webhookSecret: "STRIPE_WEBHOOK_SECRET",
  prices: { monthly: "STRIPE_PRICE_MONTHLY", annual: "STRIPE_PRICE_ANNUAL" },
} as const satisfies { secretKey: string; webhookSecret: string; prices: Record<BillingPlan, string> };

export type BillingConfig = {
  /** Always "test" in this phase. */
  mode: "test";
  secretKey: string;
  /** Stripe Price IDs for the two plans. */
  prices: Readonly<Record<BillingPlan, string>>;
  /** Needed once webhooks exist; optional until then. */
  webhookSecret: string | null;
};

export class BillingConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Stripe billing is not configured correctly: ${problems.join("; ")}`);
    this.name = "BillingConfigError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const TEST_SECRET = /^(sk|rk)_test_[A-Za-z0-9_]+$/;
const LIVE_SECRET = /^(sk|rk)_live_/;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9_]+$/;

const read = (env: Env, name: string): string | null => {
  const v = env[name]?.trim();
  return v ? v : null;
};

/** Validate the environment and return the typed config, or throw a BillingConfigError that lists every problem (names only). */
export function readBillingConfig(env: Env = process.env): BillingConfig {
  const problems: string[] = [];

  const secretKey = read(env, STRIPE_ENV.secretKey);
  if (!secretKey) problems.push(`${STRIPE_ENV.secretKey} is missing`);
  else if (LIVE_SECRET.test(secretKey)) problems.push(`${STRIPE_ENV.secretKey} is a live key; only test-mode keys are allowed for now`);
  else if (!TEST_SECRET.test(secretKey)) problems.push(`${STRIPE_ENV.secretKey} must be a Stripe test-mode secret key (sk_test_… or rk_test_…)`);

  const prices = {} as Record<BillingPlan, string>;
  for (const plan of BILLING_PLANS) {
    const name = STRIPE_ENV.prices[plan];
    const id = read(env, name);
    if (!id) problems.push(`${name} is missing`);
    else if (!PRICE_ID.test(id)) problems.push(`${name} must be a Stripe Price ID (price_…)`);
    else prices[plan] = id;
  }
  if (prices.monthly && prices.monthly === prices.annual) problems.push(`${STRIPE_ENV.prices.monthly} and ${STRIPE_ENV.prices.annual} must be different Prices`);

  const webhookSecret = read(env, STRIPE_ENV.webhookSecret);
  if (webhookSecret && !WEBHOOK_SECRET.test(webhookSecret)) problems.push(`${STRIPE_ENV.webhookSecret} must be a webhook signing secret (whsec_…)`);

  if (problems.length > 0 || !secretKey) throw new BillingConfigError(problems);
  return { mode: "test", secretKey, prices, webhookSecret };
}

/** Whether billing is configured well enough to use. Never throws and never reveals why not. */
export function isBillingConfigured(env: Env = process.env): boolean {
  try {
    readBillingConfig(env);
    return true;
  } catch {
    return false;
  }
}

/** The Stripe Price ID configured for a plan. */
export function priceIdFor(plan: BillingPlan, config: BillingConfig): string {
  return config.prices[plan];
}

// ── Webhook configuration ─────────────────────────────────────────────────────────────────────────────────────────

export type WebhookConfig = {
  /** Test-mode secret key (needed to build the Stripe client that verifies signatures). */
  secretKey: string;
  /** The endpoint's signing secret from the Stripe Dashboard (whsec_...). */
  webhookSecret: string;
};

/**
 * What the webhook endpoint needs: a test-mode secret key and the signing secret. Unlike checkout it needs no Price IDs. Throws a
 * BillingConfigError naming the problems (never values) if either is missing or malformed.
 */
export function readWebhookConfig(env: Env = process.env): WebhookConfig {
  const problems: string[] = [];
  const secretKey = read(env, STRIPE_ENV.secretKey);
  if (!secretKey) problems.push(`${STRIPE_ENV.secretKey} is missing`);
  else if (LIVE_SECRET.test(secretKey)) problems.push(`${STRIPE_ENV.secretKey} is a live key; only test-mode keys are allowed for now`);
  else if (!TEST_SECRET.test(secretKey)) problems.push(`${STRIPE_ENV.secretKey} must be a Stripe test-mode secret key (sk_test_… or rk_test_…)`);
  const webhookSecret = read(env, STRIPE_ENV.webhookSecret);
  if (!webhookSecret) problems.push(`${STRIPE_ENV.webhookSecret} is missing`);
  else if (!WEBHOOK_SECRET.test(webhookSecret)) problems.push(`${STRIPE_ENV.webhookSecret} must be a webhook signing secret (whsec_…)`);
  if (problems.length > 0 || !secretKey || !webhookSecret) throw new BillingConfigError(problems);
  return { secretKey, webhookSecret };
}

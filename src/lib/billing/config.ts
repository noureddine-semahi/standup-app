import "server-only";
import { BILLING_PLANS, type BillingPlan } from "@/lib/billing/plans";

// Stripe configuration, read from environment variables on the SERVER only (this module cannot be bundled for the browser: the
// `server-only` import makes the build fail if a client component ever imports it). Nothing here is exposed with a NEXT_PUBLIC_ name.
//
// TEST MODE BY DEFAULT, LIVE ONLY BY EXPLICIT OPT-IN. The environment is in test mode unless STRIPE_MODE is exactly "live".
//   * test mode: only sk_test_ / rk_test_ keys are accepted; a live key is refused (it cannot be switched on by accident).
//   * live mode (STRIPE_MODE=live): only a RESTRICTED live key (rk_live_) is accepted; a full live secret key (sk_live_) and any test key are
//     refused. The key and the mode must agree, so a mismatched or half-changed configuration fails closed instead of guessing.
// Stripe Price IDs and webhook signing secrets look the same in both modes, so they cannot be checked here: the webhook compares every event's
// own livemode flag with this mode, and the subscription sync does the same for the subscription it fetches.
//
// Errors name the variable that is wrong, never its value, so a misconfigured secret can't leak into logs.

export const STRIPE_ENV = {
  secretKey: "STRIPE_SECRET_KEY",
  webhookSecret: "STRIPE_WEBHOOK_SECRET",
  prices: { monthly: "STRIPE_PRICE_MONTHLY", annual: "STRIPE_PRICE_ANNUAL" },
  mode: "STRIPE_MODE",
} as const satisfies { secretKey: string; webhookSecret: string; prices: Record<BillingPlan, string>; mode: string };

export type StripeMode = "test" | "live";

export type BillingConfig = {
  /** "test" unless STRIPE_MODE=live; always agrees with the kind of secret key. */
  mode: StripeMode;
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
const LIVE_RESTRICTED_SECRET = /^rk_live_[A-Za-z0-9_]+$/;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9_]+$/;

const read = (env: Env, name: string): string | null => {
  const v = env[name]?.trim();
  return v ? v : null;
};

/** The configured mode: "test" when STRIPE_MODE is absent, "live" only when it is exactly "live"; anything else is a problem (and stays test). */
function readMode(env: Env, problems: string[]): StripeMode {
  const v = read(env, STRIPE_ENV.mode);
  if (v === null || v === "test") return "test";
  if (v === "live") return "live";
  problems.push(`${STRIPE_ENV.mode} must be "test" or "live"`);
  return "test";
}

/** Check the secret key against the mode. Returns the key when it is valid for that mode; otherwise records a problem (names only, never values). */
function checkSecretKey(env: Env, mode: StripeMode, problems: string[]): string | null {
  const key = read(env, STRIPE_ENV.secretKey);
  if (!key) {
    problems.push(`${STRIPE_ENV.secretKey} is missing`);
    return null;
  }
  if (mode === "test") {
    if (TEST_SECRET.test(key)) return key;
    if (LIVE_SECRET.test(key)) problems.push(`${STRIPE_ENV.secretKey} is a live key but ${STRIPE_ENV.mode} is not "live"; live billing must be switched on explicitly`);
    else problems.push(`${STRIPE_ENV.secretKey} must be a Stripe test-mode secret key (sk_test_… or rk_test_…)`);
    return null;
  }
  if (LIVE_RESTRICTED_SECRET.test(key)) return key;
  if (/^sk_live_/.test(key)) problems.push(`${STRIPE_ENV.secretKey} is a full live secret key; live mode requires a restricted key (rk_live_…)`);
  else if (TEST_SECRET.test(key)) problems.push(`${STRIPE_ENV.secretKey} is a test key but ${STRIPE_ENV.mode} is "live"; the key and the mode must match`);
  else problems.push(`${STRIPE_ENV.secretKey} must be a restricted live key (rk_live_…) when ${STRIPE_ENV.mode} is "live"`);
  return null;
}

/** Validate the environment and return the typed config, or throw a BillingConfigError that lists every problem (names only). */
export function readBillingConfig(env: Env = process.env): BillingConfig {
  const problems: string[] = [];

  const mode = readMode(env, problems);
  const secretKey = checkSecretKey(env, mode, problems);

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
  return { mode, secretKey, prices, webhookSecret };
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
  /** Which mode this environment is in; the webhook accepts only events of exactly this mode. */
  mode: StripeMode;
  /** Secret key valid for that mode (needed to build the Stripe client that verifies signatures). */
  secretKey: string;
  /** The endpoint's signing secret from the Stripe Dashboard (whsec_...). */
  webhookSecret: string;
};

/**
 * What the webhook endpoint needs: a secret key that matches the configured mode, and the signing secret. Unlike checkout it needs no Price
 * IDs. Throws a BillingConfigError naming the problems (never values) if anything is missing, malformed or mismatched.
 */
export function readWebhookConfig(env: Env = process.env): WebhookConfig {
  const problems: string[] = [];
  const mode = readMode(env, problems);
  const secretKey = checkSecretKey(env, mode, problems);
  const webhookSecret = read(env, STRIPE_ENV.webhookSecret);
  if (!webhookSecret) problems.push(`${STRIPE_ENV.webhookSecret} is missing`);
  else if (!WEBHOOK_SECRET.test(webhookSecret)) problems.push(`${STRIPE_ENV.webhookSecret} must be a webhook signing secret (whsec_…)`);
  if (problems.length > 0 || !secretKey || !webhookSecret) throw new BillingConfigError(problems);
  return { mode, secretKey, webhookSecret };
}

import "server-only";
import { createHash } from "crypto";
import type Stripe from "stripe";
import { readBillingConfig, priceIdFor, type BillingConfig } from "@/lib/billing/config";
import { checkoutReturnUrls, resolveTrustedOrigin } from "@/lib/billing/origins";
import { isBillingPlan, type BillingPlan } from "@/lib/billing/plans";
import { authenticateUser, readFeatureFlagsForUser } from "@/lib/billing/serverAuth";
import { getStripe } from "@/lib/billing/stripe";
import { showCheckout, type FeatureFlags } from "@/lib/featureFlags";

// POST /api/billing/checkout: start a Stripe Checkout session (subscription mode, TEST mode) for the signed-in user.
//
// Request:  { "plan": "monthly" | "annual" }   with   Authorization: Bearer <Supabase access token>   and a trusted Origin header.
// Response: 200 { "url": "https://checkout.stripe.com/..." }   or   { "error": <code> } with 400/401/403/502/503.
//
// What the client controls: the plan, nothing else. The Price ID, amounts and redirect URLs are decided here; any other field in the
// body is refused. Order of checks, so nothing costly or external happens for a request that shouldn't: trusted origin -> signed-in user
// -> BOTH feature flags (billing_checkout_enabled and premium_promotion_enabled) -> body -> Stripe configuration -> Stripe.
// Creating a session grants NOTHING: no entitlement is written here (that is for a later, verified webhook step).

export type CheckoutDeps = {
  env: Readonly<Record<string, string | undefined>>;
  authenticate(accessToken: string): Promise<{ id: string } | null>;
  readFlags(accessToken: string): Promise<FeatureFlags>;
  readConfig(): BillingConfig;
  stripe(): { checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<{ url: string | null }> } } };
  now(): number;
};

const realDeps = (): CheckoutDeps => ({
  env: process.env,
  authenticate: authenticateUser,
  readFlags: readFeatureFlagsForUser,
  readConfig: () => readBillingConfig(),
  stripe: () => getStripe() as unknown as ReturnType<CheckoutDeps["stripe"]>,
  now: () => Date.now(),
});

export type CheckoutError = "forbidden_origin" | "unauthenticated" | "checkout_disabled" | "invalid_request" | "billing_unavailable" | "checkout_failed";

const STATUS: Record<CheckoutError, number> = {
  forbidden_origin: 403,
  unauthenticated: 401,
  checkout_disabled: 403,
  invalid_request: 400,
  billing_unavailable: 503,
  checkout_failed: 502,
};

const respond = (body: { url: string } | { error: CheckoutError }, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (error: CheckoutError) => respond({ error }, STATUS[error]);

const MAX_BODY_CHARS = 1024;
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;
const STRIPE_CHECKOUT_URL = /^https:\/\/checkout\.stripe\.com\//;

/** The plan from the request body, or null. Exactly one key, "plan"; anything else (a price, an amount, a customer, a URL) is refused. */
export function parseCheckoutBody(text: string): BillingPlan | null {
  if (text.length === 0 || text.length > MAX_BODY_CHARS) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  const plan = (body as { plan?: unknown }).plan;
  return keys.length === 1 && keys[0] === "plan" && isBillingPlan(plan) ? plan : null;
}

/**
 * A retry of the same request within a few minutes gets the SAME Checkout session from Stripe instead of a second one: the key is
 * derived on the server from the user, plan, origin and a 5-minute window, never taken from the client.
 */
export function checkoutIdempotencyKey(userId: string, plan: BillingPlan, origin: string, nowMs: number): string {
  const bucket = Math.floor(nowMs / IDEMPOTENCY_WINDOW_MS);
  return "standup-checkout-" + createHash("sha256").update(`${userId}|${plan}|${origin}|${bucket}`).digest("hex").slice(0, 48);
}

const bearer = (header: string | null): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
};

export async function handleCheckoutRequest(req: Request, deps: CheckoutDeps = realDeps()): Promise<Response> {
  const origin = resolveTrustedOrigin(req.headers.get("origin"), deps.env);
  if (!origin) return fail("forbidden_origin");

  const token = bearer(req.headers.get("authorization"));
  if (!token) return fail("unauthenticated");
  const user = await deps.authenticate(token).catch(() => null);
  if (!user) return fail("unauthenticated");

  const flags = await deps.readFlags(token).catch(() => null);
  if (!flags || !showCheckout(flags)) return fail("checkout_disabled");

  const plan = parseCheckoutBody(await req.text().catch(() => ""));
  if (!plan) return fail("invalid_request");

  let config: BillingConfig;
  try {
    config = deps.readConfig();
  } catch {
    return fail("billing_unavailable");
  }

  const urls = checkoutReturnUrls(origin);
  try {
    const session = await deps.stripe().checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: priceIdFor(plan, config), quantity: 1 }],
        client_reference_id: user.id,
        metadata: { user_id: user.id, plan },
        subscription_data: { metadata: { user_id: user.id, plan } },
        success_url: urls.success,
        cancel_url: urls.cancel,
      },
      { idempotencyKey: checkoutIdempotencyKey(user.id, plan, origin, deps.now()) }
    );
    if (!session.url || !STRIPE_CHECKOUT_URL.test(session.url)) return fail("checkout_failed");
    return respond({ url: session.url }, 200);
  } catch (e) {
    // Log the kind of failure only: Stripe's messages can quote parts of keys.
    const err = e as { type?: string; code?: string; statusCode?: number };
    console.error("billing checkout: Stripe request failed", { type: err.type, code: err.code, status: err.statusCode });
    return fail("checkout_failed");
  }
}

import "server-only";
import { createHash } from "crypto";
import type Stripe from "stripe";
import { readBillingConfig, priceIdFor, type BillingConfig } from "@/lib/billing/config";
import { createDeletionStore } from "@/lib/account/deletionStore";
import { createCheckoutStore, type BeginResult, type CheckoutStore } from "@/lib/billing/checkoutStore";
import { checkoutReturnUrls, resolveTrustedOrigin } from "@/lib/billing/origins";
import { isBillingPlan, type BillingPlan } from "@/lib/billing/plans";
import { authenticateUser, readFeatureFlagsForUser } from "@/lib/billing/serverAuth";
import { getStripe } from "@/lib/billing/stripe";
import { blocksNewCheckout } from "@/lib/billing/subscriptionStates";
import { showCheckout, type FeatureFlags } from "@/lib/featureFlags";

// POST /api/billing/checkout: start a Stripe Checkout session (subscription mode, TEST mode) for the signed-in user.
//
// Request:  { "plan": "monthly" | "annual" }   with   Authorization: Bearer <Supabase access token>   and a trusted Origin header.
// Response: 200 { "url": "https://checkout.stripe.com/..." }   or   { "error": <code> } with 400/401/403/409/502/503.
//
// What the client controls: the plan, nothing else. The Price ID, amounts and redirect URLs are decided here; any other field in the
// body is refused. Order of checks, so nothing costly or external happens for a request that shouldn't: trusted origin -> signed-in user
// -> BOTH feature flags (billing_checkout_enabled and premium_promotion_enabled) -> body -> Stripe configuration -> DUPLICATE GUARD -> Stripe.
// Creating a session grants NOTHING: no entitlement is written here (that is for a later, verified webhook step).
//
// DUPLICATE-SUBSCRIPTION GUARD (Phase 5.6 step 5). A member must never end up with two paid subscriptions, whether from a double click, two
// tabs, a retry or a stale page. The guard does not rely on the browser (a disabled button) or on the billing record alone (it lags the
// webhook by seconds). Before any session is created the server asks the database, atomically per member (checkout_attempts):
//   * already has a subscription that is not over for good (active, trialing, past_due, unpaid, incomplete, paused, or any unknown status)
//       -> 409 already_subscribed. An admin Premium grant or the one-time trial are not subscriptions and never count.
//   * another request is creating a session right now                                                    -> 409 checkout_in_progress
//   * an earlier session is still open: STRIPE is asked about it (the authority)
//       open + same plan   -> that same session's URL is returned (nothing new is created: a retry/second tab continues the same checkout)
//       open + other plan  -> the old session is expired first, so only one can ever be paid, then a new one is created
//       complete           -> if its subscription is live: 409 already_subscribed (paid but not yet synced); if over: a new checkout may start
//       expired            -> a new checkout may start
//   * otherwise one attempt is claimed and ONE session is created, with an idempotency key derived from the attempt (a retry of the same
//     attempt returns the same session).

export type CheckoutStripe = {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string; url: string | null; expires_at?: number | null }>;
      retrieve(id: string): Promise<{ status: string | null; url: string | null; subscription: string | { id: string } | null }>;
      expire(id: string): Promise<unknown>;
    };
  };
  subscriptions: { retrieve(id: string): Promise<{ status: string }> };
};

export type CheckoutDeps = {
  env: Readonly<Record<string, string | undefined>>;
  authenticate(accessToken: string): Promise<{ id: string } | null>;
  readFlags(accessToken: string): Promise<FeatureFlags>;
  readConfig(): BillingConfig;
  checkoutStore(): CheckoutStore;
  stripe(): CheckoutStripe;
  /** Whether an account deletion is in progress for this member (Phase 5.7): no new Checkout may start or survive while it is. */
  deletionPending(userId: string): Promise<boolean>;
};

const realDeps = (): CheckoutDeps => ({
  env: process.env,
  authenticate: authenticateUser,
  readFlags: readFeatureFlagsForUser,
  readConfig: () => readBillingConfig(),
  checkoutStore: () => createCheckoutStore(),
  stripe: () => getStripe() as unknown as CheckoutStripe,
  deletionPending: (userId) => createDeletionStore().isPending(userId),
});

export type CheckoutError =
  | "forbidden_origin"
  | "unauthenticated"
  | "checkout_disabled"
  | "invalid_request"
  | "already_subscribed"
  | "checkout_in_progress"
  | "billing_unavailable"
  | "checkout_failed";

const STATUS: Record<CheckoutError, number> = {
  forbidden_origin: 403,
  unauthenticated: 401,
  checkout_disabled: 403,
  invalid_request: 400,
  already_subscribed: 409,
  checkout_in_progress: 409,
  billing_unavailable: 503,
  checkout_failed: 502,
};

const respond = (body: { url: string } | { error: CheckoutError }, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (error: CheckoutError) => respond({ error }, STATUS[error]);

const MAX_BODY_CHARS = 1024;
const MAX_PASSES = 3;
const STRIPE_CHECKOUT_URL = /^https:\/\/checkout\.stripe\.com\//;
const validUrl = (u: string | null | undefined): u is string => typeof u === "string" && STRIPE_CHECKOUT_URL.test(u);

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
 * Derived on the server from the attempt the database claimed (never from the client): a retry of the SAME attempt (a lost response, a
 * re-adopted stale claim) returns the same Stripe session instead of creating a second one, while every new attempt gets its own key.
 */
export function checkoutIdempotencyKey(attemptId: string, plan: BillingPlan, origin: string): string {
  return "standup-checkout-" + createHash("sha256").update(`${attemptId}|${plan}|${origin}`).digest("hex").slice(0, 48);
}

const bearer = (header: string | null): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
};

const subscriptionIdOf = (s: string | { id: string } | null): string | null => (typeof s === "string" ? s : s?.id ?? null);

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

  let store: CheckoutStore;
  try {
    store = deps.checkoutStore();
  } catch {
    return fail("billing_unavailable"); // without the attempt ledger there is no duplicate protection, so no session is created
  }
  const stripe = deps.stripe();
  try {
    if (await deps.deletionPending(user.id)) return fail("checkout_disabled"); // a member whose account is being deleted can't start a subscription
  } catch {
    return fail("billing_unavailable"); // can't tell: fail closed
  }
  const finish = (id: string, status: "completed" | "expired" | "failed") => store.finish(id, status).catch(() => undefined);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let begin: BeginResult;
    try {
      begin = await store.begin(user.id, plan);
    } catch {
      return fail("billing_unavailable");
    }
    if (begin.result === "subscription_exists") return fail("already_subscribed");
    if (begin.result === "in_progress") return fail("checkout_in_progress");

    if (begin.result === "pending") {
      let earlier: Awaited<ReturnType<CheckoutStripe["checkout"]["sessions"]["retrieve"]>>;
      try {
        earlier = await stripe.checkout.sessions.retrieve(begin.sessionId);
      } catch {
        return fail("checkout_failed"); // can't tell whether it was paid: create nothing
      }

      if (earlier.status === "open") {
        if (begin.plan === plan && validUrl(earlier.url)) return respond({ url: earlier.url }, 200); // same checkout, continued
        try {
          await stripe.checkout.sessions.expire(begin.sessionId); // a different plan: only one session may ever be payable
        } catch {
          return fail("checkout_failed"); // it may have just been paid; the next request will see that
        }
        await finish(begin.attemptId, "expired");
        continue;
      }

      if (earlier.status === "complete") {
        const subId = subscriptionIdOf(earlier.subscription);
        let live = true; // no subscription to inspect: assume the worst
        if (subId) {
          try {
            live = blocksNewCheckout((await stripe.subscriptions.retrieve(subId)).status);
          } catch {
            return fail("checkout_failed");
          }
        }
        await finish(begin.attemptId, "completed");
        if (live) return fail("already_subscribed"); // paid, and the billing record may not have caught up yet
        continue; // that subscription is over for good: a new checkout is fine
      }

      await finish(begin.attemptId, "expired"); // expired or anything else
      continue;
    }

    // claimed: create exactly one session for this attempt
    const urls = checkoutReturnUrls(origin);
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: priceIdFor(plan, config), quantity: 1 }],
          client_reference_id: user.id,
          metadata: { user_id: user.id, plan },
          subscription_data: { metadata: { user_id: user.id, plan } },
          success_url: urls.success,
          cancel_url: urls.cancel,
        },
        { idempotencyKey: checkoutIdempotencyKey(begin.attemptId, plan, origin) }
      );
      if (!session.id || !validUrl(session.url)) {
        await finish(begin.attemptId, "failed");
        return fail("checkout_failed");
      }
      // A deletion may have started while this session was being created. Marking happens BEFORE the deletion looks for sessions and this check
      // happens AFTER the session exists, so either the deletion's scan finds this session or this check sees the mark: it can't be paid unseen.
      let deleting = true;
      try {
        deleting = await deps.deletionPending(user.id);
      } catch {
        deleting = true;
      }
      if (deleting) {
        await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
        await finish(begin.attemptId, "expired");
        return fail("checkout_disabled");
      }
      const expiresAt = typeof session.expires_at === "number" ? new Date(session.expires_at * 1000).toISOString() : null;
      await store.record(begin.attemptId, session.id, expiresAt).catch(() => undefined); // if this is lost, the stale claim is re-adopted and returns this same session
      return respond({ url: session.url }, 200);
    } catch (e) {
      // Log the kind of failure only: Stripe's messages can quote parts of keys.
      const err = e as { type?: string; code?: string; statusCode?: number };
      console.error("billing checkout: Stripe request failed", { type: err.type, code: err.code, status: err.statusCode });
      await finish(begin.attemptId, "failed");
      return fail("checkout_failed");
    }
  }
  return fail("checkout_in_progress");
}

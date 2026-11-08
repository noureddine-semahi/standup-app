import "server-only";
import type Stripe from "stripe";
import { readBillingConfig, type BillingConfig } from "@/lib/billing/config";
import { portalReturnUrl, resolveTrustedOrigin } from "@/lib/billing/origins";
import { createPortalStore, type PortalStore } from "@/lib/billing/portalStore";
import { authenticateUser } from "@/lib/billing/serverAuth";
import { getStripe } from "@/lib/billing/stripe";
import { portalEligible } from "@/lib/billing/subscriptionStates";

// POST /api/billing/portal: open Stripe's hosted Customer Portal for the signed-in member's existing subscription (TEST mode).
//
// Request:  no body (or "{}"), with   Authorization: Bearer <Supabase access token>   and a trusted Origin header.
// Response: 200 { "url": "https://billing.stripe.com/..." }   or   { "error": <code> } with 400/401/403/409/502/503.
//
// What the client controls: nothing but the fact that it asked. The Stripe customer comes ONLY from the member's own billing record,
// looked up by the account ID the server just verified from their sign-in; a customer, subscription or account ID in the request is refused,
// as is any other field. The return URL is built here from a trusted origin and a fixed Settings path. Order of checks, so nothing costly or
// external happens for a request that shouldn't: trusted origin -> signed-in user -> body
// -> Stripe configuration -> the member's own billing record -> a subscription that has something to manage -> Stripe.
//
// NO FEATURE FLAGS (step 8.1). Unlike Checkout, the portal is not gated by premium_promotion_enabled or billing_checkout_enabled: those switch
// off SELLING, and a member who already pays must still be able to cancel or fix a card. Who may use it is decided only by the checks above
// and by the member's own billing record.
//
// This opens a page; it changes NOTHING here. Whatever the member does in the portal (cancel, update a card) reaches StandUp only as verified
// Stripe webhooks through the existing billing synchronisation, and the return to Settings never touches an entitlement.
//
// What the portal may do is decided in the Stripe Dashboard (Settings > Billing > Customer portal), not here: StandUp supports cancelling and
// updating the payment method / viewing invoices, and plan switching is deliberately NOT enabled. The optional STRIPE_PORTAL_CONFIGURATION
// (a bpc_ ID) pins the portal to one saved configuration instead of the account default.

export type PortalStripe = {
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string | null }>;
    };
  };
};

export type PortalDeps = {
  env: Readonly<Record<string, string | undefined>>;
  authenticate(accessToken: string): Promise<{ id: string } | null>;
  readConfig(): BillingConfig;
  portalStore(): PortalStore;
  stripe(): PortalStripe;
};

const realDeps = (): PortalDeps => ({
  env: process.env,
  authenticate: authenticateUser,
  readConfig: () => readBillingConfig(),
  portalStore: () => createPortalStore(),
  stripe: () => getStripe() as unknown as PortalStripe,
});

export type PortalError =
  | "forbidden_origin"
  | "unauthenticated"
  | "invalid_request"
  | "no_subscription"
  | "billing_unavailable"
  | "portal_failed";

const STATUS: Record<PortalError, number> = {
  forbidden_origin: 403,
  unauthenticated: 401,
  invalid_request: 400,
  no_subscription: 409,
  billing_unavailable: 503,
  portal_failed: 502,
};

const respond = (body: { url: string } | { error: PortalError }, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (error: PortalError) => respond({ error }, STATUS[error]);

const STRIPE_PORTAL_URL = /^https:\/\/billing\.stripe\.com\//;
const validUrl = (u: string | null | undefined): u is string => typeof u === "string" && STRIPE_PORTAL_URL.test(u);
export const PORTAL_CONFIGURATION_ENV = "STRIPE_PORTAL_CONFIGURATION";
const PORTAL_CONFIGURATION = /^bpc_[A-Za-z0-9]+$/;

/** True only for an empty body or an empty JSON object: the request carries no choices, so anything else (a customer, a URL, an account) is refused. */
export function isEmptyPortalBody(text: string): boolean {
  if (text.trim().length === 0) return true;
  if (text.length > 64) return false;
  try {
    const body: unknown = JSON.parse(text);
    return !!body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0;
  } catch {
    return false;
  }
}

const bearer = (header: string | null): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
};

export async function handlePortalRequest(req: Request, deps: PortalDeps = realDeps()): Promise<Response> {
  const origin = resolveTrustedOrigin(req.headers.get("origin"), deps.env);
  if (!origin) return fail("forbidden_origin");

  const token = bearer(req.headers.get("authorization"));
  if (!token) return fail("unauthenticated");
  const user = await deps.authenticate(token).catch(() => null);
  if (!user) return fail("unauthenticated");

  if (!isEmptyPortalBody(await req.text().catch(() => "x"))) return fail("invalid_request");

  try {
    deps.readConfig();
  } catch {
    return fail("billing_unavailable");
  }

  let customer: Awaited<ReturnType<PortalStore["customerFor"]>>;
  try {
    customer = await deps.portalStore().customerFor(user.id);
  } catch {
    return fail("billing_unavailable");
  }
  if (!customer || !portalEligible(customer.status)) return fail("no_subscription");

  const configuration = deps.env[PORTAL_CONFIGURATION_ENV]?.trim();
  if (configuration && !PORTAL_CONFIGURATION.test(configuration)) return fail("billing_unavailable"); // a malformed setting is never passed on

  try {
    const session = await deps.stripe().billingPortal.sessions.create({
      customer: customer.customerId,
      return_url: portalReturnUrl(origin),
      ...(configuration ? { configuration } : {}),
    });
    if (!validUrl(session.url)) return fail("portal_failed");
    return respond({ url: session.url }, 200);
  } catch (e) {
    // Log the kind of failure only: Stripe's messages can quote identifiers and parts of keys.
    const err = e as { type?: string; code?: string; statusCode?: number };
    console.error("billing portal: Stripe request failed", { type: err.type, code: err.code, status: err.statusCode });
    // The customer no longer exists in Stripe: there is nothing to manage, which is a different answer from "Stripe is having trouble".
    return fail(err.code === "resource_missing" ? "no_subscription" : "portal_failed");
  }
}

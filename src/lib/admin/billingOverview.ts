import "server-only";
import { resolveTrustedOrigin } from "@/lib/billing/origins";
import { authenticateUser, readFeatureFlagsForUser } from "@/lib/billing/serverAuth";
import { isSysAdminViaDatabase } from "@/lib/admin/adminGuard";
import { summarizeBillingOverview, type BillingOverviewNumbers } from "@/lib/admin/billingSummary";
import { createOverviewStore, type OverviewStore } from "@/lib/admin/overviewStore";
import { FEATURE_FLAGS, type FeatureFlags } from "@/lib/featureFlags";

// POST /api/admin/billing-overview: the numbers behind the admin Premium & Billing dashboard. READ-ONLY and AGGREGATE-ONLY.
//
// Request:  empty body, with   Authorization: Bearer <Supabase access token>   and a trusted Origin header.
// Response: 200 { generatedAt, accounts, subscriptions, premiumSources, flags }   or   { error: <code> } with 401/403/503.
//
// Authorization is enforced HERE, on the server, before any data is read: the sign-in is verified by Supabase, then the database's own is_sys_admin()
// function (called AS the member, with their token) must say yes. A signed-out caller gets 401; a signed-in member who is not a System Admin gets 403,
// and the billing tables are never touched for either. The page's own check is only a courtesy that hides the screen.
//
// What comes back is counts and the three flag values: no member ID, email or Stripe reference. Nothing here writes anything, calls Stripe, changes a
// flag, a plan or a subscription.

export type BillingOverviewResponse = BillingOverviewNumbers & { generatedAt: string; flags: FeatureFlags };

export type OverviewDeps = {
  env: Readonly<Record<string, string | undefined>>;
  authenticate(accessToken: string): Promise<{ id: string } | null>;
  isSysAdmin(accessToken: string): Promise<boolean>;
  readFlags(accessToken: string): Promise<FeatureFlags>;
  store(): OverviewStore;
  now(): Date;
};

const realDeps = (): OverviewDeps => ({
  env: process.env,
  authenticate: authenticateUser,
  isSysAdmin: isSysAdminViaDatabase,
  readFlags: readFeatureFlagsForUser,
  store: () => createOverviewStore(),
  now: () => new Date(),
});

export type OverviewError = "forbidden_origin" | "unauthenticated" | "forbidden" | "unavailable";
const STATUS: Record<OverviewError, number> = { forbidden_origin: 403, unauthenticated: 401, forbidden: 403, unavailable: 503 };
const respond = (body: Record<string, unknown>, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (error: OverviewError) => respond({ error }, STATUS[error]);

const bearer = (header: string | null): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
};

export async function handleBillingOverviewRequest(req: Request, deps: OverviewDeps = realDeps()): Promise<Response> {
  if (!resolveTrustedOrigin(req.headers.get("origin"), deps.env)) return fail("forbidden_origin");

  const token = bearer(req.headers.get("authorization"));
  if (!token) return fail("unauthenticated");
  const user = await deps.authenticate(token).catch(() => null);
  if (!user) return fail("unauthenticated");

  // Server-side authorization: only a System Admin gets past this line. Nothing below runs for anyone else.
  const allowed = await deps.isSysAdmin(token).catch(() => false);
  if (!allowed) return fail("forbidden");

  if ((await req.text().catch(() => "x")).trim().length > 0) return respond({ error: "invalid_request" }, 400);

  let inputs;
  try {
    inputs = await deps.store().load();
  } catch {
    return fail("unavailable");
  }
  const now = deps.now();
  const numbers = summarizeBillingOverview({ ...inputs, now });
  const flags = await deps.readFlags(token).catch(() => null);
  // flags are shown as they are; if they can't be read every one is reported OFF (the same fail-closed default the app uses everywhere)
  const shown = Object.fromEntries(FEATURE_FLAGS.map((f) => [f, flags?.[f] === true])) as FeatureFlags;
  const body: BillingOverviewResponse = { generatedAt: now.toISOString(), ...numbers, flags: shown };
  return respond(body, 200);
}

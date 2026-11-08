// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/serverAuth", () => ({ authenticateUser: vi.fn(), readFeatureFlagsForUser: vi.fn() }));
vi.mock("@/lib/admin/overviewStore", () => ({ createOverviewStore: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

import { handleBillingOverviewRequest, type OverviewDeps } from "./billingOverview";
import type { OverviewInputs, OverviewStore } from "./overviewStore";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@/lib/featureFlags";

const ORIGIN = "https://standup-app-two.vercel.app";
const ADMIN = { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" };
const MEMBER = { id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb" };
const NOW = new Date("2026-11-20T12:00:00Z");
const inputs: OverviewInputs = {
  totalAccounts: 6,
  entitlements: [{ userId: "m1-secret-id", tier: "premium", trialEndsAt: null }, { userId: "m2-secret-id", tier: "premium_trial", trialEndsAt: "2026-12-01T00:00:00Z" }],
  billing: [{ userId: "m3-secret-id", status: "active", periodEnd: "2026-12-10T00:00:00Z", cancelAtPeriodEnd: false }, { userId: "m4-secret-id", status: "active", periodEnd: "2026-12-10T00:00:00Z", cancelAtPeriodEnd: true }, { userId: "m5-secret-id", status: "canceled", periodEnd: "2026-10-01T00:00:00Z", cancelAtPeriodEnd: false }],
  trialHistoryUserIds: ["m2-secret-id"],
};

function make(over: Partial<OverviewDeps> = {}, flags: FeatureFlags = DEFAULT_FEATURE_FLAGS) {
  const load = vi.fn(async () => inputs);
  const store: OverviewStore = { load };
  const deps: OverviewDeps = {
    env: { NODE_ENV: "production" },
    authenticate: vi.fn(async (t: string) => (t === "admin-token" ? ADMIN : t === "member-token" ? MEMBER : null)),
    isSysAdmin: vi.fn(async (t: string) => t === "admin-token"),
    readFlags: vi.fn(async () => flags),
    store: () => store,
    now: () => NOW,
    ...over,
  };
  return { deps, load };
}
const req = (o: { auth?: string | null; origin?: string | null; body?: string } = {}) =>
  new Request(`${ORIGIN}/api/admin/billing-overview`, { method: "POST", headers: { ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }), ...(o.auth === null ? {} : { authorization: o.auth ?? "Bearer admin-token" }) }, body: o.body });

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("authorization is enforced on the server, before any data is read", () => {
  it("a signed-out caller (no token, a malformed header, an unknown token) gets 401 and nothing is read", async () => {
    for (const auth of [null, "", "Bearer", "Basic abc", "Bearer unknown", "admin-token"]) {
      const { deps, load } = make();
      const res = await handleBillingOverviewRequest(req({ auth }), deps);
      expect(res.status, String(auth)).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
      expect(load).not.toHaveBeenCalled();
      expect(deps.isSysAdmin).not.toHaveBeenCalled();
    }
  });

  it("a signed-in member who is not a System Admin gets 403, and neither the billing tables nor the flags are touched", async () => {
    const { deps, load } = make();
    const res = await handleBillingOverviewRequest(req({ auth: "Bearer member-token" }), deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(load).not.toHaveBeenCalled();
    expect(deps.readFlags).not.toHaveBeenCalled();
  });

  it("an ordinary Admin (not a System Admin) is also refused: the check is is_sys_admin, nothing weaker", async () => {
    const { deps, load } = make({ isSysAdmin: vi.fn(async () => false), authenticate: vi.fn(async () => ADMIN) });
    expect((await handleBillingOverviewRequest(req(), deps)).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it("if the System Admin check itself fails or throws, the answer is 403 (fail closed), never data", async () => {
    const { deps, load } = make({ isSysAdmin: vi.fn(async () => Promise.reject(new Error("rpc down"))) });
    expect((await handleBillingOverviewRequest(req(), deps)).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it("a sign-in check that throws is a 401", async () => {
    const { deps, load } = make({ authenticate: vi.fn(async () => Promise.reject(new Error("auth down"))) });
    expect((await handleBillingOverviewRequest(req(), deps)).status).toBe(401);
    expect(load).not.toHaveBeenCalled();
  });

  it("an untrusted, look-alike or missing Origin is 403 before anything else happens (not even the sign-in is checked)", async () => {
    for (const origin of ["https://evil.example", `${ORIGIN}.evil.example`, "http://standup-app-two.vercel.app", "null", null]) {
      const { deps, load } = make();
      const res = await handleBillingOverviewRequest(req({ origin }), deps);
      expect(res.status, String(origin)).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden_origin" });
      expect(deps.authenticate).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("the request carries no choices: any body is refused (after authorization), so nothing can steer what is read", async () => {
    const { deps, load } = make();
    for (const body of ['{"user_id":"x"}', "x", "{}"]) {
      const res = await handleBillingOverviewRequest(req({ body }), deps);
      expect(res.status, body).toBe(400);
    }
    expect(load).not.toHaveBeenCalled();
    const memberRes = await handleBillingOverviewRequest(req({ auth: "Bearer member-token", body: '{"x":1}' }), deps);
    expect(memberRes.status).toBe(403); // a member gets 403 even with a bad body: authorization comes first
  });
});

describe("what a System Admin receives", () => {
  it("the exact counts, computed from the rows, plus the flag values and a timestamp", async () => {
    const { deps, load } = make();
    const res = await handleBillingOverviewRequest(req(), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      generatedAt: NOW.toISOString(),
      accounts: { total: 6, free: 2, trial: 1, premium: 3, trialAvailable: 2 },
      subscriptions: { active: 1, scheduledCancellation: 1, pastDue: 0, canceled: 1, other: 0, total: 3 },
      premiumSources: { manualGrants: 1, stripeSubscriptions: 2, both: 0 },
      flags: { premium_promotion_enabled: false, premium_trial_activation_enabled: false, billing_checkout_enabled: false },
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("returns AGGREGATES ONLY: no member ID, email, Stripe reference or token anywhere in the response", async () => {
    const { deps } = make();
    const text = await (await handleBillingOverviewRequest(req(), deps)).text();
    for (const secret of ["m1-secret-id", "m2-secret-id", "m3-secret-id", "m4-secret-id", "m5-secret-id", ADMIN.id, MEMBER.id, "admin-token", "cus_", "sub_", "@"]) expect(text, secret).not.toContain(secret);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("reports the real flag values (display only), and ALL OFF when they can't be read", async () => {
    const on: FeatureFlags = { premium_promotion_enabled: true, premium_trial_activation_enabled: false, billing_checkout_enabled: true };
    const a = make({}, on);
    expect((await (await handleBillingOverviewRequest(req(), a.deps)).json()).flags).toEqual(on);
    const b = make({ readFlags: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect((await (await handleBillingOverviewRequest(req(), b.deps)).json()).flags).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it("an unreadable store is 503 with no detail, and nothing sensitive is logged", async () => {
    const { deps } = make({ store: () => ({ load: async () => Promise.reject(new Error("db down sk_test_SECRET cus_123")) }) });
    const res = await handleBillingOverviewRequest(req(), deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(JSON.stringify(logs)).not.toMatch(/sk_test|cus_|admin-token/);
    const b = make({ store: () => { throw new Error("missing env"); } });
    expect((await handleBillingOverviewRequest(req(), b.deps)).status).toBe(503);
  });

  it("is read-only by construction: the dependencies offer reads and nothing that changes a plan, flag, subscription or entitlement", () => {
    const { deps } = make();
    expect(Object.keys(deps).sort()).toEqual(["authenticate", "env", "isSysAdmin", "now", "readFlags", "store"]);
    expect(Object.keys(deps.store())).toEqual(["load"]);
  });
});

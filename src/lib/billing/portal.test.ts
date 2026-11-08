// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/serverAuth", () => ({ authenticateUser: vi.fn(), readFeatureFlagsForUser: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/billing/portalStore", () => ({ createPortalStore: vi.fn() }));

import { handlePortalRequest, isEmptyPortalBody, type PortalDeps } from "./portal";
import { readBillingConfig } from "./config";
import type { PortalCustomer, PortalStore } from "./portalStore";

const ORIGIN = "https://standup-app-two.vercel.app";
const SECRET = "sk_test_SECRETVALUE123";
const config = readBillingConfig({ STRIPE_SECRET_KEY: SECRET, STRIPE_PRICE_MONTHLY: "price_monthlyAAA", STRIPE_PRICE_ANNUAL: "price_annualBBB" });
const ME = { id: "11111111-2222-3333-4444-555555555555" };
const OTHER = { id: "99999999-8888-7777-6666-555555555555" };
const PORTAL_URL = "https://billing.stripe.com/p/session/test_abc";

type World = {
  deps: PortalDeps;
  create: ReturnType<typeof vi.fn>;
  lookups: string[];
  authenticate: ReturnType<typeof vi.fn>;
};

// An in-memory account_billing: one row per account, each with its own Stripe customer.
function makeWorld(opts: { rows?: Record<string, PortalCustomer>; env?: Record<string, string | undefined>; stripeError?: unknown; url?: string | null; storeError?: boolean; configBad?: boolean; user?: { id: string } | null } = {}): World {
  const rows: Record<string, PortalCustomer> = opts.rows ?? { [ME.id]: { customerId: "cus_ME111", status: "active" }, [OTHER.id]: { customerId: "cus_OTHER222", status: "active" } };
  const lookups: string[] = [];
  const store: PortalStore = {
    async customerFor(userId) {
      lookups.push(userId);
      if (opts.storeError) throw new Error("db down");
      return rows[userId] ?? null;
    },
  };
  const create = vi.fn(async () => {
    if (opts.stripeError) throw opts.stripeError;
    return { url: opts.url === undefined ? PORTAL_URL : opts.url };
  });
  const authenticate = vi.fn(async (t: string) => (t === "good-token" ? (opts.user === undefined ? ME : opts.user) : null));
  const deps: PortalDeps = {
    env: { NODE_ENV: "production", ...(opts.env ?? {}) },
    authenticate,
    readConfig: () => {
      if (opts.configBad) throw new Error("bad config");
      return config;
    },
    portalStore: () => store,
    stripe: () => ({ billingPortal: { sessions: { create } } }),
  };
  return { deps, create, lookups, authenticate };
}

const req = (init: { origin?: string | null; auth?: string | null; body?: string; method?: string } = {}) => {
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.auth !== null) headers.authorization = init.auth ?? "Bearer good-token";
  return new Request(`${ORIGIN}/api/billing/portal`, { method: init.method ?? "POST", headers, body: init.body });
};
const json = async (r: Response) => (await r.json()) as { url?: string; error?: string };

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("a subscriber opens the portal", () => {
  it("creates one portal session for THEIR customer, returns to Settings on the trusted origin, and returns only the Stripe billing URL", async () => {
    const w = makeWorld();
    const res = await handlePortalRequest(req(), w.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toEqual({ url: PORTAL_URL });
    expect(w.create).toHaveBeenCalledTimes(1);
    expect(w.create).toHaveBeenCalledWith({ customer: "cus_ME111", return_url: `${ORIGIN}/standup/settings?portal=return` });
  });

  it("looks the customer up by the account the sign-in proved, and by nothing else", async () => {
    const w = makeWorld({ user: OTHER });
    await handlePortalRequest(req(), w.deps);
    expect(w.lookups).toEqual([OTHER.id]);
    expect(w.create).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_OTHER222" }));
  });

  it("accepts an empty body or {}", async () => {
    for (const body of [undefined, "", "  ", "{}", " { } "]) {
      const w = makeWorld();
      expect((await handlePortalRequest(req({ body }), w.deps)).status).toBe(200);
    }
  });

  it("every status that has something to manage is allowed (active, trialing, past_due so a card can be fixed, unpaid, paused)", async () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused"]) {
      const w = makeWorld({ rows: { [ME.id]: { customerId: "cus_ME111", status } } });
      expect((await handlePortalRequest(req(), w.deps)).status, status).toBe(200);
    }
  });

  it("uses the pinned portal configuration when one is set, and only when it is a bpc_ ID", async () => {
    const w = makeWorld({ env: { STRIPE_PORTAL_CONFIGURATION: " bpc_1ABCdef " } });
    expect((await handlePortalRequest(req(), w.deps)).status).toBe(200);
    expect(w.create).toHaveBeenCalledWith({ customer: "cus_ME111", return_url: `${ORIGIN}/standup/settings?portal=return`, configuration: "bpc_1ABCdef" });
    const bad = makeWorld({ env: { STRIPE_PORTAL_CONFIGURATION: "price_oops" } });
    const r = await handlePortalRequest(req(), bad.deps);
    expect(r.status).toBe(503);
    expect(await json(r)).toEqual({ error: "billing_unavailable" });
    expect(bad.create).not.toHaveBeenCalled();
  });
});

describe("authorization and ownership", () => {
  it("no sign-in, a malformed header or an unknown token is 401, and nothing is looked up or created", async () => {
    for (const auth of [null, "", "Basic abc", "Bearer", "Bearer  ", "Bearer bad-token", "good-token"]) {
      const w = makeWorld();
      const res = await handlePortalRequest(req({ auth }), w.deps);
      expect(res.status, String(auth)).toBe(401);
      expect(await json(res)).toEqual({ error: "unauthenticated" });
      expect(w.lookups).toEqual([]);
      expect(w.create).not.toHaveBeenCalled();
    }
  });

  it("a member whose token fails verification is refused even if the lookup would have worked", async () => {
    const w = makeWorld({ user: null });
    expect((await handlePortalRequest(req(), w.deps)).status).toBe(401);
    expect(w.create).not.toHaveBeenCalled();
  });

  it("another member's customer can never be opened: with no billing record of their own the answer is no_subscription, not someone else's portal", async () => {
    const w = makeWorld({ rows: { [OTHER.id]: { customerId: "cus_OTHER222", status: "active" } } }); // ME has no row
    const res = await handlePortalRequest(req(), w.deps);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "no_subscription" });
    expect(w.create).not.toHaveBeenCalled();
  });

  it("an authentication failure that throws is a 401, not a crash", async () => {
    const w = makeWorld();
    w.authenticate.mockRejectedValue(new Error("auth down"));
    expect((await handlePortalRequest(req(), w.deps)).status).toBe(401);
  });

  it("the request cannot name a customer, subscription, account, session, return URL or configuration: any such body is refused before anything is looked up", async () => {
    const bodies = [
      { customer: "cus_OTHER222" },
      { customerId: "cus_OTHER222" },
      { subscription: "sub_123" },
      { user_id: OTHER.id },
      { account: OTHER.id },
      { return_url: "https://evil.example/" },
      { configuration: "bpc_x" },
      { flow_data: { type: "subscription_cancel" } },
      { plan: "annual" },
    ];
    for (const b of bodies) {
      const w = makeWorld();
      const res = await handlePortalRequest(req({ body: JSON.stringify(b) }), w.deps);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect(await json(res)).toEqual({ error: "invalid_request" });
      expect(w.lookups).toEqual([]);
      expect(w.create).not.toHaveBeenCalled();
    }
    for (const text of ["not json", "[]", "null", "[{}]", '"cus_x"', "1"]) {
      const w = makeWorld();
      expect((await handlePortalRequest(req({ body: text }), w.deps)).status, text).toBe(400);
    }
  });

  it("query-string tricks on the URL change nothing: the customer and return URL still come only from the server", async () => {
    const w = makeWorld();
    const r = new Request(`${ORIGIN}/api/billing/portal?customer=cus_OTHER222&return_url=https://evil.example`, { method: "POST", headers: { origin: ORIGIN, authorization: "Bearer good-token" } });
    expect((await handlePortalRequest(r, w.deps)).status).toBe(200);
    expect(w.create).toHaveBeenCalledWith({ customer: "cus_ME111", return_url: `${ORIGIN}/standup/settings?portal=return` });
  });

  it("isEmptyPortalBody: only empty or {} qualifies", () => {
    expect(isEmptyPortalBody("")).toBe(true);
    expect(isEmptyPortalBody("{}")).toBe(true);
    expect(isEmptyPortalBody('{"a":1}')).toBe(false);
    expect(isEmptyPortalBody("[]")).toBe(false);
    expect(isEmptyPortalBody("x".repeat(100))).toBe(false);
  });
});

describe("origins and the return URL", () => {
  it("an untrusted, missing or look-alike Origin is 403 and nothing else happens", async () => {
    for (const origin of ["https://evil.example", "https://standup-app-two.vercel.app.evil.example", "http://standup-app-two.vercel.app", "https://standup-app-two.vercel.app/", "null", "http://localhost:3000", null]) {
      const w = makeWorld();
      const res = await handlePortalRequest(req({ origin }), w.deps);
      expect(res.status, String(origin)).toBe(403);
      expect(await json(res)).toEqual({ error: "forbidden_origin" });
      expect(w.authenticate).not.toHaveBeenCalled();
      expect(w.create).not.toHaveBeenCalled();
    }
  });

  it("the return URL is the trusted origin plus the fixed Settings path, whatever else the request carries; localhost is trusted only outside production", async () => {
    const dev = makeWorld({ env: { NODE_ENV: "development" } });
    await handlePortalRequest(req({ origin: "http://localhost:3000" }), dev.deps);
    expect(dev.create).toHaveBeenCalledWith(expect.objectContaining({ return_url: "http://localhost:3000/standup/settings?portal=return" }));
    const extra = makeWorld({ env: { BILLING_TRUSTED_ORIGINS: "https://staging.example.com" } });
    await handlePortalRequest(req({ origin: "https://staging.example.com" }), extra.deps);
    expect(extra.create).toHaveBeenCalledWith(expect.objectContaining({ return_url: "https://staging.example.com/standup/settings?portal=return" }));
  });
});

describe("independent of the Checkout flags (step 8.1)", () => {
  const ALL_OFF = { premium_promotion_enabled: false, premium_trial_activation_enabled: false, billing_checkout_enabled: false };
  const CHECKOUT_ON = { premium_promotion_enabled: true, premium_trial_activation_enabled: true, billing_checkout_enabled: true };

  async function viaDefaultDependencies(flags: Record<string, boolean>) {
    // the real dependency wiring (no deps argument): the flag reader is mocked so we can prove it is never even consulted
    const serverAuth = await import("@/lib/billing/serverAuth");
    const stripeMod = await import("@/lib/billing/stripe");
    const storeMod = await import("@/lib/billing/portalStore");
    const create = vi.fn(async () => ({ url: PORTAL_URL }));
    vi.mocked(serverAuth.authenticateUser).mockImplementation(async (t: string) => (t === "good-token" ? ME : null));
    vi.mocked(serverAuth.readFeatureFlagsForUser).mockResolvedValue(flags as never);
    vi.mocked(stripeMod.getStripe).mockReturnValue({ billingPortal: { sessions: { create } } } as never);
    vi.mocked(storeMod.createPortalStore).mockReturnValue({ customerFor: async (id: string) => (id === ME.id ? { customerId: "cus_ME111", status: "active" } : null) });
    vi.stubEnv("STRIPE_SECRET_KEY", SECRET);
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthlyAAA");
    vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annualBBB");
    const res = await handlePortalRequest(req());
    return { res, create, flagReader: vi.mocked(serverAuth.readFeatureFlagsForUser) };
  }

  afterEach(() => vi.unstubAllEnvs());

  it("a subscriber reaches the portal with promotion, Checkout and the trial flag ALL OFF, and the flag reader is never consulted", async () => {
    const { res, create, flagReader } = await viaDefaultDependencies(ALL_OFF);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ url: PORTAL_URL });
    expect(create).toHaveBeenCalledWith({ customer: "cus_ME111", return_url: `${ORIGIN}/standup/settings?portal=return` });
    expect(flagReader).not.toHaveBeenCalled();
  });

  it("the answer is identical whatever the flags say: all off, all on, or only one of the Checkout pair on", async () => {
    for (const flags of [ALL_OFF, CHECKOUT_ON, { ...ALL_OFF, billing_checkout_enabled: true }, { ...ALL_OFF, premium_promotion_enabled: true }]) {
      const { res } = await viaDefaultDependencies(flags);
      expect(res.status, JSON.stringify(flags)).toBe(200);
    }
  });

  it("the dependency list no longer includes a flag reader, and no 'portal_disabled' answer exists", async () => {
    const w = makeWorld();
    expect(Object.keys(w.deps)).not.toContain("readFlags");
    const src = (await import("fs")).readFileSync(new URL("./portal.ts", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/featureFlags|readFeatureFlags|showCheckout|premium_promotion_enabled|billing_checkout_enabled|portal_disabled/);
  });

  it("with the flags off, everyone who should be blocked still is: no sign-in, a bad Origin, no billing record, a canceled subscription", async () => {
    const noAuth = await viaDefaultDependencies(ALL_OFF).then(async () => handlePortalRequest(req({ auth: null })));
    expect(noAuth.status).toBe(401);
    const badOrigin = await handlePortalRequest(req({ origin: "https://evil.example" }));
    expect(badOrigin.status).toBe(403);
    const none = makeWorld({ rows: {} });
    expect((await handlePortalRequest(req(), none.deps)).status).toBe(409);
    const canceled = makeWorld({ rows: { [ME.id]: { customerId: "cus_ME111", status: "canceled" } } });
    expect((await handlePortalRequest(req(), canceled.deps)).status).toBe(409);
    expect(none.create).not.toHaveBeenCalled();
    expect(canceled.create).not.toHaveBeenCalled();
  });

  it("every eligible status works with the flags off (active, trialing, past_due, unpaid, paused)", async () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused"]) {
      const w = makeWorld({ rows: { [ME.id]: { customerId: "cus_ME111", status } } });
      expect((await handlePortalRequest(req(), w.deps)).status, status).toBe(200);
    }
  });
});

describe("members with nothing to manage", () => {
  it("no billing record, no customer, or a subscription that is over, never started or unrecognised: 409 no_subscription and no Stripe call", async () => {
    const cases: Record<string, Record<string, PortalCustomer>> = {
      "no record": {},
      canceled: { [ME.id]: { customerId: "cus_ME111", status: "canceled" } },
      incomplete_expired: { [ME.id]: { customerId: "cus_ME111", status: "incomplete_expired" } },
      incomplete: { [ME.id]: { customerId: "cus_ME111", status: "incomplete" } },
      unknown: { [ME.id]: { customerId: "cus_ME111", status: "something_new" } },
      "no status": { [ME.id]: { customerId: "cus_ME111", status: null } },
    };
    for (const [name, rows] of Object.entries(cases)) {
      const w = makeWorld({ rows });
      const res = await handlePortalRequest(req(), w.deps);
      expect(res.status, name).toBe(409);
      expect(await json(res)).toEqual({ error: "no_subscription" });
      expect(w.create).not.toHaveBeenCalled();
    }
  });

  it("an admin grant or a trial is not a subscription: with no billing record there is no portal", async () => {
    const w = makeWorld({ rows: {} });
    expect((await handlePortalRequest(req(), w.deps)).status).toBe(409);
  });
});

describe("failures never leak identifiers", () => {
  const secrets = [SECRET, "cus_ME111", "cus_OTHER222", ME.id, "price_monthlyAAA", "good-token"];
  const noLeak = (text: string) => {
    for (const s of secrets) expect(text, s).not.toContain(s);
  };

  it("a Stripe error becomes 502 portal_failed, with only the kind of failure logged (never Stripe's message, which can quote IDs and keys)", async () => {
    const err = Object.assign(new Error(`No such customer: cus_ME111; key ${SECRET}`), { type: "StripeInvalidRequestError", code: "portal_not_configured", statusCode: 400 });
    const w = makeWorld({ stripeError: err });
    const res = await handlePortalRequest(req(), w.deps);
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "portal_failed" });
    noLeak(body);
    expect(logs).toEqual([["billing portal: Stripe request failed", { type: "StripeInvalidRequestError", code: "portal_not_configured", status: 400 }]]);
    noLeak(JSON.stringify(logs));
  });

  it("a customer that no longer exists in Stripe is no_subscription (nothing to manage), not a generic outage", async () => {
    const w = makeWorld({ stripeError: Object.assign(new Error("No such customer: cus_ME111"), { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 }) });
    const res = await handlePortalRequest(req(), w.deps);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "no_subscription" });
    noLeak(JSON.stringify(logs));
  });

  it("an expired or malformed session URL from Stripe is never handed to the browser", async () => {
    for (const url of [null, "", "https://evil.example/p/session", "http://billing.stripe.com/p", "https://billing.stripe.com.evil.example/p", "javascript:alert(1)"]) {
      const w = makeWorld({ url });
      const res = await handlePortalRequest(req(), w.deps);
      expect(res.status, String(url)).toBe(502);
      expect(await json(res)).toEqual({ error: "portal_failed" });
    }
  });

  it("an unreadable billing store or bad Stripe configuration is 503 billing_unavailable and calls Stripe not at all", async () => {
    const a = makeWorld({ storeError: true });
    const ra = await handlePortalRequest(req(), a.deps);
    expect(ra.status).toBe(503);
    expect(await json(ra)).toEqual({ error: "billing_unavailable" });
    expect(a.create).not.toHaveBeenCalled();
    const b = makeWorld({ configBad: true });
    expect((await handlePortalRequest(req(), b.deps)).status).toBe(503);
    expect(b.create).not.toHaveBeenCalled();
    noLeak(JSON.stringify(logs));
  });

  it("the store failing to even construct is 503", async () => {
    const w = makeWorld();
    w.deps.portalStore = () => {
      throw new Error("missing env");
    };
    expect((await handlePortalRequest(req(), w.deps)).status).toBe(503);
  });
});

describe("what the portal does not do", () => {
  it("the endpoint writes nothing: its dependencies offer no way to change an entitlement, billing row or subscription", () => {
    const w = makeWorld();
    expect(Object.keys(w.deps).sort()).toEqual(["authenticate", "env", "portalStore", "readConfig", "stripe"]);
    expect(Object.keys(w.deps.portalStore())).toEqual(["customerFor"]);
  });

  it("it never opens a portal flow that changes the subscription itself: the session is created with a customer and a return URL only (plus an optional pinned configuration)", async () => {
    const w = makeWorld({ env: { STRIPE_PORTAL_CONFIGURATION: "bpc_1ABC" } });
    await handlePortalRequest(req(), w.deps);
    const params = w.create.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(["configuration", "customer", "return_url"]);
    expect(params).not.toHaveProperty("flow_data");
  });
});

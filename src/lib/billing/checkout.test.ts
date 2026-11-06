// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/serverAuth", () => ({ authenticateUser: vi.fn(), readFeatureFlagsForUser: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn() }));

import { checkoutIdempotencyKey, handleCheckoutRequest, parseCheckoutBody, type CheckoutDeps } from "./checkout";
import { BillingConfigError, readBillingConfig } from "./config";
import { DEFAULT_FEATURE_FLAGS } from "@/lib/featureFlags";

const ORIGIN = "https://standup-app-two.vercel.app";
const SECRET = "sk_test_SECRETVALUE123";
const config = readBillingConfig({ STRIPE_SECRET_KEY: SECRET, STRIPE_PRICE_MONTHLY: "price_monthlyAAA", STRIPE_PRICE_ANNUAL: "price_annualBBB" });
const ON = { premium_promotion_enabled: true, premium_trial_activation_enabled: false, billing_checkout_enabled: true };
const USER = { id: "11111111-2222-3333-4444-555555555555" };

const create = vi.fn();
const deps = (over: Partial<CheckoutDeps> = {}): CheckoutDeps => ({
  env: { NODE_ENV: "production" },
  authenticate: vi.fn(async (t: string) => (t === "good-token" ? USER : null)),
  readFlags: vi.fn(async () => ON),
  readConfig: vi.fn(() => config),
  stripe: vi.fn(() => ({ checkout: { sessions: { create } } })),
  now: () => 1_800_000_000_000,
  ...over,
});
const req = (o: { body?: unknown; raw?: string; origin?: string | null; auth?: string | null } = {}) =>
  new Request("https://standup-app-two.vercel.app/api/billing/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }),
      ...(o.auth === null ? {} : { authorization: o.auth ?? "Bearer good-token" }),
    },
    body: o.raw ?? JSON.stringify(o.body ?? { plan: "monthly" }),
  });
const errorOf = async (r: Response) => (await r.json()).error;

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test_abc" });
});

describe("beta: checkout is blocked by the feature flags, before Stripe", () => {
  it("with every flag off (the current beta) the request is refused and nothing external happens", async () => {
    const d = deps({ readFlags: vi.fn(async () => DEFAULT_FEATURE_FLAGS) });
    const r = await handleCheckoutRequest(req(), d);
    expect(r.status).toBe(403);
    expect(await errorOf(r)).toBe("checkout_disabled");
    expect(d.readConfig).not.toHaveBeenCalled();
    expect(d.stripe).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("needs BOTH billing_checkout_enabled and premium_promotion_enabled", async () => {
    for (const flags of [
      { ...DEFAULT_FEATURE_FLAGS, billing_checkout_enabled: true },
      { ...DEFAULT_FEATURE_FLAGS, premium_promotion_enabled: true },
      { ...DEFAULT_FEATURE_FLAGS, premium_trial_activation_enabled: true },
    ]) {
      const r = await handleCheckoutRequest(req(), deps({ readFlags: vi.fn(async () => flags) }));
      expect(r.status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    }
    expect((await handleCheckoutRequest(req(), deps())).status).toBe(200);
  });
  it("a failure to read the flags blocks checkout rather than allowing it", async () => {
    const r = await handleCheckoutRequest(req(), deps({ readFlags: vi.fn(async () => Promise.reject(new Error("db down"))) }));
    expect(r.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
  it("a bad request is refused as disabled first when the flags are off (the flags are checked before the body)", async () => {
    const d = deps({ readFlags: vi.fn(async () => DEFAULT_FEATURE_FLAGS) });
    expect(await errorOf(await handleCheckoutRequest(req({ body: { plan: "lifetime" } }), d))).toBe("checkout_disabled");
  });
});

describe("authentication", () => {
  it("no Authorization header: 401, and nothing else is read or called", async () => {
    const d = deps();
    const r = await handleCheckoutRequest(req({ auth: null }), d);
    expect(r.status).toBe(401);
    expect(await errorOf(r)).toBe("unauthenticated");
    expect(d.readFlags).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("a malformed or unknown token: 401", async () => {
    for (const auth of ["good-token", "Basic abc", "Bearer ", "Bearer bad-token", "Bearer two tokens"]) {
      expect((await handleCheckoutRequest(req({ auth }), deps())).status).toBe(401);
    }
    expect(create).not.toHaveBeenCalled();
  });
  it("a verification error counts as unauthenticated", async () => {
    const r = await handleCheckoutRequest(req(), deps({ authenticate: vi.fn(async () => Promise.reject(new Error("boom"))) }));
    expect(r.status).toBe(401);
  });
  it("the signed-in user comes only from the verified token, never from the body", async () => {
    const r = await handleCheckoutRequest(req({ body: { plan: "monthly", userId: "someone-else" } }), deps());
    expect(r.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("plan and body validation", () => {
  it("accepts only monthly or annual", () => {
    expect(parseCheckoutBody('{"plan":"monthly"}')).toBe("monthly");
    expect(parseCheckoutBody('{"plan":"annual"}')).toBe("annual");
    for (const bad of ['{"plan":"yearly"}', '{"plan":"lifetime"}', '{"plan":""}', '{"plan":null}', '{"plan":["monthly"]}', "{}", "[]", '"monthly"', "null", "monthly", "", "{"]) {
      expect(parseCheckoutBody(bad)).toBeNull();
    }
  });
  it("refuses any extra field: a Price ID, amount, customer or redirect URL from the client is never read", async () => {
    for (const extra of [{ priceId: "price_evil" }, { price: "price_evil" }, { amount: 1 }, { unit_amount: 1 }, { customer: "cus_x" }, { successUrl: "https://evil.example" }, { success_url: "https://evil.example" }, { cancel_url: "https://evil.example" }, { mode: "payment" }]) {
      const r = await handleCheckoutRequest(req({ body: { plan: "monthly", ...extra } }), deps());
      expect(r.status).toBe(400);
      expect(await errorOf(r)).toBe("invalid_request");
    }
    expect(create).not.toHaveBeenCalled();
  });
  it("refuses an oversized body", async () => {
    expect((await handleCheckoutRequest(req({ raw: JSON.stringify({ plan: "monthly", pad: "x".repeat(2000) }) }), deps())).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("redirects", () => {
  it("refuses an untrusted, missing or look-alike origin before anything else", async () => {
    for (const origin of ["https://evil.example", "http://standup-app-two.vercel.app", "https://standup-app-two.vercel.app.evil.example", "https://standup-app-two.vercel.app/", "null", "http://localhost:3000", null]) {
      const d = deps();
      const r = await handleCheckoutRequest(req({ origin }), d);
      expect(r.status).toBe(403);
      expect(await errorOf(r)).toBe("forbidden_origin");
      expect(d.authenticate).not.toHaveBeenCalled();
    }
    expect(create).not.toHaveBeenCalled();
  });
  it("builds success and cancel URLs from the trusted origin and a fixed path", async () => {
    await handleCheckoutRequest(req(), deps());
    const params = create.mock.calls[0][0];
    expect(params.success_url).toBe(`${ORIGIN}/standup/settings?checkout=success`);
    expect(params.cancel_url).toBe(`${ORIGIN}/standup/settings?checkout=cancelled`);
  });
  it("allows localhost only outside production", async () => {
    expect((await handleCheckoutRequest(req({ origin: "http://localhost:3000" }), deps({ env: { NODE_ENV: "development" } }))).status).toBe(200);
    expect((await handleCheckoutRequest(req({ origin: "http://localhost:3000" }), deps({ env: { NODE_ENV: "production" } }))).status).toBe(403);
  });
});

describe("the Checkout session", () => {
  it("is subscription mode, with the Price resolved on the server for each plan", async () => {
    await handleCheckoutRequest(req({ body: { plan: "monthly" } }), deps());
    await handleCheckoutRequest(req({ body: { plan: "annual" } }), deps());
    const [m, a] = create.mock.calls.map((c) => c[0]);
    expect(m.mode).toBe("subscription");
    expect(m.line_items).toEqual([{ price: "price_monthlyAAA", quantity: 1 }]);
    expect(a.line_items).toEqual([{ price: "price_annualBBB", quantity: 1 }]);
  });
  it("is tied to the authenticated user, and carries nothing the client chose beyond the plan", async () => {
    await handleCheckoutRequest(req({ body: { plan: "annual" } }), deps());
    const p = create.mock.calls[0][0];
    expect(p.client_reference_id).toBe(USER.id);
    expect(p.metadata).toEqual({ user_id: USER.id, plan: "annual" });
    expect(p.subscription_data.metadata).toEqual({ user_id: USER.id, plan: "annual" });
    for (const k of ["customer", "customer_email", "trial_period_days", "payment_method_types"]) expect(p).not.toHaveProperty(k);
    expect(JSON.stringify(p)).not.toMatch(/unit_amount|price_data|trial_period_days/);
  });
  it("returns only the Stripe Checkout URL", async () => {
    const r = await handleCheckoutRequest(req(), deps());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_abc" });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("creating a session grants nothing: the handler has no way to write an entitlement", async () => {
    const d = deps();
    await handleCheckoutRequest(req(), d);
    expect(Object.keys(d).sort()).toEqual(["authenticate", "env", "now", "readConfig", "readFlags", "stripe"]);
  });
});

describe("duplicate requests", () => {
  it("a retry within the window sends the same idempotency key, so Stripe returns the same session", async () => {
    await handleCheckoutRequest(req(), deps());
    await handleCheckoutRequest(req(), deps({ now: () => 1_800_000_000_000 + 60_000 }));
    const [k1, k2] = create.mock.calls.map((c) => c[1].idempotencyKey);
    expect(k1).toBe(k2);
  });
  it("a different user, plan, origin or later window gets a different key; the key is server-derived and hides the user id", () => {
    const base = checkoutIdempotencyKey(USER.id, "monthly", ORIGIN, 1_800_000_000_000);
    expect(checkoutIdempotencyKey("other-user", "monthly", ORIGIN, 1_800_000_000_000)).not.toBe(base);
    expect(checkoutIdempotencyKey(USER.id, "annual", ORIGIN, 1_800_000_000_000)).not.toBe(base);
    expect(checkoutIdempotencyKey(USER.id, "monthly", "https://other.example", 1_800_000_000_000)).not.toBe(base);
    expect(checkoutIdempotencyKey(USER.id, "monthly", ORIGIN, 1_800_000_000_000 + 10 * 60_000)).not.toBe(base);
    expect(base).toMatch(/^standup-checkout-[0-9a-f]{48}$/);
    expect(base).not.toContain(USER.id);
  });
});

describe("failures", () => {
  it("missing or invalid Stripe configuration: 503, generic, and Stripe is never contacted", async () => {
    const d = deps({ readConfig: vi.fn(() => { throw new BillingConfigError(["STRIPE_SECRET_KEY is missing"]); }) });
    const r = await handleCheckoutRequest(req(), d);
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body).toEqual({ error: "billing_unavailable" });
    expect(JSON.stringify(body)).not.toContain("STRIPE_SECRET_KEY");
    expect(d.stripe).not.toHaveBeenCalled();
  });
  it("a Stripe API failure: 502 with a generic body, and no secret or Stripe message leaks to the client or the log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValue(Object.assign(new Error(`Invalid API Key provided: ${SECRET}`), { type: "StripeAuthenticationError", code: "api_key_invalid", statusCode: 401 }));
    const r = await handleCheckoutRequest(req(), deps());
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "checkout_failed" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Invalid API Key");
    spy.mockRestore();
  });
  it("a session without a Stripe Checkout URL is treated as a failure, never passed on", async () => {
    for (const url of [null, "", "https://evil.example/pay", "http://checkout.stripe.com/x"]) {
      create.mockResolvedValue({ url });
      const r = await handleCheckoutRequest(req(), deps());
      expect(r.status).toBe(502);
    }
  });
});

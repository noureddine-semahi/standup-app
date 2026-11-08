// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/serverAuth", () => ({ authenticateUser: vi.fn(), readFeatureFlagsForUser: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/billing/checkoutStore", () => ({ createCheckoutStore: vi.fn() }));
vi.mock("@/lib/account/deletionStore", () => ({ createDeletionStore: vi.fn() }));

import { handleCheckoutRequest, type CheckoutDeps } from "./checkout";
import { readBillingConfig } from "./config";
import type { CheckoutStore } from "./checkoutStore";

const ORIGIN = "https://standup-app-two.vercel.app";
const config = readBillingConfig({ STRIPE_SECRET_KEY: "sk_test_SECRETVALUE123", STRIPE_PRICE_MONTHLY: "price_monthlyAAA", STRIPE_PRICE_ANNUAL: "price_annualBBB" });
const ON = { premium_promotion_enabled: true, premium_trial_activation_enabled: false, billing_checkout_enabled: true };
const ATT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function make(pending: (call: number) => boolean | Error) {
  const calls = { pending: 0, begin: 0, create: 0, expire: [] as string[], finish: [] as string[], record: 0 };
  const store: CheckoutStore = {
    async begin() {
      calls.begin++;
      return { result: "claimed", attemptId: ATT, plan: "monthly" };
    },
    async record() {
      calls.record++;
    },
    async finish(_id, status) {
      calls.finish.push(status);
    },
  };
  const deps: CheckoutDeps = {
    env: { NODE_ENV: "production" },
    authenticate: async (t) => (t === "good" ? { id: "11111111-2222-3333-4444-555555555555" } : null),
    readFlags: async () => ON,
    readConfig: () => config,
    checkoutStore: () => store,
    stripe: () => ({
      checkout: {
        sessions: {
          create: async () => {
            calls.create++;
            return { id: "cs_test_new", url: "https://checkout.stripe.com/c/pay/cs_test_new", expires_at: 1_900_000_000 };
          },
          retrieve: async () => ({ status: "open", url: null, subscription: null }),
          expire: async (id: string) => void calls.expire.push(id),
        },
      },
      subscriptions: { retrieve: async () => ({ status: "active" }) },
    }),
    deletionPending: async () => {
      const v = pending(++calls.pending);
      if (v instanceof Error) throw v;
      return v;
    },
  };
  return { deps, calls };
}
const req = () => new Request(`${ORIGIN}/api/billing/checkout`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, authorization: "Bearer good" }, body: JSON.stringify({ plan: "monthly" }) });

describe("Checkout while an account is being deleted", () => {
  it("normal case: no deletion in progress -> the session is created and returned (checked twice: before and after creation)", async () => {
    const { deps, calls } = make(() => false);
    const res = await handleCheckoutRequest(req(), deps);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(calls.pending).toBe(2);
    expect(calls.create).toBe(1);
  });

  it("a deletion already in progress: refused (403 checkout_disabled) before any attempt is claimed or Stripe is contacted", async () => {
    const { deps, calls } = make(() => true);
    const res = await handleCheckoutRequest(req(), deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "checkout_disabled" });
    expect(calls.begin).toBe(0);
    expect(calls.create).toBe(0);
  });

  it("the deletion starts while the session is being created: the new session is expired at once, the attempt closed, and the member gets nothing to pay", async () => {
    const { deps, calls } = make((n) => n >= 2);
    const res = await handleCheckoutRequest(req(), deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "checkout_disabled" });
    expect(calls.create).toBe(1);
    expect(calls.expire).toEqual(["cs_test_new"]);
    expect(calls.finish).toEqual(["expired"]);
    expect(calls.record).toBe(0); // a session that was never handed out isn't recorded as open
  });

  it("if the deletion state can't be read, fail closed: 503 before anything is claimed; and after creation the session is expired", async () => {
    const a = make(() => new Error("db down"));
    const ra = await handleCheckoutRequest(req(), a.deps);
    expect(ra.status).toBe(503);
    expect(a.calls.begin).toBe(0);
    const b = make((n) => (n === 1 ? false : new Error("db down")));
    const rb = await handleCheckoutRequest(req(), b.deps);
    expect(rb.status).toBe(403);
    expect(b.calls.expire).toEqual(["cs_test_new"]);
  });

  it("the deletion check never reveals anything: the answers are the existing generic codes", async () => {
    const { deps } = make(() => true);
    const text = await (await handleCheckoutRequest(req(), deps)).text();
    expect(text).not.toMatch(/delet/i);
  });
});

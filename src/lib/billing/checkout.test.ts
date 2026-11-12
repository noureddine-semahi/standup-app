// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/serverAuth", () => ({ authenticateUser: vi.fn(), readFeatureFlagsForUser: vi.fn() }));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/billing/checkoutStore", () => ({ createCheckoutStore: vi.fn() }));
vi.mock("@/lib/account/deletionStore", () => ({ createDeletionStore: vi.fn() }));

import { checkoutIdempotencyKey, handleCheckoutRequest, parseCheckoutBody, type CheckoutDeps, type CheckoutStripe } from "./checkout";
import { BillingConfigError, readBillingConfig } from "./config";
import { DEFAULT_FEATURE_FLAGS } from "@/lib/featureFlags";
import type { BeginResult, CheckoutStore } from "./checkoutStore";
import type { BillingPlan } from "./plans";

const ORIGIN = "https://standup-app-two.vercel.app";
const SECRET = "sk_test_SECRETVALUE123";
const config = readBillingConfig({ STRIPE_SECRET_KEY: SECRET, STRIPE_PRICE_MONTHLY: "price_monthlyAAA", STRIPE_PRICE_ANNUAL: "price_annualBBB" });
const ON = { premium_promotion_enabled: true, premium_trial_activation_enabled: false, billing_checkout_enabled: true };
const USER = { id: "11111111-2222-3333-4444-555555555555" };
const OTHER = { id: "99999999-8888-7777-6666-555555555555" };

// ---- an in-memory model of public.begin_checkout_attempt / record_checkout_session / finish_checkout_attempt (each begin() is one synchronous step, like the
// single locked transaction in the database), plus a fake Stripe with idempotency keys ----
type Attempt = { id: string; userId: string; plan: BillingPlan; status: "creating" | "open" | "completed" | "expired" | "failed"; sessionId: string | null; expiresAtMs: number | null; updatedAt: number };
function makeWorld(billing: Record<string, string | null> = {}) {
  let clock = 1_800_000_000_000;
  let seq = 0;
  const attempts: Attempt[] = [];
  const store: CheckoutStore = {
    async begin(userId, plan): Promise<BeginResult> {
      const status = billing[userId];
      if (status !== undefined && !(status === "canceled" || status === "incomplete_expired")) return { result: "subscription_exists" };
      const a = attempts.find((x) => x.userId === userId && (x.status === "creating" || x.status === "open"));
      if (a) {
        if (a.status === "creating") {
          if (a.updatedAt > clock - 2 * 60_000) return { result: "in_progress" };
          if (a.plan === plan) {
            a.updatedAt = clock;
            return { result: "claimed", attemptId: a.id, plan: a.plan };
          }
          a.status = "expired";
        } else if (a.sessionId && (a.expiresAtMs === null || clock <= a.expiresAtMs + 15 * 60_000)) {
          return { result: "pending", attemptId: a.id, sessionId: a.sessionId, plan: a.plan };
        } else a.status = "expired";
      }
      const id = `att-${++seq}`;
      attempts.push({ id, userId, plan, status: "creating", sessionId: null, expiresAtMs: null, updatedAt: clock });
      return { result: "claimed", attemptId: id, plan };
    },
    async record(attemptId, sessionId, expiresAt) {
      const a = attempts.find((x) => x.id === attemptId && x.status === "creating");
      if (a) Object.assign(a, { status: "open", sessionId, expiresAtMs: expiresAt ? Date.parse(expiresAt) : null, updatedAt: clock });
    },
    async finish(attemptId, status) {
      const a = attempts.find((x) => x.id === attemptId && (x.status === "creating" || x.status === "open"));
      if (a) Object.assign(a, { status, updatedAt: clock });
    },
  };

  type Sess = { id: string; status: "open" | "complete" | "expired"; url: string; subscription: string | null; params: Record<string, unknown>; plan: BillingPlan };
  const sessions = new Map<string, Sess>();
  const subs = new Map<string, string>();
  const byKey = new Map<string, Sess>();
  const calls = { create: 0, retrieve: 0, expire: 0 };
  let createDelay = 5;
  const failures = { create: false, retrieve: false, expire: false };
  const stripe: CheckoutStripe = {
    checkout: {
      sessions: {
        async create(params, options) {
          calls.create++;
          await new Promise((r) => setTimeout(r, createDelay));
          if (failures.create) throw Object.assign(new Error(`Invalid API Key provided: ${SECRET}`), { type: "StripeAuthenticationError", code: "api_key_invalid", statusCode: 401 });
          const key = options?.idempotencyKey ?? "";
          const prior = byKey.get(key);
          if (prior) return { id: prior.id, url: prior.url, expires_at: Math.floor((clock + 86_400_000) / 1000) };
          const id = `cs_test_${++seq}`;
          const price = (params.line_items as { price: string }[])[0].price;
          const s: Sess = { id, status: "open", url: `https://checkout.stripe.com/c/pay/${id}`, subscription: null, params: params as unknown as Record<string, unknown>, plan: price === "price_annualBBB" ? "annual" : "monthly" };
          sessions.set(id, s);
          byKey.set(key, s);
          return { id, url: s.url, expires_at: Math.floor((clock + 86_400_000) / 1000) };
        },
        async retrieve(id) {
          calls.retrieve++;
          if (failures.retrieve) throw new Error("stripe down");
          const s = sessions.get(id)!;
          return { status: s.status, url: s.status === "open" ? s.url : null, subscription: s.subscription };
        },
        async expire(id) {
          calls.expire++;
          if (failures.expire) throw new Error("stripe down");
          const s = sessions.get(id)!;
          if (s.status !== "open") throw new Error("not open");
          s.status = "expired";
          return {};
        },
      },
    },
    subscriptions: { async retrieve(id) { return { status: subs.get(id) ?? "active" }; } },
  };
  return {
    store, stripe, attempts, sessions, subs, calls, failures, billing,
    advance: (ms: number) => void (clock += ms),
    setCreateDelay: (ms: number) => void (createDelay = ms),
    openSessions: () => [...sessions.values()].filter((s) => s.status === "open"),
  };
}

const deps = (world: ReturnType<typeof makeWorld>, over: Partial<CheckoutDeps> = {}): CheckoutDeps => ({
  env: { NODE_ENV: "production" },
  authenticate: vi.fn(async (t: string) => (t === "good-token" ? USER : t === "other-token" ? OTHER : null)),
  readFlags: vi.fn(async () => ON),
  readConfig: vi.fn(() => config),
  checkoutStore: vi.fn(() => world.store),
  stripe: vi.fn(() => world.stripe),
  deletionPending: vi.fn(async () => false),
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
const run = async (d: CheckoutDeps, r = req()) => {
  const res = await handleCheckoutRequest(r, d);
  return { status: res.status, body: (await res.json()) as { url?: string; error?: string }, headers: res.headers };
};
const errorOf = (r: { body: { error?: string } }) => r.body.error;

let world: ReturnType<typeof makeWorld>;
beforeEach(() => {
  world = makeWorld();
});

describe("beta: checkout is blocked by the feature flags, before the attempt ledger and Stripe", () => {
  it("with every flag off the request is refused and neither the ledger nor Stripe is touched", async () => {
    const d = deps(world, { readFlags: vi.fn(async () => DEFAULT_FEATURE_FLAGS) });
    const r = await run(d);
    expect(r.status).toBe(403);
    expect(errorOf(r)).toBe("checkout_disabled");
    expect(d.checkoutStore).not.toHaveBeenCalled();
    expect(d.readConfig).not.toHaveBeenCalled();
    expect(d.stripe).not.toHaveBeenCalled();
    expect(world.attempts).toHaveLength(0);
  });
  it("needs BOTH billing_checkout_enabled and premium_promotion_enabled, and a failure to read the flags blocks", async () => {
    for (const flags of [{ ...DEFAULT_FEATURE_FLAGS, billing_checkout_enabled: true }, { ...DEFAULT_FEATURE_FLAGS, premium_promotion_enabled: true }]) {
      expect((await run(deps(world, { readFlags: vi.fn(async () => flags) }))).status).toBe(403);
    }
    expect((await run(deps(world, { readFlags: vi.fn(async () => Promise.reject(new Error("db down"))) }))).status).toBe(403);
    expect(world.calls.create).toBe(0);
    expect((await run(deps(world))).status).toBe(200);
  });
});

describe("authentication and request checks (unchanged)", () => {
  it("refuses a missing or invalid sign-in with 401 and touches nothing else", async () => {
    for (const auth of [null, "Bearer bad-token", "Basic abc", "Bearer ", "Bearer two tokens"]) {
      const d = deps(world);
      expect((await run(d, req({ auth }))).status).toBe(401);
      expect(d.readFlags).not.toHaveBeenCalled();
    }
    expect(world.attempts).toHaveLength(0);
  });
  it("refuses an untrusted or missing origin before authenticating", async () => {
    for (const origin of ["https://evil.example", "http://standup-app-two.vercel.app", "https://standup-app-two.vercel.app/", "null", null]) {
      const d = deps(world);
      const r = await run(d, req({ origin }));
      expect(r.status).toBe(403);
      expect(errorOf(r)).toBe("forbidden_origin");
      expect(d.authenticate).not.toHaveBeenCalled();
    }
  });
  it("accepts only {plan} and refuses any extra field", () => {
    expect(parseCheckoutBody('{"plan":"monthly"}')).toBe("monthly");
    for (const bad of ['{"plan":"yearly"}', "{}", "[]", "null", "", "{", '{"plan":"monthly","priceId":"price_evil"}', '{"plan":"monthly","customer":"cus_x"}', '{"plan":"monthly","success_url":"https://evil.example"}', '{"plan":"monthly","userId":"someone-else"}']) {
      expect(parseCheckoutBody(bad)).toBeNull();
    }
  });
  it("refuses a bad body with 400 before the ledger or Stripe", async () => {
    const d = deps(world);
    expect((await run(d, req({ body: { plan: "monthly", priceId: "price_evil" } }))).status).toBe(400);
    expect(world.attempts).toHaveLength(0);
    expect(world.calls.create).toBe(0);
  });
  it("missing Stripe configuration is a generic 503 before the ledger or Stripe", async () => {
    const d = deps(world, { readConfig: vi.fn(() => { throw new BillingConfigError(["STRIPE_SECRET_KEY is missing"]); }) });
    const r = await run(d);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "billing_unavailable" });
    expect(d.checkoutStore).not.toHaveBeenCalled();
  });
});

describe("live mode: owner-only allowlist", () => {
  const LIST = "STRIPE_LIVE_CHECKOUT_USER_IDS";
  const live = { readConfig: vi.fn(() => ({ ...config, mode: "live" as const })) };
  const withList = (value: string | undefined) => ({ ...live, env: { NODE_ENV: "production", ...(value === undefined ? {} : { [LIST]: value }) } });

  it("an allowlisted account can start Checkout (case and spacing tolerated)", async () => {
    const r = await run(deps(world, withList(` ${OTHER.id}, ${USER.id.toUpperCase()} `)));
    expect(r.status).toBe(200);
    expect(world.calls.create).toBe(1);
  });
  it("an account that is not listed is refused before any attempt or Stripe call", async () => {
    const r = await run(deps(world, withList(OTHER.id)));
    expect([r.status, errorOf(r)]).toEqual([403, "checkout_disabled"]);
    expect(world.calls.create).toBe(0);
    expect(world.attempts).toHaveLength(0);
  });
  it("fails closed: a missing, empty or malformed allowlist allows nobody", async () => {
    for (const v of [undefined, "", "   ", "not-an-id", `${USER.id},oops`, `${USER.id};${OTHER.id}`]) {
      const r = await run(deps(world, withList(v)));
      expect([r.status, errorOf(r)]).toEqual([403, "checkout_disabled"]);
    }
    expect(world.calls.create).toBe(0);
    expect(world.attempts).toHaveLength(0);
  });
  it("the denial reveals nothing about the allowlist", async () => {
    const r = await run(deps(world, withList(OTHER.id)));
    expect(JSON.stringify(r.body)).not.toContain(OTHER.id);
  });
  it("test mode ignores the allowlist entirely (sandbox behaviour unchanged)", async () => {
    for (const v of [undefined, "not-an-id", OTHER.id]) {
      const r = await run(deps(world, { env: { NODE_ENV: "production", ...(v === undefined ? {} : { [LIST]: v }) } }));
      expect(r.status).toBe(200);
    }
  });
});

describe("a valid first-time checkout", () => {
  it("creates exactly one session: subscription mode, the configured Price, tied to the verified account, fixed redirects", async () => {
    const r = await run(deps(world));
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(world.calls.create).toBe(1);
    const p = [...world.sessions.values()][0].params as Record<string, unknown> & { line_items: { price: string; quantity: number }[]; metadata: Record<string, string> };
    expect(p.mode).toBe("subscription");
    expect(p.line_items).toEqual([{ price: "price_monthlyAAA", quantity: 1 }]);
    expect(p.client_reference_id).toBe(USER.id);
    expect(p.metadata).toEqual({ user_id: USER.id, plan: "monthly" });
    expect(p.success_url).toBe(`${ORIGIN}/standup/settings?checkout=success`);
    expect(p.cancel_url).toBe(`${ORIGIN}/standup/settings?checkout=cancelled`);
    for (const k of ["customer", "customer_email", "trial_period_days"]) expect(p).not.toHaveProperty(k);
  });
  it("records the attempt as open with its session, and the annual plan uses the annual Price", async () => {
    await run(deps(world), req({ body: { plan: "annual" } }));
    expect(world.attempts).toHaveLength(1);
    expect(world.attempts[0]).toMatchObject({ userId: USER.id, plan: "annual", status: "open" });
    expect(world.attempts[0].sessionId).toMatch(/^cs_test_/);
    expect(((([...world.sessions.values()][0].params as { line_items: { price: string }[] }).line_items[0].price))).toBe("price_annualBBB");
  });
  it("an admin Premium grant or the one-time trial alone never blocks: the guard reads only Stripe subscription records, so a member with neither is simply first-time", async () => {
    // the ledger is asked about the verified account and plan only; grants and trials live in tables it never sees
    const spy = vi.spyOn(world.store, "begin");
    expect((await run(deps(world))).status).toBe(200);
    expect(spy).toHaveBeenCalledWith(USER.id, "monthly");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("identity comes only from the verified sign-in: another member gets their own attempt, never the first member's session", async () => {
    const a = await run(deps(world));
    const b = await run(deps(world), req({ auth: "Bearer other-token" }));
    expect(a.body.url).not.toBe(b.body.url);
    expect(world.attempts.map((x) => x.userId).sort()).toEqual([OTHER.id, USER.id].sort());
    expect(world.calls.create).toBe(2);
  });
});

describe("an existing subscription blocks a second one", () => {
  it("every live or recoverable state is refused with 409 already_subscribed, and nothing is created", async () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete", "paused", "some_future_status", ""]) {
      const w = makeWorld({ [USER.id]: status });
      const r = await run(deps(w));
      expect(r.status).toBe(409);
      expect(errorOf(r)).toBe("already_subscribed");
      expect(w.calls.create).toBe(0);
      expect(w.attempts).toHaveLength(0);
    }
  });
  it("a record with no status at all is treated as live (fail closed)", async () => {
    const w = makeWorld({ [USER.id]: null });
    expect((await run(deps(w))).status).toBe(409);
  });
  it("a subscription that is over for good (canceled, incomplete_expired) allows a new checkout", async () => {
    for (const status of ["canceled", "incomplete_expired"]) {
      const w = makeWorld({ [USER.id]: status });
      expect((await run(deps(w))).status).toBe(200);
      expect(w.calls.create).toBe(1);
    }
  });
  it("another member's subscription never blocks this member", async () => {
    const w = makeWorld({ [OTHER.id]: "active" });
    expect((await run(deps(w))).status).toBe(200);
  });
});

describe("retries and an unfinished checkout", () => {
  it("asking again for the same plan continues the SAME checkout: the same URL, no second session", async () => {
    const first = await run(deps(world));
    const second = await run(deps(world));
    const third = await run(deps(world));
    expect(second.status).toBe(200);
    expect(second.body.url).toBe(first.body.url);
    expect(third.body.url).toBe(first.body.url);
    expect(world.calls.create).toBe(1);
    expect(world.openSessions()).toHaveLength(1);
  });
  it("choosing the other plan retires the old session first, so only one can ever be paid", async () => {
    const monthly = await run(deps(world), req({ body: { plan: "monthly" } }));
    const annual = await run(deps(world), req({ body: { plan: "annual" } }));
    expect(annual.status).toBe(200);
    expect(annual.body.url).not.toBe(monthly.body.url);
    expect(world.calls.expire).toBe(1);
    expect(world.openSessions()).toHaveLength(1);
    expect(world.openSessions()[0].plan).toBe("annual");
    expect(world.attempts.filter((a) => a.status === "open")).toHaveLength(1);
    // and going back works the same way
    const back = await run(deps(world), req({ body: { plan: "monthly" } }));
    expect(back.status).toBe(200);
    expect(world.openSessions()).toHaveLength(1);
  });
  it("a session that expired unpaid lets a new checkout start", async () => {
    const first = await run(deps(world));
    [...world.sessions.values()][0].status = "expired";
    const second = await run(deps(world));
    expect(second.status).toBe(200);
    expect(second.body.url).not.toBe(first.body.url);
    expect(world.attempts.filter((a) => a.status === "open")).toHaveLength(1);
    expect(world.attempts.filter((a) => a.status === "expired")).toHaveLength(1);
  });
  it("a session that was PAID but not yet synced (billing record missing) blocks another one: 409 already_subscribed", async () => {
    await run(deps(world));
    const s = [...world.sessions.values()][0];
    s.status = "complete";
    s.subscription = "sub_PAID";
    world.subs.set("sub_PAID", "active");
    const r = await run(deps(world));
    expect(r.status).toBe(409);
    expect(errorOf(r)).toBe("already_subscribed");
    expect(world.calls.create).toBe(1); // only the first
    expect(world.attempts[0].status).toBe("completed");
  });
  it("paid but the subscription then ENDED: a new checkout is allowed (a stale attempt can't block re-subscribing)", async () => {
    await run(deps(world));
    const s = [...world.sessions.values()][0];
    s.status = "complete";
    s.subscription = "sub_OLD";
    world.subs.set("sub_OLD", "canceled");
    const r = await run(deps(world));
    expect(r.status).toBe(200);
    expect(world.calls.create).toBe(2);
    expect(world.attempts.find((a) => a.status === "completed")).toBeTruthy();
  });
  it("paid with a still-recoverable subscription (past_due) blocks; a completed session with no subscription to inspect blocks (fail closed)", async () => {
    await run(deps(world));
    const s = [...world.sessions.values()][0];
    s.status = "complete";
    s.subscription = "sub_PD";
    world.subs.set("sub_PD", "past_due");
    expect((await run(deps(world))).status).toBe(409);
    const w2 = makeWorld();
    await run(deps(w2));
    const s2 = [...w2.sessions.values()][0];
    s2.status = "complete";
    s2.subscription = null;
    expect((await run(deps(w2))).status).toBe(409);
  });
  it("if Stripe can't be asked about the earlier session, nothing new is created (it might have been paid)", async () => {
    await run(deps(world));
    world.failures.retrieve = true;
    const r = await run(deps(world));
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: "checkout_failed" });
    expect(world.calls.create).toBe(1);
  });
  it("if the old session can't be expired (it may have just been paid), no new one is created", async () => {
    await run(deps(world), req({ body: { plan: "monthly" } }));
    world.failures.expire = true;
    const r = await run(deps(world), req({ body: { plan: "annual" } }));
    expect(r.status).toBe(502);
    expect(world.calls.create).toBe(1);
    expect(world.openSessions()).toHaveLength(1);
  });
});

describe("concurrent requests", () => {
  it("eight simultaneous requests for one member create exactly ONE session; the rest continue it or are told one is in progress", async () => {
    world.setCreateDelay(25);
    const results = await Promise.all(Array.from({ length: 8 }, () => run(deps(world))));
    expect(world.calls.create).toBe(1);
    expect(world.sessions.size).toBe(1);
    for (const r of results) expect([200, 409]).toContain(r.status);
    for (const r of results.filter((x) => x.status === 409)) expect(errorOf(r)).toBe("checkout_in_progress");
    const urls = new Set(results.filter((r) => r.status === 200).map((r) => r.body.url));
    expect(urls.size).toBe(1);
    expect(world.openSessions()).toHaveLength(1);
    // once settled, another request simply continues the same checkout
    const later = await run(deps(world));
    expect(later.status).toBe(200);
    expect(later.body.url).toBe([...urls][0]);
    expect(world.calls.create).toBe(1);
  });
  it("simultaneous requests for DIFFERENT plans still leave at most one payable session", async () => {
    world.setCreateDelay(15);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => run(deps(world), req({ body: { plan: i % 2 ? "annual" : "monthly" } }))));
    for (const r of results) expect([200, 409]).toContain(r.status);
    // settle any in-flight work, then follow up until the ledger is quiet
    await run(deps(world), req({ body: { plan: "annual" } }));
    expect(world.openSessions().length).toBeLessThanOrEqual(1);
    expect(world.attempts.filter((a) => a.status === "open" || a.status === "creating").length).toBeLessThanOrEqual(1);
  });
  it("two different members can check out at the same moment without blocking each other", async () => {
    world.setCreateDelay(15);
    const [a, b] = await Promise.all([run(deps(world)), run(deps(world), req({ auth: "Bearer other-token" }))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(world.calls.create).toBe(2);
  });
});

describe("stale claims and failures", () => {
  it("a claim younger than 2 minutes means 'in progress'", async () => {
    world.setCreateDelay(40);
    const slow = run(deps(world));
    await new Promise((r) => setTimeout(r, 5));
    const r = await run(deps(world));
    expect(r.status).toBe(409);
    expect(errorOf(r)).toBe("checkout_in_progress");
    expect((await slow).status).toBe(200);
  });
  it("a lost record step is harmless: the session is still returned, and a later retry re-adopts the claim and gets the SAME session (idempotency), never a second", async () => {
    const real = world.store.record;
    world.store.record = async () => Promise.reject(new Error("db blip"));
    const first = await run(deps(world));
    expect(first.status).toBe(200);
    world.store.record = real;
    expect(errorOf(await run(deps(world)))).toBe("checkout_in_progress"); // claim is fresh
    world.advance(3 * 60_000); // the claim goes stale
    const retry = await run(deps(world));
    expect(retry.status).toBe(200);
    expect(retry.body.url).toBe(first.body.url);
    expect(world.sessions.size).toBe(1);
    expect(world.attempts.filter((a) => a.status === "open")).toHaveLength(1);
  });
  it("a stale claim for a different plan is retired and replaced", async () => {
    const real = world.store.record;
    world.store.record = async () => Promise.reject(new Error("db blip"));
    await run(deps(world), req({ body: { plan: "monthly" } }));
    world.store.record = real;
    world.advance(3 * 60_000);
    const r = await run(deps(world), req({ body: { plan: "annual" } }));
    expect(r.status).toBe(200);
    expect(world.attempts.filter((a) => a.status === "creating" || a.status === "open")).toHaveLength(1);
  });
  it("a Stripe failure frees the slot, returns a generic 502, and leaks nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    world.failures.create = true;
    const r = await run(deps(world));
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: "checkout_failed" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Invalid API Key");
    spy.mockRestore();
    expect(world.attempts[0].status).toBe("failed");
    world.failures.create = false;
    expect((await run(deps(world))).status).toBe(200); // the member can try again straight away
    expect(world.sessions.size).toBe(1);
  });
  it("a session without a Stripe Checkout URL is a failure and frees the slot", async () => {
    const real = world.stripe.checkout.sessions.create;
    world.stripe.checkout.sessions.create = async (...a) => ({ ...(await real(...a)), url: "https://evil.example/pay" });
    const r = await run(deps(world));
    expect(r.status).toBe(502);
    expect(world.attempts[0].status).toBe("failed");
  });
  it("if the attempt ledger is unavailable there is no duplicate protection, so no session is created (503)", async () => {
    const d1 = deps(world, { checkoutStore: vi.fn(() => { throw new Error("no service key"); }) });
    expect((await run(d1)).status).toBe(503);
    const broken: CheckoutStore = { begin: async () => Promise.reject(new Error("db down")), record: async () => {}, finish: async () => {} };
    const d2 = deps(world, { checkoutStore: vi.fn(() => broken) });
    const r = await run(d2);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "billing_unavailable" });
    expect(world.calls.create).toBe(0);
  });
});

describe("idempotency key", () => {
  it("is derived from the claimed attempt, so a retry of one attempt is the same key and a new attempt is a new key; it hides the attempt id", () => {
    const k = checkoutIdempotencyKey("att-1", "monthly", ORIGIN);
    expect(checkoutIdempotencyKey("att-1", "monthly", ORIGIN)).toBe(k);
    expect(checkoutIdempotencyKey("att-2", "monthly", ORIGIN)).not.toBe(k);
    expect(checkoutIdempotencyKey("att-1", "annual", ORIGIN)).not.toBe(k);
    expect(checkoutIdempotencyKey("att-1", "monthly", "https://other.example")).not.toBe(k);
    expect(k).toMatch(/^standup-checkout-[0-9a-f]{48}$/);
    expect(k).not.toContain("att-1");
  });
});

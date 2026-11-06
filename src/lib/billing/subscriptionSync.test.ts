// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));

import { buildSyncArgs, createSubscriptionSyncHandler, subscriptionRef, type SubscriptionSyncDeps } from "./subscriptionSync";
import type { SubscriptionSyncArgs, SubscriptionSyncResult, WebhookStore } from "./webhookStore";

const USER = "0b8c1d1e-2f3a-4b5c-8d6e-7f8091a2b3c4";
const OTHER = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const PRICES = { monthly: "price_MONTHLY1", annual: "price_ANNUAL1" } as const;
const T0 = 1_800_000_000; // seconds

const item = (priceId: string, extra: Record<string, unknown> = {}) => ({ id: "si_1", price: { id: priceId }, current_period_start: T0, current_period_end: T0 + 30 * 86400, ...extra });
const subscription = (o: Record<string, unknown> = {}) =>
  ({ id: "sub_TEST1", object: "subscription", customer: "cus_TEST1", status: "active", livemode: false, cancel_at_period_end: false, canceled_at: null, ended_at: null, metadata: { user_id: USER }, items: { data: [item(PRICES.monthly)] }, ...o }) as unknown as Stripe.Subscription;
const event = (type: string, object: Record<string, unknown>, id = "evt_TEST1") => ({ id, type, livemode: false, data: { object } }) as unknown as Stripe.Event;

function fakeStore(result: SubscriptionSyncResult = "applied") {
  const calls: SubscriptionSyncArgs[] = [];
  const store: WebhookStore = {
    claim: async () => Promise.reject(new Error("the sync handler must not touch the event ledger")),
    complete: async () => Promise.reject(new Error("the sync handler must not touch the event ledger")),
    fail: async () => Promise.reject(new Error("the sync handler must not touch the event ledger")),
    syncSubscription: vi.fn(async (a: SubscriptionSyncArgs) => {
      calls.push(a);
      return result;
    }),
  };
  return { store, calls };
}
function setup(sub: Stripe.Subscription | (() => Stripe.Subscription) = subscription(), over: Partial<SubscriptionSyncDeps> = {}, result: SubscriptionSyncResult = "applied") {
  const order: string[] = [];
  let tick = 0;
  const deps: SubscriptionSyncDeps = {
    retrieveSubscription: vi.fn(async () => {
      order.push("retrieve");
      return typeof sub === "function" ? sub() : sub;
    }),
    prices: () => PRICES,
    now: () => {
      order.push("now");
      return new Date(T0 * 1000 + tick++ * 1000);
    },
    ...over,
  };
  const { store, calls } = fakeStore(result);
  return { handler: createSubscriptionSyncHandler(deps), deps, store, calls, order };
}

describe("which subscription an event is about", () => {
  it("checkout.session.completed: only subscription-mode sessions; hints are the client reference and the metadata user", () => {
    expect(subscriptionRef(event("checkout.session.completed", { mode: "subscription", subscription: "sub_A", client_reference_id: USER, metadata: { user_id: USER } }))).toEqual({ subscriptionId: "sub_A", userHints: [USER, USER] });
    expect(subscriptionRef(event("checkout.session.completed", { mode: "payment", subscription: "sub_A" }))).toBeNull();
    expect(subscriptionRef(event("checkout.session.completed", { mode: "subscription", subscription: null }))).toBeNull();
    expect(subscriptionRef(event("checkout.session.completed", { mode: "subscription", subscription: { id: "sub_EXPANDED" } }))?.subscriptionId).toBe("sub_EXPANDED");
  });
  it("customer.subscription.*: the subscription itself, with its metadata user as the hint", () => {
    for (const t of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]) {
      expect(subscriptionRef(event(t, { id: "sub_B", metadata: { user_id: USER } }))).toEqual({ subscriptionId: "sub_B", userHints: [USER] });
    }
  });
  it("invoice.*: the subscription from either API shape; no user hint", () => {
    expect(subscriptionRef(event("invoice.paid", { subscription: "sub_C" }))).toEqual({ subscriptionId: "sub_C", userHints: [] });
    expect(subscriptionRef(event("invoice.payment_failed", { parent: { subscription_details: { subscription: "sub_D" } } }))).toEqual({ subscriptionId: "sub_D", userHints: [] });
    expect(subscriptionRef(event("invoice.paid", { subscription: null }))).toBeNull();
  });
  it("other events, and events without a usable object, are not about a subscription", () => {
    expect(subscriptionRef(event("customer.created", { id: "cus_1" }))).toBeNull();
    expect(subscriptionRef({ id: "evt_x", type: "invoice.paid", data: {} } as unknown as Stripe.Event)).toBeNull();
  });
});

describe("what is recorded, from Stripe's own data", () => {
  const build = (sub: Stripe.Subscription, hints: string[] = [USER]) => buildSyncArgs(sub, PRICES, "evt_TEST1", hints, "2026-11-06T18:00:00.000Z");

  it("records subscription ID, customer, price, plan, status, billing period and timestamps", () => {
    const r = build(subscription({ status: "trialing", cancel_at_period_end: true, canceled_at: T0 + 5, ended_at: null }));
    expect(r).toEqual({
      ok: true,
      args: {
        eventId: "evt_TEST1",
        userHint: USER,
        customerId: "cus_TEST1",
        subscriptionId: "sub_TEST1",
        priceId: PRICES.monthly,
        plan: "monthly",
        status: "trialing",
        periodStart: new Date(T0 * 1000).toISOString(),
        periodEnd: new Date((T0 + 30 * 86400) * 1000).toISOString(),
        cancelAtPeriodEnd: true,
        canceledAt: new Date((T0 + 5) * 1000).toISOString(),
        endedAt: null,
        fetchedAt: "2026-11-06T18:00:00.000Z",
      },
    });
  });
  it("the plan comes from the Price ID only: metadata that claims another plan or price is ignored", () => {
    const annual = build(subscription({ items: { data: [item(PRICES.annual)] }, metadata: { user_id: USER, plan: "monthly", price_id: PRICES.monthly, tier: "premium" } }));
    expect(annual.ok && annual.args.plan).toBe("annual");
    const monthly = build(subscription({ metadata: { user_id: USER, plan: "annual" } }));
    expect(monthly.ok && monthly.args.plan).toBe("monthly");
  });
  it("a subscription on any other Price is ignored, never recorded as a plan", () => {
    expect(build(subscription({ items: { data: [item("price_SOMETHING_ELSE")] } }))).toEqual({ ok: false, reason: "ignored_unknown_price" });
    expect(build(subscription({ items: { data: [] } }))).toEqual({ ok: false, reason: "ignored_unknown_price" });
  });
  it("with several items, the one on a StandUp Price decides", () => {
    const r = build(subscription({ items: { data: [item("price_OTHER"), item(PRICES.annual)] } }));
    expect(r.ok && r.args.plan).toBe("annual");
  });
  it("reads the period from the subscription itself on older API versions", () => {
    const r = build(subscription({ items: { data: [{ id: "si_1", price: { id: PRICES.monthly } }] }, current_period_start: T0, current_period_end: T0 + 86400 }));
    expect(r.ok && r.args.periodEnd).toBe(new Date((T0 + 86400) * 1000).toISOString());
    const none = build(subscription({ items: { data: [{ id: "si_1", price: { id: PRICES.monthly } }] } }));
    expect(none.ok && none.args.periodEnd).toBeNull();
  });
  it("never records a live-mode subscription or one without a customer", () => {
    expect(build(subscription({ livemode: true }))).toEqual({ ok: false, reason: "ignored_live_mode" });
    expect(build(subscription({ customer: null }))).toEqual({ ok: false, reason: "ignored_incomplete_subscription" });
  });
  it("accepts an expanded customer object", () => {
    const r = build(subscription({ customer: { id: "cus_EXPANDED" } }));
    expect(r.ok && r.args.customerId).toBe("cus_EXPANDED");
  });

  describe("account hints", () => {
    it("must be real account IDs (anything else is ignored, and nothing is recorded)", () => {
      for (const bad of ["not-a-uuid", "1", "' or 1=1 --", `${USER}x`, "admin"]) expect(build(subscription(), [bad])).toEqual({ ok: false, reason: "ignored_invalid_user_hint" });
    });
    it("must agree with each other: contradictory hints record nothing", () => {
      expect(build(subscription(), [USER, OTHER])).toEqual({ ok: false, reason: "ignored_conflicting_user_hints" });
    });
    it("repeated or differently-cased copies of the same ID are one hint", () => {
      const r = build(subscription(), [USER, USER.toUpperCase(), USER]);
      expect(r.ok && r.args.userHint).toBe(USER);
    });
    it("no hint is allowed (the database then needs an existing record to know the account)", () => {
      const r = build(subscription({ metadata: {} }), []);
      expect(r.ok && r.args.userHint).toBeNull();
    });
  });
});

describe("handler: sync from Stripe's current state", () => {
  it("fetches the subscription from Stripe and records THAT, not the event's payload", async () => {
    const { handler, store, calls, deps } = setup(subscription({ status: "active" }));
    const stalePayload = event("customer.subscription.updated", { id: "sub_TEST1", status: "incomplete", metadata: { user_id: USER } });
    expect(await handler(stalePayload, { store })).toBe("sync_applied");
    expect(deps.retrieveSubscription).toHaveBeenCalledWith("sub_TEST1");
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("active");
  });
  it("takes the fetch time BEFORE asking Stripe, so a slow older snapshot can't look newer than it is", async () => {
    const { handler, store, order } = setup();
    await handler(event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER } }), { store });
    expect(order).toEqual(["now", "retrieve"]);
  });
  it("covers every supported event type: all of them end in the same recorded state", async () => {
    const events = [
      event("checkout.session.completed", { mode: "subscription", subscription: "sub_TEST1", client_reference_id: USER, metadata: { user_id: USER } }),
      event("invoice.paid", { subscription: "sub_TEST1" }),
      event("invoice.payment_failed", { subscription: "sub_TEST1" }),
      event("customer.subscription.created", { id: "sub_TEST1", metadata: { user_id: USER } }),
      event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER } }),
      event("customer.subscription.deleted", { id: "sub_TEST1", metadata: { user_id: USER } }),
    ];
    const finals = new Set<string>();
    for (const e of events) {
      const { handler, store, calls } = setup();
      expect(await handler(e, { store })).toBe("sync_applied");
      const { fetchedAt, eventId, ...state } = calls[0];
      void fetchedAt;
      void eventId;
      finals.add(JSON.stringify(state));
    }
    expect(finals.size).toBe(1);
  });

  describe("ordering", () => {
    it("events delivered out of order converge on Stripe's latest state: the older event can't resurrect an older status", async () => {
      let current = subscription({ status: "active" });
      const { handler, store, calls } = setup(() => current);
      const created = event("customer.subscription.created", { id: "sub_TEST1", status: "incomplete", metadata: { user_id: USER } }, "evt_OLD");
      const deleted = event("customer.subscription.deleted", { id: "sub_TEST1", status: "canceled", metadata: { user_id: USER } }, "evt_NEW");
      current = subscription({ status: "canceled", ended_at: T0 + 100, canceled_at: T0 + 100 });
      await handler(deleted, { store }); // the newer event arrives first
      await handler(created, { store }); // the older one arrives late
      expect(calls.map((c) => c.status)).toEqual(["canceled", "canceled"]);
      expect(calls.every((c) => c.endedAt !== null)).toBe(true);
    });
    it("every write carries its fetch time, increasing with delivery order, so the database can refuse an older snapshot", async () => {
      const { handler, store, calls } = setup();
      for (const id of ["evt_1", "evt_2", "evt_3"]) await handler(event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER } }, id), { store });
      const times = calls.map((c) => Date.parse(c.fetchedAt));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(new Set(times).size).toBe(3);
    });
    it("a snapshot the database judges stale is a normal outcome, not an error (nothing is overwritten, nothing is retried)", async () => {
      const { handler, store } = setup(subscription(), {}, "stale");
      await expect(handler(event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER } }), { store })).resolves.toBe("sync_stale");
    });
  });

  describe("idempotency", () => {
    it("the same event processed twice records identical state (the ledger prevents the second run; this makes a retry harmless)", async () => {
      const e = event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER } });
      const { handler, store, calls } = setup();
      await handler(e, { store });
      await handler(e, { store });
      const strip = ({ fetchedAt, ...rest }: SubscriptionSyncArgs) => (void fetchedAt, rest);
      expect(strip(calls[0])).toEqual(strip(calls[1]));
    });
  });

  describe("ownership", () => {
    it("passes the trusted hint to the database, which weighs it against existing records", async () => {
      const { handler, store, calls } = setup();
      await handler(event("checkout.session.completed", { mode: "subscription", subscription: "sub_TEST1", client_reference_id: USER }), { store });
      expect(calls[0].userHint).toBe(USER);
    });
    it("a Checkout session whose own hints disagree with the subscription's metadata records nothing", async () => {
      const { handler, store } = setup(subscription({ metadata: { user_id: OTHER } }));
      const r = await handler(event("checkout.session.completed", { mode: "subscription", subscription: "sub_TEST1", client_reference_id: USER, metadata: { user_id: USER } }), { store });
      expect(r).toBe("ignored_conflicting_user_hints");
      expect(store.syncSubscription).not.toHaveBeenCalled();
    });
    it("an invoice event (no hint of its own) relies on the subscription's metadata or an existing record", async () => {
      const { handler, store, calls } = setup();
      await handler(event("invoice.paid", { subscription: "sub_TEST1" }), { store });
      expect(calls[0].userHint).toBe(USER);
      const { handler: h2, store: s2, calls: c2 } = setup(subscription({ metadata: {} }));
      await h2(event("invoice.paid", { subscription: "sub_TEST1" }), { store: s2 });
      expect(c2[0].userHint).toBeNull();
    });
    it("ownership conflicts, unmapped subscriptions and a second live subscription are normal outcomes: recorded as such, never retried, never overwritten", async () => {
      for (const result of ["ownership_conflict", "unmapped", "subscription_conflict", "invalid"] as const) {
        const { handler, store } = setup(subscription(), {}, result);
        await expect(handler(event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER } }), { store })).resolves.toBe(`sync_${result}`);
      }
    });
  });

  describe("failures", () => {
    it("a subscription Stripe doesn't have is ignored (nothing to record, nothing to retry)", async () => {
      for (const err of [Object.assign(new Error("x"), { code: "resource_missing" }), Object.assign(new Error("x"), { statusCode: 404 })]) {
        const { handler, store } = setup(subscription(), { retrieveSubscription: vi.fn(async () => Promise.reject(err)) });
        await expect(handler(event("invoice.paid", { subscription: "sub_GONE" }), { store })).resolves.toBe("ignored_subscription_not_found");
        expect(store.syncSubscription).not.toHaveBeenCalled();
      }
    });
    it("a transient Stripe failure is thrown, so the webhook answers 500 and Stripe retries", async () => {
      const { handler, store } = setup(subscription(), { retrieveSubscription: vi.fn(async () => Promise.reject(Object.assign(new Error("rate limited"), { statusCode: 429 }))) });
      await expect(handler(event("invoice.paid", { subscription: "sub_TEST1" }), { store })).rejects.toThrow();
      expect(store.syncSubscription).not.toHaveBeenCalled();
    });
    it("unconfigured billing (no Price IDs) fails before Stripe is contacted, so the event is retried once it is configured", async () => {
      const retrieve = vi.fn();
      const { handler, store } = setup(subscription(), {
        retrieveSubscription: retrieve,
        prices: () => {
          throw new Error("not configured");
        },
      });
      await expect(handler(event("invoice.paid", { subscription: "sub_TEST1" }), { store })).rejects.toThrow();
      expect(retrieve).not.toHaveBeenCalled();
    });
    it("a database failure is thrown too (retried)", async () => {
      const { handler, store } = setup();
      (store.syncSubscription as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
      await expect(handler(event("invoice.paid", { subscription: "sub_TEST1" }), { store })).rejects.toThrow();
    });
    it("events that aren't about a subscription are ignored without contacting Stripe or the database", async () => {
      const { handler, store, deps } = setup();
      expect(await handler(event("invoice.paid", { subscription: null }), { store })).toBe("ignored_no_subscription");
      expect(deps.retrieveSubscription).not.toHaveBeenCalled();
      expect(store.syncSubscription).not.toHaveBeenCalled();
    });
    it("unknown prices and live-mode subscriptions are ignored without writing", async () => {
      for (const [sub, reason] of [
        [subscription({ items: { data: [item("price_OTHER")] } }), "ignored_unknown_price"],
        [subscription({ livemode: true }), "ignored_live_mode"],
      ] as const) {
        const { handler, store } = setup(sub);
        expect(await handler(event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER } }), { store })).toBe(reason);
        expect(store.syncSubscription).not.toHaveBeenCalled();
      }
    });
  });

  describe("data integrity", () => {
    it("writes billing facts only: the record has exactly the allow-listed fields, with no tier, entitlement or Premium field", async () => {
      const { handler, store, calls } = setup();
      await handler(event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER, tier: "premium" } }), { store });
      expect(Object.keys(calls[0]).sort()).toEqual(["cancelAtPeriodEnd", "canceledAt", "customerId", "endedAt", "eventId", "fetchedAt", "periodEnd", "periodStart", "plan", "priceId", "status", "subscriptionId", "userHint"]);
      expect(JSON.stringify(calls[0])).not.toMatch(/tier|entitlement|premium/i);
    });
    it("the only thing it ever asks of the store is to record the subscription (never the event ledger, never an entitlement)", async () => {
      const { handler, store } = setup();
      await handler(event("customer.subscription.updated", { id: "sub_TEST1", metadata: { user_id: USER } }), { store });
      expect(store.syncSubscription).toHaveBeenCalledTimes(1); // the ledger methods in fakeStore reject if touched
    });
  });
});

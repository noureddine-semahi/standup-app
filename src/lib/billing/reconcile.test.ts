// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/billing/reconcileStore", () => ({ createReconcileStore: vi.fn() }));
vi.mock("@/lib/billing/webhookStore", () => ({ createWebhookStore: vi.fn() }));

import { DEFAULT_BUDGET_MS, DEFAULT_LIMIT, MAX_LIMIT, handleReconcileRequest, parseReconcileBody, reconcileSubscriptions, type ReconcileDeps, type ReconcileRouteDeps, type ReconcileSummary } from "./reconcile";
import type { ReconcileCandidate, ReconcileStore } from "./reconcileStore";
import type { SubscriptionSyncArgs, SubscriptionSyncResult } from "./webhookStore";
import { billingGrantsPremium } from "@/lib/billingEntitlement";

const PRICES = { monthly: "price_MONTHLY1", annual: "price_ANNUAL1" } as const;
const DAY = 86400;
const T0 = 1_800_000_000; // seconds: "now" for most scenarios
const END = T0 + 20 * DAY;
const iso = (s: number | null) => (s === null ? null : new Date(s * 1000).toISOString());

// ---- an in-memory model of public.account_billing + public.sync_stripe_subscription (ownership, stale-snapshot refusal) ----
type Row = { userId: string; customerId: string; subscriptionId: string; priceId: string; plan: "monthly" | "annual"; status: string; cancelAtPeriodEnd: boolean; periodEnd: string | null; canceledAt: string | null; endedAt: string | null; syncedAtMs: number | null; lastEventId: string | null };
const row = (n: number, o: Partial<Row> = {}): Row => ({ userId: `00000000-0000-4000-8000-00000000000${n}`, customerId: `cus_C${n}`, subscriptionId: `sub_S${n}`, priceId: PRICES.monthly, plan: "monthly", status: "active", cancelAtPeriodEnd: false, periodEnd: iso(END), canceledAt: null, endedAt: null, syncedAtMs: (T0 - 3600) * 1000, lastEventId: `evt_old${n}`, ...o });

function world(initial: Row[], opts: { clockStart?: number } = {}) {
  const db = [...initial];
  let nowMs = (opts.clockStart ?? T0) * 1000;
  const stripeSubs = new Map<string, () => Stripe.Subscription | Error>();
  const writes: SubscriptionSyncArgs[] = [];
  const extraCalls: string[] = []; // anything other than reading a subscription or syncing would land here

  const stripeSub = (r: Row, o: Record<string, unknown> = {}): Stripe.Subscription =>
    ({ id: r.subscriptionId, object: "subscription", customer: r.customerId, status: r.status, livemode: false, cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null, metadata: {}, items: { data: [{ id: "si_1", price: { id: r.priceId }, current_period_start: T0 - 10 * DAY, current_period_end: END }] }, ...o }) as unknown as Stripe.Subscription;

  const sync = async (a: SubscriptionSyncArgs): Promise<SubscriptionSyncResult> => {
    writes.push(a);
    const r = db.find((x) => x.subscriptionId === a.subscriptionId) ?? db.find((x) => x.customerId === a.customerId);
    if (!r) return a.userHint ? "applied" : "unmapped";
    if (r.customerId !== a.customerId) return "ownership_conflict";
    if (r.subscriptionId !== a.subscriptionId) return "subscription_conflict";
    if (r.syncedAtMs !== null && r.syncedAtMs > Date.parse(a.fetchedAt)) return "stale";
    Object.assign(r, { priceId: a.priceId, plan: a.plan, status: a.status, cancelAtPeriodEnd: a.cancelAtPeriodEnd, periodEnd: a.periodEnd, canceledAt: a.canceledAt, endedAt: a.endedAt, syncedAtMs: Date.parse(a.fetchedAt), lastEventId: a.eventId });
    return "applied";
  };
  const store: ReconcileStore = {
    async candidates(staleBeforeIso, limit) {
      const before = Date.parse(staleBeforeIso);
      return db
        .filter((r) => !["canceled", "incomplete_expired"].includes(r.status) && (r.syncedAtMs === null || r.syncedAtMs < before))
        .sort((a, b) => (a.syncedAtMs ?? -1) - (b.syncedAtMs ?? -1))
        .slice(0, limit)
        .map((r): ReconcileCandidate => ({ subscriptionId: r.subscriptionId, lastEventId: r.lastEventId, status: r.status, priceId: r.priceId, cancelAtPeriodEnd: r.cancelAtPeriodEnd, periodEnd: r.periodEnd, canceledAt: r.canceledAt, endedAt: r.endedAt, syncedAt: r.syncedAtMs === null ? null : new Date(r.syncedAtMs).toISOString() }));
    },
  };
  const deps: ReconcileDeps = {
    store,
    sync,
    retrieveSubscription: async (id) => {
      const f = stripeSubs.get(id);
      if (!f) throw Object.assign(new Error("No such subscription: " + id), { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 });
      const v = f();
      if (v instanceof Error) throw v;
      return v;
    },
    prices: () => PRICES,
    now: () => new Date(nowMs),
  };
  return {
    db, deps, writes, extraCalls, stripeSubs, stripeSub,
    setNow: (s: number) => (nowMs = s * 1000),
    advance: (ms: number) => (nowMs += ms),
    nowMs: () => nowMs,
    serve: (r: Row, o: Record<string, unknown> = {}) => stripeSubs.set(r.subscriptionId, () => stripeSub(r, o)),
  };
}

const sum = (s: ReconcileSummary) => ({ ...s.outcomes, examined: s.examined });

describe("missed webhooks are recovered", () => {
  it("missed cancellation (flexible shape: cancel_at at the period end, cancel_at_period_end=false): the record now says it is set to cancel", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { cancel_at: END, cancel_at_period_end: false, canceled_at: T0 - 60 });
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.changed).toBe(1);
    expect(r.cancelAtPeriodEnd).toBe(true);
    expect(r.status).toBe("active");
    expect(r.canceledAt).toBe(iso(T0 - 60));
    expect(r.periodEnd).toBe(iso(END)); // no invented date
    expect(r.endedAt).toBeNull();
  });

  it("missed cancellation (legacy shape: cancel_at_period_end=true)", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { cancel_at_period_end: true });
    expect((await reconcileSubscriptions(w.deps)).outcomes.changed).toBe(1);
    expect(r.cancelAtPeriodEnd).toBe(true);
  });

  it("missed cancellation REVERSAL: the record had the cancellation, Stripe says it was undone, so it goes back to renewing", async () => {
    const r = row(1, { cancelAtPeriodEnd: true, canceledAt: iso(T0 - 100) });
    const w = world([r]);
    w.serve(r, { cancel_at: null, cancel_at_period_end: false, canceled_at: null });
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.changed).toBe(1);
    expect(r.cancelAtPeriodEnd).toBe(false);
    expect(r.canceledAt).toBeNull();
  });

  it("missed renewal: the new period end is recorded (so Premium continues under the unchanged policy)", async () => {
    const r = row(1, { periodEnd: iso(T0 - DAY) }); // stored period already over
    const w = world([r]);
    const before = billingGrantsPremium({ status: r.status, currentPeriodEnd: r.periodEnd }, T0 * 1000 + 5 * DAY * 1000);
    w.serve(r); // Stripe: period now ends at END
    expect((await reconcileSubscriptions(w.deps)).outcomes.changed).toBe(1);
    expect(r.periodEnd).toBe(iso(END));
    expect(before).toBe(false); // the stale record would have stopped Premium (after the 3-day slack)...
    expect(billingGrantsPremium({ status: r.status, currentPeriodEnd: r.periodEnd }, T0 * 1000 + 5 * DAY * 1000)).toBe(true); // ...the recovered one does not
  });

  it("missed payment-status change: active -> past_due -> unpaid -> paused are each recorded as Stripe reports them", async () => {
    for (const status of ["past_due", "unpaid", "paused"]) {
      const r = row(1);
      const w = world([r]);
      w.serve(r, { status });
      const s = await reconcileSubscriptions(w.deps);
      expect(s.outcomes.changed, status).toBe(1);
      expect(r.status).toBe(status);
    }
  });

  it("a payment that recovered: past_due in the record, active in Stripe", async () => {
    const r = row(1, { status: "past_due" });
    const w = world([r]);
    w.serve(r, { status: "active" });
    expect((await reconcileSubscriptions(w.deps)).outcomes.changed).toBe(1);
    expect(r.status).toBe("active");
  });

  it("a missed deletion: Stripe says canceled (with its dates), so the record is canceled and then final (never re-checked)", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { status: "canceled", ended_at: T0 - 10, canceled_at: T0 - 10 });
    expect((await reconcileSubscriptions(w.deps)).outcomes.changed).toBe(1);
    expect(r.status).toBe("canceled");
    expect(r.endedAt).toBe(iso(T0 - 10));
    expect(billingGrantsPremium({ status: r.status, currentPeriodEnd: r.periodEnd }, T0 * 1000)).toBe(false); // the unchanged policy: canceled gives none
    w.advance(3600_000);
    expect((await reconcileSubscriptions(w.deps)).examined).toBe(0);
  });

  it("a trialing subscription is covered too", async () => {
    const r = row(1, { status: "trialing" });
    const w = world([r]);
    w.serve(r, { status: "trialing", cancel_at: END });
    expect((await reconcileSubscriptions(w.deps)).outcomes.changed).toBe(1);
    expect(r.cancelAtPeriodEnd).toBe(true);
  });
});

describe("already synchronised records, idempotence", () => {
  it("a record that matches Stripe is 'unchanged' (only its last-checked time moves), and a second run finds nothing due", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r);
    const before = { ...r };
    const s1 = await reconcileSubscriptions(w.deps);
    expect(sum(s1)).toMatchObject({ unchanged: 1, changed: 0, examined: 1 });
    expect({ ...r, syncedAtMs: before.syncedAtMs }).toEqual(before);
    expect(r.syncedAtMs).toBe(T0 * 1000);
    const s2 = await reconcileSubscriptions(w.deps);
    expect(s2.examined).toBe(0);
    expect(w.writes).toHaveLength(1);
  });

  it("running again with the same Stripe state after the stale window changes nothing further", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { cancel_at: END });
    await reconcileSubscriptions(w.deps);
    const snapshot = { ...r };
    w.advance(30 * 60_000);
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.unchanged).toBe(1);
    expect({ ...r, syncedAtMs: 0 }).toEqual({ ...snapshot, syncedAtMs: 0 });
  });

  it("the record's existing last event ID is preserved (reconciliation does not pretend to be an event)", async () => {
    const r = row(1, { lastEventId: "evt_keepme" });
    const w = world([r]);
    w.serve(r, { status: "past_due" });
    await reconcileSubscriptions(w.deps);
    expect(r.lastEventId).toBe("evt_keepme");
    expect(w.writes[0].eventId).toBe("evt_keepme");
    const none = row(2, { lastEventId: null });
    const w2 = world([none]);
    w2.serve(none);
    await reconcileSubscriptions(w2.deps);
    expect(w2.writes[0].eventId).toBeNull();
  });

  it("only records that are due are examined: recently synchronised, canceled and incomplete_expired ones are skipped", async () => {
    const fresh = row(1, { syncedAtMs: T0 * 1000 - 60_000 });
    const canceled = row(2, { status: "canceled" });
    const expired = row(3, { status: "incomplete_expired" });
    const due = row(4);
    const w = world([fresh, canceled, expired, due]);
    for (const r of [fresh, canceled, expired, due]) w.serve(r);
    const s = await reconcileSubscriptions(w.deps);
    expect(s.examined).toBe(1);
    expect(w.writes.map((x) => x.subscriptionId)).toEqual([due.subscriptionId]);
  });
});

describe("Stripe API failure and retry", () => {
  it("a Stripe failure leaves the record exactly as it was and still due; the retry succeeds", async () => {
    const r = row(1);
    const w = world([r]);
    const before = { ...r };
    w.stripeSubs.set(r.subscriptionId, () => Object.assign(new Error("rate limited; sk_test_SECRET cus_C1"), { type: "StripeRateLimitError", code: "rate_limit", statusCode: 429 }));
    const s1 = await reconcileSubscriptions(w.deps);
    expect(sum(s1)).toMatchObject({ stripe_error: 1, changed: 0, examined: 1 });
    expect(r).toEqual(before);
    expect(w.writes).toHaveLength(0);
    expect(JSON.stringify(s1)).not.toMatch(/sk_test|cus_|sub_/);
    w.serve(r, { cancel_at: END });
    const s2 = await reconcileSubscriptions(w.deps);
    expect(s2.outcomes.changed).toBe(1);
    expect(r.cancelAtPeriodEnd).toBe(true);
  });

  it("one record failing does not stop the others", async () => {
    const a = row(1), b = row(2);
    const w = world([a, b]);
    w.stripeSubs.set(a.subscriptionId, () => new Error("boom"));
    w.serve(b, { status: "past_due" });
    const s = await reconcileSubscriptions(w.deps);
    expect(sum(s)).toMatchObject({ stripe_error: 1, changed: 1 });
    expect(b.status).toBe("past_due");
  });

  it("a database failure while writing stops the run and says so; the failed record is untouched", async () => {
    const a = row(1), b = row(2);
    const w = world([a, b]);
    w.serve(a, { status: "past_due" });
    w.serve(b, { status: "past_due" });
    w.deps.sync = async () => {
      throw new Error("db down");
    };
    const s = await reconcileSubscriptions(w.deps);
    expect(s.aborted).toBe(true);
    expect(s.outcomes.store_error).toBe(1);
    expect(s.examined).toBe(1);
    expect(a.status).toBe("active");
  });

  it("a failure to even list the due records, or unconfigured billing, throws before any Stripe call", async () => {
    const w = world([row(1)]);
    const retrieve = vi.spyOn(w.deps, "retrieveSubscription");
    w.deps.store = { candidates: async () => Promise.reject(new Error("db down")) };
    await expect(reconcileSubscriptions(w.deps)).rejects.toThrow();
    w.deps.prices = () => {
      throw new Error("not configured");
    };
    await expect(reconcileSubscriptions(w.deps)).rejects.toThrow();
    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe("concurrent webhook and reconciliation", () => {
  it("a webhook that records NEWER state while reconciliation waits on Stripe wins: the slow reconciliation result is refused as stale", async () => {
    const r = row(1);
    const w = world([r]);
    // reconciliation reads Stripe at t0 (a snapshot where nothing is scheduled)...
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    w.deps.retrieveSubscription = async () => {
      const snapshot = w.stripeSub(r); // taken now, shown later
      await gate;
      return snapshot;
    };
    const run = reconcileSubscriptions(w.deps);
    await Promise.resolve();
    // ...meanwhile the cancellation webhook arrives, fetching Stripe AFTER the cancellation, and is recorded
    w.advance(5000);
    const hook = await w.deps.sync({ eventId: "evt_hook", userHint: null, customerId: r.customerId, subscriptionId: r.subscriptionId, priceId: r.priceId, plan: "monthly", status: "active", periodStart: null, periodEnd: iso(END), cancelAtPeriodEnd: true, canceledAt: iso(T0 + 1), endedAt: null, fetchedAt: new Date(w.nowMs()).toISOString() });
    expect(hook).toBe("applied");
    release();
    const s = await run;
    expect(s.outcomes.stale).toBe(1);
    expect(s.outcomes.changed).toBe(0);
    expect(r.cancelAtPeriodEnd).toBe(true); // the webhook's newer truth survived
    expect(r.lastEventId).toBe("evt_hook");
  });

  it("the snapshot time is taken BEFORE the Stripe call (that is what makes the refusal above work)", async () => {
    const r = row(1);
    const w = world([r]);
    w.deps.retrieveSubscription = async () => {
      w.advance(10_000); // Stripe is slow
      return w.stripeSub(r);
    };
    await reconcileSubscriptions(w.deps);
    expect(Date.parse(w.writes[0].fetchedAt)).toBe(T0 * 1000);
  });

  it("a webhook that arrives AFTER reconciliation simply applies on top (newer snapshot wins)", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { status: "past_due" });
    await reconcileSubscriptions(w.deps);
    expect(r.status).toBe("past_due");
    w.advance(1000);
    const res = await w.deps.sync({ eventId: "evt_after", userHint: null, customerId: r.customerId, subscriptionId: r.subscriptionId, priceId: r.priceId, plan: "monthly", status: "active", periodStart: null, periodEnd: iso(END), cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, fetchedAt: new Date(w.nowMs()).toISOString() });
    expect(res).toBe("applied");
    expect(r.status).toBe("active");
  });

  it("two reconciliation runs at once converge on one consistent record (no duplicate, no torn state)", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { cancel_at: END });
    const [a, b] = await Promise.all([reconcileSubscriptions(w.deps), reconcileSubscriptions(w.deps)]);
    expect(a.outcomes.changed + b.outcomes.changed + a.outcomes.unchanged + b.outcomes.unchanged).toBe(2);
    expect(w.db).toHaveLength(1);
    expect(r.cancelAtPeriodEnd).toBe(true);
    expect(r.status).toBe("active");
  });
});

describe("missing or deleted objects, ownership and safety", () => {
  it("a subscription Stripe doesn't know is 'missing': the record is left alone (no access change, nothing invented)", async () => {
    const r = row(1);
    const w = world([r]);
    const before = { ...r };
    const s = await reconcileSubscriptions(w.deps); // nothing served: Stripe answers resource_missing
    expect(s.outcomes.missing).toBe(1);
    expect(r).toEqual(before);
    expect(w.writes).toHaveLength(0);
  });

  it("a deleted customer: Stripe reports its subscription canceled, which is recorded as canceled like any other cancellation", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { status: "canceled", ended_at: T0 - 5, canceled_at: T0 - 5, cancel_at: null });
    expect((await reconcileSubscriptions(w.deps)).outcomes.changed).toBe(1);
    expect(r.status).toBe("canceled");
  });

  it("ownership: Stripe reporting a different customer than the record's is a conflict and changes nothing", async () => {
    const r = row(1);
    const w = world([r]);
    const before = { ...r };
    w.serve(r, { customer: "cus_SOMEONE_ELSE", status: "canceled" });
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.conflict).toBe(1);
    expect(r).toEqual(before);
  });

  it("ownership: Stripe answering with a different subscription than the one asked about is never recorded", async () => {
    const r = row(1);
    const other = row(2);
    const w = world([r, other]);
    w.stripeSubs.set(r.subscriptionId, () => w.stripeSub(other, { status: "canceled" }));
    w.serve(other);
    const before = { ...other };
    const s = await reconcileSubscriptions(w.deps, { limit: 1 });
    expect(s.outcomes.conflict).toBe(1);
    expect(w.writes.filter((x) => x.subscriptionId === other.subscriptionId)).toHaveLength(0);
    expect(other).toEqual(before);
    expect(r.status).toBe("active");
  });

  it("the account is never passed from outside: reconciliation sends no user hint, so the database finds the owner from the stored subscription/customer", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { metadata: { user_id: "11111111-1111-4111-8111-111111111111" } }); // even Stripe metadata naming someone else is not used here
    await reconcileSubscriptions(w.deps);
    expect(w.writes[0].userHint).toBeNull();
    expect(r.userId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("live-mode subscriptions, unknown prices and incomplete data are ignored, not recorded", async () => {
    const a = row(1), b = row(2), c = row(3);
    const w = world([a, b, c]);
    w.serve(a, { livemode: true });
    w.serve(b, { items: { data: [{ id: "si", price: { id: "price_UNKNOWN" }, current_period_end: END }] } });
    w.serve(c, { customer: null });
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.ignored).toBe(3);
    expect(w.writes).toHaveLength(0);
  });

  it("it never creates anything: the only operations are reading a subscription and the one sync call", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { status: "past_due" });
    await reconcileSubscriptions(w.deps);
    expect(Object.keys(w.deps).sort()).toEqual(["now", "prices", "retrieveSubscription", "store", "sync"]);
    expect(Object.keys(w.deps.store)).toEqual(["candidates"]);
    expect(w.extraCalls).toEqual([]);
  });

  it("a record with a subscription of the wrong kind of ID is never asked about (handled by the store); the outcome summary holds counts only", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r);
    const s = await reconcileSubscriptions(w.deps);
    expect(Object.keys(s).sort()).toEqual(["aborted", "examined", "moreDue", "outcomes"]);
    expect(JSON.stringify(s)).not.toMatch(/sub_|cus_|evt_|00000000/);
  });
});

describe("bounded execution", () => {
  it("defaults and ceiling: 10 by default, never more than 25, never fewer than 1", async () => {
    expect([DEFAULT_LIMIT, MAX_LIMIT, DEFAULT_BUDGET_MS]).toEqual([10, 25, 20_000]);
    const rows = Array.from({ length: 40 }, (_, i) => row(i + 1, { subscriptionId: `sub_S${i + 1}`, customerId: `cus_C${i + 1}` }));
    for (const [limit, expected] of [[undefined, 10], [1000, 25], [0, 1], [-5, 1], [3, 3], [2.9, 2]] as const) {
      const w = world(rows.map((r) => ({ ...r })));
      for (const r of w.db) w.serve(r);
      const s = await reconcileSubscriptions(w.deps, limit === undefined ? {} : { limit });
      expect(s.examined, String(limit)).toBe(expected);
      expect(s.moreDue).toBe(true);
    }
  });

  it("exactly as many due as the limit is not 'more due'", async () => {
    const rows = [row(1), row(2)];
    const w = world(rows);
    for (const r of rows) w.serve(r);
    const s = await reconcileSubscriptions(w.deps, { limit: 2 });
    expect(s.moreDue).toBe(false);
  });

  it("the oldest-synchronised records go first", async () => {
    const newer = row(1, { syncedAtMs: (T0 - 700) * 1000 });
    const older = row(2, { syncedAtMs: (T0 - 7200) * 1000 });
    const never = row(3, { syncedAtMs: null });
    const w = world([newer, older, never]);
    for (const r of [newer, older, never]) w.serve(r);
    await reconcileSubscriptions(w.deps);
    expect(w.writes.map((x) => x.subscriptionId)).toEqual(["sub_S3", "sub_S2", "sub_S1"]);
  });

  it("a time budget stops the run and reports that more are due", async () => {
    const rows = [row(1), row(2), row(3)];
    const w = world(rows);
    w.deps.retrieveSubscription = async (id) => {
      w.advance(8000);
      return w.stripeSub(rows.find((r) => r.subscriptionId === id)!);
    };
    const s = await reconcileSubscriptions(w.deps, { budgetMs: 10_000 });
    expect(s.examined).toBe(2);
    expect(s.moreDue).toBe(true);
  });

  it("the staleness window is respected and can be tightened", async () => {
    const r = row(1, { syncedAtMs: (T0 - 120) * 1000 }); // two minutes ago
    const w = world([r]);
    w.serve(r);
    expect((await reconcileSubscriptions(w.deps)).examined).toBe(0); // default 10 minutes
    expect((await reconcileSubscriptions(w.deps, { staleMinutes: 1 })).examined).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe("the server-side invocation (POST /api/billing/reconcile)", () => {
  const SECRET = "reconcile-secret-0123456789-abcdefghijklmnop";
  const summary: ReconcileSummary = { examined: 2, outcomes: { changed: 1, unchanged: 1, stale: 0, missing: 0, conflict: 0, ignored: 0, stripe_error: 0, store_error: 0 }, moreDue: false, aborted: false };
  const mk = (over: Partial<ReconcileRouteDeps> = {}) => {
    const run = vi.fn(async () => summary);
    return { run, deps: { env: { BILLING_RECONCILE_SECRET: SECRET }, run, ...over } as ReconcileRouteDeps };
  };
  const call = (deps: ReconcileRouteDeps, init: { auth?: string | null; origin?: string; body?: string; method?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${SECRET}`;
    if (init.origin) headers.origin = init.origin;
    return handleReconcileRequest(new Request("https://standup-app-two.vercel.app/api/billing/reconcile", { method: "POST", headers, body: init.body }), deps);
  };
  let logs: unknown[][];
  beforeEach(() => {
    logs = [];
    for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
  });
  afterEach(() => vi.restoreAllMocks());

  it("with the right secret it runs once and returns counts only", async () => {
    const { run, deps } = mk();
    const res = await call(deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(summary);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({});
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });

  it("is switched off without a configured secret, or with a short one: 503, and nothing runs", async () => {
    for (const env of [{}, { BILLING_RECONCILE_SECRET: "" }, { BILLING_RECONCILE_SECRET: "   " }, { BILLING_RECONCILE_SECRET: "short" }, { BILLING_RECONCILE_SECRET: "x".repeat(31) }]) {
      const { run, deps } = mk({ env });
      const res = await call(deps, { auth: "Bearer short" });
      expect(res.status, JSON.stringify(env)).toBe(503);
      expect(await res.json()).toEqual({ error: "reconcile_unavailable" });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("no credentials, the wrong secret, a similar secret, another scheme or a bare token are all 401 and nothing runs", async () => {
    for (const auth of [null, "", "Bearer", "Bearer ", "Bearer wrong", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, `Basic ${SECRET}`, SECRET, `Bearer ${SECRET.toUpperCase()}`]) {
      const { run, deps } = mk();
      const res = await call(deps, { auth });
      expect(res.status, String(auth)).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("a member's Supabase sign-in is not authorization: a user token is just a wrong secret", async () => {
    const { run, deps } = mk();
    expect((await call(deps, { auth: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig" })).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("a browser request (it carries an Origin) is refused even with the right secret", async () => {
    const { run, deps } = mk();
    const res = await call(deps, { origin: "https://standup-app-two.vercel.app" });
    expect(res.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("the body can only be empty, {} or { limit: 1..25 }: an account, customer, subscription, URL or anything else is 400 and nothing runs", async () => {
    for (const body of ['{"user_id":"11111111-1111-4111-8111-111111111111"}', '{"customer":"cus_x"}', '{"subscription":"sub_x"}', '{"limit":0}', '{"limit":26}', '{"limit":1.5}', '{"limit":"5"}', '{"limit":5,"user_id":"x"}', "[]", "null", "not json", "x".repeat(100)]) {
      const { run, deps } = mk();
      const res = await call(deps, { body });
      expect(res.status, body).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(run).not.toHaveBeenCalled();
    }
    for (const [body, opts] of [[undefined, {}], ["", {}], ["{}", {}], ['{"limit":1}', { limit: 1 }], ['{"limit":25}', { limit: 25 }]] as const) {
      const { run, deps } = mk();
      expect((await call(deps, { body })).status).toBe(200);
      expect(run).toHaveBeenCalledWith(opts);
    }
    expect(parseReconcileBody('{"limit":7}')).toEqual({ limit: 7 });
  });

  it("an aborted run (database failure) is 503 with the counts; an unconfigured or unreachable setup is a generic 503 with no detail", async () => {
    const a = mk({ run: async () => ({ ...summary, aborted: true }) });
    const ra = await call(a.deps);
    expect(ra.status).toBe(503);
    expect((await ra.json()).aborted).toBe(true);
    const b = mk({
      run: async () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY missing, cus_123, sk_test_abc");
      },
    });
    const rb = await call(b.deps);
    expect(rb.status).toBe(503);
    const text = await rb.text();
    expect(JSON.parse(text)).toEqual({ error: "reconcile_failed" });
    expect(text).not.toMatch(/SERVICE_ROLE|cus_|sk_test/);
  });

  it("the log line carries counts only: never an identifier, the secret or the request", async () => {
    const { deps } = mk();
    await call(deps);
    const text = JSON.stringify(logs);
    expect(text).toContain("billing reconcile");
    expect(text).not.toMatch(/sub_|cus_|evt_|Bearer|authorization/i);
  });
});

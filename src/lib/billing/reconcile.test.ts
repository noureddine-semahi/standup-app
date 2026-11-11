// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/billing/reconcileStore", () => ({ createReconcileStore: vi.fn() }));
vi.mock("@/lib/billing/webhookStore", () => ({ createWebhookStore: vi.fn() }));

import { DEFAULT_BUDGET_MS, DEFAULT_LIMIT, MAX_LIMIT, PERSISTENT_BACKOFF, TRANSIENT_BACKOFF, TRANSIENT_ESCALATE_AFTER, handleReconcileRequest, retryDelayMs, parseReconcileBody, reconcileSubscriptions, type ReconcileDeps, type ReconcileRouteDeps, type ReconcileSummary } from "./reconcile";
import type { ReconcileCandidate, ReconcileFailureKind, ReconcileStore } from "./reconcileStore";
import type { SubscriptionSyncArgs, SubscriptionSyncResult } from "./webhookStore";
import { billingGrantsPremium } from "@/lib/billingEntitlement";

const PRICES = { monthly: "price_MONTHLY1", annual: "price_ANNUAL1" } as const;
const DAY = 86400;
const T0 = 1_800_000_000; // seconds: "now" for most scenarios
const END = T0 + 20 * DAY;
const iso = (s: number | null) => (s === null ? null : new Date(s * 1000).toISOString());

// ---- an in-memory model of public.account_billing + public.sync_stripe_subscription (ownership, stale-snapshot refusal) ----
type Row = { userId: string; customerId: string; subscriptionId: string; priceId: string; plan: "monthly" | "annual"; status: string; cancelAtPeriodEnd: boolean; periodEnd: string | null; canceledAt: string | null; endedAt: string | null; syncedAtMs: number | null; lastEventId: string | null; failures: number; nextAttemptMs: number | null; lastOutcome: ReconcileFailureKind | null };
const row = (n: number, o: Partial<Row> = {}): Row => ({ userId: `00000000-0000-4000-8000-00000000000${n}`, customerId: `cus_C${n}`, subscriptionId: `sub_S${n}`, priceId: PRICES.monthly, plan: "monthly", status: "active", cancelAtPeriodEnd: false, periodEnd: iso(END), canceledAt: null, endedAt: null, syncedAtMs: (T0 - 3600) * 1000, lastEventId: `evt_old${n}`, failures: 0, nextAttemptMs: null, lastOutcome: null, ...o });

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
  const recorded: { subscriptionId: string; ok: boolean; kind?: string; nextAttemptAtIso?: string }[] = [];
  const store: ReconcileStore = {
    async candidates(staleBeforeIso, nowIso, limit) {
      const before = Date.parse(staleBeforeIso);
      const now = Date.parse(nowIso);
      return db
        .filter((r) => !["canceled", "incomplete_expired"].includes(r.status) && (r.syncedAtMs === null || r.syncedAtMs < before) && (r.nextAttemptMs === null || r.nextAttemptMs <= now))
        .sort((x, y) => x.failures - y.failures || (x.syncedAtMs ?? -1) - (y.syncedAtMs ?? -1))
        .slice(0, limit)
        .map((r): ReconcileCandidate => ({ subscriptionId: r.subscriptionId, lastEventId: r.lastEventId, status: r.status, priceId: r.priceId, cancelAtPeriodEnd: r.cancelAtPeriodEnd, periodEnd: r.periodEnd, canceledAt: r.canceledAt, endedAt: r.endedAt, syncedAt: r.syncedAtMs === null ? null : new Date(r.syncedAtMs).toISOString(), failures: r.failures }));
    },
    async waiting(nowIso) {
      return db.filter((r) => !["canceled", "incomplete_expired"].includes(r.status) && r.nextAttemptMs !== null && r.nextAttemptMs > Date.parse(nowIso)).length;
    },
    async record(subscriptionId, result) {
      recorded.push({ subscriptionId, ok: result.ok, ...(result.ok ? {} : { kind: result.kind, nextAttemptAtIso: result.nextAttemptAtIso }) });
      const r = db.find((x) => x.subscriptionId === subscriptionId);
      if (!r) return;
      // mirrors record_reconcile_result: ONLY the four reconcile columns change
      if (result.ok) Object.assign(r, { failures: 0, lastOutcome: null, nextAttemptMs: null });
      else {
        const next = Math.max(nowMs, Math.min(Date.parse(result.nextAttemptAtIso), nowMs + 7 * 86400_000));
        Object.assign(r, { failures: Math.min(r.failures + 1, 1000), lastOutcome: result.kind, nextAttemptMs: next });
      }
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
    db, deps, writes, extraCalls, recorded, stripeSubs, stripeSub,
    setNow: (s: number) => (nowMs = s * 1000),
    advance: (ms: number) => (nowMs += ms),
    nowMs: () => nowMs,
    serve: (r: Row, o: Record<string, unknown> = {}) => stripeSubs.set(r.subscriptionId, () => stripeSub(r, o)),
  };
}

/** A record without its retry memory: what a failed check must leave byte-for-byte alone (billing data). */
const billingOnly = (r: Row) => { const { failures, nextAttemptMs, lastOutcome, ...rest } = r; void failures; void nextAttemptMs; void lastOutcome; return rest; };
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
    expect(billingOnly(r)).toEqual(billingOnly(before));
    expect(w.writes).toHaveLength(0);
    expect(JSON.stringify(s1)).not.toMatch(/sk_test|cus_|sub_/);
    w.serve(r, { cancel_at: END });
    expect((await reconcileSubscriptions(w.deps)).examined).toBe(0); // backed off for 5 minutes: not retried at once
    w.advance(6 * 60_000);
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
    w.deps.store = { ...w.deps.store, candidates: async () => Promise.reject(new Error("db down")) };
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
    expect(billingOnly(r)).toEqual(billingOnly(before));
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
    expect(billingOnly(r)).toEqual(billingOnly(before));
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

  it("in a LIVE environment a test-mode subscription is ignored and a live one is reconciled; in a test environment it is the other way round", async () => {
    const t = row(1), l = row(2);
    const live = world([t, l]);
    live.serve(t, { livemode: false });
    live.serve(l, { livemode: true, status: "past_due" });
    const s = await reconcileSubscriptions({ ...live.deps, mode: () => "live" });
    expect(s.outcomes.ignored).toBe(1);
    expect(live.writes.map((w) => JSON.stringify(w)).join("")).toContain("past_due");
    expect(live.writes).toHaveLength(1);
    const test = world([row(3)]);
    test.serve(row(3), { livemode: true });
    const s2 = await reconcileSubscriptions({ ...test.deps, mode: () => "test" });
    expect(s2.outcomes.ignored).toBe(1);
    expect(test.writes).toHaveLength(0);
  });

  it("it never creates anything: the only operations are reading a subscription and the one sync call", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { status: "past_due" });
    await reconcileSubscriptions(w.deps);
    expect(Object.keys(w.deps).sort()).toEqual(["now", "prices", "retrieveSubscription", "store", "sync"]);
    expect(Object.keys(w.deps.store).sort()).toEqual(["candidates", "record", "waiting"]);
    expect(w.extraCalls).toEqual([]);
  });

  it("a record with a subscription of the wrong kind of ID is never asked about (handled by the store); the outcome summary holds counts only", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r);
    const s = await reconcileSubscriptions(w.deps);
    expect(Object.keys(s).sort()).toEqual(["aborted", "backedOff", "examined", "moreDue", "outcomes"]);
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

describe("retry backoff: failing records cannot starve healthy ones (step 9.2)", () => {
  const MIN = 60_000;
  const NOW = T0 * 1000;
  const missingSub = (w: ReturnType<typeof world>, r: Row) => w.stripeSubs.delete(r.subscriptionId); // Stripe answers resource_missing

  it("the delay schedule: doubles per consecutive failure and is capped; Stripe errors are quick, missing/conflict/ignored slow; repeated Stripe errors escalate", () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => retryDelayMs("stripe_error", n) / MIN)).toEqual([5, 10, 20, 40, 60, 1440]);
    expect(TRANSIENT_ESCALATE_AFTER).toBe(5);
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => retryDelayMs("missing", n) / MIN)).toEqual([60, 120, 240, 480, 960, 1440, 1440]);
    for (const k of ["missing", "conflict", "ignored"] as const) expect(retryDelayMs(k, 0)).toBe(PERSISTENT_BACKOFF.baseMs);
    expect(retryDelayMs("stripe_error", 0)).toBe(TRANSIENT_BACKOFF.baseMs);
    expect(retryDelayMs("missing", 1000)).toBe(PERSISTENT_BACKOFF.capMs); // never overflows or exceeds the cap
    expect(retryDelayMs("stripe_error", -3)).toBe(TRANSIENT_BACKOFF.baseMs);
    expect(PERSISTENT_BACKOFF.capMs).toBeLessThanOrEqual(7 * 86400_000); // the database refuses anything beyond 7 days anyway
  });

  it("a permanently missing subscription: remembered with a retry time, skipped until then, retried later with a longer delay, never discarded", async () => {
    const bad = row(1);
    const w = world([bad]);
    missingSub(w, bad);
    const before = JSON.stringify({ ...bad, failures: 0, nextAttemptMs: null, lastOutcome: null });
    let s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.missing).toBe(1);
    expect(s.backedOff).toBe(1);
    expect(bad.failures).toBe(1);
    expect(bad.lastOutcome).toBe("missing");
    expect(bad.nextAttemptMs).toBe(NOW + 60 * MIN);
    expect(JSON.stringify({ ...bad, failures: 0, nextAttemptMs: null, lastOutcome: null })).toBe(before); // billing data untouched

    w.advance(30 * MIN); // still waiting
    s = await reconcileSubscriptions(w.deps);
    expect(s.examined).toBe(0);
    expect(s.backedOff).toBe(1);
    expect(bad.failures).toBe(1);

    w.advance(31 * MIN); // the hour has passed: tried again, fails again, waits twice as long
    s = await reconcileSubscriptions(w.deps);
    expect(s.examined).toBe(1);
    expect(s.outcomes.missing).toBe(1);
    expect(bad.failures).toBe(2);
    expect(bad.nextAttemptMs).toBe(w.nowMs() + 120 * MIN);
    expect(w.db).toContain(bad); // still stored and visible
  });

  it("repeated customer mismatch: each consecutive conflict doubles the wait; the record is never changed", async () => {
    const bad = row(1);
    const w = world([bad]);
    w.serve(bad, { customer: "cus_SOMEONE_ELSE" });
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const s = await reconcileSubscriptions(w.deps);
      expect(s.outcomes.conflict).toBe(1);
      delays.push((bad.nextAttemptMs! - w.nowMs()) / MIN);
      w.setNow(bad.nextAttemptMs! / 1000 + 1);
    }
    expect(delays).toEqual([60, 120, 240, 480]);
    expect(bad.failures).toBe(4);
    expect(bad.status).toBe("active");
    expect(bad.customerId).toBe("cus_C1");
  });

  it("a conflict reported by the Stripe answer itself (a different subscription than asked) and an ignored record are backed off too", async () => {
    const a = row(1), b = row(2), other = row(3);
    const w = world([a, b]);
    w.stripeSubs.set(a.subscriptionId, () => w.stripeSub(other));
    w.serve(b, { livemode: true });
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.conflict).toBe(1);
    expect(s.outcomes.ignored).toBe(1);
    expect(a.lastOutcome).toBe("conflict");
    expect(b.lastOutcome).toBe("ignored");
    expect(s.backedOff).toBe(2);
  });

  it("a transient Stripe error: retried soon (5 min), recovery clears the memory, and the next failure starts from the beginning again", async () => {
    const r = row(1);
    const w = world([r]);
    w.stripeSubs.set(r.subscriptionId, () => Object.assign(new Error("rate limited"), { code: "rate_limit", statusCode: 429 }));
    let s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.stripe_error).toBe(1);
    expect(r.nextAttemptMs).toBe(NOW + 5 * MIN);
    w.advance(6 * MIN);
    s = await reconcileSubscriptions(w.deps);
    expect(r.failures).toBe(2);
    expect(r.nextAttemptMs).toBe(w.nowMs() + 10 * MIN);
    // Stripe recovers
    w.serve(r, { cancel_at: END });
    w.advance(11 * MIN);
    s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.changed).toBe(1);
    expect(r.cancelAtPeriodEnd).toBe(true);
    expect(r.failures).toBe(0);
    expect(r.lastOutcome).toBeNull();
    expect(r.nextAttemptMs).toBeNull();
    expect(s.backedOff).toBe(0);
    // a later failure starts the schedule over
    w.stripeSubs.set(r.subscriptionId, () => new Error("boom"));
    w.advance(11 * MIN);
    await reconcileSubscriptions(w.deps);
    expect(r.failures).toBe(1);
    expect(r.nextAttemptMs).toBe(w.nowMs() + 5 * MIN);
  });

  it("repeated Stripe errors escalate to the slow schedule after 5 in a row (bounded noise during a long outage)", async () => {
    const r = row(1, { failures: TRANSIENT_ESCALATE_AFTER });
    const w = world([r]);
    w.stripeSubs.set(r.subscriptionId, () => new Error("still down"));
    await reconcileSubscriptions(w.deps);
    expect(r.nextAttemptMs! - w.nowMs()).toBe(PERSISTENT_BACKOFF.capMs); // 60 min * 2^5 is capped at 24 h
  });

  it("HEALTHY RECORDS PROGRESS PAST FAILING ONES: with more failing records than the batch holds, healthy ones are still reconciled on the first run, and after backoff the failing ones no longer occupy the batch", async () => {
    const failing = Array.from({ length: 12 }, (_, i) => row(i + 1, { subscriptionId: `sub_F${i + 1}`, customerId: `cus_F${i + 1}`, syncedAtMs: (T0 - 7200 - i) * 1000 })); // the OLDEST records
    const healthy = Array.from({ length: 6 }, (_, i) => row(i + 21, { subscriptionId: `sub_H${i + 1}`, customerId: `cus_H${i + 1}` }));
    const w = world([...failing, ...healthy]);
    for (const h of healthy) w.serve(h, { cancel_at: END });
    // (failing ones: Stripe knows nothing about them)
    const first = await reconcileSubscriptions(w.deps, { limit: 10 });
    // run 1: all 18 records are healthy-so-far, so the 12 OLDEST (the failing ones) take 10 of the slots and each backs off after one try
    expect(first.examined).toBe(10);
    expect(first.outcomes.missing).toBe(10);
    expect(first.backedOff).toBe(10);
    // run 2 (same instant): the 10 are waiting, so the batch is the 2 remaining failing records plus ALL 6 healthy ones: the healthy ones got through
    const second = await reconcileSubscriptions(w.deps, { limit: 10 });
    expect(second.examined).toBe(8);
    expect(second.outcomes.missing).toBe(2);
    expect(second.outcomes.changed).toBe(6);
    for (const h of healthy) expect(h.cancelAtPeriodEnd).toBe(true);
    // run 3 (same instant): nothing is due: every failing record waits, every healthy one is inside its cooldown
    const third = await reconcileSubscriptions(w.deps, { limit: 10 });
    expect(third.examined).toBe(0);
    expect(third.backedOff).toBe(12);
    expect(failing.every((f) => f.failures === 1 && f.lastOutcome === "missing")).toBe(true); // all still stored and visible
    // an hour later the failing records return, but a healthy record due at the same moment is still ahead of them
    w.advance(61 * MIN);
    healthy[0].syncedAtMs = (T0 - 7200) * 1000;
    const fourth = await reconcileSubscriptions(w.deps, { limit: 3 });
    expect(fourth.examined).toBe(3);
    expect(w.writes.at(-1)!.subscriptionId === "sub_H1" || w.writes.slice(-3).some((x) => x.subscriptionId === "sub_H1")).toBe(true);
  });

  it("in a single batch healthy records go FIRST and failing ones only fill what is left (a failing record never displaces a healthy one)", async () => {
    const retry = row(1, { failures: 3, syncedAtMs: (T0 - 9000) * 1000 }); // oldest, eligible to retry
    const h1 = row(2), h2 = row(3);
    const w = world([retry, h1, h2]);
    for (const r of [retry, h1, h2]) w.serve(r);
    await reconcileSubscriptions(w.deps, { limit: 2 });
    expect(w.writes.map((x) => x.subscriptionId).sort()).toEqual(["sub_S2", "sub_S3"]);
    expect(retry.failures).toBe(3); // untouched: it will be retried when there is room
    const s = await reconcileSubscriptions(w.deps, { limit: 2 });
    expect(s.examined).toBe(1);
    expect(w.writes.at(-1)!.subscriptionId).toBe("sub_S1");
    expect(retry.failures).toBe(0); // and its success cleared the memory
  });

  it("retry eligibility after backoff is exact: not before the retry time, yes at it", async () => {
    const r = row(1, { failures: 1, lastOutcome: "missing", nextAttemptMs: NOW + 60 * MIN, syncedAtMs: (T0 - 7200) * 1000 });
    const w = world([r]);
    w.serve(r);
    w.setNow(T0 + 60 * 60 - 1);
    expect((await reconcileSubscriptions(w.deps)).examined).toBe(0);
    w.setNow(T0 + 60 * 60);
    const s = await reconcileSubscriptions(w.deps);
    expect(s.examined).toBe(1);
    expect(s.outcomes.unchanged).toBe(1);
  });

  it("the 10-minute successful-check cooldown, batch limit and time budget are unchanged by backoff", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(i + 1, { subscriptionId: `sub_Z${i + 1}`, customerId: `cus_Z${i + 1}` }));
    const w = world(rows);
    for (const r of rows) w.serve(r);
    expect((await reconcileSubscriptions(w.deps, { limit: 2 })).examined).toBe(2);
    expect((await reconcileSubscriptions(w.deps, { limit: 2 })).examined).toBe(2); // different two: the first two are inside their cooldown
    expect((await reconcileSubscriptions(w.deps, { limit: 2 })).examined).toBe(1);
    expect((await reconcileSubscriptions(w.deps, { limit: 2 })).examined).toBe(0);
    w.advance(11 * MIN);
    expect((await reconcileSubscriptions(w.deps, { limit: 25 })).examined).toBe(5);
    // budget
    w.advance(11 * MIN);
    w.deps.retrieveSubscription = async (id) => {
      w.advance(8000);
      return w.stripeSub(rows.find((r) => r.subscriptionId === id)!);
    };
    const s = await reconcileSubscriptions(w.deps, { budgetMs: 10_000 });
    expect(s.examined).toBe(2);
    expect(s.moreDue).toBe(true);
  });

  it("idempotent: running again changes nothing further, and a failing record is not re-counted while it waits", async () => {
    const bad = row(1);
    const good = row(2);
    const w = world([bad, good]);
    missingSub(w, bad);
    w.serve(good);
    await reconcileSubscriptions(w.deps);
    const snap = JSON.stringify([bad, good]);
    const recordedBefore = w.recorded.length;
    const s = await reconcileSubscriptions(w.deps); // same instant
    expect(s.examined).toBe(0);
    expect(JSON.stringify([bad, good])).toBe(snap);
    expect(w.recorded.length).toBe(recordedBefore);
    expect(bad.failures).toBe(1);
  });

  it("success on a healthy record writes no retry memory at all (no extra writes in the normal case)", async () => {
    const r = row(1);
    const w = world([r]);
    w.serve(r, { status: "past_due" });
    await reconcileSubscriptions(w.deps);
    expect(w.recorded).toEqual([]);
  });

  it("a webhook win ('stale') counts as a successful check and clears earlier failures", async () => {
    const r = row(1, { failures: 2, lastOutcome: "stripe_error", syncedAtMs: (T0 - 7200) * 1000 });
    const w = world([r]);
    w.serve(r);
    const real = w.deps.sync;
    w.deps.sync = async (a) => (r.syncedAtMs = Date.parse(a.fetchedAt) + 60_000, real(a)); // a newer webhook landed first
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.stale).toBe(1);
    expect(r.failures).toBe(0);
    expect(r.nextAttemptMs).toBeNull();
  });

  it("backoff memory can't touch billing: the model's record() changes only the three retry fields, and the store offers no other write", async () => {
    const r = row(1);
    const w = world([r]);
    const before = { ...r };
    await w.deps.store.record(r.subscriptionId, { ok: false, kind: "missing", nextAttemptAtIso: new Date(NOW + MIN).toISOString() });
    const changed = Object.keys(r).filter((k) => JSON.stringify((r as Record<string, unknown>)[k]) !== JSON.stringify((before as Record<string, unknown>)[k]));
    expect(changed.sort()).toEqual(["failures", "lastOutcome", "nextAttemptMs"]);
    expect(Object.keys(w.deps.store).sort()).toEqual(["candidates", "record", "waiting"]);
  });

  it("the retry time is bounded by the database to 7 days, never in the past", async () => {
    const r = row(1);
    const w = world([r]);
    await w.deps.store.record(r.subscriptionId, { ok: false, kind: "missing", nextAttemptAtIso: new Date(NOW + 400 * 86400_000).toISOString() });
    expect(r.nextAttemptMs).toBe(NOW + 7 * 86400_000);
    await w.deps.store.record(r.subscriptionId, { ok: false, kind: "missing", nextAttemptAtIso: new Date(NOW - 5 * 86400_000).toISOString() });
    expect(r.nextAttemptMs).toBe(NOW);
  });

  it("losing the retry memory (a database hiccup while recording) never stops the run or affects the others", async () => {
    const bad = row(1), good = row(2);
    const w = world([bad, good]);
    missingSub(w, bad);
    w.serve(good, { status: "past_due" });
    w.deps.store.record = async () => {
      throw new Error("db hiccup");
    };
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.missing).toBe(1);
    expect(s.outcomes.changed).toBe(1);
    expect(s.aborted).toBe(false);
    expect(good.status).toBe("past_due");
  });
});

describe("backoff under concurrent webhook and reconciliation processing", () => {
  it("a webhook newer than a failing record's last check still applies normally, and the next successful check clears the failure memory", async () => {
    const r = row(1, { failures: 2, lastOutcome: "conflict", nextAttemptMs: null, syncedAtMs: (T0 - 7200) * 1000 });
    const w = world([r]);
    w.serve(r, { status: "past_due" });
    // a webhook writes first (newer snapshot)
    w.advance(1000);
    expect(await w.deps.sync({ eventId: "evt_hook", userHint: null, customerId: r.customerId, subscriptionId: r.subscriptionId, priceId: r.priceId, plan: "monthly", status: "past_due", periodStart: null, periodEnd: iso(END), cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, fetchedAt: new Date(w.nowMs()).toISOString() })).toBe("applied");
    expect(r.failures).toBe(2); // the webhook path doesn't touch retry memory
    w.advance(11 * 60_000);
    const s = await reconcileSubscriptions(w.deps);
    expect(s.outcomes.unchanged).toBe(1);
    expect(r.failures).toBe(0);
  });

  it("a slow reconciliation that loses to a webhook is 'stale': not a failure, so it is not backed off", async () => {
    const r = row(1);
    const w = world([r]);
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    w.deps.retrieveSubscription = async () => {
      const snap = w.stripeSub(r);
      await gate;
      return snap;
    };
    const run = reconcileSubscriptions(w.deps);
    await Promise.resolve();
    w.advance(5000);
    await w.deps.sync({ eventId: "evt_hook", userHint: null, customerId: r.customerId, subscriptionId: r.subscriptionId, priceId: r.priceId, plan: "monthly", status: "active", periodStart: null, periodEnd: iso(END), cancelAtPeriodEnd: true, canceledAt: iso(T0 + 1), endedAt: null, fetchedAt: new Date(w.nowMs()).toISOString() });
    release();
    const s = await run;
    expect(s.outcomes.stale).toBe(1);
    expect(r.cancelAtPeriodEnd).toBe(true);
    expect(r.failures).toBe(0);
    expect(r.nextAttemptMs).toBeNull();
  });

  it("two overlapping runs over a failing record both record the failure; the stored count stays bounded and the retry time sane", async () => {
    const bad = row(1);
    const w = world([bad]);
    w.stripeSubs.delete(bad.subscriptionId);
    await Promise.all([reconcileSubscriptions(w.deps), reconcileSubscriptions(w.deps)]);
    expect(bad.failures).toBeGreaterThanOrEqual(1);
    expect(bad.failures).toBeLessThanOrEqual(2);
    expect(bad.nextAttemptMs).toBeGreaterThan(w.nowMs());
    expect(bad.nextAttemptMs).toBeLessThanOrEqual(w.nowMs() + 24 * 60 * 60_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe("the server-side invocation (POST /api/billing/reconcile)", () => {
  const SECRET = "reconcile-secret-0123456789-abcdefghijklmnop";
  const summary: ReconcileSummary = { examined: 2, outcomes: { changed: 1, unchanged: 1, stale: 0, missing: 0, conflict: 0, ignored: 0, stripe_error: 0, store_error: 0 }, moreDue: false, backedOff: 0, aborted: false };
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

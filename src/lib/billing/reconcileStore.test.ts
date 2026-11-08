// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const q = vi.hoisted(() => {
  const calls: { table?: string; select?: string; selectOpts?: unknown; filters: string[]; orders: unknown[]; limit?: number; rpc?: { fn: string; args: unknown } } = { filters: [], orders: [] };
  const result = { current: { data: null, error: null, status: 200, count: null } as unknown };
  const chain: Record<string, unknown> = {
    from(t: string) {
      calls.table = t;
      return chain;
    },
    select(s: string, o?: unknown) {
      calls.select = s;
      calls.selectOpts = o;
      return chain;
    },
    not(col: string, op: string, val: string) {
      calls.filters.push(`not ${col} ${op} ${val}`);
      return chain;
    },
    gt(col: string, val: string) {
      calls.filters.push(`gt ${col} ${val}`);
      return Promise.resolve(result.current);
    },
    or(expr: string) {
      calls.filters.push(`or ${expr}`);
      return chain;
    },
    order(col: string, o: unknown) {
      calls.orders.push({ col, o });
      return chain;
    },
    limit(n: number) {
      calls.limit = n;
      return Promise.resolve(result.current);
    },
    rpc(fn: string, args: unknown) {
      calls.rpc = { fn, args };
      return Promise.resolve(result.current);
    },
  };
  return { calls, result, chain };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => q.chain) }));

import { ReconcileStoreUnavailableError, createReconcileStore } from "./reconcileStore";

const KEY = "eyJSECRET.SERVICE.ROLEKEYVALUE";
const URL_ = "https://private-project-ref.supabase.co";
const env = { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY };
const STALE = "2026-11-08T12:00:00.000Z";
const NOW = "2026-11-08T12:10:00.000Z";

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  q.calls.filters = [];
  q.calls.orders = [];
  q.calls.rpc = undefined;
  q.result.current = { data: [], error: null, status: 200, count: null };
  for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("candidates", () => {
  it("reads only billing records that have a subscription, are not over for good, are past the cooldown AND past any retry time; healthy first, then longest-unsynchronised; bounded", async () => {
    await createReconcileStore(env).candidates(STALE, NOW, 11);
    expect(q.calls.table).toBe("account_billing");
    expect(q.calls.filters).toHaveLength(3);
    expect(q.calls.filters.slice(0, 2)).toEqual(["not stripe_subscription_id is null", "not subscription_status in (canceled,incomplete_expired)"]);
    // (never synced OR synced before the cut-off) AND (no retry time OR retry time reached), as one OR of the four combinations
    expect(q.calls.filters[2]).toBe(
      "or " +
        [
          `and(subscription_synced_at.is.null,reconcile_next_attempt_at.is.null)`,
          `and(subscription_synced_at.is.null,reconcile_next_attempt_at.lte.${NOW})`,
          `and(subscription_synced_at.lt.${STALE},reconcile_next_attempt_at.is.null)`,
          `and(subscription_synced_at.lt.${STALE},reconcile_next_attempt_at.lte.${NOW})`,
        ].join(",")
    );
    expect(q.calls.orders).toEqual([{ col: "reconcile_failures", o: { ascending: true } }, { col: "subscription_synced_at", o: { ascending: true, nullsFirst: true } }]);
    expect(q.calls.limit).toBe(11);
    expect(q.calls.select).not.toMatch(/user_id|customer/); // the reconciler doesn't even read account or customer IDs
    expect(q.calls.select).toContain("reconcile_failures");
  });

  it("maps rows to the facts the reconciler compares, and drops anything whose subscription ID isn't a real one", async () => {
    q.result.current = {
      data: [
        { stripe_subscription_id: "sub_AAA111", last_event_id: "evt_123", subscription_status: "active", stripe_price_id: "price_X", cancel_at_period_end: true, current_period_end: "2026-12-01T00:00:00+00:00", canceled_at: null, ended_at: null, subscription_synced_at: "2026-11-01T00:00:00+00:00", reconcile_failures: 3 },
        { stripe_subscription_id: "cus_NOTASUB", subscription_status: "active" },
        { stripe_subscription_id: "sub_with space", subscription_status: "active" },
        { stripe_subscription_id: null },
        { stripe_subscription_id: "sub_BBB222", last_event_id: "garbage", subscription_status: null, cancel_at_period_end: "yes", reconcile_failures: -4 },
        { stripe_subscription_id: "sub_CCC333", reconcile_failures: "7" },
      ],
      error: null,
      status: 200,
    };
    expect(await createReconcileStore(env).candidates(STALE, NOW, 5)).toEqual([
      { subscriptionId: "sub_AAA111", lastEventId: "evt_123", status: "active", priceId: "price_X", cancelAtPeriodEnd: true, periodEnd: "2026-12-01T00:00:00+00:00", canceledAt: null, endedAt: null, syncedAt: "2026-11-01T00:00:00+00:00", failures: 3 },
      { subscriptionId: "sub_BBB222", lastEventId: null, status: null, priceId: null, cancelAtPeriodEnd: false, periodEnd: null, canceledAt: null, endedAt: null, syncedAt: null, failures: 0 },
      { subscriptionId: "sub_CCC333", lastEventId: null, status: null, priceId: null, cancelAtPeriodEnd: false, periodEnd: null, canceledAt: null, endedAt: null, syncedAt: null, failures: 0 },
    ]);
  });

  it("a non-array answer is an empty list, never a guess", async () => {
    for (const data of [null, {}, "x"]) {
      q.result.current = { data, error: null, status: 200 };
      expect(await createReconcileStore(env).candidates(STALE, NOW, 5)).toEqual([]);
    }
  });

  it("a database error is thrown and logged with safe fields only", async () => {
    q.result.current = { data: null, error: { code: "42501", message: `denied; key ${KEY}; ${URL_}; sub_SECRET1` }, status: 403 };
    await expect(createReconcileStore(env).candidates(STALE, NOW, 5)).rejects.toBeInstanceOf(ReconcileStoreUnavailableError);
    expect(logs).toEqual([["reconcile billing store failure", { reason: "query_error", op: "candidates", code: "42501", status: 403 }]]);
    for (const secret of [KEY, URL_, "sub_SECRET1", "denied"]) expect(JSON.stringify(logs)).not.toContain(secret);
  });

  it("refuses to start without the server configuration, naming variables but never values", () => {
    expect(() => createReconcileStore({})).toThrow(ReconcileStoreUnavailableError);
    expect(logs).toEqual([["reconcile billing store failure", { reason: "missing_env", op: "init", missing: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] }]]);
  });
});

describe("waiting", () => {
  it("counts live records whose retry time is still in the future (a head-only count query)", async () => {
    q.result.current = { data: null, error: null, status: 200, count: 4 };
    expect(await createReconcileStore(env).waiting(NOW)).toBe(4);
    expect(q.calls.selectOpts).toEqual({ count: "exact", head: true });
    expect(q.calls.filters).toEqual(["not stripe_subscription_id is null", "not subscription_status in (canceled,incomplete_expired)", `gt reconcile_next_attempt_at ${NOW}`]);
  });

  it("a missing count is 0, and a database error is thrown with safe logging", async () => {
    q.result.current = { data: null, error: null, status: 200, count: null };
    expect(await createReconcileStore(env).waiting(NOW)).toBe(0);
    q.result.current = { data: null, error: { code: "XX000", message: `boom ${KEY}` }, status: 500 };
    await expect(createReconcileStore(env).waiting(NOW)).rejects.toBeInstanceOf(ReconcileStoreUnavailableError);
    expect(JSON.stringify(logs)).not.toContain(KEY);
    expect(logs[0]).toEqual(["reconcile billing store failure", { reason: "query_error", op: "waiting", code: "XX000", status: 500 }]);
  });
});

describe("record", () => {
  it("a success calls the one retry-memory function to clear the failures", async () => {
    await createReconcileStore(env).record("sub_ABC123", { ok: true });
    expect(q.calls.rpc).toEqual({ fn: "record_reconcile_result", args: { p_subscription_id: "sub_ABC123", p_outcome: "ok", p_next_attempt_at: null } });
  });

  it("a failure passes its kind and the earliest retry time", async () => {
    await createReconcileStore(env).record("sub_ABC123", { ok: false, kind: "missing", nextAttemptAtIso: NOW });
    expect(q.calls.rpc).toEqual({ fn: "record_reconcile_result", args: { p_subscription_id: "sub_ABC123", p_outcome: "missing", p_next_attempt_at: NOW } });
  });

  it("anything that isn't a real subscription ID is never sent to the database", async () => {
    for (const id of ["cus_X", "sub_ with space", "", "sub_'; drop table x;--"]) await createReconcileStore(env).record(id, { ok: true });
    expect(q.calls.rpc).toBeUndefined();
  });

  it("a database error is thrown (the caller treats the memory as best-effort) and logged with safe fields only", async () => {
    q.result.current = { data: null, error: { code: "42883", message: `function missing ${KEY} sub_SECRET9` }, status: 404 };
    await expect(createReconcileStore(env).record("sub_ABC123", { ok: true })).rejects.toBeInstanceOf(ReconcileStoreUnavailableError);
    expect(logs).toEqual([["reconcile billing store failure", { reason: "query_error", op: "record", code: "42883", status: 404 }]]);
    expect(JSON.stringify(logs)).not.toMatch(/sub_SECRET9|ey[A-Z]/);
  });
});

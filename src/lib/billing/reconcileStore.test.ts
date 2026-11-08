// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const q = vi.hoisted(() => {
  const calls: { table?: string; select?: string; filters: string[]; order?: unknown; limit?: number } = { filters: [] };
  const result = { current: { data: null, error: null, status: 200 } as unknown };
  const chain = {
    from(t: string) {
      calls.table = t;
      return chain;
    },
    select(s: string) {
      calls.select = s;
      return chain;
    },
    not(col: string, op: string, val: string) {
      calls.filters.push(`not ${col} ${op} ${val}`);
      return chain;
    },
    or(expr: string) {
      calls.filters.push(`or ${expr}`);
      return chain;
    },
    order(col: string, o: unknown) {
      calls.order = { col, o };
      return chain;
    },
    limit(n: number) {
      calls.limit = n;
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

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  q.calls.filters = [];
  q.result.current = { data: [], error: null, status: 200 };
  for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("candidates", () => {
  it("reads only billing records that have a subscription, are not over for good, and were last synchronised before the cut-off, oldest first, bounded", async () => {
    await createReconcileStore(env).candidates(STALE, 11);
    expect(q.calls.table).toBe("account_billing");
    expect(q.calls.filters).toEqual(["not stripe_subscription_id is null", "not subscription_status in (canceled,incomplete_expired)", `or subscription_synced_at.is.null,subscription_synced_at.lt.${STALE}`]);
    expect(q.calls.order).toEqual({ col: "subscription_synced_at", o: { ascending: true, nullsFirst: true } });
    expect(q.calls.limit).toBe(11);
    expect(q.calls.select).not.toMatch(/user_id|customer/); // the reconciler doesn't even read account or customer IDs
  });

  it("maps rows to the facts the reconciler compares, and drops anything whose subscription ID isn't a real one", async () => {
    q.result.current = {
      data: [
        { stripe_subscription_id: "sub_AAA111", last_event_id: "evt_123", subscription_status: "active", stripe_price_id: "price_X", cancel_at_period_end: true, current_period_end: "2026-12-01T00:00:00+00:00", canceled_at: null, ended_at: null, subscription_synced_at: "2026-11-01T00:00:00+00:00" },
        { stripe_subscription_id: "cus_NOTASUB", subscription_status: "active" },
        { stripe_subscription_id: "sub_with space", subscription_status: "active" },
        { stripe_subscription_id: null },
        { stripe_subscription_id: "sub_BBB222", last_event_id: "garbage", subscription_status: null, cancel_at_period_end: "yes" },
      ],
      error: null,
      status: 200,
    };
    expect(await createReconcileStore(env).candidates(STALE, 5)).toEqual([
      { subscriptionId: "sub_AAA111", lastEventId: "evt_123", status: "active", priceId: "price_X", cancelAtPeriodEnd: true, periodEnd: "2026-12-01T00:00:00+00:00", canceledAt: null, endedAt: null, syncedAt: "2026-11-01T00:00:00+00:00" },
      { subscriptionId: "sub_BBB222", lastEventId: null, status: null, priceId: null, cancelAtPeriodEnd: false, periodEnd: null, canceledAt: null, endedAt: null, syncedAt: null },
    ]);
  });

  it("a non-array answer is an empty list, never a guess", async () => {
    for (const data of [null, {}, "x"]) {
      q.result.current = { data, error: null, status: 200 };
      expect(await createReconcileStore(env).candidates(STALE, 5)).toEqual([]);
    }
  });

  it("a database error is thrown and logged with safe fields only", async () => {
    q.result.current = { data: null, error: { code: "42501", message: `denied; key ${KEY}; ${URL_}; sub_SECRET1` }, status: 403 };
    await expect(createReconcileStore(env).candidates(STALE, 5)).rejects.toBeInstanceOf(ReconcileStoreUnavailableError);
    expect(logs).toEqual([["reconcile billing store failure", { reason: "query_error", op: "candidates", code: "42501", status: 403 }]]);
    for (const secret of [KEY, URL_, "sub_SECRET1", "denied"]) expect(JSON.stringify(logs)).not.toContain(secret);
  });

  it("refuses to start without the server configuration, naming variables but never values", () => {
    expect(() => createReconcileStore({})).toThrow(ReconcileStoreUnavailableError);
    expect(logs).toEqual([["reconcile billing store failure", { reason: "missing_env", op: "init", missing: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] }]]);
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const q = vi.hoisted(() => {
  const calls: { table?: string; select?: string; col?: string; val?: string; limit?: number } = {};
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
    eq(c: string, v: string) {
      calls.col = c;
      calls.val = v;
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

import { PortalStoreUnavailableError, createPortalStore } from "./portalStore";

const KEY = "eyJSECRET.SERVICE.ROLEKEYVALUE";
const URL_ = "https://private-project-ref.supabase.co";
const env = { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY };
const USER = "11111111-2222-3333-4444-555555555555";

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  q.result.current = { data: null, error: null, status: 200 };
  for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("customerFor", () => {
  it("reads only the customer and status columns of the verified account's own row", async () => {
    q.result.current = { data: [{ stripe_customer_id: "cus_ABC123", subscription_status: "active" }], error: null, status: 200 };
    expect(await createPortalStore(env).customerFor(USER)).toEqual({ customerId: "cus_ABC123", status: "active" });
    expect(q.calls).toEqual({ table: "account_billing", select: "stripe_customer_id, subscription_status", col: "user_id", val: USER, limit: 1 });
  });

  it("no row, no customer, or a malformed customer ID is null (never a guess)", async () => {
    const store = createPortalStore(env);
    for (const data of [null, [], [{ stripe_customer_id: null, subscription_status: "active" }], [{ stripe_customer_id: "sub_123", subscription_status: "active" }], [{ stripe_customer_id: "cus_ x", subscription_status: "active" }], [{ subscription_status: "active" }], "cus_ABC"]) {
      q.result.current = { data, error: null, status: 200 };
      expect(await store.customerFor(USER)).toBeNull();
    }
  });

  it("a missing status is reported as null so the caller treats it as nothing to manage", async () => {
    q.result.current = { data: [{ stripe_customer_id: "cus_ABC123", subscription_status: null }], error: null, status: 200 };
    expect(await createPortalStore(env).customerFor(USER)).toEqual({ customerId: "cus_ABC123", status: null });
  });

  it("a database error is thrown (so no portal is opened) and logged with safe fields only", async () => {
    const store = createPortalStore(env);
    q.result.current = { data: null, error: { code: "42501", message: `denied; key ${KEY}; user ${USER}; ${URL_}` }, status: 403 };
    await expect(store.customerFor(USER)).rejects.toBeInstanceOf(PortalStoreUnavailableError);
    expect(logs).toEqual([["portal billing store failure", { reason: "query_error", op: "customerFor", code: "42501", status: 403 }]]);
    for (const secret of [KEY, URL_, USER, "denied"]) expect(JSON.stringify(logs)).not.toContain(secret);
  });

  it("refuses to start without the server configuration, naming the variables but never values", () => {
    expect(() => createPortalStore({})).toThrow(PortalStoreUnavailableError);
    expect(logs).toEqual([["portal billing store failure", { reason: "missing_env", op: "init", missing: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] }]]);
  });
});

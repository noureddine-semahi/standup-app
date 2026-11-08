// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => {
  const state = {
    rpc: { current: { data: null, error: null, status: 200 } as { data: unknown; error: unknown; status?: number } },
    tables: {} as Record<string, { data: unknown; error: unknown }>,
    folders: {} as Record<string, string[]>, // bucket -> object names currently in <userId>/
    removed: [] as string[],
    calls: [] as string[],
    listError: null as unknown,
    removeError: null as unknown,
    stuck: false, // objects that refuse to be removed
    deleteUser: { current: { error: null } as { error: unknown } },
    deleteUserThrows: false,
  };
  const chainFor = (table: string) => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, val: string) => (state.calls.push(`${table}.eq.${col}`), void val, c),
      limit: () => Promise.resolve(state.tables[table] ?? { data: [], error: null }),
    };
    return c;
  };
  const client = {
    rpc: (fn: string, args: unknown) => (state.calls.push(`rpc:${fn}:${JSON.stringify(args)}`), Promise.resolve(state.rpc.current)),
    from: (t: string) => chainFor(t),
    storage: {
      from: (bucket: string) => ({
        list: (prefix: string, opts: { limit: number; offset: number }) => {
          state.calls.push(`list:${bucket}:${prefix}`);
          if (state.listError) return Promise.resolve({ data: null, error: state.listError });
          const names = state.folders[bucket] ?? [];
          return Promise.resolve({ data: names.slice(opts.offset, opts.offset + opts.limit).map((name) => ({ name })), error: null });
        },
        remove: (paths: string[]) => {
          state.calls.push(`remove:${bucket}:${paths.length}`);
          if (state.removeError) return Promise.resolve({ data: null, error: state.removeError });
          if (!state.stuck) {
            state.removed.push(...paths);
            const gone = new Set(paths.map((p) => p.split("/").slice(1).join("/")));
            state.folders[bucket] = (state.folders[bucket] ?? []).filter((n) => !gone.has(n));
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
    },
    auth: { admin: { deleteUser: (id: string) => (state.calls.push(`deleteUser:${id}`), state.deleteUserThrows ? Promise.reject(new Error("net")) : Promise.resolve(state.deleteUser.current)) } },
  };
  return { state, client };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => m.client) }));

import { DeletionStoreUnavailableError, USER_BUCKETS, createDeletionStore } from "./deletionStore";

const KEY = "eyJSECRET.SERVICE.ROLEKEYVALUE";
const URL_ = "https://private-project-ref.supabase.co";
const env = { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY };
const USER = "11111111-2222-4333-8444-555555555555";
let logs: unknown[][];

beforeEach(() => {
  logs = [];
  Object.assign(m.state, { tables: {}, folders: {}, removed: [], calls: [], listError: null, removeError: null, stuck: false, deleteUserThrows: false });
  m.state.rpc.current = { data: null, error: null, status: 200 };
  m.state.deleteUser.current = { error: null };
  for (const l of ["error", "info", "log", "warn"] as const) vi.spyOn(console, l).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());
const store = () => createDeletionStore(env);

describe("state functions", () => {
  it("begin asks the database about the verified account only, and understands acquired / busy / invalid", async () => {
    m.state.rpc.current = { data: [{ r_result: "acquired", r_state: "billing_cancelled" }], error: null };
    expect(await store().begin(USER)).toEqual({ result: "acquired", state: "billing_cancelled" });
    expect(m.state.calls[0]).toBe(`rpc:begin_account_deletion:${JSON.stringify({ p_user_id: USER })}`);
    m.state.rpc.current = { data: [{ r_result: "busy", r_state: "pending" }], error: null };
    expect(await store().begin(USER)).toEqual({ result: "busy" });
    m.state.rpc.current = { data: [{ r_result: "invalid", r_state: null }], error: null };
    expect(await store().begin(USER)).toEqual({ result: "invalid" });
  });

  it("anything unrecognised is a failure, never a go-ahead", async () => {
    for (const data of [null, [], [{ r_result: "acquired" }], [{ r_result: "acquired", r_state: "weird" }], [{ r_result: "maybe" }]]) {
      m.state.rpc.current = { data, error: null };
      await expect(store().begin(USER)).rejects.toBeInstanceOf(DeletionStoreUnavailableError);
    }
    m.state.rpc.current = { data: "unknown", error: null };
    await expect(store().advance(USER, "billing_cancelled", null)).rejects.toBeInstanceOf(DeletionStoreUnavailableError);
    m.state.rpc.current = { data: "yes", error: null };
    await expect(store().isPending(USER)).rejects.toBeInstanceOf(DeletionStoreUnavailableError);
  });

  it("advance passes the state and failure category; isPending returns the database's boolean", async () => {
    m.state.rpc.current = { data: "ok", error: null };
    await store().advance(USER, "data_cleaned", "storage");
    expect(m.state.calls.at(-1)).toBe(`rpc:advance_account_deletion:${JSON.stringify({ p_user_id: USER, p_state: "data_cleaned", p_failure: "storage" })}`);
    m.state.rpc.current = { data: true, error: null };
    expect(await store().isPending(USER)).toBe(true);
    m.state.rpc.current = { data: false, error: null };
    expect(await store().isPending(USER)).toBe(false);
  });

  it("a database error is thrown and logged with safe fields only", async () => {
    m.state.rpc.current = { data: null, error: { code: "42501", message: `denied ${KEY} ${URL_} ${USER}` }, status: 403 };
    await expect(store().begin(USER)).rejects.toBeInstanceOf(DeletionStoreUnavailableError);
    expect(logs).toEqual([["account deletion store failure", { reason: "rpc_error", op: "begin", code: "42501", status: 403 }]]);
    for (const s of [KEY, URL_, USER, "denied"]) expect(JSON.stringify(logs)).not.toContain(s);
  });

  it("refuses to start without the server configuration, naming variables but never values", () => {
    expect(() => createDeletionStore({})).toThrow(DeletionStoreUnavailableError);
    expect(logs).toEqual([["account deletion store failure", { reason: "missing_env", op: "init", missing: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] }]]);
  });
});

describe("billing references", () => {
  it("reads only the member's own billing row and checkout attempts, and drops anything that isn't a real Stripe ID", async () => {
    m.state.tables.account_billing = { data: [{ stripe_customer_id: "cus_ABC123", stripe_subscription_id: "sub_XYZ789" }], error: null };
    m.state.tables.checkout_attempts = { data: [{ stripe_session_id: "cs_test_a1B2" }, { stripe_session_id: "cs_test_a1B2" }, { stripe_session_id: "evil" }, { stripe_session_id: null }], error: null };
    expect(await store().billingRefs(USER)).toEqual({ customerId: "cus_ABC123", subscriptionId: "sub_XYZ789", sessionIds: ["cs_test_a1B2"] });
    expect(m.state.calls).toEqual(["account_billing.eq.user_id", "checkout_attempts.eq.user_id"]);
    m.state.tables.account_billing = { data: [{ stripe_customer_id: "bad id", stripe_subscription_id: 5 }], error: null };
    m.state.tables.checkout_attempts = { data: null, error: null };
    expect(await store().billingRefs(USER)).toEqual({ customerId: null, subscriptionId: null, sessionIds: [] });
    m.state.tables.account_billing = { data: [], error: null };
    expect((await store().billingRefs(USER)).customerId).toBeNull();
  });

  it("a read error fails the step (the caller then refuses to continue)", async () => {
    m.state.tables.account_billing = { data: null, error: { code: "XX000" } };
    await expect(store().billingRefs(USER)).rejects.toBeInstanceOf(DeletionStoreUnavailableError);
  });
});

describe("storage", () => {
  it("empties the member's folder in every user bucket, in batches, and verifies it is empty", async () => {
    m.state.folders["goal-attachments"] = Array.from({ length: 230 }, (_, i) => `f${i}.png`);
    m.state.folders["post-images"] = ["a.jpg"];
    m.state.folders["avatars"] = ["avatar-1.png"];
    await store().removeStorage(USER);
    expect(m.state.removed).toHaveLength(232);
    expect(m.state.removed.every((p) => p.startsWith(USER + "/"))).toBe(true);
    for (const b of USER_BUCKETS) expect(m.state.folders[b] ?? []).toEqual([]);
    expect([...USER_BUCKETS]).toEqual(["goal-attachments", "post-images", "post-videos", "avatars"]);
  });

  it("only ever lists and removes inside the member's own folder", async () => {
    m.state.folders["avatars"] = ["x.png"];
    await store().removeStorage(USER);
    expect(m.state.calls.filter((c) => c.startsWith("list:")).every((c) => c.endsWith(":" + USER))).toBe(true);
  });

  it("nothing to remove is fine", async () => {
    await expect(store().removeStorage(USER)).resolves.toBeUndefined();
    expect(m.state.removed).toEqual([]);
  });

  it("objects that refuse to go fail the step (the login is then never deleted)", async () => {
    m.state.folders["post-videos"] = ["v.mp4"];
    m.state.stuck = true;
    await expect(store().removeStorage(USER)).rejects.toMatchObject({ reason: "storage_error" });
  });

  it("a list or remove error fails the step with safe logging", async () => {
    m.state.folders["avatars"] = ["x.png"];
    m.state.listError = { code: "500", message: `boom ${KEY}` };
    await expect(store().removeStorage(USER)).rejects.toMatchObject({ reason: "storage_error" });
    m.state.listError = null;
    m.state.removeError = { code: "403" };
    await expect(store().removeStorage(USER)).rejects.toMatchObject({ reason: "storage_error" });
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it("a malformed account ID never reaches storage", async () => {
    await expect(store().removeStorage("../other")).rejects.toBeInstanceOf(DeletionStoreUnavailableError);
    expect(m.state.calls).toEqual([]);
  });
});

describe("login deletion", () => {
  it("deletes exactly the given account", async () => {
    await store().deleteAuthUser(USER);
    expect(m.state.calls).toEqual([`deleteUser:${USER}`]);
  });

  it("an account that is already gone counts as done; any other error fails the step", async () => {
    m.state.deleteUser.current = { error: { status: 404, code: "user_not_found" } };
    await expect(store().deleteAuthUser(USER)).resolves.toBeUndefined();
    m.state.deleteUser.current = { error: { status: 500, code: "unexpected_failure", message: `db error ${USER} ${KEY}` } };
    await expect(store().deleteAuthUser(USER)).rejects.toMatchObject({ reason: "auth_error" });
    m.state.deleteUserThrows = true;
    await expect(store().deleteAuthUser(USER)).rejects.toMatchObject({ reason: "auth_error" });
    for (const s of [USER, KEY, "db error"]) expect(JSON.stringify(logs)).not.toContain(s);
  });
});

describe("data cleanup", () => {
  it("calls the one cleanup function for the verified account", async () => {
    await store().cleanupData(USER);
    expect(m.state.calls[0]).toBe(`rpc:cleanup_account_shared_data:${JSON.stringify({ p_user_id: USER })}`);
  });
});

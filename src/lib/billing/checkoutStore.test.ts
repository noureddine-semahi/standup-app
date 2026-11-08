// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ rpc })) }));

import { CheckoutStoreUnavailableError, createCheckoutStore } from "./checkoutStore";

const KEY = "eyJSECRET.SERVICE.ROLEKEYVALUE";
const URL_ = "https://private-project-ref.supabase.co";
const env = { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY };
const USER = "11111111-2222-3333-4444-555555555555";
const ATT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

let logs: unknown[][];
beforeEach(() => {
  rpc.mockReset();
  logs = [];
  for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());
const text = () => JSON.stringify(logs);

describe("begin", () => {
  it("asks the database about the verified account and plan, and understands each answer", async () => {
    const store = createCheckoutStore(env);
    rpc.mockResolvedValue({ data: [{ r_result: "claimed", r_attempt_id: ATT, r_session_id: null, r_plan: "monthly" }], error: null });
    expect(await store.begin(USER, "monthly")).toEqual({ result: "claimed", attemptId: ATT, plan: "monthly" });
    expect(rpc).toHaveBeenLastCalledWith("begin_checkout_attempt", { p_user_id: USER, p_plan: "monthly" });
    rpc.mockResolvedValue({ data: [{ r_result: "pending", r_attempt_id: ATT, r_session_id: "cs_test_abc", r_plan: "annual" }], error: null });
    expect(await store.begin(USER, "monthly")).toEqual({ result: "pending", attemptId: ATT, sessionId: "cs_test_abc", plan: "annual" });
    for (const result of ["subscription_exists", "in_progress"]) {
      rpc.mockResolvedValue({ data: [{ r_result: result, r_attempt_id: null, r_session_id: null, r_plan: null }], error: null });
      expect(await store.begin(USER, "monthly")).toEqual({ result });
    }
  });
  it("anything it doesn't fully recognise is a failure, never a go-ahead", async () => {
    const store = createCheckoutStore(env);
    for (const data of [null, [], [{ r_result: "claimed" }], [{ r_result: "claimed", r_attempt_id: "not-a-uuid", r_plan: "monthly" }], [{ r_result: "pending", r_attempt_id: ATT, r_session_id: "evil", r_plan: "monthly" }], [{ r_result: "invalid" }], [{ r_result: "maybe" }]]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(store.begin(USER, "monthly")).rejects.toBeInstanceOf(CheckoutStoreUnavailableError);
    }
  });
  it("a database failure is thrown (so no session is created) and logged with safe fields only", async () => {
    const store = createCheckoutStore(env);
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: `permission denied; key ${KEY}; user ${USER}`, details: "x", hint: "y" }, status: 403 });
    await expect(store.begin(USER, "monthly")).rejects.toMatchObject({ reason: "rpc_error" });
    expect(logs).toEqual([["checkout attempt store failure", { reason: "rpc_error", op: "begin", code: "42501", status: 403 }]]);
    for (const secret of [KEY, URL_, USER, "permission denied"]) expect(text()).not.toContain(secret);
    logs = [];
    rpc.mockRejectedValue(new Error(`fetch failed ${KEY} ${URL_}`));
    await expect(store.begin(USER, "monthly")).rejects.toBeInstanceOf(CheckoutStoreUnavailableError);
    expect(logs).toEqual([["checkout attempt store failure", { reason: "rpc_error", op: "begin" }]]);
    expect(text()).not.toContain(KEY);
  });
});

describe("record and finish", () => {
  it("call their functions with exactly the attempt, session and status", async () => {
    const store = createCheckoutStore(env);
    rpc.mockResolvedValue({ data: true, error: null });
    await store.record(ATT, "cs_test_abc", "2026-11-09T00:00:00.000Z");
    expect(rpc).toHaveBeenLastCalledWith("record_checkout_session", { p_attempt_id: ATT, p_session_id: "cs_test_abc", p_expires_at: "2026-11-09T00:00:00.000Z" });
    await store.finish(ATT, "completed");
    expect(rpc).toHaveBeenLastCalledWith("finish_checkout_attempt", { p_attempt_id: ATT, p_status: "completed" });
  });
  it("failures are thrown and diagnosed with their operation, without ids or messages", async () => {
    const store = createCheckoutStore(env);
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: ATT }, status: 404 });
    await expect(store.finish(ATT, "failed")).rejects.toBeInstanceOf(CheckoutStoreUnavailableError);
    expect(logs).toEqual([["checkout attempt store failure", { reason: "rpc_error", op: "finish", code: "PGRST202", status: 404 }]]);
    expect(text()).not.toContain(ATT);
  });
});

describe("configuration", () => {
  it("without the service role key or URL it names the missing variable (never a value) and refuses to work", () => {
    for (const [e, missing] of [[{ NEXT_PUBLIC_SUPABASE_URL: URL_ }, ["SUPABASE_SERVICE_ROLE_KEY"]], [{}, ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]]] as const) {
      logs = [];
      expect(() => createCheckoutStore(e)).toThrow(CheckoutStoreUnavailableError);
      expect(logs).toEqual([["checkout attempt store failure", { reason: "missing_env", op: "init", missing }]]);
    }
    expect(text()).not.toContain(KEY);
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ rpc })) }));

import { WebhookStoreUnavailableError, createWebhookStore } from "./webhookStore";

const KEY = "eyJSECRET.SERVICE.ROLEKEYVALUE";
const URL_ = "https://private-project-ref.supabase.co";
const env = { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY };
const EVENT = "evt_test_PRIVATE_EVENT_ID";

let logs: unknown[][];
beforeEach(() => {
  rpc.mockReset();
  logs = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a));
  vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => void logs.push(a));
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a));
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

const logged = () => logs.map((l) => l[1] as Record<string, unknown>);
const text = () => JSON.stringify(logs);

describe("missing_env", () => {
  it("names which variable is missing (never a value) and throws a missing_env error", () => {
    for (const [e, missing] of [
      [{ NEXT_PUBLIC_SUPABASE_URL: URL_ }, ["SUPABASE_SERVICE_ROLE_KEY"]],
      [{ SUPABASE_SERVICE_ROLE_KEY: KEY }, ["NEXT_PUBLIC_SUPABASE_URL"]],
      [{}, ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]],
      [{ NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "" }, ["SUPABASE_SERVICE_ROLE_KEY"]],
    ] as const) {
      logs = [];
      expect(() => createWebhookStore(e)).toThrow(WebhookStoreUnavailableError);
      try {
        createWebhookStore(e);
      } catch (err) {
        expect((err as WebhookStoreUnavailableError).reason).toBe("missing_env");
      }
      expect(logged()[0]).toEqual({ reason: "missing_env", op: "init", missing });
      expect(text()).not.toContain(KEY);
      expect(text()).not.toContain(URL_);
    }
  });
});

describe("rpc_error", () => {
  it("logs the PostgREST/Postgres code and HTTP status only", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: `permission denied for function claim_stripe_event; key ${KEY}`, details: "customer private@example.com", hint: "secret hint" }, status: 403 });
    await expect(createWebhookStore(env).claim(EVENT, "invoice.paid")).rejects.toMatchObject({ reason: "rpc_error" });
    expect(logged()).toEqual([{ reason: "rpc_error", op: "claim", code: "42501", status: 403 }]);
  });
  it("covers an invalid key (PostgREST JWT error), a missing function and a missing table", async () => {
    for (const [code, status] of [["PGRST301", 401], ["PGRST202", 404], ["42P01", 404], ["PGRST205", 404]] as const) {
      logs = [];
      rpc.mockResolvedValue({ data: null, error: { code, message: "x" }, status });
      await expect(createWebhookStore(env).claim(EVENT, "invoice.paid")).rejects.toBeInstanceOf(WebhookStoreUnavailableError);
      expect(logged()).toEqual([{ reason: "rpc_error", op: "claim", code, status }]);
    }
  });
  it("a call that throws (network, DNS, timeout) is rpc_error with no code or status, and its message is never logged", async () => {
    rpc.mockRejectedValue(new TypeError(`fetch failed: getaddrinfo ENOTFOUND private-project-ref.supabase.co ${KEY}`));
    await expect(createWebhookStore(env).claim(EVENT, "invoice.paid")).rejects.toMatchObject({ reason: "rpc_error" });
    expect(logged()).toEqual([{ reason: "rpc_error", op: "claim" }]);
    expect(text()).not.toContain("ENOTFOUND");
  });
  it("free text in the code field is dropped rather than logged", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: `Invalid API key ${KEY} for customer a@b.c`, message: "x" }, status: 401 });
    await expect(createWebhookStore(env).claim(EVENT, "invoice.paid")).rejects.toBeInstanceOf(WebhookStoreUnavailableError);
    expect(logged()).toEqual([{ reason: "rpc_error", op: "claim", status: 401 }]);
    expect(text()).not.toContain(KEY);
  });
  it("an absent or nonsensical status is omitted", async () => {
    for (const status of [undefined, "401", -1, 99999, 4.5, null]) {
      logs = [];
      rpc.mockResolvedValue({ data: null, error: { code: "42501" }, status });
      await expect(createWebhookStore(env).claim(EVENT, "invoice.paid")).rejects.toBeInstanceOf(WebhookStoreUnavailableError);
      expect(logged()).toEqual([{ reason: "rpc_error", op: "claim", code: "42501" }]);
    }
  });
  it("complete and fail failures are diagnosed with their own operation name", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" }, status: 403 });
    await expect(createWebhookStore(env).complete(EVENT)).rejects.toBeInstanceOf(WebhookStoreUnavailableError);
    await expect(createWebhookStore(env).fail(EVENT, "handler_error")).rejects.toBeInstanceOf(WebhookStoreUnavailableError);
    expect(logged().map((l) => l.op)).toEqual(["complete", "fail"]);
  });
});

describe("unexpected_response", () => {
  it("an answer that isn't claimed/duplicate/in_progress is its own category", async () => {
    for (const data of [null, "weird", { x: 1 }, 7]) {
      logs = [];
      rpc.mockResolvedValue({ data, error: null, status: 200 });
      await expect(createWebhookStore(env).claim(EVENT, "invoice.paid")).rejects.toMatchObject({ reason: "unexpected_response" });
      expect(logged()).toEqual([{ reason: "unexpected_response", op: "claim" }]);
    }
  });
});

describe("success and safety", () => {
  it("a successful claim logs nothing and returns the database's answer", async () => {
    for (const answer of ["claimed", "duplicate", "in_progress"] as const) {
      rpc.mockResolvedValue({ data: answer, error: null, status: 200 });
      expect(await createWebhookStore(env).claim(EVENT, "invoice.paid")).toBe(answer);
    }
    expect(logs).toEqual([]);
  });
  it("no failure path ever logs the key, the URL, the event ID, the arguments or the error text", async () => {
    const failures: Array<() => Promise<unknown>> = [
      async () => { rpc.mockResolvedValue({ data: null, error: { code: "42501", message: `${KEY} ${URL_} private@example.com`, details: EVENT, hint: KEY }, status: 401 }); return createWebhookStore(env).claim(EVENT, "invoice.paid"); },
      async () => { rpc.mockRejectedValue(new Error(`${KEY} ${URL_} ${EVENT}`)); return createWebhookStore(env).complete(EVENT); },
      async () => { rpc.mockResolvedValue({ data: KEY, error: null, status: 200 }); return createWebhookStore(env).claim(EVENT, "invoice.paid"); },
      async () => createWebhookStore({}),
    ];
    for (const f of failures) await f().catch(() => {});
    const t = text();
    for (const secret of [KEY, URL_, "private-project-ref", EVENT, "private@example.com", "evt_test", "permission denied", "ENOTFOUND"]) expect(t).not.toContain(secret);
    // only the allow-listed field names ever appear
    const fields = new Set(logged().flatMap((l) => Object.keys(l)));
    for (const f of fields) expect(["reason", "op", "missing", "code", "status"]).toContain(f);
  });
});

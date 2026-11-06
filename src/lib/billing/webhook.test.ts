// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";

vi.mock("server-only", () => ({}));

import { BillingConfigError } from "./config";
import { createWebhookVerifier } from "./stripe";
import { SUPPORTED_EVENT_TYPES, defaultHandlers, handleStripeWebhook, isSupportedEventType, type EventHandler, type WebhookDeps } from "./webhook";
import type { ClaimResult, WebhookStore } from "./webhookStore";

const SECRET = "whsec_testsecret123abc";
const KEY = "sk_test_secretkey456def";
const signer = new Stripe(KEY);
const sign = (payload: string, over: { secret?: string; timestamp?: number } = {}) => signer.webhooks.generateTestHeaderString({ payload, secret: over.secret ?? SECRET, ...(over.timestamp ? { timestamp: over.timestamp } : {}) });

const eventJson = (o: Record<string, unknown> = {}, indent = 2) =>
  JSON.stringify({ id: "evt_test_001", object: "event", api_version: "2025-01-01", created: 1_800_000_000, livemode: false, type: "invoice.paid", data: { object: { customer: "cus_PRIVATE123", customer_email: "private.person@example.com" } }, ...o }, null, indent);

/** Mirrors public.claim_stripe_event: one synchronous step per call, so it is atomic exactly like the single SQL statement. */
function memoryStore() {
  const rows = new Map<string, { status: "processing" | "processed" | "failed"; attempts: number; claimedAt: number; error: string | null }>();
  let now = 1_000_000;
  const store: WebhookStore & { rows: typeof rows; advance(ms: number): void } = {
    rows,
    advance: (ms) => void (now += ms),
    async claim(id): Promise<ClaimResult> {
      const r = rows.get(id);
      if (!r) {
        rows.set(id, { status: "processing", attempts: 1, claimedAt: now, error: null });
        return "claimed";
      }
      if (r.status === "failed" || (r.status === "processing" && r.claimedAt < now - 5 * 60_000)) {
        Object.assign(r, { status: "processing", attempts: r.attempts + 1, claimedAt: now, error: null });
        return "claimed";
      }
      return r.status === "processed" ? "duplicate" : "in_progress";
    },
    async complete(id) {
      const r = rows.get(id);
      if (r && r.status === "processing") r.status = "processed";
    },
    async fail(id, code) {
      const r = rows.get(id);
      if (r && r.status === "processing") Object.assign(r, { status: "failed", error: code });
    },
    async syncSubscription() {
      return "applied";
    },
  };
  return store;
}

const noopHandler = () => vi.fn<EventHandler>(async () => {});
const makeDeps = (over: Partial<WebhookDeps> = {}, store = memoryStore(), handler = noopHandler()) => {
  const handlers = Object.fromEntries(SUPPORTED_EVENT_TYPES.map((t) => [t, handler])) as unknown as WebhookDeps["handlers"];
  const deps: WebhookDeps = {
    readConfig: () => ({ secretKey: KEY, webhookSecret: SECRET }),
    verifier: (c) => createWebhookVerifier(c.secretKey, c.webhookSecret),
    store: () => store,
    handlers,
    ...over,
  };
  return { deps, store, handler };
};
const post = (body: string, headers: Record<string, string | undefined> = {}) =>
  new Request("https://standup-app-two.vercel.app/api/stripe/webhook", { method: "POST", headers: Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<string, string>, body });
const signed = (body: string, over?: Parameters<typeof sign>[1]) => post(body, { "stripe-signature": sign(body, over), "content-type": "application/json" });
const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const m of ["info", "log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("signature verification", () => {
  it("accepts a correctly signed event, over the exact raw body", async () => {
    const { deps, handler } = makeDeps();
    const r = await read(await handleStripeWebhook(signed(eventJson()), deps));
    expect(r).toEqual({ status: 200, body: { received: true, handled: true } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].id).toBe("evt_test_001");
  });
  it("rejects a missing signature header, before anything else is read or stored", async () => {
    const { deps, store, handler } = makeDeps();
    const r = await read(await handleStripeWebhook(post(eventJson(), { "content-type": "application/json" }), deps));
    expect(r).toEqual({ status: 400, body: { error: "missing_signature" } });
    expect(store.rows.size).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
  it("rejects wrong, malformed and empty signatures", async () => {
    const body = eventJson();
    const headers = [sign(body, { secret: "whsec_someOtherSecret999" }), "garbage", "t=,v1=", "t=123", `v1=${"0".repeat(64)}`, "t=1800000000,v1=notahex", ""];
    for (const h of headers) {
      const { deps, store, handler } = makeDeps();
      const r = await read(await handleStripeWebhook(post(body, { "stripe-signature": h }), deps));
      expect(r.status).toBe(400);
      expect(store.rows.size).toBe(0);
      expect(handler).not.toHaveBeenCalled();
    }
  });
  it("rejects a tampered body", async () => {
    const body = eventJson();
    const { deps, handler } = makeDeps();
    const r = await read(await handleStripeWebhook(post(body.replace("invoice.paid", "invoice.payment_failed"), { "stripe-signature": sign(body) }), deps));
    expect(r).toEqual({ status: 400, body: { error: "invalid_signature" } });
    expect(handler).not.toHaveBeenCalled();
  });
  it("rejects a replay: a validly signed event with an old timestamp", async () => {
    const { deps, handler } = makeDeps();
    const old = Math.floor(Date.now() / 1000) - 3600;
    const r = await read(await handleStripeWebhook(signed(eventJson(), { timestamp: old }), deps));
    expect(r.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
  it("verifies the RAW bytes: the same JSON re-serialised differently fails", async () => {
    const pretty = eventJson({}, 4);
    const compact = JSON.stringify(JSON.parse(pretty));
    expect(compact).not.toBe(pretty);
    const { deps } = makeDeps();
    const header = sign(pretty);
    expect((await handleStripeWebhook(post(pretty, { "stripe-signature": header }), deps)).status).toBe(200);
    const { deps: d2 } = makeDeps();
    expect((await handleStripeWebhook(post(compact, { "stripe-signature": header }), d2)).status).toBe(400);
  });
  it("never reaches the database for an unverified request", async () => {
    const storeFactory = vi.fn(() => memoryStore());
    const { deps } = makeDeps({ store: storeFactory });
    await handleStripeWebhook(post(eventJson(), { "stripe-signature": "bad" }), deps);
    await handleStripeWebhook(post(eventJson()), deps);
    expect(storeFactory).not.toHaveBeenCalled();
  });
  it("refuses an oversized payload", async () => {
    const { deps, handler } = makeDeps();
    const r = await read(await handleStripeWebhook(signed(eventJson({ pad: "x".repeat(600_000) })), deps));
    expect(r).toEqual({ status: 413, body: { error: "payload_too_large" } });
    expect(handler).not.toHaveBeenCalled();
  });
  it("rejects a live-mode event, even correctly signed", async () => {
    const { deps, store, handler } = makeDeps();
    const r = await read(await handleStripeWebhook(signed(eventJson({ livemode: true })), deps));
    expect(r).toEqual({ status: 400, body: { error: "live_mode_rejected" } });
    expect(store.rows.size).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("webhook configuration", () => {
  it("a missing or invalid secret fails safely: 503, nothing verified, nothing stored, nothing leaked", async () => {
    const storeFactory = vi.fn(() => memoryStore());
    const { deps } = makeDeps({
      readConfig: () => {
        throw new BillingConfigError(["STRIPE_WEBHOOK_SECRET is missing"]);
      },
      store: storeFactory,
    });
    const res = await handleStripeWebhook(signed(eventJson()), deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "webhook_unavailable" });
    expect(storeFactory).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain("STRIPE_WEBHOOK_SECRET");
  });
});

describe("supported and unsupported events", () => {
  it("recognises exactly the six subscription events", () => {
    expect([...SUPPORTED_EVENT_TYPES]).toEqual(["checkout.session.completed", "invoice.paid", "invoice.payment_failed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);
    expect(isSupportedEventType("invoice.paid")).toBe(true);
    expect(isSupportedEventType("customer.created")).toBe(false);
  });
  it("each supported type is claimed, handled once and marked processed", async () => {
    for (const type of SUPPORTED_EVENT_TYPES) {
      const { deps, store, handler } = makeDeps();
      const r = await read(await handleStripeWebhook(signed(eventJson({ type })), deps));
      expect(r).toEqual({ status: 200, body: { received: true, handled: true } });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(store.rows.get("evt_test_001")?.status).toBe("processed");
    }
  });
  it("a verified but unsupported event is acknowledged and changes nothing: no claim, no handler, no row", async () => {
    for (const type of ["customer.created", "charge.succeeded", "payment_intent.created", "price.updated"]) {
      const storeFactory = vi.fn(() => memoryStore());
      const { deps, handler } = makeDeps({ store: storeFactory });
      const r = await read(await handleStripeWebhook(signed(eventJson({ type })), deps));
      expect(r).toEqual({ status: 200, body: { received: true, handled: false } });
      expect(storeFactory).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    }
  });
  it("the default handlers only record billing: an event with no subscription is ignored without touching the store, and none can reach an entitlement", async () => {
    for (const h of Object.values(defaultHandlers)) expect(h.toString()).not.toMatch(/supabase|entitlement|rpc|from\(/);
    const store = memoryStore();
    const spy = vi.spyOn(store, "syncSubscription");
    for (const t of SUPPORTED_EVENT_TYPES) await expect(defaultHandlers[t]({ id: "evt_x", type: t, data: { object: {} } } as unknown as Stripe.Event, { store })).resolves.toBe("ignored_no_subscription");
    expect(spy).not.toHaveBeenCalled();
  });
  it("the handler's outcome code is logged next to the event ID, and nothing else is", async () => {
    const handler = vi.fn<EventHandler>().mockResolvedValue("sync_applied");
    const { deps } = makeDeps({}, memoryStore(), handler);
    await handleStripeWebhook(signed(eventJson()), deps);
    expect(JSON.stringify(logs)).toContain("sync_applied");
  });
});

describe("deduplication", () => {
  it("a duplicate delivery is acknowledged and not processed again", async () => {
    const { deps, store, handler } = makeDeps();
    const body = eventJson();
    expect((await read(await handleStripeWebhook(signed(body), deps))).body).toEqual({ received: true, handled: true });
    const second = await read(await handleStripeWebhook(signed(body), deps));
    expect(second).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.rows.get("evt_test_001")?.attempts).toBe(1);
  });
  it("different event IDs are independent", async () => {
    const { deps, handler } = makeDeps();
    await handleStripeWebhook(signed(eventJson({ id: "evt_test_A" })), deps);
    await handleStripeWebhook(signed(eventJson({ id: "evt_test_B" })), deps);
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it("concurrent deliveries of one event: the handler runs exactly once and every response is a safe acknowledgement or retry request", async () => {
    const handler = vi.fn<EventHandler>(() => new Promise((res) => setTimeout(res, 25)));
    const { deps } = makeDeps({}, memoryStore(), handler);
    const body = eventJson();
    const results = await Promise.all(Array.from({ length: 8 }, () => handleStripeWebhook(signed(body), deps).then(read)));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 200 && r.body.handled === true)).toHaveLength(1);
    for (const r of results) expect([200, 409]).toContain(r.status);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body).toEqual({ error: "in_progress" });
    // once the winner has finished, a late delivery is a plain duplicate
    expect((await read(await handleStripeWebhook(signed(body), deps))).body).toEqual({ received: true, duplicate: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("a delivery that arrives while the first is still running is told to retry later (409), not dropped", async () => {
    let release!: () => void;
    const handler = vi.fn<EventHandler>(() => new Promise<void>((res) => (release = res)));
    const { deps } = makeDeps({}, memoryStore(), handler);
    const first = handleStripeWebhook(signed(eventJson()), deps);
    await new Promise((r) => setTimeout(r, 5));
    expect((await read(await handleStripeWebhook(signed(eventJson()), deps))).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });
  it("a claim left behind by a crashed run expires and the event can be processed", async () => {
    const store = memoryStore();
    await store.claim("evt_test_001", "invoice.paid"); // claimed, never completed
    const { deps, handler } = makeDeps({}, store);
    expect((await handleStripeWebhook(signed(eventJson()), deps)).status).toBe(409);
    store.advance(6 * 60_000);
    expect((await handleStripeWebhook(signed(eventJson()), deps)).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("retry after a processing failure", () => {
  it("a failing handler returns 500 and marks the event failed; the retry re-claims and succeeds; then it is a duplicate", async () => {
    const handler = vi.fn<EventHandler>().mockRejectedValueOnce(new Error("boom: customer private.person@example.com")).mockResolvedValue(undefined);
    const { deps, store } = makeDeps({}, memoryStore(), handler);
    const body = eventJson();
    const first = await read(await handleStripeWebhook(signed(body), deps));
    expect(first).toEqual({ status: 500, body: { error: "processing_failed" } });
    expect(store.rows.get("evt_test_001")).toMatchObject({ status: "failed", error: "handler_error", attempts: 1 });
    const retry = await read(await handleStripeWebhook(signed(body), deps));
    expect(retry).toEqual({ status: 200, body: { received: true, handled: true } });
    expect(store.rows.get("evt_test_001")).toMatchObject({ status: "processed", attempts: 2 });
    expect((await read(await handleStripeWebhook(signed(body), deps))).body).toEqual({ received: true, duplicate: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it("the stored failure is a short code, never the error message", async () => {
    const handler = vi.fn<EventHandler>().mockRejectedValue(new Error("secret detail cus_PRIVATE123"));
    const { deps, store } = makeDeps({}, memoryStore(), handler);
    await handleStripeWebhook(signed(eventJson()), deps);
    expect(store.rows.get("evt_test_001")?.error).toBe("handler_error");
  });
  it("if recording the failure also fails, the response is still a retryable 500", async () => {
    const store = memoryStore();
    store.fail = async () => Promise.reject(new Error("db down"));
    const handler = vi.fn<EventHandler>().mockRejectedValue(new Error("x"));
    const { deps } = makeDeps({}, store, handler);
    expect((await handleStripeWebhook(signed(eventJson()), deps)).status).toBe(500);
  });
  it("an unavailable event store is a retryable 503 and the handler is not run", async () => {
    const store = memoryStore();
    store.claim = async () => Promise.reject(new Error("db down"));
    const { deps, handler } = makeDeps({}, store);
    expect(await read(await handleStripeWebhook(signed(eventJson()), deps))).toEqual({ status: 503, body: { error: "store_unavailable" } });
    expect(handler).not.toHaveBeenCalled();
    const { deps: d2, handler: h2 } = makeDeps({ store: () => { throw new Error("no service key"); } });
    expect((await handleStripeWebhook(signed(eventJson()), d2)).status).toBe(503);
    expect(h2).not.toHaveBeenCalled();
  });
  it("if marking the event complete fails the response asks for a retry", async () => {
    const store = memoryStore();
    store.complete = async () => Promise.reject(new Error("db down"));
    const { deps } = makeDeps({}, store);
    expect((await handleStripeWebhook(signed(eventJson()), deps)).status).toBe(503);
  });
});

describe("safe logging and responses", () => {
  it("logs only event ID, type and outcome: never the payload, customer data, signature or any secret", async () => {
    const { deps } = makeDeps();
    const body = eventJson();
    const header = sign(body);
    await handleStripeWebhook(post(body, { "stripe-signature": header }), deps);
    await handleStripeWebhook(post(body, { "stripe-signature": header }), deps); // duplicate
    await handleStripeWebhook(post(body, { "stripe-signature": "bad" }), deps); // invalid
    const text = JSON.stringify(logs);
    expect(text).toContain("evt_test_001");
    expect(text).toContain("invoice.paid");
    expect(text).toContain("processed");
    expect(text).toContain("duplicate");
    expect(text).toContain("invalid_signature");
    for (const secret of [SECRET, KEY, header, "private.person@example.com", "cus_PRIVATE123", "customer_email"]) expect(text).not.toContain(secret);
  });
  it("error and success responses never carry secrets, payload data or internal messages", async () => {
    const handler = vi.fn<EventHandler>().mockRejectedValue(new Error(`internal ${SECRET} ${KEY}`));
    const { deps } = makeDeps({}, memoryStore(), handler);
    const responses = [
      await handleStripeWebhook(signed(eventJson()), deps),
      await handleStripeWebhook(post(eventJson(), { "stripe-signature": "bad" }), deps),
      await handleStripeWebhook(post(eventJson()), deps),
    ];
    for (const r of responses) {
      const t = JSON.stringify(await r.json());
      for (const s of [SECRET, KEY, "private.person@example.com", "cus_PRIVATE123", "internal"]) expect(t).not.toContain(s);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });
});

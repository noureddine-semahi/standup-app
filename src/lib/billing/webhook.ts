import "server-only";
import type Stripe from "stripe";
import { readBillingConfig, readWebhookConfig, type WebhookConfig } from "@/lib/billing/config";
import { createSubscriptionSyncHandler } from "@/lib/billing/subscriptionSync";
import { createWebhookVerifier, getStripe } from "@/lib/billing/stripe";
import { createWebhookStore, type WebhookStore } from "@/lib/billing/webhookStore";

// POST /api/stripe/webhook: receives Stripe events: verified, deduplicated, and (Phase 5.6 step 1) recorded as BILLING RECORDS by the
// subscription sync handlers (subscriptionSync.ts). NOTHING here grants or revokes Premium or changes a trial, entitlement or admin
// grant: turning a verified billing record into an entitlement is a later step.
//
// Order: webhook configuration -> signature header -> raw body -> signature verification -> live-mode guard -> supported type? ->
// claim (persistent, atomic dedup) -> handler -> complete/fail. A request that fails any early step never reaches the database, and
// an unsupported event is acknowledged without touching it at all.
//
// Responses are generic ({received} or {error: code}). Logs carry event ID, type and outcome only: never the payload, customer data,
// signature or any secret.

export const SUPPORTED_EVENT_TYPES = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
export type SupportedEventType = (typeof SUPPORTED_EVENT_TYPES)[number];
export const isSupportedEventType = (t: string): t is SupportedEventType => (SUPPORTED_EVENT_TYPES as readonly string[]).includes(t);

/**
 * What to do with a verified, first-time event. Must be idempotent (a crashed run can be retried). May return a short safe outcome
 * code (e.g. "sync_applied") that is logged alongside the event ID.
 */
export type EventHandler = (event: Stripe.Event, ctx: { store: WebhookStore }) => Promise<string | void>;

// All six events are about one subscription: each is resolved to that subscription's current state and recorded (subscriptionSync.ts).
const syncHandler = createSubscriptionSyncHandler({
  retrieveSubscription: (id) => getStripe().subscriptions.retrieve(id),
  prices: () => readBillingConfig().prices,
  mode: () => readBillingConfig().mode,
  now: () => new Date(),
});
export const defaultHandlers: Readonly<Record<SupportedEventType, EventHandler>> = {
  "checkout.session.completed": syncHandler,
  "invoice.paid": syncHandler,
  "invoice.payment_failed": syncHandler,
  "customer.subscription.created": syncHandler,
  "customer.subscription.updated": syncHandler,
  "customer.subscription.deleted": syncHandler,
};

export type WebhookDeps = {
  readConfig(): WebhookConfig;
  verifier(config: WebhookConfig): (rawBody: string, signatureHeader: string) => Stripe.Event;
  store(): WebhookStore;
  handlers: Readonly<Record<SupportedEventType, EventHandler>>;
};

const realDeps = (): WebhookDeps => ({
  readConfig: () => readWebhookConfig(),
  verifier: (c) => createWebhookVerifier(c.secretKey, c.webhookSecret),
  store: () => createWebhookStore(),
  handlers: defaultHandlers,
});

export type WebhookError =
  | "webhook_unavailable"
  | "missing_signature"
  | "payload_too_large"
  | "invalid_signature"
  | "live_mode_rejected"
  | "test_mode_rejected"
  | "store_unavailable"
  | "in_progress"
  | "processing_failed";

const STATUS: Record<WebhookError, number> = {
  webhook_unavailable: 503,
  missing_signature: 400,
  payload_too_large: 413,
  invalid_signature: 400,
  live_mode_rejected: 400,
  test_mode_rejected: 400,
  store_unavailable: 503,
  in_progress: 409,
  processing_failed: 500,
};

const MAX_BODY_CHARS = 512 * 1024;

const respond = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (error: WebhookError) => respond({ error }, STATUS[error]);

const log = (fields: { event?: string; type?: string; outcome: string; detail?: string }) => console.info("stripe webhook", fields);

export async function handleStripeWebhook(req: Request, deps: WebhookDeps = realDeps()): Promise<Response> {
  let config: WebhookConfig;
  try {
    config = deps.readConfig();
  } catch {
    log({ outcome: "webhook_unavailable" });
    return fail("webhook_unavailable");
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    log({ outcome: "missing_signature" });
    return fail("missing_signature");
  }

  // The RAW body, exactly as received: the signature is over these bytes, so it must never be parsed and re-serialised first.
  const rawBody = await req.text().catch(() => "");
  if (rawBody.length > MAX_BODY_CHARS) {
    log({ outcome: "payload_too_large" });
    return fail("payload_too_large");
  }

  let event: Stripe.Event;
  try {
    event = deps.verifier(config)(rawBody, signature);
  } catch {
    log({ outcome: "invalid_signature" });
    return fail("invalid_signature");
  }

  // The event's own mode must be exactly this environment's mode: a test environment never processes a live event, and a live environment
  // never processes a test event (even a correctly signed one). Anything that isn't a boolean is refused as the wrong mode too.
  if (config.mode === "live" ? event.livemode !== true : event.livemode !== false) {
    const outcome = config.mode === "live" ? "test_mode_rejected" : "live_mode_rejected";
    log({ event: event.id, type: event.type, outcome });
    return fail(outcome);
  }

  if (!isSupportedEventType(event.type)) {
    log({ event: event.id, type: event.type, outcome: "ignored_unsupported" });
    return respond({ received: true, handled: false }, 200); // acknowledged; nothing stored, nothing changed
  }

  let store: WebhookStore;
  let claim: Awaited<ReturnType<WebhookStore["claim"]>>;
  try {
    store = deps.store();
    claim = await store.claim(event.id, event.type);
  } catch {
    log({ event: event.id, type: event.type, outcome: "store_unavailable" });
    return fail("store_unavailable"); // Stripe will retry
  }

  if (claim === "duplicate") {
    log({ event: event.id, type: event.type, outcome: "duplicate" });
    return respond({ received: true, duplicate: true }, 200);
  }
  if (claim === "in_progress") {
    log({ event: event.id, type: event.type, outcome: "in_progress" });
    return fail("in_progress"); // another delivery is processing it; Stripe will retry
  }

  let detail: string | void;
  try {
    detail = await deps.handlers[event.type](event, { store });
  } catch {
    await store.fail(event.id, "handler_error").catch(() => {});
    log({ event: event.id, type: event.type, outcome: "processing_failed" });
    return fail("processing_failed"); // Stripe will retry; the next delivery re-claims the failed event
  }

  try {
    await store.complete(event.id);
  } catch {
    log({ event: event.id, type: event.type, outcome: "complete_failed" });
    return fail("store_unavailable"); // the claim lease expires and a retry can run again
  }
  log({ event: event.id, type: event.type, outcome: "processed", ...(typeof detail === "string" ? { detail } : {}) });
  return respond({ received: true, handled: true }, 200);
}

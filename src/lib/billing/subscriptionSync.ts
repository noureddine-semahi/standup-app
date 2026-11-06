import "server-only";
import type Stripe from "stripe";
import { BILLING_PLANS, type BillingPlan } from "@/lib/billing/plans";
import type { SubscriptionSyncArgs, WebhookStore } from "@/lib/billing/webhookStore";

// Phase 5.6 step 1: turn a VERIFIED Stripe event into a billing record. BILLING RECORDS ONLY: nothing here activates or revokes Premium,
// reads or writes entitlements, trials or admin grants. (A later step turns verified billing records into entitlements.)
//
// Trust model:
//   * the event arrived through the signature-verified webhook, but the event body is only used to learn WHICH subscription changed;
//   * the subscription's actual state is then fetched from Stripe's API with our secret key (so duplicate and out-of-order events all
//     converge on Stripe's latest truth, and a stale payload can never overwrite newer state);
//   * the plan comes from the Price ID, matched against OUR two configured Prices (never from metadata or anything a browser sent);
//   * the account comes from the Checkout metadata our own server set from the signed-in user, weighed by the database against existing
//     billing records (an existing record always wins, and any contradiction changes nothing).

export type SyncContext = { store: WebhookStore };
export type SubscriptionSyncHandler = (event: Stripe.Event, ctx: SyncContext) => Promise<string>;

export type SubscriptionSyncDeps = {
  /** Fetch the subscription's current state from Stripe. */
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  /** The configured Price IDs. Throws if billing isn't configured (the event is then retried by Stripe). */
  prices(): Readonly<Record<BillingPlan, string>>;
  now(): Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
/** A Stripe ID from either an ID string or an expanded object. */
const idOf = (v: unknown): string | null => (typeof v === "string" && v ? v : (obj(v)?.id as string | undefined) || null);
const iso = (seconds: unknown): string | null => (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null);

export type SubscriptionRef = { subscriptionId: string; userHints: string[] };

/** Which subscription this event is about, and any user hints the event itself carries. Null when it isn't about a subscription. */
export function subscriptionRef(event: Stripe.Event): SubscriptionRef | null {
  const o = obj(event.data?.object);
  if (!o) return null;
  const hints = (...vals: unknown[]) => vals.filter((v): v is string => typeof v === "string" && v.length > 0);

  switch (event.type) {
    case "checkout.session.completed": {
      if (o.mode !== "subscription") return null;
      const subscriptionId = idOf(o.subscription);
      return subscriptionId ? { subscriptionId, userHints: hints(o.client_reference_id, obj(o.metadata)?.user_id) } : null;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscriptionId = idOf(o);
      return subscriptionId ? { subscriptionId, userHints: hints(obj(o.metadata)?.user_id) } : null;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      // the subscription reference moved between Stripe API versions: top-level `subscription`, or parent.subscription_details.subscription
      const subscriptionId = idOf(o.subscription) ?? idOf(obj(obj(o.parent)?.subscription_details)?.subscription);
      return subscriptionId ? { subscriptionId, userHints: [] } : null;
    }
    default:
      return null;
  }
}

export type BuiltSync = { ok: true; args: SubscriptionSyncArgs } | { ok: false; reason: string };

/**
 * The record to store, from the subscription as Stripe reports it. `userHints` are every hint seen (event + subscription metadata);
 * they must be valid account IDs and must agree with each other, otherwise nothing is recorded.
 */
export function buildSyncArgs(sub: Stripe.Subscription, prices: Readonly<Record<BillingPlan, string>>, eventId: string, userHints: string[], fetchedAt: string): BuiltSync {
  if (sub.livemode === true) return { ok: false, reason: "ignored_live_mode" };

  const customerId = idOf(sub.customer);
  if (!customerId || !sub.id) return { ok: false, reason: "ignored_incomplete_subscription" };

  const items = (sub.items?.data ?? []) as unknown as Obj[];
  let matched: { item: Obj; plan: BillingPlan; priceId: string } | null = null;
  for (const item of items) {
    const priceId = idOf(obj(item)?.price);
    const plan = BILLING_PLANS.find((p) => prices[p] === priceId);
    if (priceId && plan) {
      matched = { item, plan, priceId };
      break;
    }
  }
  if (!matched) return { ok: false, reason: "ignored_unknown_price" };

  const distinct = [...new Set(userHints.map((h) => h.toLowerCase()))];
  if (distinct.some((h) => !UUID.test(h))) return { ok: false, reason: "ignored_invalid_user_hint" };
  if (distinct.length > 1) return { ok: false, reason: "ignored_conflicting_user_hints" };

  // billing period: on the item in current Stripe API versions, on the subscription in older ones
  const legacy = sub as unknown as Obj;
  return {
    ok: true,
    args: {
      eventId,
      userHint: distinct[0] ?? null,
      customerId,
      subscriptionId: sub.id,
      priceId: matched.priceId,
      plan: matched.plan,
      status: String(sub.status),
      periodStart: iso(matched.item.current_period_start ?? legacy.current_period_start),
      periodEnd: iso(matched.item.current_period_end ?? legacy.current_period_end),
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      canceledAt: iso(sub.canceled_at),
      endedAt: iso(sub.ended_at),
      fetchedAt,
    },
  };
}

const isNotFound = (e: unknown): boolean => {
  const err = e as { code?: string; statusCode?: number } | null;
  return err?.code === "resource_missing" || err?.statusCode === 404;
};

export function createSubscriptionSyncHandler(deps: SubscriptionSyncDeps): SubscriptionSyncHandler {
  return async (event, { store }) => {
    const ref = subscriptionRef(event);
    if (!ref) return "ignored_no_subscription";

    const prices = deps.prices(); // throws if billing isn't configured: the event fails and Stripe retries it later
    const fetchedAt = deps.now().toISOString(); // taken BEFORE the fetch, so a slower, older snapshot can never look newer

    let sub: Stripe.Subscription;
    try {
      sub = await deps.retrieveSubscription(ref.subscriptionId);
    } catch (e) {
      if (isNotFound(e)) return "ignored_subscription_not_found"; // not a subscription of this account: nothing to record, nothing to retry
      throw e; // anything else is transient: fail so Stripe retries
    }

    const metaHint = obj(sub.metadata)?.user_id;
    const hints = [...ref.userHints, ...(typeof metaHint === "string" && metaHint ? [metaHint] : [])];
    const built = buildSyncArgs(sub, prices, event.id, hints, fetchedAt);
    if (!built.ok) return built.reason;

    return `sync_${await store.syncSubscription(built.args)}`;
  };
}

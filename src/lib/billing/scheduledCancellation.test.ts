// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import fs from "fs";
import path from "path";

vi.mock("server-only", () => ({}));

import { buildSyncArgs, cancellationScheduled, createSubscriptionSyncHandler, type SubscriptionSyncDeps } from "./subscriptionSync";
import type { SubscriptionSyncArgs, WebhookStore } from "./webhookStore";
import { billingGrantsPremium } from "@/lib/billingEntitlement";
import { billingView } from "@/lib/billingStatusView";
import type { BillingStatus } from "@/lib/supabase/billingStatus";

const USER = "0b8c1d1e-2f3a-4b5c-8d6e-7f8091a2b3c4";
const PRICES = { monthly: "price_MONTHLY1", annual: "price_ANNUAL1" } as const;
const NOW_S = 1_800_000_000; // "now", in Stripe seconds
const NOW_ISO = new Date(NOW_S * 1000).toISOString();
const END_S = NOW_S + 20 * 86400; // the end of the period already paid for
const END_ISO = new Date(END_S * 1000).toISOString();

const item = () => ({ id: "si_1", price: { id: PRICES.monthly }, current_period_start: NOW_S - 10 * 86400, current_period_end: END_S });
const subscription = (o: Record<string, unknown> = {}) =>
  ({ id: "sub_TEST1", object: "subscription", customer: "cus_TEST1", status: "active", livemode: false, cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null, metadata: { user_id: USER }, items: { data: [item()] }, ...o }) as unknown as Stripe.Subscription;
const flagOf = (sub: Stripe.Subscription): boolean => {
  const r = buildSyncArgs(sub, PRICES, "evt_1", [USER], NOW_ISO);
  if (!r.ok) throw new Error(r.reason);
  return r.args.cancelAtPeriodEnd;
};

describe("a subscription scheduled to cancel is recognised (the normalisation)", () => {
  it("legacy mode: cancel_at_period_end=true", () => {
    expect(flagOf(subscription({ cancel_at_period_end: true }))).toBe(true);
    expect(flagOf(subscription({ cancel_at_period_end: true, cancel_at: null }))).toBe(true);
    expect(flagOf(subscription({ cancel_at_period_end: true, cancel_at: END_S }))).toBe(true);
  });

  it("flexible mode, as the real Customer Portal produced it: cancel_at at the period end with cancel_at_period_end=false", () => {
    expect(flagOf(subscription({ cancel_at_period_end: false, cancel_at: END_S, canceled_at: NOW_S - 5 }))).toBe(true);
  });

  it("a normal renewing subscription is not scheduled", () => {
    expect(flagOf(subscription())).toBe(false);
    expect(flagOf(subscription({ cancel_at: null, cancel_at_period_end: false }))).toBe(false);
    expect(flagOf(subscription({ status: "trialing" }))).toBe(false);
  });

  it("a cancel_at before the period end (inside the paid period) counts", () => {
    expect(flagOf(subscription({ cancel_at: END_S - 86400 }))).toBe(true);
    expect(flagOf(subscription({ cancel_at: NOW_S + 1 }))).toBe(true);
  });

  it("reversal: after the member keeps the subscription Stripe sends cancel_at=null and the flag goes back to false (both modes)", () => {
    expect(flagOf(subscription({ cancel_at: END_S }))).toBe(true);
    expect(flagOf(subscription({ cancel_at: null, canceled_at: null, cancel_at_period_end: false }))).toBe(false); // flexible mode, undone
    expect(flagOf(subscription({ cancel_at_period_end: false }))).toBe(false); // legacy mode, undone
  });
});

describe("timestamp boundaries and bad data are handled conservatively", () => {
  const f = (cancel_at: unknown, periodEnd: string | null = END_ISO, now = NOW_ISO) => cancellationScheduled({ cancel_at_period_end: false, cancel_at }, periodEnd, now);

  it("exactly at the period end counts; one second later does not", () => {
    expect(f(END_S)).toBe(true);
    expect(f(END_S + 1)).toBe(false);
    expect(f(END_S - 1)).toBe(true);
  });

  it("must be strictly in the future: now and the past do not count", () => {
    expect(f(NOW_S)).toBe(false);
    expect(f(NOW_S - 1)).toBe(false);
    expect(f(NOW_S + 1)).toBe(true);
    expect(f(1)).toBe(false);
  });

  it("later than the period end (a cancellation we can't place inside the paid period) is not claimed", () => {
    expect(f(END_S + 30 * 86400)).toBe(false);
    expect(f(END_S + 365 * 86400)).toBe(false);
  });

  it("absent, null, malformed and non-integer values are not claimed", () => {
    for (const v of [undefined, null, "", "1800000000", "soon", NaN, Infinity, -Infinity, 0, -5, 1.5, END_S + 0.5, {}, [], [END_S], true, false, NOW_S * 1000 * 1000]) expect(f(v), String(v)).toBe(false);
  });

  it("without a usable period end (or clock) a cancel_at cannot be placed, so it is not claimed; the legacy flag still counts", () => {
    expect(f(END_S, null)).toBe(false);
    expect(f(END_S, "garbage")).toBe(false);
    expect(f(END_S, END_ISO, "garbage")).toBe(false);
    expect(cancellationScheduled({ cancel_at_period_end: true, cancel_at: null }, null, "garbage")).toBe(true);
  });

  it("only a literal true counts for the legacy flag", () => {
    for (const v of ["true", 1, "yes", null, undefined, {}]) expect(cancellationScheduled({ cancel_at_period_end: v, cancel_at: null }, END_ISO, NOW_ISO), String(v)).toBe(false);
  });

  it("no date is invented: the recorded period end, canceled_at and ended_at come from Stripe unchanged, whatever cancel_at says", () => {
    const r = buildSyncArgs(subscription({ cancel_at: END_S - 86400, canceled_at: null }), PRICES, "evt_1", [USER], NOW_ISO);
    if (!r.ok) throw new Error(r.reason);
    expect(r.args.periodEnd).toBe(END_ISO);
    expect(r.args.canceledAt).toBeNull();
    expect(r.args.endedAt).toBeNull();
    expect(Object.keys(r.args).sort()).toEqual(["cancelAtPeriodEnd", "canceledAt", "customerId", "endedAt", "eventId", "fetchedAt", "periodEnd", "periodStart", "plan", "priceId", "status", "subscriptionId", "userHint"]); // no new column
  });

  it("the check is made against the time the subscription was fetched, so the stored value matches Stripe at that moment", () => {
    const sub = subscription({ cancel_at: NOW_S + 100 });
    const early = buildSyncArgs(sub, PRICES, "e", [USER], new Date((NOW_S + 50) * 1000).toISOString());
    const late = buildSyncArgs(sub, PRICES, "e", [USER], new Date((NOW_S + 150) * 1000).toISOString());
    if (!early.ok || !late.ok) throw new Error("build");
    expect(early.args.cancelAtPeriodEnd).toBe(true);
    expect(late.args.cancelAtPeriodEnd).toBe(false);
  });
});

describe("every synchronisation path applies it (the webhook handler fetches fresh state, then uses the same builder)", () => {
  function run(type: string, objectOverride: Record<string, unknown>, fresh: Stripe.Subscription) {
    const calls: SubscriptionSyncArgs[] = [];
    const store = { syncSubscription: vi.fn(async (a: SubscriptionSyncArgs) => (calls.push(a), "applied" as const)) } as unknown as WebhookStore;
    const deps: SubscriptionSyncDeps = { retrieveSubscription: async () => fresh, prices: () => PRICES, now: () => new Date(NOW_S * 1000) };
    const event = { id: "evt_X", type, livemode: false, data: { object: objectOverride } } as unknown as Stripe.Event;
    return createSubscriptionSyncHandler(deps)(event, { store }).then(() => calls);
  }
  const scheduled = subscription({ cancel_at: END_S });
  const subObj = { id: "sub_TEST1", object: "subscription", metadata: { user_id: USER } };

  it("customer.subscription.updated / created / deleted use the fresh subscription's cancel_at", async () => {
    for (const type of ["customer.subscription.updated", "customer.subscription.created"]) {
      expect((await run(type, subObj, scheduled))[0].cancelAtPeriodEnd, type).toBe(true);
    }
    expect((await run("customer.subscription.deleted", subObj, subscription({ status: "canceled", cancel_at: null, ended_at: NOW_S, canceled_at: NOW_S })))[0].cancelAtPeriodEnd).toBe(false);
  });

  it("invoice events and checkout.session.completed (which look the subscription up by ID) apply it too", async () => {
    const invoice = { id: "in_1", object: "invoice", parent: { subscription_details: { subscription: "sub_TEST1", metadata: { user_id: USER } } }, subscription: "sub_TEST1" };
    for (const type of ["invoice.paid", "invoice.payment_failed"]) expect((await run(type, invoice, scheduled))[0].cancelAtPeriodEnd, type).toBe(true);
    const session = { id: "cs_1", object: "checkout.session", mode: "subscription", subscription: "sub_TEST1", client_reference_id: USER, metadata: { user_id: USER } };
    expect((await run("checkout.session.completed", session, scheduled))[0].cancelAtPeriodEnd).toBe(true);
  });

  it("the reversal event writes false again", async () => {
    expect((await run("customer.subscription.updated", subObj, scheduled))[0].cancelAtPeriodEnd).toBe(true);
    expect((await run("customer.subscription.updated", subObj, subscription({ cancel_at: null })))[0].cancelAtPeriodEnd).toBe(false);
  });
});

describe("Premium access timing is untouched", () => {
  const facts = { status: "active", currentPeriodEnd: END_ISO };
  const DAY = 86400_000;

  it("the access policy takes no cancellation input at all: the same status and period end give the same answer at every moment", () => {
    for (const offset of [-20 * DAY, -1, 0, 3 * DAY, 3 * DAY + 1, 30 * DAY]) {
      const now = Date.parse(END_ISO) + offset;
      expect(billingGrantsPremium({ ...facts, ...({ cancelAtPeriodEnd: true } as object) }, now)).toBe(billingGrantsPremium(facts, now));
    }
  });

  it("a scheduled cancellation keeps Premium through the paid period and the existing 3-day slack, then ends it exactly as a renewing subscription's missing renewal would", () => {
    const end = Date.parse(END_ISO);
    expect(billingGrantsPremium(facts, end - 1)).toBe(true);
    expect(billingGrantsPremium(facts, end)).toBe(true);
    expect(billingGrantsPremium(facts, end + 3 * DAY)).toBe(true);
    expect(billingGrantsPremium(facts, end + 3 * DAY + 1)).toBe(false);
  });

  it("neither the sync module nor the policy module lets the cancellation flag drive access", () => {
    const policy = fs.readFileSync(path.join(process.cwd(), "src/lib/billingEntitlement.ts"), "utf8");
    expect(policy).not.toMatch(/cancel_at|cancelAt/i);
    const sync = fs.readFileSync(path.join(process.cwd(), "src/lib/billing/subscriptionSync.ts"), "utf8");
    expect(sync).not.toMatch(/from\s+["']@\/lib\/(billingEntitlement|entitlements)/);
  });
});

describe("what the member sees (view model)", () => {
  const status = (o: Partial<BillingStatus>): BillingStatus => ({ access: "premium", source: "subscription", plan: "monthly", status: "active", periodEnd: END_ISO, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: true, trialEndsAt: null, ...o });

  it("a renewing subscription says renews; a scheduled one says cancels and doesn't claim a renewal", () => {
    expect(billingView(status({}))?.subscription).toMatchObject({ kind: "active", explainKey: "billing.explain.active", grantsPremium: true });
    expect(billingView(status({ cancelAtPeriodEnd: true }))?.subscription).toMatchObject({ kind: "activeCanceling", explainKey: "billing.explain.activeCanceling", statusKey: "billing.status.activeCanceling", date: END_ISO, grantsPremium: true });
  });

  it("scheduled cancellation without a date uses the no-date wording rather than inventing one", () => {
    expect(billingView(status({ cancelAtPeriodEnd: true, periodEnd: null }))?.subscription).toMatchObject({ explainKey: "billing.explain.activeCancelingNoDate", date: null });
  });

  it("trialing and active both show the cancellation; past_due and canceled keep their own wording", () => {
    expect(billingView(status({ status: "trialing", cancelAtPeriodEnd: true }))?.subscription?.kind).toBe("activeCanceling");
    expect(billingView(status({ status: "past_due", cancelAtPeriodEnd: true, graceEndsAt: END_ISO }))?.subscription?.kind).toBe("pastDueGrace");
    expect(billingView(status({ status: "canceled", cancelAtPeriodEnd: true, subscriptionGrantsPremium: false, access: "free", source: "none" }))?.subscription?.kind).toBe("canceled");
  });
});

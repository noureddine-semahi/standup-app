import { describe, it, expect } from "vitest";
import { billingView, statusKind } from "./billingStatusView";
import type { BillingStatus } from "./supabase/billingStatus";

const END = "2026-12-01T00:00:00.000Z";
const GRACE_END = "2026-12-08T00:00:00.000Z";
const mk = (o: Partial<BillingStatus> = {}): BillingStatus => ({
  access: "free", source: "none", plan: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: false, trialEndsAt: null, ...o,
});
const sub = (o: Partial<BillingStatus> = {}) => mk({ access: "premium", source: "subscription", plan: "monthly", status: "active", periodEnd: END, subscriptionGrantsPremium: true, ...o });

describe("subscription statuses", () => {
  it("active: renews on the period end", () => {
    const v = billingView(sub())!;
    expect(v.subscription).toMatchObject({ kind: "active", statusKey: "billing.status.active", explainKey: "billing.explain.active", date: END, grantsPremium: true, planKey: "billing.plan.monthly" });
    expect(v.access?.key).toBe("billing.access.subscription");
  });
  it("active and set to cancel: says it won't renew and when Premium ends", () => {
    const v = billingView(sub({ cancelAtPeriodEnd: true }))!;
    expect(v.subscription).toMatchObject({ kind: "activeCanceling", explainKey: "billing.explain.activeCanceling", date: END, grantsPremium: true });
  });
  it("trialing: renews on the period end", () => {
    expect(billingView(sub({ status: "trialing" }))!.subscription).toMatchObject({ kind: "trialing", explainKey: "billing.explain.trialing", date: END });
  });
  it("annual plans are labelled annual", () => {
    expect(billingView(sub({ plan: "annual" }))!.subscription?.planKey).toBe("billing.plan.annual");
  });

  describe("failed payment: the 7-day grace period and its expiration", () => {
    it("inside the grace period: Premium continues until the grace end", () => {
      const v = billingView(sub({ status: "past_due", graceEndsAt: GRACE_END, subscriptionGrantsPremium: true }))!;
      expect(v.subscription).toMatchObject({ kind: "pastDueGrace", statusKey: "billing.status.pastDueGrace", explainKey: "billing.explain.pastDueGrace", date: GRACE_END, grantsPremium: true });
    });
    it("after the grace period: the subscription no longer gives Premium, and the grace end date is stated", () => {
      const v = billingView(mk({ plan: "monthly", status: "past_due", periodEnd: END, graceEndsAt: GRACE_END, subscriptionGrantsPremium: false }))!;
      expect(v.subscription).toMatchObject({ kind: "pastDueEnded", statusKey: "billing.status.pastDueEnded", explainKey: "billing.explain.pastDueEnded", date: GRACE_END, grantsPremium: false });
      expect(v.access?.key).toBe("billing.access.free"); // Free with a subscription record: the access line says Free, never Premium
    });
    it("past_due without a grace end date uses the no-date wording rather than inventing one", () => {
      const v = billingView(mk({ plan: "monthly", status: "past_due", subscriptionGrantsPremium: false }))!;
      expect(v.subscription).toMatchObject({ kind: "pastDueEnded", explainKey: "billing.explain.pastDueEndedNoDate", date: null });
    });
  });

  it("canceled: ended, with the end date (or the no-date wording)", () => {
    expect(billingView(mk({ plan: "monthly", status: "canceled", endedAt: "2026-11-20T00:00:00.000Z", periodEnd: END }))!.subscription).toMatchObject({ kind: "canceled", explainKey: "billing.explain.canceled", date: "2026-11-20T00:00:00.000Z", grantsPremium: false });
    expect(billingView(mk({ plan: "monthly", status: "canceled", periodEnd: END }))!.subscription).toMatchObject({ explainKey: "billing.explain.canceled", date: END });
    expect(billingView(mk({ plan: "monthly", status: "canceled" }))!.subscription).toMatchObject({ explainKey: "billing.explain.canceledNoDate", date: null });
  });
  it("unpaid, incomplete, incomplete_expired and paused each have their own honest wording and never claim Premium", () => {
    for (const [status, kind] of [["unpaid", "unpaid"], ["incomplete", "incomplete"], ["incomplete_expired", "incompleteExpired"], ["paused", "paused"]] as const) {
      const v = billingView(mk({ plan: "monthly", status, periodEnd: END }))!;
      expect(v.subscription).toMatchObject({ kind, grantsPremium: false });
      expect(v.subscription?.statusKey).toBe(`billing.status.${kind}`);
    }
  });
  it("an active status the database says gives no Premium (renewal update missing) is NOT shown as simply active", () => {
    const v = billingView(mk({ plan: "monthly", status: "active", periodEnd: END, subscriptionGrantsPremium: false }))!;
    expect(v.subscription).toMatchObject({ kind: "activeStale", statusKey: "billing.status.activeStale", grantsPremium: false });
  });
  it("an unrecognised status is described neutrally, never as active", () => {
    for (const status of ["something_new", "ACTIVE", ""]) {
      const k = statusKind({ status, cancelAtPeriodEnd: false, subscriptionGrantsPremium: true });
      expect(k).toBe("unknown");
    }
    expect(billingView(mk({ plan: "monthly", status: "something_new", subscriptionGrantsPremium: false }))!.subscription).toMatchObject({ kind: "unknown", explainKey: "billing.explain.unknown", date: null });
  });
});

describe("how the member has Premium: subscription, admin grant, trial or Free", () => {
  it("an admin grant with no subscription: says so, and shows no subscription section", () => {
    const v = billingView(mk({ access: "premium", source: "manual" }))!;
    expect(v.access?.key).toBe("billing.access.manual");
    expect(v.subscription).toBeNull();
  });
  it("an admin grant WITH a canceled subscription: Premium is explained as the admin grant, and the subscription is shown as canceled, not active", () => {
    const v = billingView(mk({ access: "premium", source: "manual", plan: "monthly", status: "canceled", endedAt: END, subscriptionGrantsPremium: false }))!;
    expect(v.access?.key).toBe("billing.access.manual");
    expect(v.subscription).toMatchObject({ kind: "canceled", grantsPremium: false });
  });
  it("a trial with no subscription adds nothing (the trial card already covers it)", () => {
    expect(billingView(mk({ access: "premium_trial", source: "trial", trialEndsAt: END }))).toBeNull();
  });
  it("a running trial with a canceled subscription: Premium is explained as the trial, with its end date, and the subscription is not shown as giving Premium", () => {
    const v = billingView(mk({ access: "premium_trial", source: "trial", trialEndsAt: END, plan: "monthly", status: "canceled", subscriptionGrantsPremium: false }))!;
    expect(v.access).toEqual({ key: "billing.access.trial", date: END });
    expect(v.subscription).toMatchObject({ kind: "canceled", grantsPremium: false });
  });
  it("Premium from a subscription is the only case that says 'through your subscription'", () => {
    expect(billingView(sub())!.access?.key).toBe("billing.access.subscription");
    expect(billingView(mk({ access: "premium", source: "manual", plan: "monthly", status: "active", periodEnd: END, subscriptionGrantsPremium: true }))!.access?.key).toBe("billing.access.manual");
  });
  it("a Free account with no subscription shows nothing", () => {
    expect(billingView(mk())).toBeNull();
    expect(billingView(null)).toBeNull();
    expect(billingView(undefined)).toBeNull();
  });
  it("a Free account whose subscription ended says it is on the Free plan, with the subscription described as ended", () => {
    const v = billingView(mk({ plan: "annual", status: "canceled", endedAt: END }))!;
    expect(v.access?.key).toBe("billing.access.free");
    expect(v.subscription).toMatchObject({ kind: "canceled", planKey: "billing.plan.annual" });
  });
  it("having Premium never produces an 'active' description by itself: with no subscription record there is no subscription section", () => {
    for (const source of ["manual", "trial", "subscription"] as const) {
      const v = billingView(mk({ access: source === "trial" ? "premium_trial" : "premium", source }));
      expect(v?.subscription ?? null).toBeNull();
    }
  });
});

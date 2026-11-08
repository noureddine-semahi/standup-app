import { describe, it, expect } from "vitest";
import { subscriptionKind, summarizeBillingOverview, summarizeSubscriptions, type BillingRow, type EntitlementRow } from "./billingSummary";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;
const id = () => `u${++n}`;
const bill = (userId: string, status: string | null, over: Partial<BillingRow> = {}): BillingRow => ({ userId, status, periodEnd: iso(NOW + 10 * DAY), cancelAtPeriodEnd: false, ...over });
const ent = (userId: string, tier: EntitlementRow["tier"], trialEndsAt: string | null = null): EntitlementRow => ({ userId, tier, trialEndsAt });
const overview = (o: Partial<Parameters<typeof summarizeBillingOverview>[0]> = {}) => summarizeBillingOverview({ totalAccounts: 0, entitlements: [], billing: [], trialHistoryUserIds: [], now: NOW, ...o });

describe("how one subscription record is classified", () => {
  it("active and trialing: running, or scheduled to end when the cancel flag is on", () => {
    for (const s of ["active", "trialing"]) {
      expect(subscriptionKind({ status: s, cancelAtPeriodEnd: false })).toBe("active");
      expect(subscriptionKind({ status: s, cancelAtPeriodEnd: true })).toBe("scheduledCancellation");
    }
  });
  it("past_due is past due (the cancel flag doesn't change that), canceled and incomplete_expired are canceled", () => {
    expect(subscriptionKind({ status: "past_due", cancelAtPeriodEnd: false })).toBe("pastDue");
    expect(subscriptionKind({ status: "past_due", cancelAtPeriodEnd: true })).toBe("pastDue");
    for (const s of ["canceled", "incomplete_expired"]) {
      expect(subscriptionKind({ status: s, cancelAtPeriodEnd: false })).toBe("canceled");
      expect(subscriptionKind({ status: s, cancelAtPeriodEnd: true })).toBe("canceled"); // an ended subscription is canceled, not "scheduled"
    }
  });
  it("everything else (incomplete, unpaid, paused, unknown, missing) is 'other' and is never counted as active", () => {
    for (const s of ["incomplete", "unpaid", "paused", "something_new", "ACTIVE", "", null]) expect(subscriptionKind({ status: s, cancelAtPeriodEnd: false }), String(s)).toBe("other");
  });
  it("the counts add up to the total, status by status", () => {
    const rows = [bill("a", "active"), bill("b", "active"), bill("c", "trialing", { cancelAtPeriodEnd: true }), bill("d", "past_due"), bill("e", "canceled"), bill("f", "incomplete_expired"), bill("g", "unpaid"), bill("h", "paused"), bill("i", null)];
    expect(summarizeSubscriptions(rows)).toEqual({ active: 2, scheduledCancellation: 1, pastDue: 1, canceled: 2, other: 3, total: 9 });
    expect(summarizeSubscriptions([])).toEqual({ active: 0, scheduledCancellation: 0, pastDue: 0, canceled: 0, other: 0, total: 0 });
  });
});

describe("account totals follow the app's own precedence (manual grant, then billing, then trial, then Free)", () => {
  it("plain accounts with no rows are Free and could still start the trial", () => {
    const o = overview({ totalAccounts: 10 });
    expect(o.accounts).toEqual({ total: 10, free: 10, trial: 0, premium: 0, trialAvailable: 10 });
  });

  it("classifies a mixed population exactly", () => {
    const [manual, active, canceling, pastDue, pastDueExpired, canceled, trialOn, trialOver, bothSources, usedFree] = Array.from({ length: 10 }, id);
    const o = overview({
      totalAccounts: 14, // 4 plain accounts with no rows at all
      entitlements: [ent(manual, "premium"), ent(trialOn, "premium_trial", iso(NOW + 5 * DAY)), ent(trialOver, "premium_trial", iso(NOW - 2 * DAY)), ent(bothSources, "premium"), ent(usedFree, "free")],
      billing: [bill(active, "active"), bill(canceling, "active", { cancelAtPeriodEnd: true }), bill(pastDue, "past_due", { periodEnd: iso(NOW - 2 * DAY) }), bill(pastDueExpired, "past_due", { periodEnd: iso(NOW - 20 * DAY) }), bill(canceled, "canceled"), bill(bothSources, "active")],
      trialHistoryUserIds: [trialOn, trialOver, usedFree],
    });
    // premium: manual, active, canceling(still active), pastDue (within the 7-day grace), bothSources = 5. trial: trialOn = 1.
    // free: pastDueExpired (grace over), canceled, trialOver, usedFree + 4 plain = 8 -> 14 total
    expect(o.accounts).toEqual({ total: 14, free: 8, trial: 1, premium: 5, trialAvailable: 8 - 2 }); // trialOver and usedFree have used it; pastDueExpired/canceled/plain haven't
    expect(o.subscriptions).toEqual({ active: 2, scheduledCancellation: 1, pastDue: 2, canceled: 1, other: 0, total: 6 });
    expect(o.accounts.free + o.accounts.trial + o.accounts.premium).toBe(o.accounts.total);
  });

  it("an admin grant that outranks a canceled subscription stays Premium; a canceled subscription alone is Free", () => {
    const a = id();
    const b = id();
    const o = overview({ totalAccounts: 2, entitlements: [ent(a, "premium")], billing: [bill(a, "canceled"), bill(b, "canceled")] });
    expect(o.accounts).toMatchObject({ premium: 1, free: 1 });
  });

  it("an ended trial is Free and has used its trial; an active one is Trial", () => {
    const over = id();
    const on = id();
    const o = overview({ totalAccounts: 2, entitlements: [ent(over, "premium_trial", iso(NOW - DAY)), ent(on, "premium_trial", iso(NOW + DAY))], trialHistoryUserIds: [over, on] });
    expect(o.accounts).toEqual({ total: 2, free: 1, trial: 1, premium: 0, trialAvailable: 0 });
  });

  it("never reports fewer accounts than it has rows for, and never a negative count", () => {
    const a = id();
    const b = id();
    const o = overview({ totalAccounts: 1, entitlements: [ent(a, "premium"), ent(b, "premium")] });
    expect(o.accounts.total).toBe(2);
    expect(Object.values(o.accounts).every((v) => v >= 0)).toBe(true);
  });
});

describe("manual grants are kept apart from Stripe subscriptions", () => {
  it("counts each source independently, and the overlap once", () => {
    const [manualOnly, stripeOnly, both, trialOnly, canceledOnly, graceStripe] = Array.from({ length: 6 }, id);
    const o = overview({
      totalAccounts: 6,
      entitlements: [ent(manualOnly, "premium"), ent(both, "premium"), ent(trialOnly, "premium_trial", iso(NOW + DAY))],
      billing: [bill(stripeOnly, "active"), bill(both, "trialing"), bill(canceledOnly, "canceled"), bill(graceStripe, "past_due", { periodEnd: iso(NOW - DAY) })],
    });
    expect(o.premiumSources).toEqual({ manualGrants: 2, stripeSubscriptions: 3, both: 1 });
    expect(o.accounts.premium).toBe(4); // manualOnly, stripeOnly, both, graceStripe: the trial and the canceled one aren't Premium
  });

  it("a trial is not a manual grant, and a subscription that no longer gives Premium is not a Stripe source", () => {
    const a = id();
    const b = id();
    const o = overview({ totalAccounts: 2, entitlements: [ent(a, "premium_trial", iso(NOW + DAY))], billing: [bill(b, "past_due", { periodEnd: iso(NOW - 30 * DAY) })] });
    expect(o.premiumSources).toEqual({ manualGrants: 0, stripeSubscriptions: 0, both: 0 });
  });
});

describe("the output is aggregate-only", () => {
  it("contains numbers and nothing that identifies a member, whatever went in", () => {
    const rows = Array.from({ length: 5 }, () => id());
    const o = overview({ totalAccounts: 7, entitlements: rows.map((r) => ent(r, "premium")), billing: rows.map((r) => bill(r, "active")), trialHistoryUserIds: rows });
    const text = JSON.stringify(o);
    for (const r of rows) expect(text).not.toContain(r);
    const leaves: unknown[] = [];
    (function walk(v: unknown) {
      if (v && typeof v === "object") Object.values(v).forEach(walk);
      else leaves.push(v);
    })(o);
    expect(leaves.every((v) => typeof v === "number")).toBe(true);
  });
});

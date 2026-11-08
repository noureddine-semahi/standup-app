import { describe, it, expect } from "vitest";
import { BILLING_ACTIVE_SLACK_DAYS, BILLING_PAST_DUE_GRACE_DAYS, BILLING_STATUS_POLICY, billingGrantsPremium, effectiveTierFromSources } from "./billingEntitlement";

const DAY = 24 * 60 * 60 * 1000;
const END = Date.parse("2026-12-01T00:00:00.000Z"); // end of the period already paid for
const endIso = new Date(END).toISOString();
const at = (offsetMs: number) => END + offsetMs;
const b = (status: string | null, currentPeriodEnd: string | null = endIso) => ({ status, currentPeriodEnd });

describe("billing status policy", () => {
  it("active and trialing grant Premium within the paid period", () => {
    for (const s of ["active", "trialing"]) {
      expect(billingGrantsPremium(b(s), at(-20 * DAY))).toBe(true);
      expect(billingGrantsPremium(b(s), at(-1))).toBe(true);
      expect(billingGrantsPremium(b(s), at(0))).toBe(true);
    }
  });
  it("active tolerates a late renewal update for 3 days, then stops", () => {
    expect(BILLING_ACTIVE_SLACK_DAYS).toBe(3);
    expect(billingGrantsPremium(b("active"), at(3 * DAY))).toBe(true); // inclusive boundary
    expect(billingGrantsPremium(b("active"), at(3 * DAY + 1))).toBe(false);
  });
  it("a missing period end on an active subscription is treated as in-period", () => {
    expect(billingGrantsPremium(b("active", null), at(500 * DAY))).toBe(true);
    expect(billingGrantsPremium(b("active", "garbage"), at(500 * DAY))).toBe(true);
  });

  describe("failed payments (past_due): an intentional 7-day grace, never an immediate revocation", () => {
    it("keeps Premium through the grace period", () => {
      expect(BILLING_PAST_DUE_GRACE_DAYS).toBe(7);
      expect(billingGrantsPremium(b("past_due"), at(-1 * DAY))).toBe(true); // renewal failing right at the period boundary
      expect(billingGrantsPremium(b("past_due"), at(0))).toBe(true);
      expect(billingGrantsPremium(b("past_due"), at(1 * DAY))).toBe(true);
      expect(billingGrantsPremium(b("past_due"), at(7 * DAY))).toBe(true); // inclusive boundary
    });
    it("ends when the grace period does, even if Stripe is still retrying", () => {
      expect(billingGrantsPremium(b("past_due"), at(7 * DAY + 1))).toBe(false);
      expect(billingGrantsPremium(b("past_due"), at(30 * DAY))).toBe(false);
    });
    it("past_due with no known period end is not Premium (no grace can be computed)", () => {
      expect(billingGrantsPremium(b("past_due", null), at(0))).toBe(false);
    });
  });

  it("unpaid, canceled, incomplete, incomplete_expired and paused never grant Premium, even inside the old period", () => {
    for (const s of ["unpaid", "canceled", "incomplete", "incomplete_expired", "paused"]) {
      expect(billingGrantsPremium(b(s), at(-20 * DAY))).toBe(false);
      expect(billingGrantsPremium(b(s), at(0))).toBe(false);
    }
  });
  it("unknown, future, empty or missing statuses fail closed", () => {
    for (const s of ["something_new", "ACTIVE", "", null]) expect(billingGrantsPremium(b(s), at(-DAY))).toBe(false);
    expect(billingGrantsPremium(null, at(0))).toBe(false);
    expect(billingGrantsPremium(undefined, at(0))).toBe(false);
  });
  it("every Stripe status is explicitly classified", () => {
    expect(Object.keys(BILLING_STATUS_POLICY).sort()).toEqual(["active", "canceled", "incomplete", "incomplete_expired", "past_due", "paused", "trialing", "unpaid"]);
  });
  it("a cancel-at-period-end subscription stays 'active' (so Premium) until the period ends, then Stripe sets 'canceled'", () => {
    expect(billingGrantsPremium(b("active"), at(-2 * DAY))).toBe(true);
    expect(billingGrantsPremium(b("canceled"), at(1))).toBe(false);
  });
});

describe("entitlement precedence", () => {
  const trialEnds = new Date(END + 30 * DAY).toISOString();
  const trialPast = new Date(END - 30 * DAY).toISOString();
  const now = at(-10 * DAY);

  it("1. a manual admin grant is Premium whatever Stripe says", () => {
    for (const status of [null, "canceled", "unpaid", "incomplete_expired", "paused", "active"]) {
      expect(effectiveTierFromSources({ storedTier: "premium", trialEndsAt: null, billing: b(status) }, at(100 * DAY))).toBe("premium");
    }
  });
  it("a Stripe cancellation never revokes independently granted access, and never touches an active trial", () => {
    const canceled = b("canceled");
    expect(effectiveTierFromSources({ storedTier: "premium", trialEndsAt: null, billing: canceled }, now)).toBe("premium");
    expect(effectiveTierFromSources({ storedTier: "premium_trial", trialEndsAt: trialEnds, billing: canceled }, now)).toBe("premium_trial");
  });
  it("2. billing-derived Premium applies to an account with no stored grant, with a Free row, or with an expired trial", () => {
    expect(effectiveTierFromSources({ storedTier: null, trialEndsAt: null, billing: b("active") }, now)).toBe("premium");
    expect(effectiveTierFromSources({ storedTier: "free", trialEndsAt: null, billing: b("active") }, now)).toBe("premium");
    expect(effectiveTierFromSources({ storedTier: "premium_trial", trialEndsAt: trialPast, billing: b("active") }, now)).toBe("premium");
  });
  it("billing outranks an active trial (the account shows Premium), and the trial dates are simply left alone", () => {
    expect(effectiveTierFromSources({ storedTier: "premium_trial", trialEndsAt: trialEnds, billing: b("active") }, now)).toBe("premium");
  });
  it("3. an active trial still works with no billing, and an expired one is Free", () => {
    expect(effectiveTierFromSources({ storedTier: "premium_trial", trialEndsAt: trialEnds, billing: null }, now)).toBe("premium_trial");
    expect(effectiveTierFromSources({ storedTier: "premium_trial", trialEndsAt: trialPast, billing: null }, now)).toBe("free");
  });
  it("4. everything else is Free: no row, a Free row, or billing that doesn't grant", () => {
    expect(effectiveTierFromSources({ storedTier: null, trialEndsAt: null, billing: null }, now)).toBe("free");
    expect(effectiveTierFromSources({ storedTier: "free", trialEndsAt: null, billing: b("canceled") }, now)).toBe("free");
  });
  it("renewal: a new period end restores or keeps Premium; the downgrade path returns to Free without any stored change", () => {
    const sources = (status: string, end: number) => ({ storedTier: "free" as const, trialEndsAt: null, billing: b(status, new Date(end).toISOString()) });
    expect(effectiveTierFromSources(sources("active", END), at(5 * DAY))).toBe("free"); // renewal update never arrived: past slack
    expect(effectiveTierFromSources(sources("active", END + 30 * DAY), at(5 * DAY))).toBe("premium"); // renewed: period end moved forward
    expect(effectiveTierFromSources(sources("past_due", END), at(2 * DAY))).toBe("premium"); // failed renewal: grace
    expect(effectiveTierFromSources(sources("past_due", END), at(8 * DAY))).toBe("free"); // grace over
    expect(effectiveTierFromSources(sources("active", END + 30 * DAY), at(8 * DAY))).toBe("premium"); // paid after the retry
  });
});

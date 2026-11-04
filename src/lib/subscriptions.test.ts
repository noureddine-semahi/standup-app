import { describe, it, expect } from "vitest";
import type { Bill } from "./bills";
import {
  annualCents,
  applyStatusAction,
  effectiveStatus,
  emptySubscriptionForm,
  findPossibleOverlaps,
  lastPayment,
  monthlyCents,
  nextCharge,
  parseSubscriptionForm,
  parseSubscriptionPaymentEntry,
  paymentsPerYear,
  previousRenewal,
  renewalDates,
  shiftMonths,
  subscriptionSuggestionKey,
  subscriptionToFormValues,
  suggestSubscriptionGoals,
  summarizeSubscriptions,
  totalPaid,
  totalPaidInYear,
  upcomingEvents,
  type Subscription,
  type SubscriptionPayment,
} from "./subscriptions";

const TODAY = "2026-11-04";

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1",
  name: "Netflix",
  provider: null,
  category: null,
  planName: null,
  amount: 15.49,
  currency: "USD",
  frequency: "monthly",
  customInterval: null,
  customUnit: null,
  nextBillingDate: "2026-11-20",
  startDate: null,
  status: "active",
  trialEndsOn: null,
  remindDaysBefore: 3,
  notes: null,
  billId: null,
  canceledAt: null,
  cancelUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const pay = (over: Partial<SubscriptionPayment> = {}): SubscriptionPayment => ({
  id: "p1",
  subscriptionId: "s1",
  amount: 15.49,
  paidAt: "2026-10-20T12:00:00",
  note: null,
  billingDate: null,
  reversedAt: null,
  ...over,
});

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: "b1",
  name: "Rent",
  amountType: "fixed",
  expectedAmount: 1000,
  recurrence: "monthly",
  firstDueDate: "2026-01-12",
  remindDaysBefore: 3,
  category: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("annualization (weekly 52, monthly 12, quarterly 4, yearly 1, custom by interval)", () => {
  it("payments per year", () => {
    expect(paymentsPerYear(sub({ frequency: "weekly" }))).toBe(52);
    expect(paymentsPerYear(sub({ frequency: "monthly" }))).toBe(12);
    expect(paymentsPerYear(sub({ frequency: "quarterly" }))).toBe(4);
    expect(paymentsPerYear(sub({ frequency: "yearly" }))).toBe(1);
    expect(paymentsPerYear(sub({ frequency: "custom", customInterval: 10, customUnit: "days" }))).toBe(36.5);
    expect(paymentsPerYear(sub({ frequency: "custom", customInterval: 2, customUnit: "weeks" }))).toBe(26);
    expect(paymentsPerYear(sub({ frequency: "custom", customInterval: 2, customUnit: "months" }))).toBe(6);
  });

  it("an incomplete custom schedule has no cost rather than a guessed one", () => {
    expect(paymentsPerYear(sub({ frequency: "custom", customInterval: null, customUnit: null }))).toBeNull();
    expect(paymentsPerYear(sub({ frequency: "custom", customInterval: 0, customUnit: "days" }))).toBeNull();
    expect(annualCents(sub({ frequency: "custom", customInterval: null, customUnit: null }))).toBeNull();
  });

  it("annual and monthly-equivalent cents per frequency (rounded once, cent-exact)", () => {
    expect(annualCents(sub())).toBe(18588); // 15.49 * 12
    expect(monthlyCents(sub())).toBe(1549);
    expect(annualCents(sub({ frequency: "weekly", amount: 10 }))).toBe(52000);
    expect(monthlyCents(sub({ frequency: "weekly", amount: 10 }))).toBe(4333); // 520/12 = 43.33
    expect(annualCents(sub({ frequency: "quarterly", amount: 30 }))).toBe(12000);
    expect(monthlyCents(sub({ frequency: "quarterly", amount: 30 }))).toBe(1000);
    expect(annualCents(sub({ frequency: "yearly", amount: 120 }))).toBe(12000);
    expect(monthlyCents(sub({ frequency: "yearly", amount: 120 }))).toBe(1000);
    expect(annualCents(sub({ frequency: "custom", customInterval: 10, customUnit: "days", amount: 5 }))).toBe(18250);
    expect(annualCents(sub({ frequency: "custom", customInterval: 2, customUnit: "weeks", amount: 20 }))).toBe(52000);
    expect(annualCents(sub({ frequency: "custom", customInterval: 2, customUnit: "months", amount: 30 }))).toBe(18000);
  });

  it("a missing price is unknown, never $0; an explicit $0 is a real $0", () => {
    expect(annualCents(sub({ amount: null }))).toBeNull();
    expect(monthlyCents(sub({ amount: null }))).toBeNull();
    expect(annualCents(sub({ amount: 0 }))).toBe(0);
  });
});

describe("shiftMonths (anchor day kept, clamped to month end, leap years)", () => {
  it("Jan 31 anchor: Feb 28 (non-leap), Mar 31, Apr 30 -- never drifting to the 28th", () => {
    expect(shiftMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(shiftMonths("2026-01-31", 3)).toBe("2026-04-30");
    expect(shiftMonths("2026-01-31", 4)).toBe("2026-05-31");
  });
  it("leap year uses Feb 29", () => {
    expect(shiftMonths("2027-12-31", 2)).toBe("2028-02-29");
    expect(shiftMonths("2028-01-30", 1)).toBe("2028-02-29");
  });
  it("29th and 30th anchors", () => {
    expect(shiftMonths("2026-01-29", 1)).toBe("2026-02-28");
    expect(shiftMonths("2026-01-30", 1)).toBe("2026-02-28");
    expect(shiftMonths("2026-01-30", 2)).toBe("2026-03-30");
  });
  it("yearly Feb 29: Feb 28 in non-leap years, Feb 29 again in leap years", () => {
    expect(shiftMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(shiftMonths("2024-02-29", 24)).toBe("2026-02-28");
    expect(shiftMonths("2024-02-29", 48)).toBe("2028-02-29");
  });
  it("negative shifts and year boundaries", () => {
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(shiftMonths("2026-01-15", -13)).toBe("2024-12-15");
    expect(shiftMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("renewalDates", () => {
  it("monthly from a month-end anchor", () => {
    const s = sub({ nextBillingDate: "2026-01-31" });
    expect(renewalDates(s, "2026-01-01", "2026-06-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  });
  it("weekly, quarterly and yearly (incl. Feb 29)", () => {
    expect(renewalDates(sub({ frequency: "weekly", nextBillingDate: "2026-11-02" }), "2026-11-09", "2026-11-30")).toEqual(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(renewalDates(sub({ frequency: "quarterly", nextBillingDate: "2026-11-30" }), "2026-11-01", "2027-12-31")).toEqual(["2026-11-30", "2027-02-28", "2027-05-30", "2027-08-30", "2027-11-30"]);
    expect(renewalDates(sub({ frequency: "yearly", nextBillingDate: "2024-02-29" }), "2024-01-01", "2028-12-31")).toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });
  it("custom: days, weeks and months", () => {
    expect(renewalDates(sub({ frequency: "custom", customInterval: 10, customUnit: "days", nextBillingDate: "2026-11-01" }), "2026-11-01", "2026-12-01")).toEqual(["2026-11-01", "2026-11-11", "2026-11-21", "2026-12-01"]);
    expect(renewalDates(sub({ frequency: "custom", customInterval: 2, customUnit: "weeks", nextBillingDate: "2026-11-01" }), "2026-11-01", "2026-12-01")).toEqual(["2026-11-01", "2026-11-15", "2026-11-29"]);
    expect(renewalDates(sub({ frequency: "custom", customInterval: 2, customUnit: "months", nextBillingDate: "2026-01-31" }), "2026-01-01", "2026-12-31")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-09-30", "2026-11-30"]);
  });
  it("an anchor in the past still projects forward correctly", () => {
    expect(renewalDates(sub({ nextBillingDate: "2025-01-12" }), "2026-10-01", "2027-01-31")).toEqual(["2026-10-12", "2026-11-12", "2026-12-12", "2027-01-12"]);
  });
  it("a start date before the anchor extends the schedule backwards; without one, nothing precedes the anchor", () => {
    expect(renewalDates(sub({ nextBillingDate: "2026-11-20", startDate: "2026-09-01" }), "2026-08-01", "2026-11-30")).toEqual(["2026-09-20", "2026-10-20", "2026-11-20"]);
    expect(renewalDates(sub({ nextBillingDate: "2026-11-20" }), "2026-08-01", "2026-11-30")).toEqual(["2026-11-20"]);
  });
  it("a trial never produces renewals before its first charge", () => {
    expect(renewalDates(sub({ status: "trial", nextBillingDate: "2026-11-20", startDate: "2026-11-01", trialEndsOn: "2026-11-20" }), "2026-10-01", "2027-01-31")).toEqual(["2026-11-20", "2026-12-20", "2027-01-20"]);
  });
  it("an incomplete custom schedule or inverted range yields nothing", () => {
    expect(renewalDates(sub({ frequency: "custom", customInterval: null, customUnit: null }), "2026-01-01", "2026-12-31")).toEqual([]);
    expect(renewalDates(sub(), "2026-12-31", "2026-01-01")).toEqual([]);
  });
});

describe("trial handling and effective status", () => {
  it("a running trial stays a trial through its end date, then converts to active", () => {
    const t = { status: "trial" as const, trialEndsOn: "2026-11-10" };
    expect(effectiveStatus(t, "2026-11-04")).toEqual({ status: "trial", trialEnded: false });
    expect(effectiveStatus(t, "2026-11-10")).toEqual({ status: "trial", trialEnded: false });
    expect(effectiveStatus(t, "2026-11-11")).toEqual({ status: "active", trialEnded: true });
  });
  it("other statuses are unchanged", () => {
    expect(effectiveStatus({ status: "paused", trialEndsOn: "2020-01-01" }, TODAY).status).toBe("paused");
    expect(effectiveStatus({ status: "canceled", trialEndsOn: null }, TODAY).status).toBe("canceled");
    expect(effectiveStatus({ status: "active", trialEndsOn: null }, TODAY).status).toBe("active");
  });
});

describe("status transitions", () => {
  const nowISO = "2026-11-04T10:00:00.000Z";
  it("pause: from active or trial only", () => {
    expect(applyStatusAction(sub(), "pause", TODAY, nowISO)).toEqual({ status: "paused", canceledAt: null });
    expect(applyStatusAction(sub({ status: "trial", trialEndsOn: "2026-11-20" }), "pause", TODAY, nowISO)?.status).toBe("paused");
    expect(applyStatusAction(sub({ status: "paused" }), "pause", TODAY, nowISO)).toBeNull();
    expect(applyStatusAction(sub({ status: "canceled" }), "pause", TODAY, nowISO)).toBeNull();
  });
  it("resume: paused -> active, or back to trial while the trial is still running", () => {
    expect(applyStatusAction(sub({ status: "paused" }), "resume", TODAY, nowISO)).toEqual({ status: "active", canceledAt: null });
    expect(applyStatusAction(sub({ status: "paused", trialEndsOn: "2026-11-20" }), "resume", TODAY, nowISO)?.status).toBe("trial");
    expect(applyStatusAction(sub({ status: "paused", trialEndsOn: "2026-10-01" }), "resume", TODAY, nowISO)?.status).toBe("active");
    expect(applyStatusAction(sub({ status: "active" }), "resume", TODAY, nowISO)).toBeNull();
  });
  it("cancel: from any non-canceled status, stamping canceledAt (the record and its history are kept)", () => {
    for (const status of ["active", "trial", "paused"] as const) {
      expect(applyStatusAction(sub({ status, trialEndsOn: "2026-11-20" }), "cancel", TODAY, nowISO)).toEqual({ status: "canceled", canceledAt: nowISO });
    }
    expect(applyStatusAction(sub({ status: "canceled" }), "cancel", TODAY, nowISO)).toBeNull();
  });
  it("reactivate: only from canceled, clearing canceledAt", () => {
    expect(applyStatusAction(sub({ status: "canceled", canceledAt: nowISO }), "reactivate", TODAY, nowISO)).toEqual({ status: "active", canceledAt: null });
    expect(applyStatusAction(sub({ status: "active" }), "reactivate", TODAY, nowISO)).toBeNull();
  });
});

describe("nextCharge / previousRenewal (projections, never 'paid')", () => {
  it("active: the next scheduled renewal on/after today", () => {
    expect(nextCharge(sub(), TODAY)).toBe("2026-11-20");
    expect(nextCharge(sub({ nextBillingDate: "2025-01-12" }), TODAY)).toBe("2026-11-12");
    expect(nextCharge(sub({ nextBillingDate: "2025-01-02" }), TODAY)).toBe("2026-12-02"); // this month's date already passed
    expect(nextCharge(sub({ nextBillingDate: "2026-11-04" }), TODAY)).toBe("2026-11-04"); // due today
  });
  it("paused and canceled have no upcoming charge", () => {
    expect(nextCharge(sub({ status: "paused" }), TODAY)).toBeNull();
    expect(nextCharge(sub({ status: "canceled" }), TODAY)).toBeNull();
  });
  it("a running trial's next charge is its first charge; once ended it follows the normal schedule", () => {
    const t = sub({ status: "trial", trialEndsOn: "2026-11-20", nextBillingDate: "2026-11-20" });
    expect(nextCharge(t, TODAY)).toBe("2026-11-20");
    expect(nextCharge(t, "2026-11-25")).toBe("2026-12-20");
  });
  it("an incomplete schedule has no next charge", () => {
    expect(nextCharge(sub({ frequency: "custom", customInterval: null, customUnit: null }), TODAY)).toBeNull();
  });
  it("previous renewal = latest scheduled date on/before today", () => {
    expect(previousRenewal(sub({ nextBillingDate: "2026-01-12" }), TODAY)).toBe("2026-10-12");
    expect(previousRenewal(sub({ nextBillingDate: "2026-11-20" }), TODAY)).toBeNull(); // nothing before the anchor
    expect(previousRenewal(sub({ status: "trial", trialEndsOn: "2026-11-20" }), TODAY)).toBeNull();
  });
});

describe("reminders: upcomingEvents", () => {
  it("renewal inside the reminder window, not before it", () => {
    expect(upcomingEvents(sub({ nextBillingDate: "2026-11-07" }), TODAY)).toEqual([{ kind: "renewal", date: "2026-11-07", daysUntil: 3 }]);
    expect(upcomingEvents(sub({ nextBillingDate: "2026-11-08" }), TODAY)).toEqual([]);
    expect(upcomingEvents(sub({ nextBillingDate: "2026-11-04" }), TODAY)[0].daysUntil).toBe(0);
  });
  it("a user-defined lead time is honored", () => {
    expect(upcomingEvents(sub({ nextBillingDate: "2026-11-14", remindDaysBefore: 10 }), TODAY)).toHaveLength(1);
    expect(upcomingEvents(sub({ nextBillingDate: "2026-11-14", remindDaysBefore: 5 }), TODAY)).toHaveLength(0);
    expect(upcomingEvents(sub({ nextBillingDate: "2026-11-04", remindDaysBefore: 0 }), TODAY)).toHaveLength(1);
  });
  it("trial: one trial_end event (its first charge isn't a second one); ended trials renew normally", () => {
    const t = sub({ status: "trial", trialEndsOn: "2026-11-06", nextBillingDate: "2026-11-06" });
    expect(upcomingEvents(t, TODAY)).toEqual([{ kind: "trial_end", date: "2026-11-06", daysUntil: 2 }]);
    expect(upcomingEvents({ ...t, trialEndsOn: "2026-11-20", nextBillingDate: "2026-11-20" }, TODAY)).toEqual([]);
    expect(upcomingEvents({ ...t, trialEndsOn: "2026-11-01", nextBillingDate: "2026-11-05" }, TODAY).map((e) => e.kind)).toEqual(["renewal"]);
  });
  it("paused and canceled never alert", () => {
    expect(upcomingEvents(sub({ status: "paused", nextBillingDate: "2026-11-05" }), TODAY)).toEqual([]);
    expect(upcomingEvents(sub({ status: "canceled", nextBillingDate: "2026-11-05" }), TODAY)).toEqual([]);
  });
});

describe("summarizeSubscriptions", () => {
  it("is all zero with nothing tracked", () => {
    expect(summarizeSubscriptions([], TODAY)).toEqual({
      monthlyCost: 0, yearlyEstimate: 0, activeCount: 0, upcomingRenewals: 0, upcomingUnlinked: 0,
      awaitingPrice: 0, otherCurrency: 0, trialCount: 0, pausedCount: 0, canceledCount: 0,
    });
  });

  it("monthly cost is the monthly-equivalent total of active, paid subscriptions across frequencies", () => {
    const s = summarizeSubscriptions(
      [
        sub({ id: "a", amount: 15.49 }), // 15.49/mo
        sub({ id: "b", frequency: "yearly", amount: 120 }), // 10/mo
        sub({ id: "c", frequency: "quarterly", amount: 30 }), // 10/mo
        sub({ id: "d", frequency: "weekly", amount: 10 }), // 43.33/mo (520/yr)
      ],
      TODAY
    );
    expect(s.yearlyEstimate).toBe(185.88 + 120 + 120 + 520); // 945.88
    expect(s.monthlyCost).toBe(78.82); // 94588 / 12 = 7882.33 -> 7882 cents
    expect(s.activeCount).toBe(4);
  });

  it("monthly and yearly tiles agree (monthly = yearly / 12, rounded once)", () => {
    const s = summarizeSubscriptions([sub({ frequency: "weekly", amount: 9.99 }), sub({ id: "x", frequency: "custom", customInterval: 10, customUnit: "days", amount: 7.77 })], TODAY);
    expect(Math.abs(s.monthlyCost * 12 - s.yearlyEstimate)).toBeLessThan(0.07);
  });

  it("trials, paused and canceled subscriptions are excluded from the totals", () => {
    const s = summarizeSubscriptions(
      [
        sub({ id: "a", amount: 10 }),
        sub({ id: "t", amount: 99, status: "trial", trialEndsOn: "2026-11-30", nextBillingDate: "2026-11-30" }),
        sub({ id: "p", amount: 99, status: "paused" }),
        sub({ id: "c", amount: 99, status: "canceled" }),
      ],
      TODAY
    );
    expect(s).toMatchObject({ monthlyCost: 10, yearlyEstimate: 120, activeCount: 1, trialCount: 1, pausedCount: 1, canceledCount: 1 });
  });

  it("a trial whose end date has passed starts counting automatically (trial-to-paid)", () => {
    const t = sub({ status: "trial", amount: 20, trialEndsOn: "2026-11-01", nextBillingDate: "2026-11-05" });
    expect(summarizeSubscriptions([t], TODAY)).toMatchObject({ monthlyCost: 20, activeCount: 1, trialCount: 0 });
    expect(summarizeSubscriptions([{ ...t, trialEndsOn: "2026-11-30" }], TODAY)).toMatchObject({ monthlyCost: 0, trialCount: 1 });
  });

  it("missing prices are counted separately (never $0), and non-base currencies are excluded and surfaced", () => {
    const s = summarizeSubscriptions([sub({ id: "a", amount: 10 }), sub({ id: "n", amount: null }), sub({ id: "e", amount: 8, currency: "EUR" })], TODAY);
    expect(s).toMatchObject({ monthlyCost: 10, awaitingPrice: 1, otherCurrency: 1, activeCount: 3 });
  });

  it("counts upcoming renewals and trial endings inside their windows, and how many are not linked to a bill", () => {
    const s = summarizeSubscriptions(
      [
        sub({ id: "a", nextBillingDate: "2026-11-06" }),
        sub({ id: "b", nextBillingDate: "2026-11-06", billId: "b1" }),
        sub({ id: "t", status: "trial", trialEndsOn: "2026-11-05", nextBillingDate: "2026-11-05" }),
        sub({ id: "far", nextBillingDate: "2026-12-20" }),
      ],
      TODAY
    );
    expect(s.upcomingRenewals).toBe(3);
    expect(s.upcomingUnlinked).toBe(2);
  });

  it("a renewal date passing does not change totals or mark anything paid", () => {
    const s = sub({ nextBillingDate: "2026-11-01" });
    const summary = summarizeSubscriptions([s], TODAY);
    expect(summary.monthlyCost).toBe(15.49);
    expect(nextCharge(s, TODAY)).toBe("2026-12-01"); // projected forward; no payment was invented
  });
});

describe("overlap with Bills (surfaced, never merged)", () => {
  it("flags a subscription whose name or provider matches a bill (either contains the other)", () => {
    const o = findPossibleOverlaps([sub({ id: "a", name: "Netflix" })], [bill({ id: "b9", name: "Netflix Premium" })]);
    expect(o).toEqual([{ subscriptionId: "a", billId: "b9", billName: "Netflix Premium" }]);
    expect(findPossibleOverlaps([sub({ name: "Streaming", provider: "Spotify" })], [bill({ name: "Spotify" })])).toHaveLength(1);
    expect(findPossibleOverlaps([sub({ name: "Spotify Family" })], [bill({ name: "SPOTIFY" })])).toHaveLength(1);
  });
  it("ignores punctuation and case", () => {
    expect(findPossibleOverlaps([sub({ name: "Disney+" })], [bill({ name: "disney plus" })])).toHaveLength(1); // 'disney' is inside 'disneyplus'
    expect(findPossibleOverlaps([sub({ name: "Disney+ Bundle" })], [bill({ name: "Disney" })])).toHaveLength(1);
  });
  it("does not flag already-linked or canceled subscriptions, archived bills, or very short names", () => {
    expect(findPossibleOverlaps([sub({ name: "Netflix", billId: "b1" })], [bill({ name: "Netflix" })])).toEqual([]);
    expect(findPossibleOverlaps([sub({ name: "Netflix", status: "canceled" })], [bill({ name: "Netflix" })])).toEqual([]);
    expect(findPossibleOverlaps([sub({ name: "Netflix" })], [bill({ name: "Netflix", archivedAt: "2026-01-01T00:00:00Z" })])).toEqual([]);
    expect(findPossibleOverlaps([sub({ name: "HBO" })], [bill({ name: "HBO" })])).toEqual([]);
  });
  it("unrelated names don't overlap, and an amount match alone is not enough to guess", () => {
    expect(findPossibleOverlaps([sub({ name: "Netflix", amount: 1000 })], [bill({ name: "Rent", expectedAmount: 1000 })])).toEqual([]);
  });
});

describe("Plan Tomorrow suggestions (tap-to-add, deduplicated)", () => {
  const plan = "2026-11-17"; // renewal on the 20th is 3 days ahead
  const none = new Set<string>();

  it("suggests a renewal once the plan date is inside the reminder window", () => {
    const s = suggestSubscriptionGoals([sub()], [], plan, none);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ event: "renewal", date: "2026-11-20", amount: 15.49 });
  });
  it("not before the window opens or after the date", () => {
    expect(suggestSubscriptionGoals([sub()], [], "2026-11-16", none)).toEqual([]);
    expect(suggestSubscriptionGoals([sub({ nextBillingDate: "2026-11-01" })], [], "2026-11-17", none).every((x) => x.date >= "2026-11-17")).toBe(true);
  });
  it("suggests a trial ending, using the trial end date", () => {
    const t = sub({ status: "trial", trialEndsOn: "2026-11-20", nextBillingDate: "2026-11-20" });
    const s = suggestSubscriptionGoals([t], [], plan, none);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ event: "trial_end", date: "2026-11-20" });
  });
  it("never suggests paused or canceled subscriptions", () => {
    expect(suggestSubscriptionGoals([sub({ status: "paused" }), sub({ id: "c", status: "canceled" })], [], plan, none)).toEqual([]);
  });
  it("doesn't repeat an event that already has a goal (no duplicate goals)", () => {
    const linked = new Set([subscriptionSuggestionKey("s1", "renewal", "2026-11-20")]);
    expect(suggestSubscriptionGoals([sub()], [], plan, linked)).toEqual([]);
    // a different event/date is still suggested
    expect(suggestSubscriptionGoals([sub()], [], plan, new Set([subscriptionSuggestionKey("s1", "trial_end", "2026-11-20")]))).toHaveLength(1);
  });
  it("a renewal that already has a recorded payment isn't suggested; a reversed payment doesn't suppress it", () => {
    expect(suggestSubscriptionGoals([sub()], [pay({ billingDate: "2026-11-20" })], plan, none)).toEqual([]);
    expect(suggestSubscriptionGoals([sub()], [pay({ billingDate: "2026-11-20", reversedAt: "2026-11-10T00:00:00Z" })], plan, none)).toHaveLength(1);
  });
  it("a renewal of a bill-linked subscription isn't suggested (the bill's reminder covers it), but its trial end still is", () => {
    expect(suggestSubscriptionGoals([sub({ billId: "b1" })], [], plan, none)).toEqual([]);
    const t = sub({ billId: "b1", status: "trial", trialEndsOn: "2026-11-20", nextBillingDate: "2026-11-20" });
    expect(suggestSubscriptionGoals([t], [], plan, none)).toHaveLength(1);
  });
  it("is pure data: it describes suggestions, it creates nothing", () => {
    const before = JSON.stringify(sub());
    suggestSubscriptionGoals([sub()], [], plan, none);
    expect(JSON.stringify(sub())).toBe(before);
  });
});

describe("payment totals and history", () => {
  it("totalPaid excludes reversed payments and sums exactly in cents", () => {
    expect(totalPaid([pay({ amount: 0.1 }), pay({ id: "b", amount: 0.2 }), pay({ id: "c", amount: 5, reversedAt: "x" })])).toBe(0.3);
    expect(totalPaid([])).toBe(0);
  });
  it("totalPaidInYear counts only that year's non-reversed payments", () => {
    const list = [pay({ paidAt: "2026-03-01T12:00:00" }), pay({ id: "b", paidAt: "2025-12-31T12:00:00", amount: 10 }), pay({ id: "c", paidAt: "2026-05-01T12:00:00", reversedAt: "x" })];
    expect(totalPaidInYear(list, 2026)).toBe(15.49);
    expect(totalPaidInYear(list, 2025)).toBe(10);
  });
  it("lastPayment is the most recent non-reversed one", () => {
    const list = [pay({ paidAt: "2026-09-20T12:00:00" }), pay({ id: "b", paidAt: "2026-10-20T12:00:00", amount: 7 }), pay({ id: "c", paidAt: "2026-11-01T12:00:00", reversedAt: "x" })];
    expect(lastPayment(list)?.id).toBe("b");
    expect(lastPayment([])).toBeNull();
    expect(lastPayment([pay({ reversedAt: "x" })])).toBeNull();
  });
  it("payment history survives cancellation: totals don't depend on status", () => {
    const canceled = sub({ status: "canceled" });
    expect(canceled.status).toBe("canceled");
    expect(totalPaid([pay()])).toBe(15.49);
  });
});

describe("parseSubscriptionForm", () => {
  const ok = { ...emptySubscriptionForm(TODAY), name: " Netflix ", amount: "15.49" };

  it("builds a monthly payload", () => {
    const r = parseSubscriptionForm(ok);
    expect(r.ok && r.payload).toMatchObject({
      name: "Netflix", amount: 15.49, currency: "USD", frequency: "monthly", customInterval: null, customUnit: null,
      nextBillingDate: TODAY, startDate: null, status: "active", trialEndsOn: null, remindDaysBefore: 3, billId: null,
    });
  });
  it("the price may be left blank (tracked before it's known) but not malformed", () => {
    const blank = parseSubscriptionForm({ ...ok, amount: "" });
    expect(blank.ok && blank.payload.amount).toBeNull();
    expect(parseSubscriptionForm({ ...ok, amount: "-3" })).toMatchObject({ ok: false, errors: [{ field: "amount", code: "negative" }] });
    expect(parseSubscriptionForm({ ...ok, amount: "1.999" })).toMatchObject({ ok: false, errors: [{ field: "amount", code: "precision" }] });
    expect(parseSubscriptionForm({ ...ok, amount: "abc" }).ok).toBe(false);
    expect(parseSubscriptionForm({ ...ok, amount: "0" }).ok).toBe(true);
  });
  it("requires a name and validates lengths", () => {
    expect(parseSubscriptionForm({ ...ok, name: "  " })).toMatchObject({ ok: false, errors: [{ field: "name", code: "required" }] });
    expect(parseSubscriptionForm({ ...ok, name: "x".repeat(121) }).ok).toBe(false);
    expect(parseSubscriptionForm({ ...ok, provider: "x".repeat(121) }).ok).toBe(false);
    expect(parseSubscriptionForm({ ...ok, planName: "x".repeat(121) }).ok).toBe(false);
    expect(parseSubscriptionForm({ ...ok, category: "x".repeat(61) }).ok).toBe(false);
    expect(parseSubscriptionForm({ ...ok, notes: "x".repeat(1001) }).ok).toBe(false);
  });
  it("custom frequency needs a whole interval from 1 to 365 and keeps its unit; other frequencies drop them", () => {
    const c = parseSubscriptionForm({ ...ok, frequency: "custom", customInterval: "6", customUnit: "weeks" });
    expect(c.ok && c.payload).toMatchObject({ frequency: "custom", customInterval: 6, customUnit: "weeks" });
    for (const bad of ["", "0", "-1", "1.5", "366", "abc"]) expect(parseSubscriptionForm({ ...ok, frequency: "custom", customInterval: bad }).ok, bad).toBe(false);
    const m = parseSubscriptionForm({ ...ok, frequency: "yearly", customInterval: "6", customUnit: "weeks" });
    expect(m.ok && m.payload).toMatchObject({ customInterval: null, customUnit: null });
  });
  it("validates dates, including leap days and month ends", () => {
    expect(parseSubscriptionForm({ ...ok, nextBillingDate: "2028-02-29" }).ok).toBe(true);
    expect(parseSubscriptionForm({ ...ok, nextBillingDate: "2027-02-29" }).ok).toBe(false);
    expect(parseSubscriptionForm({ ...ok, nextBillingDate: "2026-01-31" }).ok).toBe(true);
    expect(parseSubscriptionForm({ ...ok, nextBillingDate: "" })).toMatchObject({ ok: false, errors: [{ field: "nextBillingDate", code: "required" }] });
    expect(parseSubscriptionForm({ ...ok, startDate: "2026-13-01" }).ok).toBe(false);
  });
  it("a start date can't be after the next billing date", () => {
    expect(parseSubscriptionForm({ ...ok, startDate: "2026-12-01", nextBillingDate: "2026-11-20" })).toMatchObject({ ok: false, errors: [{ field: "startDate", code: "startAfterNextBilling" }] });
    expect(parseSubscriptionForm({ ...ok, startDate: "2026-01-01" }).ok).toBe(true);
  });
  it("a trial needs an end date, and its first charge can't be before the trial ends", () => {
    expect(parseSubscriptionForm({ ...ok, status: "trial" })).toMatchObject({ ok: false, errors: [{ field: "trialEndsOn", code: "required" }] });
    expect(parseSubscriptionForm({ ...ok, status: "trial", trialEndsOn: "2026-11-30", nextBillingDate: "2026-11-20" })).toMatchObject({ ok: false, errors: [{ field: "nextBillingDate", code: "firstChargeBeforeTrialEnd" }] });
    const good = parseSubscriptionForm({ ...ok, status: "trial", trialEndsOn: "2026-11-20", nextBillingDate: "2026-11-20" });
    expect(good.ok && good.payload).toMatchObject({ status: "trial", trialEndsOn: "2026-11-20" });
  });
  it("a trial end date is dropped when the status isn't trial", () => {
    const r = parseSubscriptionForm({ ...ok, status: "active", trialEndsOn: "2026-11-30" });
    expect(r.ok && r.payload.trialEndsOn).toBeNull();
  });
  it("reminder lead time 0-60 days; currency must be supported", () => {
    expect(parseSubscriptionForm({ ...ok, remindDaysBefore: "0" }).ok).toBe(true);
    expect(parseSubscriptionForm({ ...ok, remindDaysBefore: "61" }).ok).toBe(false);
    expect(parseSubscriptionForm({ ...ok, remindDaysBefore: "-1" }).ok).toBe(false);
    expect(parseSubscriptionForm({ ...ok, currency: "XYZ" })).toMatchObject({ ok: false, errors: [{ field: "currency", code: "invalid" }] });
    expect(parseSubscriptionForm({ ...ok, currency: "EUR" }).ok).toBe(true);
  });
  it("carries an explicit bill link, and round-trips a saved subscription through the form unchanged", () => {
    const r = parseSubscriptionForm({ ...ok, billId: "bill-7" });
    expect(r.ok && r.payload.billId).toBe("bill-7");
    const s = sub({ provider: "Netflix Inc.", planName: "Premium", category: "Streaming", startDate: "2026-01-01", billId: "b1", notes: "n", remindDaysBefore: 7 });
    const back = parseSubscriptionForm(subscriptionToFormValues(s));
    expect(back.ok && back.payload).toMatchObject({
      name: "Netflix", provider: "Netflix Inc.", planName: "Premium", category: "Streaming", amount: 15.49, startDate: "2026-01-01", billId: "b1", notes: "n", remindDaysBefore: 7,
    });
  });
});

describe("parseSubscriptionPaymentEntry", () => {
  const base = { amount: "15.49", date: TODAY, note: "", billingDate: "" };
  it("accepts a positive 2-decimal payment, trims the note, ties it to a renewal when given", () => {
    const r = parseSubscriptionPaymentEntry({ ...base, note: " Oct ", billingDate: "2026-10-20" }, TODAY);
    expect(r.ok && r.payload).toMatchObject({ amount: 15.49, note: "Oct", billingDate: "2026-10-20" });
  });
  it("rejects zero, negatives, >2 decimals, future and invalid dates, long notes", () => {
    expect(parseSubscriptionPaymentEntry({ ...base, amount: "0" }, TODAY)).toEqual({ ok: false, error: "amount" });
    expect(parseSubscriptionPaymentEntry({ ...base, amount: "-1" }, TODAY)).toEqual({ ok: false, error: "amount" });
    expect(parseSubscriptionPaymentEntry({ ...base, amount: "1.005" }, TODAY)).toEqual({ ok: false, error: "amountPrecision" });
    expect(parseSubscriptionPaymentEntry({ ...base, date: "2026-11-05" }, TODAY)).toEqual({ ok: false, error: "dateFuture" });
    expect(parseSubscriptionPaymentEntry({ ...base, date: "2026-02-30" }, TODAY)).toEqual({ ok: false, error: "date" });
    expect(parseSubscriptionPaymentEntry({ ...base, note: "x".repeat(501) }, TODAY)).toEqual({ ok: false, error: "note" });
  });
  it("allows historical payments, and a blank renewal means 'not tied to a renewal'", () => {
    const r = parseSubscriptionPaymentEntry({ ...base, date: "2024-05-01" }, TODAY);
    expect(r.ok && r.payload.billingDate).toBeNull();
  });
});

// ── Renewal dates advance correctly, cycle after cycle ───────────────────
// An independent reference (plain Date arithmetic, written separately from shiftMonths /
// renewalDates) is compared with the app's schedule for every day across several years.
describe("renewal dates advance correctly after each cycle", () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
  const lastDay = (y: number, m0: number) => utc(y, m0 + 1, 0).getUTCDate();

  /** k-th renewal after the anchor, independently computed. */
  function ref(anchor: string, kind: "days" | "months", n: number, k: number): string {
    const [y, m, d] = anchor.split("-").map(Number);
    if (kind === "days") return iso(utc(y, m - 1, d + n * k));
    const total = m - 1 + n * k;
    const yy = y + Math.floor(total / 12);
    const mm = ((total % 12) + 12) % 12;
    return iso(utc(yy, mm, Math.min(d, lastDay(yy, mm))));
  }

  type Case = { label: string; anchor: string; frequency: Subscription["frequency"]; kind: "days" | "months"; n: number; customInterval?: number; customUnit?: Subscription["customUnit"] };
  const cases: Case[] = [
    { label: "monthly, Jan 31 (month-end)", anchor: "2026-01-31", frequency: "monthly", kind: "months", n: 1 },
    { label: "monthly, Jan 30", anchor: "2026-01-30", frequency: "monthly", kind: "months", n: 1 },
    { label: "monthly, Jan 29 (Feb in leap 2028)", anchor: "2026-01-29", frequency: "monthly", kind: "months", n: 1 },
    { label: "monthly, mid-month", anchor: "2026-03-15", frequency: "monthly", kind: "months", n: 1 },
    { label: "quarterly, Nov 30", anchor: "2026-11-30", frequency: "quarterly", kind: "months", n: 3 },
    { label: "quarterly, Aug 31", anchor: "2026-08-31", frequency: "quarterly", kind: "months", n: 3 },
    { label: "yearly, Feb 29 (leap day)", anchor: "2024-02-29", frequency: "yearly", kind: "months", n: 12 },
    { label: "yearly, Mar 1", anchor: "2026-03-01", frequency: "yearly", kind: "months", n: 12 },
    { label: "weekly", anchor: "2026-02-27", frequency: "weekly", kind: "days", n: 7 },
    { label: "custom 45 days", anchor: "2026-01-15", frequency: "custom", kind: "days", n: 45, customInterval: 45, customUnit: "days" },
    { label: "custom 6 weeks", anchor: "2026-02-10", frequency: "custom", kind: "days", n: 42, customInterval: 6, customUnit: "weeks" },
    { label: "custom 2 months, Dec 31", anchor: "2026-12-31", frequency: "custom", kind: "months", n: 2, customInterval: 2, customUnit: "months" },
    { label: "custom 5 months, Jan 31", anchor: "2026-01-31", frequency: "custom", kind: "months", n: 5, customInterval: 5, customUnit: "months" },
  ];

  for (const c of cases) {
    it(`${c.label}: the next charge is the earliest scheduled date on/after each day for 4 years, never skipping or repeating`, () => {
      const s = sub({ nextBillingDate: c.anchor, frequency: c.frequency, customInterval: c.customInterval ?? null, customUnit: c.customUnit ?? null });
      // Reference schedule covering well past the sweep.
      const schedule: string[] = [];
      for (let k = 0; k < 400; k++) schedule.push(ref(c.anchor, c.kind, c.n, k));
      expect(schedule).toEqual([...schedule].sort()); // strictly ascending
      expect(new Set(schedule).size).toBe(schedule.length);

      let day = c.anchor;
      const end = iso(utc(Number(c.anchor.slice(0, 4)) + 4, 0, 1));
      let seen: string | null = null;
      let changes = 0;
      while (day < end) {
        const expected = schedule.find((d) => d >= day)!;
        const got = nextCharge(s, day);
        expect(got, `${c.label} on ${day}`).toBe(expected);
        if (got !== seen) {
          changes++;
          seen = got;
        }
        day = iso(utc(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + 1));
      }
      expect(changes).toBeGreaterThan(3); // it really did advance through several cycles
    });
  }

  it("the day after a renewal the next charge is the following cycle, whether or not anything was paid", () => {
    const s = sub({ nextBillingDate: "2026-01-31", frequency: "monthly" });
    const withPayment: SubscriptionPayment[] = [pay({ billingDate: "2026-01-31" })];
    expect(nextCharge(s, "2026-01-31")).toBe("2026-01-31");
    expect(nextCharge(s, "2026-02-01")).toBe("2026-02-28");
    expect(nextCharge(s, "2026-03-01")).toBe("2026-03-31"); // no drift to the 28th
    expect(nextCharge(s, "2028-02-01")).toBe("2028-02-29"); // leap year
    // Recording (or not recording) a payment is not an input to the schedule.
    expect(withPayment).toHaveLength(1);
    expect(nextCharge(s, "2026-02-01")).toBe(nextCharge(sub({ nextBillingDate: "2026-01-31", frequency: "monthly" }), "2026-02-01"));
  });

  it("a passed renewal with no recorded payment stays unpaid: it is offered as the latest renewal to record, and the schedule still moves on", () => {
    const s = sub({ nextBillingDate: "2026-10-12", frequency: "monthly" });
    expect(previousRenewal(s, TODAY)).toBe("2026-10-12");
    expect(nextCharge(s, TODAY)).toBe("2026-11-12");
    expect(lastPayment([])).toBeNull();
    // the summary doesn't pretend it was paid either
    expect(totalPaid([])).toBe(0);
  });

  it("quarterly month-end keeps its anchor day: Nov 30 -> Feb 28/29 -> May 30 -> Aug 30", () => {
    const q = (d: string) => nextCharge(sub({ nextBillingDate: "2026-11-30", frequency: "quarterly" }), d);
    expect(q("2026-12-01")).toBe("2027-02-28");
    expect(q("2027-03-01")).toBe("2027-05-30");
    expect(q("2027-06-01")).toBe("2027-08-30");
    expect(nextCharge(sub({ nextBillingDate: "2027-11-30", frequency: "quarterly" }), "2027-12-01")).toBe("2028-02-29"); // leap year
  });

  it("yearly Feb 29: Feb 28 in common years and Feb 29 again in the next leap year", () => {
    const y = (d: string) => nextCharge(sub({ nextBillingDate: "2024-02-29", frequency: "yearly" }), d);
    expect(y("2024-03-01")).toBe("2025-02-28");
    expect(y("2025-03-01")).toBe("2026-02-28");
    expect(y("2027-03-01")).toBe("2028-02-29");
  });

  it("recorded payment history is untouched by cycles: totals depend only on the payments", () => {
    const pays = [pay({ id: "a", amount: 10, paidAt: "2026-01-31T12:00:00Z" }), pay({ id: "b", amount: 10, paidAt: "2026-02-28T12:00:00Z" })];
    const before = totalPaid(pays);
    nextCharge(sub({ nextBillingDate: "2026-01-31" }), "2026-06-01");
    expect(totalPaid(pays)).toBe(before);
    expect(pays).toHaveLength(2);
  });
});


import { describe, it, expect } from "vitest";
import { computeNextDueDate, type PaymentAccount } from "@/lib/supabase/db";
import {
  diffPaymentPayload,
  getPaymentDueInfo,
  parsePaymentEntry,
  parsePaymentForm,
  paymentToFormValues,
  previewBalanceAfter,
  summarizeFinances,
  summarizePayments,
} from "./paymentSummary";

const acct = (over: Partial<PaymentAccount> = {}): PaymentAccount => ({
  id: "a1",
  name: "Chase",
  balance: 100,
  minimumPayment: 25,
  dueDay: 13,
  remindDaysBefore: 3,
  lastReminderDueDate: null,
  createdAt: "2026-01-01T00:00:00Z",
  balanceMode: "auto",
  ...over,
});

describe("summarizePayments", () => {
  it("is zero for an empty list", () => {
    expect(summarizePayments([])).toEqual({ totalBalance: 0, monthlyMinimums: 0, count: 0 });
  });

  it("handles a single account", () => {
    expect(summarizePayments([acct({ balance: 394, minimumPayment: 25 })])).toEqual({
      totalBalance: 394,
      monthlyMinimums: 25,
      count: 1,
    });
  });

  it("sums balances and minimums across accounts without float drift", () => {
    const s = summarizePayments([
      acct({ balance: 0.1, minimumPayment: 0.1 }),
      acct({ id: "a2", balance: 0.2, minimumPayment: 0.2 }),
      acct({ id: "a3", balance: 1000.35, minimumPayment: 40.05 }),
    ]);
    expect(s.totalBalance).toBe(1000.65);
    expect(s.monthlyMinimums).toBe(40.35);
    expect(s.count).toBe(3);
  });

  it("treats missing / invalid amounts as 0 instead of poisoning the total", () => {
    const s = summarizePayments([
      acct({ balance: NaN, minimumPayment: Infinity }),
      acct({ id: "a2", balance: undefined as unknown as number, minimumPayment: null as unknown as number }),
      acct({ id: "a3", balance: 50, minimumPayment: 5 }),
    ]);
    expect(s).toMatchObject({ totalBalance: 50, monthlyMinimums: 5 });
  });
});

describe("getPaymentDueInfo (existing reminder rules, unchanged)", () => {
  it("uses computeNextDueDate for the date", () => {
    for (const [day, from] of [[13, "2026-11-03"], [31, "2026-02-10"], [1, "2026-12-15"], [3, "2026-11-03"]] as const) {
      expect(getPaymentDueInfo(acct({ dueDay: day }), from).dueDate).toBe(computeNextDueDate(day, from));
    }
  });

  it("is 'today' on the due date, 'soon' inside the reminder window, otherwise 'later'", () => {
    expect(getPaymentDueInfo(acct({ dueDay: 3 }), "2026-11-03")).toMatchObject({ daysUntilDue: 0, tier: "today" });
    expect(getPaymentDueInfo(acct({ dueDay: 6, remindDaysBefore: 3 }), "2026-11-03")).toMatchObject({ daysUntilDue: 3, tier: "soon" });
    expect(getPaymentDueInfo(acct({ dueDay: 7, remindDaysBefore: 3 }), "2026-11-03")).toMatchObject({ daysUntilDue: 4, tier: "later" });
    expect(getPaymentDueInfo(acct({ dueDay: 13, remindDaysBefore: 0 }), "2026-11-03").tier).toBe("later");
  });

  it("rolls to next month once this month's due day has passed (never overdue)", () => {
    const info = getPaymentDueInfo(acct({ dueDay: 2 }), "2026-11-03");
    expect(info.dueDate).toBe("2026-12-02");
    expect(info.daysUntilDue).toBeGreaterThan(0);
  });
});

describe("payment form parsing", () => {
  const base = { name: " Visa ", balance: "394", minimumPayment: "25", dueDay: "13", remindDaysBefore: "3", balanceMode: "manual" as const };

  it("produces the same payload the inline form produced", () => {
    expect(parsePaymentForm(base)).toEqual({ name: "Visa", balance: 394, minimumPayment: 25, dueDay: 13, remindDaysBefore: 3, balanceMode: "manual" });
  });

  it("defaults blank balance / minimum / reminder to 0", () => {
    expect(parsePaymentForm({ ...base, balance: "", minimumPayment: "", remindDaysBefore: "" })).toMatchObject({
      balance: 0,
      minimumPayment: 0,
      remindDaysBefore: 0,
    });
  });

  it("requires a name and a due day of 1-31", () => {
    expect(parsePaymentForm({ ...base, name: "  " })).toBeNull();
    expect(parsePaymentForm({ ...base, dueDay: "" })).toBeNull();
    expect(parsePaymentForm({ ...base, dueDay: "0" })).toBeNull();
    expect(parsePaymentForm({ ...base, dueDay: "32" })).toBeNull();
    expect(parsePaymentForm({ ...base, dueDay: "31" })).not.toBeNull();
    expect(parsePaymentForm({ ...base, balance: "abc" })).toBeNull();
  });

  it("round-trips an account through the form, preserving reminder fields", () => {
    const a = acct({ dueDay: 28, remindDaysBefore: 5, balance: 12.5, minimumPayment: 3 });
    const payload = parsePaymentForm(paymentToFormValues(a))!;
    expect(payload).toEqual({ name: "Chase", balance: 12.5, minimumPayment: 3, dueDay: 28, remindDaysBefore: 5, balanceMode: "auto" });
    expect(diffPaymentPayload(a, payload)).toEqual({});
  });

  it("diff only includes changed fields", () => {
    const a = acct();
    expect(diffPaymentPayload(a, { name: "Chase", balance: 90, minimumPayment: 25, dueDay: 13, remindDaysBefore: 7, balanceMode: "auto" })).toEqual({
      balance: 90,
      remindDaysBefore: 7,
    });
  });
});

describe("balance mode in the account form", () => {
  it("a changed mode shows up in the diff, an unchanged one does not", () => {
    const a = acct({ balanceMode: "auto" });
    const same = parsePaymentForm(paymentToFormValues(a))!;
    expect(diffPaymentPayload(a, same)).toEqual({});
    expect(diffPaymentPayload(a, { ...same, balanceMode: "manual" })).toEqual({ balanceMode: "manual" });
  });
});

describe("previewBalanceAfter (cents-exact)", () => {
  it("subtracts without float drift and allows a credit", () => {
    expect(previewBalanceAfter(0.3, 0.1)).toBe(0.2);
    expect(previewBalanceAfter(100.1, 0.2)).toBe(99.9);
    expect(previewBalanceAfter(50, 75.25)).toBe(-25.25);
  });
});

describe("parsePaymentEntry", () => {
  const today = "2026-11-03";
  const ok = { amount: "25.50", date: today, note: " rent ", applyBalance: false };

  it("accepts a positive 2-decimal amount, trims the note, and pins the date to local noon", () => {
    const r = parsePaymentEntry(ok, today);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.amount).toBe(25.5);
      expect(r.payload.note).toBe("rent");
      const d = new Date(r.payload.paidAt);
      expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([2026, 11, 3, 12]);
    }
  });

  it("empty note becomes null", () => {
    const r = parsePaymentEntry({ ...ok, note: "  " }, today);
    expect(r.ok && r.payload.note).toBeNull();
  });

  it("rejects zero, negative, non-numeric and absurd amounts", () => {
    for (const amount of ["", "0", "0.00", "-5", "abc", "1e3", "12,50", ".", "1.", "100000000"]) {
      expect(parsePaymentEntry({ ...ok, amount }, today).ok, amount).toBe(false);
    }
  });

  it("rejects more than 2 decimals instead of rounding", () => {
    expect(parsePaymentEntry({ ...ok, amount: "10.005" }, today)).toEqual({ ok: false, error: "amountPrecision" });
  });

  it("validates the date: real calendar day, not in the future", () => {
    expect(parsePaymentEntry({ ...ok, date: "2026-02-30" }, today)).toEqual({ ok: false, error: "date" });
    expect(parsePaymentEntry({ ...ok, date: "" }, today)).toEqual({ ok: false, error: "date" });
    expect(parsePaymentEntry({ ...ok, date: "2026-11-04" }, today)).toEqual({ ok: false, error: "dateFuture" });
    expect(parsePaymentEntry({ ...ok, date: "2025-12-31" }, today).ok).toBe(true); // historical
  });

  it("caps the note length", () => {
    expect(parsePaymentEntry({ ...ok, note: "x".repeat(501) }, today)).toEqual({ ok: false, error: "note" });
  });

  it("carries the explicit apply-balance choice through", () => {
    const r = parsePaymentEntry({ ...ok, applyBalance: true }, today);
    expect(r.ok && r.payload.applyBalance).toBe(true);
  });
});

describe("summarizeFinances", () => {
  const today = "2026-11-03";
  it("is all zeros with no accounts", () => {
    expect(summarizeFinances([], today)).toEqual({ totalBalances: 0, monthlyDue: 0, monthlyDueUnknown: 0, subscriptionsMonthly: 0, upcomingCount: 0 });
  });

  it("keeps balances and monthly due as separate figures, and counts only obligations inside their window", () => {
    const o = summarizeFinances(
      [
        acct({ id: "1", balance: 1000, minimumPayment: 35, dueDay: 3 }), // today
        acct({ id: "2", balance: 500, minimumPayment: 20, dueDay: 5, remindDaysBefore: 3 }), // soon
        acct({ id: "3", balance: 250.5, minimumPayment: 15, dueDay: 25, remindDaysBefore: 3 }), // later
      ],
      today
    );
    expect(o.totalBalances).toBe(1750.5);
    expect(o.monthlyDue).toBe(70);
    expect(o.upcomingCount).toBe(2);
    // No combined grand total exists on the result.
    expect(Object.keys(o).sort()).toEqual(["monthlyDue", "monthlyDueUnknown", "subscriptionsMonthly", "totalBalances", "upcomingCount"]);
  });

  it("adds real bills to monthly due and upcoming, never to balances, and carries the unknown-amount count", () => {
    const accounts = [acct({ id: "1", balance: 1000, minimumPayment: 35, dueDay: 3 })];
    const without = summarizeFinances(accounts, today);
    const withBills = summarizeFinances(accounts, today, { outstandingThisMonth: 600.25, unknownThisMonth: 2, upcoming: 3 });
    expect(withBills.totalBalances).toBe(without.totalBalances); // balances untouched by bills
    expect(withBills.monthlyDue).toBe(635.25);
    expect(withBills.monthlyDueUnknown).toBe(2);
    expect(withBills.upcomingCount).toBe(without.upcomingCount + 3);
    expect(withBills.subscriptionsMonthly).toBe(0);
  });
});

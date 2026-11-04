import { describe, it, expect } from "vitest";
import { computeNextDueDate, type PaymentAccount } from "@/lib/supabase/db";
import {
  diffPaymentPayload,
  getPaymentDueInfo,
  parsePaymentForm,
  paymentToFormValues,
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
  const base = { name: " Visa ", balance: "394", minimumPayment: "25", dueDay: "13", remindDaysBefore: "3" };

  it("produces the same payload the inline form produced", () => {
    expect(parsePaymentForm(base)).toEqual({ name: "Visa", balance: 394, minimumPayment: 25, dueDay: 13, remindDaysBefore: 3 });
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
    expect(payload).toEqual({ name: "Chase", balance: 12.5, minimumPayment: 3, dueDay: 28, remindDaysBefore: 5 });
    expect(diffPaymentPayload(a, payload)).toEqual({});
  });

  it("diff only includes changed fields", () => {
    const a = acct();
    expect(diffPaymentPayload(a, { name: "Chase", balance: 90, minimumPayment: 25, dueDay: 13, remindDaysBefore: 7 })).toEqual({
      balance: 90,
      remindDaysBefore: 7,
    });
  });
});

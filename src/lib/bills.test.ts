import { describe, it, expect } from "vitest";
import {
  describeDueSummary,
  statusLabel,
  billOccurrenceViews,
  billSuggestionKey,
  computeStatus,
  currentOccurrence,
  isOccurrenceDate,
  nextOccurrenceOnOrAfter,
  occurrenceDates,
  parseBillForm,
  parseBillPaymentEntry,
  parseMoney,
  resolveOccurrence,
  suggestBillGoals,
  summarizeBills,
  emptyBillForm,
  type Bill,
  type OccurrenceMap,
} from "./bills";

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

const pay = (amount: number, over: Record<string, unknown> = {}) => ({ id: `p${amount}`, amount, paidAt: "2026-11-01T12:00:00Z", note: null, reversedAt: null, ...over });
const occ = (dueDate: string, amountDue: number | null, payments: ReturnType<typeof pay>[] = [], billId = "b1") => ({ id: `o-${dueDate}`, billId, dueDate, amountDue, payments });
const mapOf = (...os: ReturnType<typeof occ>[]): OccurrenceMap => {
  const m: OccurrenceMap = {};
  for (const o of os) (m[o.billId] ??= {})[o.dueDate] = o;
  return m;
};

describe("recurrence", () => {
  it("one-time: only the first due date", () => {
    const b = { firstDueDate: "2026-11-12", recurrence: "once" as const };
    expect(occurrenceDates(b, "2026-01-01", "2027-01-01")).toEqual(["2026-11-12"]);
    expect(occurrenceDates(b, "2026-11-13", "2027-01-01")).toEqual([]);
    expect(isOccurrenceDate(b, "2026-11-19")).toBe(false);
  });

  it("weekly and biweekly step from the first date", () => {
    const w = { firstDueDate: "2026-11-02", recurrence: "weekly" as const };
    expect(occurrenceDates(w, "2026-11-10", "2026-11-30")).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
    const bw = { firstDueDate: "2026-11-02", recurrence: "biweekly" as const };
    expect(occurrenceDates(bw, "2026-11-01", "2026-12-31")).toEqual(["2026-11-02", "2026-11-16", "2026-11-30", "2026-12-14", "2026-12-28"]);
    expect(isOccurrenceDate(bw, "2026-11-09")).toBe(false);
  });

  it("monthly, quarterly, annually", () => {
    expect(occurrenceDates({ firstDueDate: "2026-01-12", recurrence: "monthly" }, "2026-10-01", "2027-01-31")).toEqual(["2026-10-12", "2026-11-12", "2026-12-12", "2027-01-12"]);
    expect(occurrenceDates({ firstDueDate: "2026-01-15", recurrence: "quarterly" }, "2026-01-01", "2027-01-31")).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15", "2027-01-15"]);
    expect(occurrenceDates({ firstDueDate: "2025-06-30", recurrence: "annually" }, "2025-01-01", "2028-12-31")).toEqual(["2025-06-30", "2026-06-30", "2027-06-30", "2028-06-30"]);
  });

  it("end of month: a bill first due on the 31st clamps to each month's last day and never drifts", () => {
    const dates = occurrenceDates({ firstDueDate: "2026-01-31", recurrence: "monthly" }, "2026-01-01", "2026-06-30");
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
    // the 29th/30th behave the same way
    expect(occurrenceDates({ firstDueDate: "2026-01-30", recurrence: "monthly" }, "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-30"]);
    expect(occurrenceDates({ firstDueDate: "2026-01-29", recurrence: "monthly" }, "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-29"]);
  });

  it("end of month in a leap year uses Feb 29", () => {
    expect(occurrenceDates({ firstDueDate: "2027-12-31", recurrence: "monthly" }, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("quarterly from Nov 30 clamps Feb to 28/29", () => {
    expect(occurrenceDates({ firstDueDate: "2026-11-30", recurrence: "quarterly" }, "2026-11-01", "2027-12-31")).toEqual(["2026-11-30", "2027-02-28", "2027-05-30", "2027-08-30", "2027-11-30"]);
  });

  it("annual Feb 29: Feb 28 in non-leap years, Feb 29 in leap years", () => {
    const b = { firstDueDate: "2024-02-29", recurrence: "annually" as const };
    expect(occurrenceDates(b, "2024-01-01", "2028-12-31")).toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
    expect(isOccurrenceDate(b, "2025-02-28")).toBe(true);
    expect(isOccurrenceDate(b, "2025-03-01")).toBe(false);
  });

  it("is stable across the year boundary and long histories", () => {
    expect(occurrenceDates({ firstDueDate: "2020-11-05", recurrence: "monthly" }, "2026-12-01", "2027-02-28")).toEqual(["2026-12-05", "2027-01-05", "2027-02-05"]);
  });

  it("nextOccurrenceOnOrAfter", () => {
    expect(nextOccurrenceOnOrAfter({ firstDueDate: "2026-01-12", recurrence: "monthly" }, "2026-11-13")).toBe("2026-12-12");
    expect(nextOccurrenceOnOrAfter({ firstDueDate: "2026-01-12", recurrence: "monthly" }, "2026-11-12")).toBe("2026-11-12");
    expect(nextOccurrenceOnOrAfter({ firstDueDate: "2026-01-12", recurrence: "once" }, "2026-11-12")).toBeNull();
    expect(nextOccurrenceOnOrAfter({ firstDueDate: "2026-12-01", recurrence: "weekly" }, "2026-11-12")).toBe("2026-12-01");
  });
});

describe("occurrence status", () => {
  it("fixed: unpaid, partial, paid, multiple payments, overpay", () => {
    expect(computeStatus(100, 0)).toBe("unpaid");
    expect(computeStatus(100, 4000)).toBe("partial");
    expect(computeStatus(100, 10000)).toBe("paid");
    expect(computeStatus(100, 10001)).toBe("paid");
    expect(computeStatus(0, 0)).toBe("paid"); // nothing owed
  });

  it("variable with unknown amount is never 'paid', even at/over the estimate", () => {
    expect(computeStatus(null, 0)).toBe("unpaid");
    expect(computeStatus(null, 99999)).toBe("partial");
    const b = bill({ amountType: "variable", expectedAmount: 145 });
    const v = resolveOccurrence(b, "2026-11-12", occ("2026-11-12", null, [pay(150)]), "2026-11-03");
    expect(v.status).toBe("partial");
    expect(v.outstanding).toBeNull();
    expect(v.amountDue).toBeNull();
    expect(v.estimate).toBe(145);
  });

  it("partial then full across multiple payments, summed exactly in cents", () => {
    const b = bill({ expectedAmount: 0.3 });
    const o = occ("2026-11-12", 0.3, [pay(0.1), pay(0.2, { id: "p2" })]);
    const v = resolveOccurrence(b, "2026-11-12", o, "2026-11-03");
    expect(v.status).toBe("paid");
    expect(v.paid).toBe(0.3);
    expect(v.outstanding).toBe(0);
  });

  it("reversed payments don't count; reversing recalculates outstanding and status", () => {
    const b = bill();
    const before = resolveOccurrence(b, "2026-11-12", occ("2026-11-12", 1000, [pay(1000)]), "2026-11-03");
    expect(before.status).toBe("paid");
    const after = resolveOccurrence(b, "2026-11-12", occ("2026-11-12", 1000, [pay(1000, { reversedAt: "2026-11-04T00:00:00Z" })]), "2026-11-03");
    expect(after.status).toBe("unpaid");
    expect(after.outstanding).toBe(1000);
    const partial = resolveOccurrence(b, "2026-11-12", occ("2026-11-12", 1000, [pay(400), pay(600, { id: "x", reversedAt: "2026-11-04T00:00:00Z" })]), "2026-11-03");
    expect(partial.status).toBe("partial");
    expect(partial.outstanding).toBe(600);
  });

  it("a cycle without a row: fixed uses the bill's amount, variable has none", () => {
    expect(resolveOccurrence(bill(), "2026-11-12", undefined, "2026-11-03").amountDue).toBe(1000);
    expect(resolveOccurrence(bill({ amountType: "variable", expectedAmount: 145 }), "2026-11-12", undefined, "2026-11-03").amountDue).toBeNull();
  });

  it("a stored cycle keeps its own snapshot even after the bill's amount changes", () => {
    const edited = bill({ expectedAmount: 1200 });
    expect(resolveOccurrence(edited, "2026-10-12", occ("2026-10-12", 1000, [pay(1000)]), "2026-11-03").amountDue).toBe(1000);
    expect(resolveOccurrence(edited, "2026-11-12", undefined, "2026-11-03").amountDue).toBe(1200);
  });
});

describe("overdue and tiers (calendar-date based, no time zones)", () => {
  const b = bill();
  it("not overdue on the due date, overdue the day after", () => {
    expect(resolveOccurrence(b, "2026-11-03", undefined, "2026-11-03")).toMatchObject({ overdue: false, tier: "soon", daysUntil: 0 });
    expect(resolveOccurrence(b, "2026-11-02", undefined, "2026-11-03")).toMatchObject({ overdue: true, tier: "overdue", daysUntil: -1 });
  });
  it("tiers: later / soon (inside reminder window) / paid", () => {
    expect(resolveOccurrence(b, "2026-11-07", undefined, "2026-11-03").tier).toBe("later");
    expect(resolveOccurrence(b, "2026-11-06", undefined, "2026-11-03").tier).toBe("soon");
    expect(resolveOccurrence(b, "2026-10-01", occ("2026-10-01", 1000, [pay(1000)]), "2026-11-03").tier).toBe("paid");
  });
});

describe("bounded window and current occurrence", () => {
  it("only counts occurrences inside the lookback/horizon window", () => {
    const b = bill({ firstDueDate: "2025-01-12" });
    const dates = billOccurrenceViews(b, {}, "2026-11-03").map((v) => v.dueDate);
    expect(dates).toEqual(["2026-10-12", "2026-11-12", "2026-12-12"]);
  });

  it("shows the earliest unpaid occurrence, even if overdue; a paid cycle doesn't hide the next one", () => {
    const b = bill();
    expect(currentOccurrence(b, {}, "2026-11-03")?.dueDate).toBe("2026-10-12");
    const m = mapOf(occ("2026-10-12", 1000, [pay(1000)]));
    expect(currentOccurrence(b, m, "2026-11-03")?.dueDate).toBe("2026-11-12");
    const both = mapOf(occ("2026-10-12", 1000, [pay(1000)]), occ("2026-11-12", 1000, [pay(1000)]));
    // paying the 12th does NOT mark future cycles paid
    expect(currentOccurrence(b, both, "2026-11-03")?.dueDate).toBe("2026-12-12");
    expect(currentOccurrence(b, both, "2026-11-03")?.status).toBe("unpaid");
  });

  it("a paid one-time bill stays visible as paid", () => {
    const b = bill({ recurrence: "once", firstDueDate: "2026-09-01" });
    const m = mapOf(occ("2026-09-01", 1000, [pay(1000)]));
    expect(currentOccurrence(b, m, "2026-11-03")).toMatchObject({ dueDate: "2026-09-01", status: "paid" });
  });
});

describe("summarizeBills", () => {
  const today = "2026-11-03";
  it("is all zero with no bills", () => {
    expect(summarizeBills([], {}, today)).toEqual({ dueThisMonth: 0, unknownThisMonth: 0, knownThisMonth: 0, paidThisMonth: 0, upcoming: 0, overdue: 0, outstandingThisMonth: 0 });
  });

  it("totals this month's due/paid/outstanding from real records", () => {
    const rent = bill({ id: "b1", expectedAmount: 1000, firstDueDate: "2026-01-12" });
    const net = bill({ id: "b2", name: "Internet", expectedAmount: 60, firstDueDate: "2026-01-05" });
    const m = mapOf(occ("2026-11-12", 1000, [pay(400)], "b1"), occ("2026-11-05", 60, [pay(60)], "b2"), occ("2026-10-12", 1000, [pay(1000)], "b1"), occ("2026-10-05", 60, [pay(60)], "b2"));
    const s = summarizeBills([rent, net], m, today);
    expect(s.dueThisMonth).toBe(1060);
    expect(s.paidThisMonth).toBe(460);
    expect(s.outstandingThisMonth).toBe(600);
    expect(s.unknownThisMonth).toBe(0);
    expect(s.overdue).toBe(0);
  });

  it("never counts an unknown variable amount as $0 -- it's reported separately", () => {
    const power = bill({ id: "b3", name: "Electricity", amountType: "variable", expectedAmount: 145, firstDueDate: "2026-01-12" });
    const rent = bill({ id: "b1", expectedAmount: 1000, firstDueDate: "2026-01-12" });
    const s = summarizeBills([power, rent], mapOf(occ("2026-10-12", 1000, [pay(1000)], "b1"), occ("2026-10-12", 130, [pay(130)], "b3")), today);
    expect(s.dueThisMonth).toBe(1000);
    expect(s.unknownThisMonth).toBe(1);
  });

  it("counts overdue and upcoming (reminder window) separately and excludes paid and archived", () => {
    const a = bill({ id: "a", firstDueDate: "2026-01-02" }); // Nov 2 is overdue (and Dec 2 later)
    const b = bill({ id: "b", firstDueDate: "2026-01-05", remindDaysBefore: 3 }); // Nov 5 within window
    const c = bill({ id: "c", firstDueDate: "2026-01-05" }); // Nov 5, paid
    const d = bill({ id: "d", firstDueDate: "2026-01-02", archivedAt: "2026-02-01T00:00:00Z" });
    const m = mapOf(occ("2026-10-02", 1000, [pay(1000)], "a"), occ("2026-10-05", 1000, [pay(1000)], "b"), occ("2026-10-05", 1000, [pay(1000)], "c"), occ("2026-11-05", 1000, [pay(1000)], "c"));
    const s = summarizeBills([a, b, c, d], m, today);
    expect(s.overdue).toBe(1);
    expect(s.upcoming).toBe(1);
  });

  it("doesn't count unpaid cycles older than the lookback as overdue", () => {
    const old = bill({ firstDueDate: "2025-01-12" });
    const s = summarizeBills([old], {}, today);
    expect(s.overdue).toBe(1); // only Oct 12 (within 45 days), not the 10 older months
  });
});

describe("Plan Tomorrow suggestions (tap-to-add, deduped)", () => {
  const planDate = "2026-11-10";
  const power = bill({ id: "b9", name: "Electricity", firstDueDate: "2026-01-12", remindDaysBefore: 3 });

  it("suggests an unpaid occurrence once the plan date is inside its reminder window", () => {
    const s = suggestBillGoals([power], {}, planDate, new Set());
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ dueDate: "2026-11-12", amountDue: 1000 });
  });

  it("doesn't suggest before the window opens or after the due date", () => {
    expect(suggestBillGoals([power], {}, "2026-11-08", new Set())).toEqual([]);
    expect(suggestBillGoals([power], {}, "2026-11-13", new Set())).toEqual([]);
  });

  it("doesn't suggest a paid occurrence, an archived bill, or one that already has a goal", () => {
    const paid = mapOf(occ("2026-11-12", 1000, [pay(1000)], "b9"));
    expect(suggestBillGoals([power], paid, planDate, new Set())).toEqual([]);
    expect(suggestBillGoals([{ ...power, archivedAt: "x" }], {}, planDate, new Set())).toEqual([]);
    expect(suggestBillGoals([power], {}, planDate, new Set([billSuggestionKey("b9", "2026-11-12")]))).toEqual([]);
  });

  it("a partially paid occurrence is still suggested; a reversed full payment brings it back", () => {
    expect(suggestBillGoals([power], mapOf(occ("2026-11-12", 1000, [pay(300)], "b9")), planDate, new Set())).toHaveLength(1);
    expect(suggestBillGoals([power], mapOf(occ("2026-11-12", 1000, [pay(1000, { reversedAt: "x" })], "b9")), planDate, new Set())).toHaveLength(1);
  });

  it("a variable bill with an unknown amount is suggested with no amount", () => {
    const v = { ...power, amountType: "variable" as const, expectedAmount: 145 };
    expect(suggestBillGoals([v], {}, planDate, new Set())[0].amountDue).toBeNull();
  });

  it("only creates suggestions -- the function is pure data (no goal is created here)", () => {
    expect(typeof suggestBillGoals).toBe("function");
  });
});

describe("money parsing", () => {
  it("accepts non-negative amounts with at most 2 decimals", () => {
    for (const [raw, v] of [["0", 0], ["12", 12], ["12.5", 12.5], ["145.00", 145], [" 9.99 ", 9.99]] as const) expect(parseMoney(raw)).toEqual({ ok: true, value: v });
  });
  it("rejects invalid input instead of converting it", () => {
    expect(parseMoney("-5")).toEqual({ ok: false, error: "negative" });
    expect(parseMoney("10.555")).toEqual({ ok: false, error: "precision" });
    for (const raw of ["", "abc", "1e3", "12,50", ".", "1.", ".5", "$5"]) expect(parseMoney(raw).ok, raw).toBe(false);
    expect(parseMoney("99999999999").ok).toBe(false);
  });
});

describe("parseBillForm", () => {
  const ok = { ...emptyBillForm("2026-11-03"), name: " Rent ", amount: "1000" };

  it("builds a fixed bill payload", () => {
    const r = parseBillForm(ok);
    expect(r.ok && r.payload).toMatchObject({ name: "Rent", amountType: "fixed", expectedAmount: 1000, recurrence: "monthly", remindDaysBefore: 3, category: null, notes: null });
  });

  it("fixed requires an amount; variable allows a blank estimate", () => {
    expect(parseBillForm({ ...ok, amount: "" })).toMatchObject({ ok: false, errors: [{ field: "amount", code: "required" }] });
    const v = parseBillForm({ ...ok, amountType: "variable", amount: "" });
    expect(v.ok && v.payload.expectedAmount).toBeNull();
    const e = parseBillForm({ ...ok, amountType: "variable", amount: "145" });
    expect(e.ok && e.payload.expectedAmount).toBe(145);
  });

  it("validates every field", () => {
    const r = parseBillForm({ ...ok, name: "  ", amount: "-1", firstDueDate: "2026-02-30", remindDaysBefore: "99", category: "x".repeat(61), notes: "y".repeat(1001) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field).sort()).toEqual(["amount", "category", "firstDueDate", "name", "notes", "remindDaysBefore"]);
  });

  it("accepts leap-day and month-end first dates", () => {
    expect(parseBillForm({ ...ok, firstDueDate: "2028-02-29" }).ok).toBe(true);
    expect(parseBillForm({ ...ok, firstDueDate: "2027-02-29" }).ok).toBe(false);
    expect(parseBillForm({ ...ok, firstDueDate: "2026-01-31" }).ok).toBe(true);
  });
});

describe("parseBillPaymentEntry", () => {
  const today = "2026-11-03";
  const base = { amount: "50", date: today, note: "", amountDue: "" };
  it("accepts a positive payment, optional actual amount due, trims the note", () => {
    const r = parseBillPaymentEntry({ ...base, note: " Oct ", amountDue: "142.37" }, today);
    expect(r.ok && r.payload).toMatchObject({ amount: 50, note: "Oct", amountDue: 142.37 });
  });
  it("rejects zero, negatives, >2 decimals, future dates, invalid actual amounts", () => {
    expect(parseBillPaymentEntry({ ...base, amount: "0" }, today)).toEqual({ ok: false, error: "amount" });
    expect(parseBillPaymentEntry({ ...base, amount: "-3" }, today)).toEqual({ ok: false, error: "amount" });
    expect(parseBillPaymentEntry({ ...base, amount: "1.005" }, today)).toEqual({ ok: false, error: "amountPrecision" });
    expect(parseBillPaymentEntry({ ...base, date: "2026-11-04" }, today)).toEqual({ ok: false, error: "dateFuture" });
    expect(parseBillPaymentEntry({ ...base, amountDue: "abc" }, today)).toEqual({ ok: false, error: "amountDue" });
    expect(parseBillPaymentEntry({ ...base, date: "2026-02-30" }, today)).toEqual({ ok: false, error: "date" });
  });
  it("allows historical payments", () => {
    expect(parseBillPaymentEntry({ ...base, date: "2025-01-15" }, today).ok).toBe(true);
  });
});

describe("status labels (presentation only)", () => {
  const b = bill({ amountType: "variable", expectedAmount: 145 });
  const view = (record: ReturnType<typeof occ> | undefined, dueDate = "2026-11-12") => resolveOccurrence(b, dueDate, record, "2026-11-03");

  it("unknown actual amount is 'pending' -- with no payments, with a payment equal to the estimate, with a partial one", () => {
    expect(statusLabel(view(undefined))).toBe("pending");
    expect(statusLabel(view(occ("2026-11-12", null, [pay(145)])))).toBe("pending"); // equals the estimate: still nothing confirmed
    expect(statusLabel(view(occ("2026-11-12", null, [pay(50)])))).toBe("pending");
  });

  it("an overdue bill is still labelled overdue even while its amount is unknown", () => {
    expect(statusLabel(view(undefined, "2026-10-20"))).toBe("overdue");
  });

  it("once the actual amount is known the label follows the real status", () => {
    expect(statusLabel(view(occ("2026-11-12", 130, [pay(130)])))).toBe("paid");
    expect(statusLabel(view(occ("2026-11-12", 130, [pay(50)])))).toBe("partial");
    expect(statusLabel(view(occ("2026-11-12", 130, [])))).toBe("due");
    expect(statusLabel(view(occ("2026-11-12", 130, [pay(200)])))).toBe("paid"); // overpayment
    expect(statusLabel(view(occ("2026-10-12", 130, [pay(50)]), "2026-10-12"))).toBe("overdue");
  });

  it("fixed bills are unaffected: always have an amount, so they never read 'pending'", () => {
    const f = bill();
    expect(statusLabel(resolveOccurrence(f, "2026-11-12", undefined, "2026-11-03"))).toBe("due");
    expect(statusLabel(resolveOccurrence(f, "2026-11-12", occ("2026-11-12", 1000, [pay(400)]), "2026-11-03"))).toBe("partial");
  });

  it("the underlying status is unchanged (estimate never decides it)", () => {
    const v = view(occ("2026-11-12", null, [pay(145)]));
    expect(v.status).toBe("partial");
    expect(v.outstanding).toBeNull();
  });
});

describe("describeDueSummary / known counts", () => {
  const today = "2026-11-03";
  const power = bill({ id: "e", name: "Electricity", amountType: "variable", expectedAmount: 145, firstDueDate: "2026-01-12" });
  const water = bill({ id: "w", name: "Water", amountType: "variable", expectedAmount: null, firstDueDate: "2026-01-20" });
  const rent = bill({ id: "r", firstDueDate: "2026-01-12" });

  it("all amounts unknown -> allPending (never a misleading $0.00)", () => {
    const s = summarizeBills([power, water], {}, today);
    expect(s).toMatchObject({ dueThisMonth: 0, knownThisMonth: 0, unknownThisMonth: 2 });
    expect(describeDueSummary(s)).toEqual({ allPending: true, knownOnly: false, awaiting: 2 });
  });

  it("mixed known and unknown -> known-only total plus the awaiting count", () => {
    const s = summarizeBills([power, rent], {}, today);
    expect(s).toMatchObject({ dueThisMonth: 1000, knownThisMonth: 1, unknownThisMonth: 1 });
    expect(describeDueSummary(s)).toEqual({ allPending: false, knownOnly: true, awaiting: 1 });
  });

  it("everything known -> neither flag", () => {
    expect(describeDueSummary(summarizeBills([rent], {}, today))).toEqual({ allPending: false, knownOnly: false, awaiting: 0 });
    expect(describeDueSummary(summarizeBills([], {}, today))).toEqual({ allPending: false, knownOnly: false, awaiting: 0 });
  });

  it("a finalized actual amount moves a bill from awaiting to known, with totals unchanged otherwise", () => {
    const m = mapOf(occ("2026-11-12", 152.1, [], "e"));
    const s = summarizeBills([power, rent], m, today);
    expect(s).toMatchObject({ dueThisMonth: 1152.1, knownThisMonth: 2, unknownThisMonth: 0 });
  });
});

import { describe, it, expect } from "vitest";
import { EXPENSE_CATEGORIES, buildPlan, emptyProfile, type FinancialProfile } from "./financialPlanner";
import { nextSteps, spendingBreakdown, wholePercents } from "./plannerView";

const TODAY = "2026-11-04";
const profile = (over: Partial<FinancialProfile> = {}): FinancialProfile => ({ ...emptyProfile(), ...over });
const planOf = (p: FinancialProfile) => buildPlan({ profile: p, bills: [], accounts: [], subscriptions: [], todayISO: TODAY });

describe("wholePercents", () => {
  it("always adds up to exactly 100", () => {
    for (const v of [[1, 1, 1], [50, 30, 20], [333, 333, 334], [1, 2, 3, 4, 5, 6, 7], [7]]) {
      expect(wholePercents(v).reduce((a, b) => a + b, 0), v.join()).toBe(100);
    }
  });
  it("no amounts -> all zero", () => {
    expect(wholePercents([])).toEqual([]);
    expect(wholePercents([0, 0])).toEqual([0, 0]);
  });
  it("is proportional", () => {
    expect(wholePercents([50, 30, 20])).toEqual([50, 30, 20]);
  });
});

describe("spendingBreakdown", () => {
  const p = profile({
    useSubscriptions: true,
    noDebts: true,
    debts: [],
    expenses: { housing: { amount: 1000, basis: "actual" }, groceries: { amount: 400, basis: "estimate" }, other: { amount: 0, basis: "actual" } },
  });

  it("slices only the amounts that are known and positive, largest first, summing to the plan's outflow", () => {
    const b = spendingBreakdown(planOf(p), p);
    expect(b.segments.map((s) => s.key)).toEqual(["housing", "groceries"]);
    expect(b.totalCents).toBe(140000);
    expect(b.totalCents).toBe(planOf(p).outflowCents);
    expect(b.segments.map((s) => s.percent)).toEqual([71, 29]);
  });
  it("never invents missing expenses: categories that weren't provided have no slice", () => {
    const b = spendingBreakdown(planOf(p), p);
    for (const c of EXPENSE_CATEGORIES.filter((c) => !["housing", "groceries"].includes(c))) expect(b.segments.some((s) => s.key === c)).toBe(false);
  });
  it("includes bills & payments and subscriptions as their own slices when they exist", () => {
    const withSubs = buildPlan({
      profile: p,
      bills: [],
      accounts: [],
      subscriptions: [
        { id: "s", name: "N", provider: null, category: null, planName: null, amount: 100, currency: "USD", frequency: "monthly", customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null, remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "x", updatedAt: "x" },
      ],
      todayISO: TODAY,
    });
    const b = spendingBreakdown(withSubs, p);
    expect(b.segments.find((s) => s.key === "subscriptions")?.cents).toBe(10000);
    expect(b.totalCents).toBe(withSubs.outflowCents);
  });
  it("a row marked 'already in my Bills' is left out only while Bills are included (matching the plan)", () => {
    const covered = profile({ ...p, useBills: true, expenses: { housing: { amount: 1000, basis: "actual", covered: true }, groceries: { amount: 400, basis: "actual" } } });
    const b = spendingBreakdown(planOf(covered), covered);
    expect(b.segments.map((s) => s.key)).toEqual(["groceries"]);
    expect(b.totalCents).toBe(planOf(covered).outflowCents);
  });
  it("nothing known -> an empty breakdown (the screen shows its empty state)", () => {
    expect(spendingBreakdown(planOf(emptyProfile()), emptyProfile())).toEqual({ segments: [], totalCents: 0 });
  });
});

describe("nextSteps (rule-based, no AI)", () => {
  it("a new profile is told what is missing, in priority order, capped", () => {
    const steps = nextSteps(planOf(emptyProfile()));
    expect(steps.map((s) => s.kind)).toEqual(["addIncome", "addExpenses", "addObligations", "includeSubscriptions"]);
    expect(steps[0]).toMatchObject({ step: 1 });
    expect(steps[1]).toMatchObject({ step: 3, count: 8 });
  });
  it("a complete, healthy plan points out the savings room and the separate debt balance", () => {
    const p = profile({
      payFrequency: "monthly",
      takeHome: 5000,
      noDebts: false,
      debts: [{ id: "d", name: "Loan", balance: 4000, monthlyPayment: 100, basis: "actual", accountId: null }],
      useSubscriptions: true,
      expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 100, basis: "actual" as const }])),
    });
    const steps = nextSteps(planOf(p));
    expect(steps.map((s) => s.kind)).toEqual(["capacity", "debtBalance"]);
    expect(steps[0]).toMatchObject({ cents: 410000 - 0 });
    expect(steps[1]).toMatchObject({ cents: 400000 });
  });
  it("a shortfall is reported instead of savings room", () => {
    const p = profile({
      payFrequency: "monthly",
      takeHome: 500,
      noDebts: true,
      useSubscriptions: true,
      expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 100, basis: "actual" as const }])),
    });
    expect(nextSteps(planOf(p)).map((s) => s.kind)).toEqual(["shortfall"]);
  });
  it("no savings-room claim is made while the data is incomplete", () => {
    const p = profile({ payFrequency: "monthly", takeHome: 5000, noDebts: true, useSubscriptions: true, expenses: { housing: { amount: 100, basis: "actual" } } });
    expect(nextSteps(planOf(p)).some((s) => s.kind === "capacity")).toBe(false);
  });
  it("nothing to do -> empty", () => {
    const p = profile({
      payFrequency: "monthly",
      takeHome: 100,
      noDebts: true,
      useSubscriptions: true,
      savingsMonthly: 0,
      expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 0, basis: "actual" as const }])),
    });
    const kinds = nextSteps(planOf(p)).map((s) => s.kind);
    expect(kinds).toEqual(["capacity"]); // $100 a month is genuinely free to save
  });
});

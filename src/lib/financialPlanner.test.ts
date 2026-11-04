import { describe, it, expect } from "vitest";
import type { Bill } from "./bills";
import type { Subscription } from "./subscriptions";
import type { PaymentAccount } from "./supabase/db";
import {
  EXPENSE_CATEGORIES,
  buildPlan,
  billExpenseOverlaps,
  emptyProfile,
  monthlyIncome,
  obligationsKnown,
  optionalMoney,
  parseDebtsStep,
  parseExpensesStep,
  parseGoalsStep,
  parseHouseholdStep,
  parseIncomeStep,
  profileCompletion,
  stepStatus,
  summarizeAccountsSource,
  summarizeBillsSource,
  summarizeDebts,
  summarizeExpenses,
  summarizeSubscriptionsSource,
  type DebtEntry,
  type ExpenseValues,
  type FinancialProfile,
} from "./financialPlanner";

const TODAY = "2026-11-04";

const profile = (over: Partial<FinancialProfile> = {}): FinancialProfile => ({ ...emptyProfile(), ...over });

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: "b1",
  name: "Rent",
  amountType: "fixed",
  expectedAmount: 1200,
  recurrence: "monthly",
  firstDueDate: "2026-01-01",
  remindDaysBefore: 3,
  category: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

const account = (over: Partial<PaymentAccount> = {}): PaymentAccount => ({
  id: "a1",
  name: "Visa",
  balance: 1000,
  minimumPayment: 35,
  dueDay: 15,
  remindDaysBefore: 3,
  lastReminderDueDate: null,
  createdAt: "2026-01-01T00:00:00Z",
  balanceMode: "auto",
  ...over,
});

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1",
  name: "Netflix",
  provider: null,
  category: null,
  planName: null,
  amount: 15,
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

const debt = (over: Partial<DebtEntry> = {}): DebtEntry => ({ id: "d1", name: "Car loan", balance: 8000, monthlyPayment: 250, basis: "actual", accountId: null, ...over });

describe("monthly income normalization", () => {
  const inc = (payFrequency: FinancialProfile["payFrequency"], takeHome: number | null) =>
    monthlyIncome({ payFrequency, takeHome, incomeTypical: null, incomeLow: null, incomeBasis: "actual" });

  it("converts each pay frequency to a monthly figure in cents (periods per year / 12)", () => {
    expect(inc("monthly", 3000).monthlyCents).toBe(300000);
    expect(inc("semimonthly", 1500).monthlyCents).toBe(300000); // 24 / 12 = 2
    expect(inc("biweekly", 1000).monthlyCents).toBe(216667); // 26 / 12, rounded once
    expect(inc("weekly", 500).monthlyCents).toBe(216667); // 52 / 12
    expect(inc("weekly", 1000.5).monthlyCents).toBe(433550);
  });
  it("irregular income uses the typical month and carries the lowest month separately", () => {
    const r = monthlyIncome({ payFrequency: "irregular", takeHome: null, incomeTypical: 3200, incomeLow: 1800, incomeBasis: "estimate" });
    expect(r).toMatchObject({ monthlyCents: 320000, lowCents: 180000, irregular: true, basis: "estimate", missing: null });
  });
  it("missing information is null, never 0, and says what is missing", () => {
    expect(inc(null, 1000)).toMatchObject({ monthlyCents: null, missing: "frequency" });
    expect(inc("monthly", null)).toMatchObject({ monthlyCents: null, missing: "amount" });
    expect(monthlyIncome({ payFrequency: "irregular", takeHome: null, incomeTypical: null, incomeLow: 900, incomeBasis: "actual" })).toMatchObject({ monthlyCents: null, missing: "amount" });
  });
  it("an explicit $0 income is a real $0, different from not provided", () => {
    expect(inc("monthly", 0).monthlyCents).toBe(0);
  });
});

describe("living expenses", () => {
  it("sums only what was provided and lists the rest as missing (unknown, not zero)", () => {
    const r = summarizeExpenses({ housing: { amount: 1200, basis: "actual" }, groceries: { amount: 400.5, basis: "estimate" } }, false);
    expect(r.totalCents).toBe(160050);
    expect(r.providedCount).toBe(2);
    expect(r.missing).toEqual(["utilities", "transportation", "insurance", "healthcare", "childcare", "other"]);
    expect(r.includesEstimates).toBe(true);
  });
  it("a provided $0 is not missing", () => {
    const r = summarizeExpenses({ childcare: { amount: 0, basis: "actual" } }, false);
    expect(r.missing).not.toContain("childcare");
    expect(r.totalCents).toBe(0);
  });
  it("a row marked 'already in my Bills' is excluded only while Bills are included", () => {
    const e = { housing: { amount: 1200, basis: "actual" as const, covered: true }, groceries: { amount: 300, basis: "actual" as const } };
    expect(summarizeExpenses(e, true)).toMatchObject({ totalCents: 30000, coveredCents: 120000 });
    expect(summarizeExpenses(e, false)).toMatchObject({ totalCents: 150000, coveredCents: 0 });
  });
  it("all-actual figures don't claim estimates", () => {
    expect(summarizeExpenses({ housing: { amount: 1, basis: "actual" } }, false).includesEstimates).toBe(false);
  });
});

describe("Bills as recurring obligations (only with consent)", () => {
  it("is off and zero until the user consents", () => {
    expect(summarizeBillsSource([bill()], false)).toMatchObject({ included: false, monthlyCents: 0, count: 0 });
  });
  it("converts every recurrence to a monthly equivalent", () => {
    const r = summarizeBillsSource(
      [
        bill({ id: "1", expectedAmount: 100, recurrence: "monthly" }),
        bill({ id: "2", expectedAmount: 300, recurrence: "quarterly" }), // 100
        bill({ id: "3", expectedAmount: 1200, recurrence: "annually" }), // 100
        bill({ id: "4", expectedAmount: 12, recurrence: "weekly" }), // 52 * 12 / 12 = 52
        bill({ id: "5", expectedAmount: 24, recurrence: "biweekly" }), // 26 * 24 / 12 = 52
      ],
      true
    );
    expect(r.monthlyCents).toBe(10000 + 10000 + 10000 + 5200 + 5200);
  });
  it("one-time bills, archived bills are left out of the monthly baseline; one-time are counted for display", () => {
    const r = summarizeBillsSource([bill({ id: "1", recurrence: "once", expectedAmount: 500 }), bill({ id: "2", archivedAt: "2026-02-01T00:00:00Z" }), bill({ id: "3", expectedAmount: 50 })], true);
    expect(r).toMatchObject({ monthlyCents: 5000, count: 1, oneTimeCount: 1 });
  });
  it("a variable bill's estimate is used and flagged; a bill with no amount is missing, not 0", () => {
    const r = summarizeBillsSource(
      [bill({ id: "1", amountType: "variable", expectedAmount: 80 }), bill({ id: "2", amountType: "variable", expectedAmount: null })],
      true
    );
    expect(r).toMatchObject({ monthlyCents: 8000, missingCount: 1, includesEstimates: true });
  });
});

describe("Payments accounts and subscriptions as obligations", () => {
  it("sums minimum payments only with consent", () => {
    const a = [account({ minimumPayment: 35 }), account({ id: "a2", minimumPayment: 90.25 })];
    expect(summarizeAccountsSource(a, true).monthlyCents).toBe(12525);
    expect(summarizeAccountsSource(a, false)).toMatchObject({ included: false, monthlyCents: 0 });
  });
  it("subscriptions: monthly-equivalent of active priced ones; missing prices and other currencies are counted, not zeroed", () => {
    const r = summarizeSubscriptionsSource(
      [sub({ id: "a", amount: 10 }), sub({ id: "b", amount: 120, frequency: "yearly" }), sub({ id: "c", amount: null }), sub({ id: "d", currency: "EUR" })],
      true,
      false,
      new Set(),
      TODAY
    );
    expect(r).toMatchObject({ monthlyCents: 2000, missingCount: 1, otherCurrency: 1 });
  });
  it("a subscription linked to a bill is NOT counted again while that bill is included", () => {
    const linked = sub({ id: "x", amount: 15, billId: "b1" });
    expect(summarizeSubscriptionsSource([linked], true, true, new Set(["b1"]), TODAY)).toMatchObject({ monthlyCents: 0, linkedSkipped: 1 });
    // Bills not included -> the bill isn't carrying it, so the subscription counts.
    expect(summarizeSubscriptionsSource([linked], true, false, new Set(["b1"]), TODAY)).toMatchObject({ monthlyCents: 1500, linkedSkipped: 0 });
    // The linked bill isn't among the counted (e.g. archived / one-time) bills -> counts.
    expect(summarizeSubscriptionsSource([linked], true, true, new Set(), TODAY)).toMatchObject({ monthlyCents: 1500 });
  });
});

describe("debts: balances stay separate from monthly payments", () => {
  it("payments and balances are summed separately", () => {
    const r = summarizeDebts([debt(), debt({ id: "d2", balance: 2000, monthlyPayment: 60 })], [], false);
    expect(r).toMatchObject({ monthlyPaymentCents: 31000, balanceCents: 1000000 });
  });
  it("a missing payment or balance is counted as missing, not 0", () => {
    const r = summarizeDebts([debt({ monthlyPayment: null }), debt({ id: "d2", balance: null })], [], false);
    expect(r).toMatchObject({ missingPayments: 1, missingBalances: 1, monthlyPaymentCents: 25000, balanceCents: 800000 });
  });
  it("a debt linked to a Payments account is counted there, not twice, only while accounts are included", () => {
    const linked = debt({ accountId: "a1" });
    expect(summarizeDebts([linked], [account()], true)).toMatchObject({ monthlyPaymentCents: 0, balanceCents: 0, trackedElsewhere: 1 });
    expect(summarizeDebts([linked], [account()], false)).toMatchObject({ monthlyPaymentCents: 25000, balanceCents: 800000, trackedElsewhere: 0 });
    // a stale link to an account that no longer exists is just an ordinary debt
    expect(summarizeDebts([debt({ accountId: "gone" })], [account()], true)).toMatchObject({ monthlyPaymentCents: 25000, trackedElsewhere: 0 });
  });
});

describe("the plan: aggregation, cash flow, savings capacity", () => {
  const base = profile({
    payFrequency: "monthly",
    takeHome: 5000,
    incomeBasis: "actual",
    expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 100, basis: "actual" as const }])),
    noDebts: true,
    useSubscriptions: true,
  });
  const plan = (p: FinancialProfile, extra: Partial<{ bills: Bill[]; accounts: PaymentAccount[]; subscriptions: Subscription[] }> = {}) =>
    buildPlan({ profile: p, bills: extra.bills ?? [], accounts: extra.accounts ?? [], subscriptions: extra.subscriptions ?? [], todayISO: TODAY });

  it("available = take-home - (obligations + living expenses + subscriptions)", () => {
    const p = plan(
      { ...base, useBills: true, useAccounts: true },
      { bills: [bill({ expectedAmount: 1200 })], accounts: [account({ minimumPayment: 40 })], subscriptions: [sub({ amount: 20 })] }
    );
    expect(p.obligationsCents).toBe(124000);
    expect(p.expenses.totalCents).toBe(80000);
    expect(p.subscriptions.monthlyCents).toBe(2000);
    expect(p.outflowCents).toBe(206000);
    expect(p.availableCents).toBe(500000 - 206000);
    expect(p.incomplete).toBe(false);
    expect(p.missing).toEqual([]);
  });
  it("is null (never guessed) when income isn't known, and says income is missing", () => {
    const p = plan({ ...base, payFrequency: null, takeHome: null });
    expect(p.availableCents).toBeNull();
    expect(p.savingsCapacityCents).toBeNull();
    expect(p.missing).toContain("income");
    expect(p.incomplete).toBe(true);
  });
  it("a fresh profile is entirely 'unknown': nothing becomes $0", () => {
    const p = plan(emptyProfile());
    expect(p.availableCents).toBeNull();
    expect(p.missing).toEqual(["income", "expenses", "obligations", "subscriptions"]);
    expect(obligationsKnown(emptyProfile())).toBe(false);
  });
  it("missing expense categories and unpriced records flag the result as incomplete", () => {
    const p = plan(
      { ...base, expenses: { housing: { amount: 1000, basis: "actual" } }, useBills: true },
      { bills: [bill({ amountType: "variable", expectedAmount: null })], subscriptions: [sub({ amount: null })] }
    );
    expect(p.missing).toEqual(expect.arrayContaining(["expenses", "billAmounts", "subscriptionPrices"]));
    expect(p.incomplete).toBe(true);
    expect(p.availableCents).not.toBeNull(); // still shown, but flagged incomplete
  });
  it("outstanding debt balances are kept out of every monthly figure", () => {
    const withDebt = plan({ ...base, noDebts: false, debts: [debt({ balance: 20000, monthlyPayment: 300 })] });
    expect(withDebt.obligationsCents).toBe(30000);
    expect(withDebt.debtBalanceCents).toBe(2000000);
    expect(withDebt.outflowCents).toBe(30000 + 80000);
  });
  it("Payments account balances join the debt total (not the monthly figures) when included", () => {
    const p = plan({ ...base, useAccounts: true }, { accounts: [account({ balance: 900, minimumPayment: 30 })] });
    expect(p.debtBalanceCents).toBe(90000);
    expect(p.obligationsCents).toBe(3000);
  });
  it("savings capacity is what is left after planned savings, never negative; a shortfall is flagged", () => {
    const roomy = plan({ ...base, savingsMonthly: 500 });
    expect(roomy.availableCents).toBe(420000);
    expect(roomy.savingsCapacityCents).toBe(370000);
    expect(roomy.shortfall).toBe(false);
    const tight = plan({ ...base, takeHome: 900, savingsMonthly: 200 });
    expect(tight.availableCents).toBe(10000);
    expect(tight.savingsCapacityCents).toBe(0);
    expect(tight.shortfall).toBe(true);
  });
  it("irregular income also reports the lowest month", () => {
    const p = plan({ ...base, payFrequency: "irregular", takeHome: null, incomeTypical: 5000, incomeLow: 2000 });
    expect(p.availableCents).toBe(500000 - 80000);
    expect(p.lowAvailableCents).toBe(200000 - 80000);
  });
  it("tracks whether estimates are involved", () => {
    expect(plan(base).includesEstimates).toBe(false);
    expect(plan({ ...base, incomeBasis: "estimate" }).includesEstimates).toBe(true);
    expect(plan({ ...base, expenses: { ...base.expenses, housing: { amount: 100, basis: "estimate" } } }).includesEstimates).toBe(true);
  });
  it("records are not read until the user consents, and the plan never mutates its inputs", () => {
    const bills = [bill()];
    const copy = JSON.stringify(bills);
    const p = plan({ ...base, useBills: false }, { bills });
    expect(p.bills.included).toBe(false);
    expect(p.obligationsCents).toBe(0);
    expect(JSON.stringify(bills)).toBe(copy);
  });
  it("surfaces (never merges) bills that probably cover an expense category", () => {
    const bills = [bill({ category: "Rent / Mortgage" }), bill({ id: "u", category: "Utilities" }), bill({ id: "o", category: "Rent / Mortgage", recurrence: "once" }), bill({ id: "x", category: "Memberships" })];
    expect(billExpenseOverlaps(bills)).toEqual(["housing", "utilities"]);
    expect(plan({ ...base, useBills: true }, { bills }).overlapCategories).toEqual(["housing", "utilities"]);
    expect(plan({ ...base, useBills: false }, { bills }).overlapCategories).toEqual([]);
  });
});

describe("profile completion", () => {
  it("each step reports complete / partial / skipped / todo from the data", () => {
    const e = emptyProfile();
    expect(stepStatus(e, 1)).toBe("todo");
    expect(stepStatus(profile({ payFrequency: "monthly" }), 1)).toBe("partial");
    expect(stepStatus(profile({ payFrequency: "monthly", takeHome: 3000 }), 1)).toBe("complete");
    expect(stepStatus(profile({ payFrequency: "irregular", incomeTypical: 2500 }), 1)).toBe("complete");
    expect(stepStatus(profile({ adults: 2 }), 2)).toBe("complete");
    expect(stepStatus(profile({ country: "US" }), 2)).toBe("partial");
    expect(stepStatus(profile({ expenses: { housing: { amount: 1, basis: "actual" } } }), 3)).toBe("partial");
    expect(stepStatus(profile({ expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 1, basis: "actual" as const }])) }), 3)).toBe("complete");
    expect(stepStatus(profile({ noDebts: true }), 4)).toBe("complete");
    expect(stepStatus(profile({ debts: [debt()] }), 4)).toBe("complete");
    expect(stepStatus(profile({ savingsMonthly: 50 }), 4)).toBe("partial");
    expect(stepStatus(profile({ goals: [{ id: "g", name: "Trip", targetAmount: null, targetDate: null }] }), 5)).toBe("complete");
  });
  it("skipping marks an unanswered step skipped, but never hides data that was entered", () => {
    expect(stepStatus(profile({ skippedSteps: [5] }), 5)).toBe("skipped");
    expect(stepStatus(profile({ skippedSteps: [2], adults: 3 }), 2)).toBe("complete");
  });
  it("overall percent and the next step to work on", () => {
    expect(profileCompletion(emptyProfile())).toMatchObject({ completeCount: 0, percent: 0, nextStep: 1 });
    const c = profileCompletion(profile({ payFrequency: "monthly", takeHome: 1, adults: 1, noDebts: true }));
    expect(c).toMatchObject({ completeCount: 3, percent: 60, nextStep: 3 });
  });
});

describe("validation", () => {
  it("optionalMoney: blank is 'not provided'; otherwise a non-negative amount with at most 2 decimals", () => {
    expect(optionalMoney("")).toEqual({ ok: true, value: null });
    expect(optionalMoney("  ")).toEqual({ ok: true, value: null });
    expect(optionalMoney("1200.50")).toEqual({ ok: true, value: 1200.5 });
    expect(optionalMoney("0")).toEqual({ ok: true, value: 0 });
    for (const bad of ["abc", "-5", "1.234", "1,2,3"]) expect(optionalMoney(bad).ok, bad).toBe(false);
  });

  it("income: needs a frequency before amounts; irregular lowest month can't exceed typical", () => {
    expect(parseIncomeStep({ frequency: "", takeHome: "", typical: "", low: "", basis: "estimate" })).toMatchObject({ ok: true });
    expect(parseIncomeStep({ frequency: "", takeHome: "100", typical: "", low: "", basis: "estimate" })).toMatchObject({ ok: false, errors: [{ field: "frequency" }] });
    expect(parseIncomeStep({ frequency: "monthly", takeHome: "x", typical: "", low: "", basis: "actual" })).toMatchObject({ ok: false, errors: [{ field: "takeHome" }] });
    expect(parseIncomeStep({ frequency: "irregular", takeHome: "", typical: "2000", low: "2500", basis: "estimate" })).toMatchObject({ ok: false, errors: [{ code: "lowAboveTypical" }] });
    const ok = parseIncomeStep({ frequency: "biweekly", takeHome: "1500.25", typical: "999", low: "1", basis: "actual" });
    expect(ok).toEqual({ ok: true, patch: { payFrequency: "biweekly", takeHome: 1500.25, incomeTypical: null, incomeLow: null, incomeBasis: "actual" } });
    const irr = parseIncomeStep({ frequency: "irregular", takeHome: "123", typical: "3000", low: "", basis: "estimate" });
    expect(irr).toEqual({ ok: true, patch: { payFrequency: "irregular", takeHome: null, incomeTypical: 3000, incomeLow: null, incomeBasis: "estimate" } });
  });

  it("income with { required: true } (Next / Save & Exit): frequency and the amount must be given; blanks are fine without it", () => {
    const blank = { frequency: "" as const, takeHome: "", typical: "", low: "", basis: "estimate" as const };
    expect(parseIncomeStep(blank)).toMatchObject({ ok: true });
    expect(parseIncomeStep(blank, { required: true })).toMatchObject({ ok: false, errors: [{ field: "frequency", code: "required" }] });
    expect(parseIncomeStep({ ...blank, frequency: "monthly" }, { required: true })).toMatchObject({ ok: false, errors: [{ field: "takeHome", code: "required" }] });
    expect(parseIncomeStep({ ...blank, frequency: "monthly", takeHome: "  " }, { required: true })).toMatchObject({ ok: false });
    expect(parseIncomeStep({ ...blank, frequency: "irregular", low: "500" }, { required: true })).toMatchObject({ ok: false, errors: [{ field: "typical", code: "required" }] });
    expect(parseIncomeStep({ ...blank, frequency: "monthly", takeHome: "0" }, { required: true })).toMatchObject({ ok: true, patch: { takeHome: 0 } }); // an explicit $0 is an answer
    expect(parseIncomeStep({ ...blank, frequency: "weekly", takeHome: "12.345" }, { required: true })).toMatchObject({ ok: false, errors: [{ field: "takeHome", code: "precision" }] });
  });

  it("household: optional, with bounded whole numbers", () => {
    expect(parseHouseholdStep({ country: " US ", region: "", adults: "2", dependents: "0" })).toEqual({ ok: true, patch: { country: "US", region: null, adults: 2, dependents: 0 } });
    expect(parseHouseholdStep({ country: "", region: "", adults: "", dependents: "" })).toEqual({ ok: true, patch: { country: null, region: null, adults: null, dependents: null } });
    expect(parseHouseholdStep({ country: "", region: "", adults: "0", dependents: "" })).toMatchObject({ ok: false, errors: [{ field: "adults", code: "numRange" }] });
    expect(parseHouseholdStep({ country: "", region: "", adults: "2.5", dependents: "-1" })).toMatchObject({ ok: false });
    expect(parseHouseholdStep({ country: "x".repeat(61), region: "", adults: "", dependents: "" })).toMatchObject({ ok: false, errors: [{ field: "country", code: "tooLong" }] });
  });

  const blankExpenses = (): ExpenseValues => Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: "", basis: "estimate", covered: false }])) as ExpenseValues;
  it("expenses: blank rows are omitted (unknown), a typed 0 is kept, and the estimate / covered flags are stored", () => {
    const v = blankExpenses();
    v.housing = { amount: "1200", basis: "actual", covered: true };
    v.groceries = { amount: "0", basis: "estimate", covered: false };
    expect(parseExpensesStep(v)).toEqual({ ok: true, patch: { expenses: { housing: { amount: 1200, basis: "actual", covered: true }, groceries: { amount: 0, basis: "estimate" } } } });
    v.utilities = { amount: "12.345", basis: "estimate", covered: false };
    expect(parseExpensesStep(v)).toMatchObject({ ok: false, errors: [{ field: "utilities" }] });
  });

  it("debts: a name is required, balances and payments are optional amounts, 'no debts' clears the list", () => {
    const d = { id: "1", name: "Card", balance: "500", payment: "25", basis: "actual" as const, accountId: "" };
    expect(parseDebtsStep({ noDebts: false, debts: [d], savingsBalance: "", savingsMonthly: "50", savingsBasis: "estimate" })).toEqual({
      ok: true,
      patch: { debts: [{ id: "1", name: "Card", balance: 500, monthlyPayment: 25, basis: "actual", accountId: null }], noDebts: false, savingsBalance: null, savingsMonthly: 50, savingsBasis: "estimate" },
    });
    expect(parseDebtsStep({ noDebts: false, debts: [{ ...d, name: " " }], savingsBalance: "", savingsMonthly: "", savingsBasis: "estimate" })).toMatchObject({ ok: false, errors: [{ field: "debt0.name", code: "required" }] });
    expect(parseDebtsStep({ noDebts: false, debts: [{ ...d, payment: "-1" }], savingsBalance: "", savingsMonthly: "", savingsBasis: "estimate" })).toMatchObject({ ok: false });
    const cleared = parseDebtsStep({ noDebts: true, debts: [d], savingsBalance: "", savingsMonthly: "", savingsBasis: "estimate" });
    expect(cleared).toMatchObject({ ok: true, patch: { debts: [], noDebts: true } });
    expect(parseDebtsStep({ noDebts: false, debts: [d], savingsBalance: "1e3", savingsMonthly: "", savingsBasis: "estimate" })).toMatchObject({ ok: false, errors: [{ field: "savingsBalance" }] });
  });

  it("goals: name required, optional amount and a real date", () => {
    expect(parseGoalsStep([{ id: "g", name: " Trip ", targetAmount: "1500", targetDate: "2027-06-30" }])).toEqual({ ok: true, patch: { goals: [{ id: "g", name: "Trip", targetAmount: 1500, targetDate: "2027-06-30" }] } });
    expect(parseGoalsStep([{ id: "g", name: "", targetAmount: "", targetDate: "" }])).toMatchObject({ ok: false });
    expect(parseGoalsStep([{ id: "g", name: "Trip", targetAmount: "", targetDate: "2027-02-30" }])).toMatchObject({ ok: false, errors: [{ field: "goal0.date", code: "date" }] });
    expect(parseGoalsStep([])).toEqual({ ok: true, patch: { goals: [] } });
  });
});

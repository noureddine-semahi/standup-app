// Pure logic for Tools > Planner (Financial Planner, phase 1): the financial profile, income
// normalization, expense / obligation totals, cash flow, savings capacity, completion status and input
// validation. No I/O.
//
// Mirrors supabase/migrations/20261106000100_financial_profiles.sql.
//
// Principles:
//  - All money is computed in integer CENTS. Amounts the user hasn't given are NULL, never 0, and every
//    total reports what is missing so the UI can say "incomplete" instead of showing a falsely low number.
//  - Estimates are kept apart from actual values (a "basis" per figure) and surfaced as "includes estimates".
//  - Outstanding debt BALANCES are never mixed into monthly obligations; only monthly PAYMENTS are.
//  - Linked records (Bills, Payments accounts, Subscriptions) are used only with the user's consent, and are
//    never double counted: an explicit link wins (a subscription tied to a bill, a debt tied to a payment
//    account, an expense marked "already in my Bills"). Fuzzy overlaps are SURFACED, never merged.

import { isValidISODate, parseMoney, toCents, type Bill } from "@/lib/bills";
import { summarizeSubscriptions, type Subscription } from "@/lib/subscriptions";
import type { PaymentAccount } from "@/lib/supabase/db";

export type Basis = "actual" | "estimate";
export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "irregular";
export const PAY_FREQUENCIES: readonly PayFrequency[] = ["weekly", "biweekly", "semimonthly", "monthly", "irregular"];

export const EXPENSE_CATEGORIES = ["housing", "utilities", "groceries", "transportation", "insurance", "healthcare", "childcare", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PLANNER_STEPS = [1, 2, 3, 4, 5] as const;
export type PlannerStep = (typeof PLANNER_STEPS)[number];

export const MAX_DEBTS = 20;
export const MAX_GOALS = 10;
export const MAX_NAME = 80;
export const MAX_PLACE = 60;
export const MAX_ADULTS = 10;
export const MAX_DEPENDENTS = 15;

export type ExpenseEntry = {
  amount: number;
  basis: Basis;
  /** The user says a tracked Bill already covers this, so it is not counted again while Bills are included. */
  covered?: boolean;
};

export type DebtEntry = {
  id: string;
  name: string;
  /** Outstanding balance (what is owed). Never part of the monthly totals. */
  balance: number | null;
  /** The monthly payment. */
  monthlyPayment: number | null;
  basis: Basis;
  /** Explicit link to a Payments account that already tracks this debt. */
  accountId: string | null;
};

export type GoalEntry = { id: string; name: string; targetAmount: number | null; targetDate: string | null };

export type FinancialProfile = {
  currentStep: PlannerStep;
  /** Steps the user chose to skip. */
  skippedSteps: PlannerStep[];
  payFrequency: PayFrequency | null;
  /** Take-home per pay period (not for irregular income). */
  takeHome: number | null;
  /** Irregular income: a typical month's take-home, and optionally the lowest month. */
  incomeTypical: number | null;
  incomeLow: number | null;
  incomeBasis: Basis;
  country: string | null;
  region: string | null;
  adults: number | null;
  dependents: number | null;
  expenses: Partial<Record<ExpenseCategory, ExpenseEntry>>;
  debts: DebtEntry[];
  /** The user said they have no debts (so an empty list is an answer, not a gap). */
  noDebts: boolean;
  savingsBalance: number | null;
  savingsMonthly: number | null;
  savingsBasis: Basis;
  goals: GoalEntry[];
  /** Consent to read each existing record set into the plan. Off by default; nothing is ever written back. */
  useBills: boolean;
  useAccounts: boolean;
  useSubscriptions: boolean;
  updatedAt: string | null;
};

export function emptyProfile(): FinancialProfile {
  return {
    currentStep: 1,
    skippedSteps: [],
    payFrequency: null,
    takeHome: null,
    incomeTypical: null,
    incomeLow: null,
    incomeBasis: "estimate",
    country: null,
    region: null,
    adults: null,
    dependents: null,
    expenses: {},
    debts: [],
    noDebts: false,
    savingsBalance: null,
    savingsMonthly: null,
    savingsBasis: "estimate",
    goals: [],
    useBills: false,
    useAccounts: false,
    useSubscriptions: false,
    updatedAt: null,
  };
}

const cents = (n: number | null | undefined): number | null => (n === null || n === undefined ? null : toCents(n));

// ── Income ───────────────────────────────────────────────────────────────

/** Pay periods per year; the monthly figure is takeHome * periods / 12. */
export const PERIODS_PER_YEAR: Record<Exclude<PayFrequency, "irregular">, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

export type IncomeResult = {
  /** Monthly take-home in cents, or null when it can't be known yet. */
  monthlyCents: number | null;
  /** Irregular income only: the lowest month, if given. */
  lowCents: number | null;
  irregular: boolean;
  basis: Basis;
  /** Why it is null: no pay frequency, or no amount. */
  missing: "frequency" | "amount" | null;
};

export function monthlyIncome(p: Pick<FinancialProfile, "payFrequency" | "takeHome" | "incomeTypical" | "incomeLow" | "incomeBasis">): IncomeResult {
  const base = { basis: p.incomeBasis, lowCents: null as number | null };
  if (!p.payFrequency) return { ...base, monthlyCents: null, irregular: false, missing: "frequency" };
  if (p.payFrequency === "irregular") {
    const typical = cents(p.incomeTypical);
    return { ...base, monthlyCents: typical, lowCents: cents(p.incomeLow), irregular: true, missing: typical === null ? "amount" : null };
  }
  const per = cents(p.takeHome);
  if (per === null) return { ...base, monthlyCents: null, irregular: false, missing: "amount" };
  return { ...base, monthlyCents: Math.round((per * PERIODS_PER_YEAR[p.payFrequency]) / 12), irregular: false, missing: null };
}

// ── Living expenses ──────────────────────────────────────────────────────

export type ExpensesResult = {
  /** Sum of the categories the user provided (counted). */
  totalCents: number;
  /** Categories not provided at all: unknown, NOT zero. */
  missing: ExpenseCategory[];
  /** Provided but excluded because a tracked Bill already covers them. */
  coveredCents: number;
  includesEstimates: boolean;
  providedCount: number;
};

export function summarizeExpenses(expenses: FinancialProfile["expenses"], billsIncluded: boolean): ExpensesResult {
  let total = 0;
  let covered = 0;
  let estimates = false;
  let provided = 0;
  const missing: ExpenseCategory[] = [];
  for (const cat of EXPENSE_CATEGORIES) {
    const e = expenses[cat];
    if (!e) {
      missing.push(cat);
      continue;
    }
    provided += 1;
    const c = toCents(e.amount);
    if (e.covered && billsIncluded) covered += c;
    else {
      total += c;
      if (e.basis === "estimate") estimates = true;
    }
  }
  return { totalCents: total, missing, coveredCents: covered, includesEstimates: estimates, providedCount: provided };
}

// ── Existing records (only with consent) ─────────────────────────────────

/** Payments per year for a bill recurrence; null for one-time bills (not part of a monthly baseline). */
export const BILL_PERIODS_PER_YEAR: Record<Bill["recurrence"], number | null> = {
  once: null,
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

export type SourceResult = {
  /** Whether the user consented to using this record set. */
  included: boolean;
  monthlyCents: number;
  /** Records with no usable amount: unknown, NOT zero. */
  missingCount: number;
  /** Records counted from an estimate (a variable bill's estimate). */
  includesEstimates: boolean;
  /** Records in the set (that apply), for display. */
  count: number;
  /** One-time bills left out of the monthly baseline (bills only). */
  oneTimeCount?: number;
};

const OFF: SourceResult = { included: false, monthlyCents: 0, missingCount: 0, includesEstimates: false, count: 0 };

export function summarizeBillsSource(bills: readonly Bill[], included: boolean): SourceResult {
  if (!included) return OFF;
  let total = 0;
  let missing = 0;
  let est = false;
  let count = 0;
  let oneTime = 0;
  for (const b of bills) {
    if (b.archivedAt) continue;
    const per = BILL_PERIODS_PER_YEAR[b.recurrence];
    if (per === null) {
      oneTime += 1;
      continue;
    }
    count += 1;
    if (b.expectedAmount === null) {
      missing += 1;
      continue;
    }
    total += Math.round((toCents(b.expectedAmount) * per) / 12);
    if (b.amountType === "variable") est = true;
  }
  return { included: true, monthlyCents: total, missingCount: missing, includesEstimates: est, count, oneTimeCount: oneTime };
}

/** Minimum payments on Payments accounts. A minimum of 0 is a real 0 (the account has no required payment). */
export function summarizeAccountsSource(accounts: readonly PaymentAccount[], included: boolean): SourceResult {
  if (!included) return OFF;
  let total = 0;
  for (const a of accounts) total += toCents(a.minimumPayment);
  return { included: true, monthlyCents: total, missingCount: 0, includesEstimates: false, count: accounts.length };
}

/**
 * Subscriptions: the monthly-equivalent cost of active, priced USD subscriptions. A subscription explicitly
 * linked to a bill is left out while Bills are included, because the bill already carries that charge.
 */
export function summarizeSubscriptionsSource(
  subs: readonly Subscription[],
  included: boolean,
  billsIncluded: boolean,
  includedBillIds: ReadonlySet<string>,
  todayISO: string
): SourceResult & { otherCurrency: number; linkedSkipped: number } {
  if (!included) return { ...OFF, otherCurrency: 0, linkedSkipped: 0 };
  const isLinkedToCountedBill = (s: Subscription) => billsIncluded && !!s.billId && includedBillIds.has(s.billId);
  const counted = subs.filter((s) => !isLinkedToCountedBill(s));
  const summary = summarizeSubscriptions(counted, todayISO);
  return {
    included: true,
    monthlyCents: toCents(summary.monthlyCost),
    missingCount: summary.awaitingPrice,
    includesEstimates: false,
    count: summary.activeCount,
    otherCurrency: summary.otherCurrency,
    linkedSkipped: subs.length - counted.length,
  };
}

// ── Debts and savings ────────────────────────────────────────────────────

export type DebtsResult = {
  /** Monthly payments on the user's own debt entries (not those tracked by a Payments account). */
  monthlyPaymentCents: number;
  /** Outstanding balances, kept separate from every monthly figure. */
  balanceCents: number;
  missingPayments: number;
  missingBalances: number;
  includesEstimates: boolean;
  /** Entries tracked by a Payments account that is being used (counted there, not here). */
  trackedElsewhere: number;
};

export function summarizeDebts(debts: readonly DebtEntry[], accounts: readonly PaymentAccount[], accountsIncluded: boolean): DebtsResult {
  const accountIds = new Set(accounts.map((a) => a.id));
  let pay = 0;
  let bal = 0;
  let mp = 0;
  let mb = 0;
  let est = false;
  let tracked = 0;
  for (const d of debts) {
    if (accountsIncluded && d.accountId && accountIds.has(d.accountId)) {
      tracked += 1;
      continue;
    }
    if (d.monthlyPayment === null) mp += 1;
    else pay += toCents(d.monthlyPayment);
    if (d.balance === null) mb += 1;
    else bal += toCents(d.balance);
    if (d.basis === "estimate" && (d.monthlyPayment !== null || d.balance !== null)) est = true;
  }
  return { monthlyPaymentCents: pay, balanceCents: bal, missingPayments: mp, missingBalances: mb, includesEstimates: est, trackedElsewhere: tracked };
}

// ── Overlaps (surfaced, never merged) ────────────────────────────────────

const BILL_CATEGORY_TO_EXPENSE: Record<string, ExpenseCategory> = {
  Utilities: "utilities",
  Internet: "utilities",
  "Rent / Mortgage": "housing",
  "Home Maintenance": "housing",
  Insurance: "insurance",
  "Auto / Transportation": "transportation",
  Groceries: "groceries",
  Healthcare: "healthcare",
  "Education / Childcare": "childcare",
};

/** Expense categories an included recurring bill probably already covers. */
export function billExpenseOverlaps(bills: readonly Bill[]): ExpenseCategory[] {
  const out = new Set<ExpenseCategory>();
  for (const b of bills) {
    if (b.archivedAt || BILL_PERIODS_PER_YEAR[b.recurrence] === null || !b.category) continue;
    const cat = BILL_CATEGORY_TO_EXPENSE[b.category];
    if (cat) out.add(cat);
  }
  return EXPENSE_CATEGORIES.filter((c) => out.has(c));
}

// ── The plan ─────────────────────────────────────────────────────────────

/** Whether anything is known about monthly obligations: records included, debts listed, or "no debts" stated. */
export function obligationsKnown(p: Pick<FinancialProfile, "useBills" | "useAccounts" | "debts" | "noDebts">): boolean {
  return p.useBills || p.useAccounts || p.debts.length > 0 || p.noDebts;
}

export type MissingKey = "income" | "expenses" | "obligations" | "subscriptions" | "billAmounts" | "subscriptionPrices" | "debtPayments";

export type FinancialPlan = {
  income: IncomeResult;
  expenses: ExpensesResult;
  bills: SourceResult;
  accounts: SourceResult;
  subscriptions: SourceResult & { otherCurrency: number; linkedSkipped: number };
  debts: DebtsResult;
  /** Bills + Payments minimums + the user's own debt payments (subscriptions are shown separately). */
  obligationsCents: number;
  /** Everything that leaves each month, counting only what is known. */
  outflowCents: number;
  /** Income minus outflow, or null when income is unknown (never guessed). */
  availableCents: number | null;
  /** Irregular income: the same figure using the lowest month. */
  lowAvailableCents: number | null;
  /** Monthly savings the user already plans. */
  plannedSavingsCents: number;
  /** What could still be saved each month after planned savings (never negative). */
  savingsCapacityCents: number | null;
  /** Spending plus planned savings exceed income. */
  shortfall: boolean;
  /** True when anything above is based on missing or unverified figures. */
  incomplete: boolean;
  missing: MissingKey[];
  includesEstimates: boolean;
  /** Outstanding debt balances (own entries + included Payments accounts), kept apart from every monthly figure. */
  debtBalanceCents: number;
  accountBalanceCents: number;
  overlapCategories: ExpenseCategory[];
};

export type PlanInputs = {
  profile: FinancialProfile;
  bills: readonly Bill[];
  accounts: readonly PaymentAccount[];
  subscriptions: readonly Subscription[];
  todayISO: string;
};

export function buildPlan({ profile, bills, accounts, subscriptions, todayISO }: PlanInputs): FinancialPlan {
  const income = monthlyIncome(profile);
  const billsSrc = summarizeBillsSource(bills, profile.useBills);
  const accountsSrc = summarizeAccountsSource(accounts, profile.useAccounts);
  const activeBillIds = new Set(bills.filter((b) => !b.archivedAt && BILL_PERIODS_PER_YEAR[b.recurrence] !== null).map((b) => b.id));
  const subsSrc = summarizeSubscriptionsSource(subscriptions, profile.useSubscriptions, profile.useBills, activeBillIds, todayISO);
  const expenses = summarizeExpenses(profile.expenses, profile.useBills);
  const debts = summarizeDebts(profile.debts, accounts, profile.useAccounts);

  const obligations = billsSrc.monthlyCents + accountsSrc.monthlyCents + debts.monthlyPaymentCents;
  const outflow = obligations + subsSrc.monthlyCents + expenses.totalCents;
  const available = income.monthlyCents === null ? null : income.monthlyCents - outflow;
  const lowAvailable = income.lowCents === null ? null : income.lowCents - outflow;
  const planned = cents(profile.savingsMonthly) ?? 0;

  const missing: MissingKey[] = [];
  if (income.monthlyCents === null) missing.push("income");
  if (expenses.missing.length > 0) missing.push("expenses");
  // Obligations are unknown (not zero) until the user either lets the plan read Bills / Payments or says what they owe.
  if (!obligationsKnown(profile)) missing.push("obligations");
  if (!profile.useSubscriptions) missing.push("subscriptions");
  if (billsSrc.missingCount > 0) missing.push("billAmounts");
  if (subsSrc.missingCount > 0) missing.push("subscriptionPrices");
  if (debts.missingPayments > 0) missing.push("debtPayments");

  const accountBalance = profile.useAccounts ? accounts.reduce((sum, a) => sum + toCents(a.balance), 0) : 0;
  const afterSavings = available === null ? null : available - planned;

  return {
    income,
    expenses,
    bills: billsSrc,
    accounts: accountsSrc,
    subscriptions: subsSrc,
    debts,
    obligationsCents: obligations,
    outflowCents: outflow,
    availableCents: available,
    lowAvailableCents: lowAvailable,
    plannedSavingsCents: planned,
    savingsCapacityCents: afterSavings === null ? null : Math.max(0, afterSavings),
    shortfall: afterSavings !== null && afterSavings < 0,
    incomplete: missing.length > 0 || subsSrc.otherCurrency > 0,
    missing,
    includesEstimates:
      (income.monthlyCents !== null && income.basis === "estimate") ||
      expenses.includesEstimates ||
      billsSrc.includesEstimates ||
      debts.includesEstimates ||
      (planned > 0 && profile.savingsBasis === "estimate"),
    debtBalanceCents: debts.balanceCents + accountBalance,
    accountBalanceCents: accountBalance,
    overlapCategories: profile.useBills ? billExpenseOverlaps(bills) : [],
  };
}

// ── Completion ───────────────────────────────────────────────────────────

export type StepStatus = "complete" | "partial" | "skipped" | "todo";

/**
 * A partner's profile has no household-size answer (that is a household-level answer, added in a later phase), so
 * for a partner "Location" is complete once a country or region is given. Everything else is identical.
 */
export function stepStatus(p: FinancialProfile, step: PlannerStep, person: "me" | "partner" = "me"): StepStatus {
  let complete = false;
  let partial = false;
  switch (step) {
    case 1: {
      const i = monthlyIncome(p);
      complete = i.monthlyCents !== null;
      partial = !complete && p.payFrequency !== null;
      break;
    }
    case 2:
      if (person === "partner") {
        complete = p.country !== null || p.region !== null;
      } else {
        complete = p.adults !== null;
        partial = !complete && (p.country !== null || p.region !== null || p.dependents !== null);
      }
      break;
    case 3: {
      const n = Object.keys(p.expenses).length;
      complete = n === EXPENSE_CATEGORIES.length;
      partial = n > 0 && !complete;
      break;
    }
    case 4:
      complete = p.noDebts || p.debts.length > 0;
      partial = !complete && (p.savingsBalance !== null || p.savingsMonthly !== null);
      break;
    case 5:
      complete = p.goals.length > 0;
      break;
  }
  if (complete) return "complete";
  if (partial) return "partial";
  return p.skippedSteps.includes(step) ? "skipped" : "todo";
}

export type Completion = { statuses: Record<PlannerStep, StepStatus>; completeCount: number; percent: number; nextStep: PlannerStep | null };

export function profileCompletion(p: FinancialProfile, person: "me" | "partner" = "me"): Completion {
  const statuses = {} as Record<PlannerStep, StepStatus>;
  let done = 0;
  for (const s of PLANNER_STEPS) {
    statuses[s] = stepStatus(p, s, person);
    if (statuses[s] === "complete") done += 1;
  }
  const next = PLANNER_STEPS.find((s) => statuses[s] === "todo" || statuses[s] === "partial") ?? null;
  return { statuses, completeCount: done, percent: Math.round((done / PLANNER_STEPS.length) * 100), nextStep: next };
}

// ── Validation (each step parses its own form strings) ───────────────────

export type MoneyFieldError = "invalid" | "precision" | "negative" | "range";

/** Blank -> null (not provided); otherwise a valid non-negative amount with at most 2 decimals. */
export function optionalMoney(raw: string): { ok: true; value: number | null } | { ok: false; error: MoneyFieldError } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  const r = parseMoney(t);
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
}

export type StepError<F extends string = string> = { field: F; code: MoneyFieldError | "required" | "tooLong" | "frequency" | "lowAboveTypical" | "integer" | "numRange" | "date" | "tooMany" };

type Parsed<P, F extends string = string> = { ok: true; patch: P } | { ok: false; errors: StepError<F>[] };

export type IncomeValues = { frequency: PayFrequency | ""; takeHome: string; typical: string; low: string; basis: Basis };

/**
 * With { required: true } (what Next and Save & Exit use) a pay frequency and the take-home amount (per paycheck, or a
 * typical month for irregular income) must be given. Without it, blanks are allowed (nothing is invented; they stay
 * unknown). Skip for now never calls this.
 */
export function parseIncomeStep(
  v: IncomeValues,
  opts: { required?: boolean } = {}
): Parsed<Pick<FinancialProfile, "payFrequency" | "takeHome" | "incomeTypical" | "incomeLow" | "incomeBasis">> {
  const errors: StepError[] = [];
  const takeHome = optionalMoney(v.takeHome);
  const typical = optionalMoney(v.typical);
  const low = optionalMoney(v.low);
  const irregular = v.frequency === "irregular";
  if (!v.frequency) {
    if (opts.required) errors.push({ field: "frequency", code: "required" });
    else if ((v.takeHome.trim() || v.typical.trim() || v.low.trim()) !== "") errors.push({ field: "frequency", code: "frequency" });
  } else if (irregular) {
    if (opts.required && typical.ok && typical.value === null) errors.push({ field: "typical", code: "required" });
    if (!typical.ok) errors.push({ field: "typical", code: typical.error });
    if (!low.ok) errors.push({ field: "low", code: low.error });
    if (typical.ok && low.ok && typical.value !== null && low.value !== null && low.value > typical.value) errors.push({ field: "low", code: "lowAboveTypical" });
  } else if (!takeHome.ok) {
    errors.push({ field: "takeHome", code: takeHome.error });
  } else if (opts.required && takeHome.value === null) {
    errors.push({ field: "takeHome", code: "required" });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    patch: {
      payFrequency: v.frequency || null,
      takeHome: !irregular && takeHome.ok ? takeHome.value : null,
      incomeTypical: irregular && typical.ok ? typical.value : null,
      incomeLow: irregular && low.ok ? low.value : null,
      incomeBasis: v.basis,
    },
  };
}

export type HouseholdValues = { country: string; region: string; adults: string; dependents: string };

function optionalInt(raw: string, min: number, max: number): { ok: true; value: number | null } | { ok: false; code: "integer" | "numRange" } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false, code: "integer" };
  const n = Number(t);
  return n < min || n > max ? { ok: false, code: "numRange" } : { ok: true, value: n };
}

export function parseHouseholdStep(v: HouseholdValues): Parsed<Pick<FinancialProfile, "country" | "region" | "adults" | "dependents">> {
  const errors: StepError[] = [];
  const country = v.country.trim();
  const region = v.region.trim();
  if (country.length > MAX_PLACE) errors.push({ field: "country", code: "tooLong" });
  if (region.length > MAX_PLACE) errors.push({ field: "region", code: "tooLong" });
  const adults = optionalInt(v.adults, 1, MAX_ADULTS);
  const deps = optionalInt(v.dependents, 0, MAX_DEPENDENTS);
  if (!adults.ok) errors.push({ field: "adults", code: adults.code });
  if (!deps.ok) errors.push({ field: "dependents", code: deps.code });
  if (errors.length > 0 || !adults.ok || !deps.ok) return { ok: false, errors };
  return { ok: true, patch: { country: country || null, region: region || null, adults: adults.value, dependents: deps.value } };
}

export type ExpenseValues = Record<ExpenseCategory, { amount: string; basis: Basis; covered: boolean }>;

export function parseExpensesStep(v: ExpenseValues): Parsed<Pick<FinancialProfile, "expenses">> {
  const errors: StepError[] = [];
  const expenses: FinancialProfile["expenses"] = {};
  for (const cat of EXPENSE_CATEGORIES) {
    const row = v[cat];
    const m = optionalMoney(row.amount);
    if (!m.ok) errors.push({ field: cat, code: m.error });
    else if (m.value !== null) expenses[cat] = { amount: m.value, basis: row.basis, ...(row.covered ? { covered: true } : {}) };
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch: { expenses } };
}

export type DebtValues = { id: string; name: string; balance: string; payment: string; basis: Basis; accountId: string };
export type DebtsStepValues = { noDebts: boolean; debts: DebtValues[]; savingsBalance: string; savingsMonthly: string; savingsBasis: Basis };

export function parseDebtsStep(v: DebtsStepValues): Parsed<Pick<FinancialProfile, "debts" | "noDebts" | "savingsBalance" | "savingsMonthly" | "savingsBasis">> {
  const errors: StepError[] = [];
  const debts: DebtEntry[] = [];
  if (!v.noDebts) {
    if (v.debts.length > MAX_DEBTS) errors.push({ field: "debts", code: "tooMany" });
    v.debts.forEach((d, i) => {
      const name = d.name.trim();
      if (!name) errors.push({ field: `debt${i}.name`, code: "required" });
      else if (name.length > MAX_NAME) errors.push({ field: `debt${i}.name`, code: "tooLong" });
      const bal = optionalMoney(d.balance);
      const pay = optionalMoney(d.payment);
      if (!bal.ok) errors.push({ field: `debt${i}.balance`, code: bal.error });
      if (!pay.ok) errors.push({ field: `debt${i}.payment`, code: pay.error });
      if (name && bal.ok && pay.ok) debts.push({ id: d.id, name, balance: bal.value, monthlyPayment: pay.value, basis: d.basis, accountId: d.accountId || null });
    });
  }
  const sb = optionalMoney(v.savingsBalance);
  const sm = optionalMoney(v.savingsMonthly);
  if (!sb.ok) errors.push({ field: "savingsBalance", code: sb.error });
  if (!sm.ok) errors.push({ field: "savingsMonthly", code: sm.error });
  if (errors.length > 0 || !sb.ok || !sm.ok) return { ok: false, errors };
  return { ok: true, patch: { debts, noDebts: v.noDebts, savingsBalance: sb.value, savingsMonthly: sm.value, savingsBasis: v.savingsBasis } };
}

export type GoalValues = { id: string; name: string; targetAmount: string; targetDate: string };

export function parseGoalsStep(goals: GoalValues[]): Parsed<Pick<FinancialProfile, "goals">> {
  const errors: StepError[] = [];
  const out: GoalEntry[] = [];
  if (goals.length > MAX_GOALS) errors.push({ field: "goals", code: "tooMany" });
  goals.forEach((g, i) => {
    const name = g.name.trim();
    if (!name) errors.push({ field: `goal${i}.name`, code: "required" });
    else if (name.length > MAX_NAME) errors.push({ field: `goal${i}.name`, code: "tooLong" });
    const amt = optionalMoney(g.targetAmount);
    if (!amt.ok) errors.push({ field: `goal${i}.amount`, code: amt.error });
    const date = g.targetDate.trim();
    if (date !== "" && !isValidISODate(date)) errors.push({ field: `goal${i}.date`, code: "date" });
    if (name && amt.ok && (date === "" || isValidISODate(date))) out.push({ id: g.id, name, targetAmount: amt.value, targetDate: date || null });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch: { goals: out } };
}

// ── Formatting helpers for form defaults ─────────────────────────────────

export const moneyText = (n: number | null): string => (n === null ? "" : String(n));


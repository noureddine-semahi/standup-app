// Household Phase 2, Step 1: the pure household accounting module. No I/O, no UI, no database.
//
// It COMBINES results that the Planner already computes (buildPlan for each person) with the household's shared
// costs, joint debts and shared goals. Nothing here changes how a personal plan is calculated, and nothing in its
// inputs is ever modified, deleted or merged (reconciliation only decides what is COUNTED, in memory).
//
// Decisions applied in this revision:
//  - A shared cost linked to a counted Finances record: the record stays authoritative. Contributions entered on it are
//    kept as INFORMATIONAL only (never in the ledger or totals) until record assignments exist (Phase 3).
//  - Responsibility is three-way: assigned to included members | assigned to an excluded partner | not yet assigned.
//    Unassigned amounts are never silently attributed to anyone (in particular never to Me).
//  - A definitive available figure exists only when nothing required is missing. Anything else is a PROVISIONAL figure
//    that lists the assumptions it rests on.
//  - A linked personal row can SUGGEST a contribution; nothing applies it except an explicit applyContributionSuggestion.
//  - Me is always included. All money is USD.
//
// Principles (each one is enforced by tests and by accountingInvariantViolations):
//  - Money is integer cents. A blank is UNKNOWN, never $0. Every total reports "complete" | "partial" | "unknown";
//    only a complete total has a value (`cents`), a partial one exposes just what is known (`knownCents`).
//  - Total household spending is kept apart from spending funded by INCLUDED members. Excluding a partner removes
//    their income and personal costs, but never an actual shared cost: a shared cost the excluded partner pays for
//    stays in the household total and is shown as externally funded.
//  - Nothing is split 50/50. Who pays is only what was stated; the rest is "not yet assigned" (and still counted).
//  - The same cost is never counted twice: a cost represented in a Finances record, a personal profile row and/or a
//    shared entry is counted once, only through an explicit link, and only when the representation that wins is
//    really counted. Possible overlaps WITHOUT a link are reported as issues and change nothing.
//  - Finances records (Bills, Payments, Subscriptions) stay attributed to Me until record assignments exist (Phase 3).

import { toCents, type Bill } from "@/lib/bills";
import {
  BILL_PERIODS_PER_YEAR,
  EXPENSE_CATEGORIES,
  billExpenseOverlaps,
  buildPlan,
  type Basis,
  type ExpenseCategory,
  type FinancialPlan,
  type FinancialProfile,
} from "@/lib/financialPlanner";
import { BASE_CURRENCY, effectiveStatus, monthlyCents, type Subscription } from "@/lib/subscriptions";
import type { PaymentAccount } from "@/lib/supabase/db";

export type Person = "me" | "partner";
/** The household is USD only (a subscription in another currency is never counted, as in the personal plan). */
export const HOUSEHOLD_CURRENCY = BASE_CURRENCY;
export type Status = "complete" | "partial" | "unknown";

export type MissingItem = { scope: Person | "shared" | "household"; key: string };

/** A household total. Only a complete total has `cents`; a partial one exposes what is known as `knownCents`. */
export type Total = {
  status: Status;
  cents: number | null;
  /** The sum of every component that IS known (0 when nothing is). Never a stand-in for an unknown. */
  knownCents: number;
  includesEstimates: boolean;
  missing: MissingItem[];
};

const total = (knownCents: number, status: Status, missing: MissingItem[], includesEstimates = false): Total => ({
  status,
  cents: status === "complete" ? knownCents : null,
  knownCents,
  includesEstimates,
  missing,
});

// ── Input types ──────────────────────────────────────────────────────────

/** Explicit dollar amounts each person pays toward one shared item. null = not stated (never assumed). */
export type Contributions = { me: number | null; partner: number | null };

export type RecordLink = { kind: "bill"; id: string } | { kind: "subscription"; id: string } | { kind: "account"; id: string };
export type PersonalExpenseLink = { kind: "personalExpense"; person: Person; category: ExpenseCategory };
export type PersonalDebtLink = { kind: "personalDebt"; person: Person; debtId: string };

export type SharedExpense = {
  id: string;
  category: ExpenseCategory;
  label: string;
  /** The FULL monthly household cost, in dollars. */
  amount: number;
  basis: Basis;
  contributions: Contributions;
  /** Explicit reconciliation: other places this same cost is already represented. */
  links: (RecordLink | PersonalExpenseLink)[];
};

export type SharedDebt = {
  id: string;
  name: string;
  balance: number | null;
  monthlyPayment: number | null;
  basis: Basis;
  contributions: Contributions;
  links: (Extract<RecordLink, { kind: "account" }> | PersonalDebtLink)[];
};

export type SharedGoal = {
  id: string;
  name: string;
  targetAmount: number | null;
  targetDate: string | null;
  savedAmount: number | null;
  /** Planned MONTHLY contribution from each person. */
  contributions: Contributions;
  /** The user says this contribution is already part of that person's monthly savings (so it is not counted twice). */
  countedInSavings: { me: boolean; partner: boolean };
};

export type SharedHousehold = {
  expenses: SharedExpense[];
  /** The user has said there are no shared household costs (so an empty list is an answer, not a gap). */
  noSharedExpenses: boolean;
  debts: SharedDebt[];
  noSharedDebts: boolean;
  goals: SharedGoal[];
};

export const emptyShared = (): SharedHousehold => ({ expenses: [], noSharedExpenses: false, debts: [], noSharedDebts: false, goals: [] });

export type Composition = { adults: number | null; children: number | null; otherMembers: number | null };
export const emptyComposition = (): Composition => ({ adults: null, children: null, otherMembers: null });

export type HouseholdInputs = {
  me: { profile: FinancialProfile };
  /** `included: false` removes the partner's income and personal costs from the totals (never shared costs). */
  partner: { profile: FinancialProfile; name: string; included: boolean } | null;
  shared: SharedHousehold;
  composition: Composition;
  /** The signed-in user's Finances records. They are counted once, and attributed to Me. */
  records: { bills: readonly Bill[]; accounts: readonly PaymentAccount[]; subscriptions: readonly Subscription[] };
  todayISO: string;
};

// ── Output types ─────────────────────────────────────────────────────────

export type IssueCode =
  | "partnerIncomeUnknown"
  | "meIncomeUnknown"
  | "sharedCostsUnanswered"
  | "sharedDebtsUnanswered"
  | "payerNotSet"
  | "contributionsInvalid"
  | "contributionsInformationalOnLinked"
  | "unassignedWithExcludedPartner"
  | "linkInactive"
  | "linkTargetMissing"
  | "duplicateLink"
  | "possibleSharedPersonalOverlap"
  | "possibleBillOverlap"
  | "possibleSubscriptionOverlap"
  | "possibleDuplicateJointDebt"
  | "partnerExcludedFundsSharedCosts"
  | "compositionAdultsBelowEarners"
  | "invalidAmount";

export type Issue = {
  code: IssueCode;
  severity: "info" | "warning";
  /** The shared item, goal, person or record it is about. */
  ref?: string;
  person?: Person;
  cents?: number;
  reason?: string;
  /** A related record id (e.g. the subscription a shared cost probably duplicates). */
  related?: string;
};

export type ContributionStatus = "assigned" | "partial" | "unassigned" | "invalid";

export type Allocation = { meCents: number; partnerCents: number; unassignedCents: number; status: ContributionStatus };

/**
 * A SUGGESTED contribution derived from a linked personal row (what that person already spends on this cost). It is
 * never applied automatically: it only exists in the result, and changes nothing until applyContributionSuggestion
 * is called with the user's confirmation.
 */
export type ContributionSuggestion = {
  person: Person;
  /** The suggested contribution, capped at what is still unassigned on the item. */
  cents: number;
  /** The linked personal row's own amount. */
  sourceCents: number;
  capped: boolean;
  source: "linkedPersonalRow";
};

export type SharedItemResult = {
  id: string;
  kind: "expense" | "debtPayment";
  label: string;
  /** The amount that was entered for the item, whether or not it is counted here. */
  enteredCents: number;
  /**
   * Contributions entered on an item that is represented by a counted Finances record. Shown for information only:
   * they never enter the ledger, the allocation or any total until Phase 3 record assignments.
   */
  informational: { meCents: number; partnerCents: number } | null;
  /** Suggestions only; never part of the allocation. */
  suggestions: ContributionSuggestion[];
  /** The full monthly cost of the item (0 and uncounted when it is represented elsewhere). */
  totalCents: number;
  /** false when this cost is already counted elsewhere (see excludedReason). */
  counted: boolean;
  /** The Finances record that represents this cost, when that is why it is not counted here. */
  representedBy: RecordLink | null;
  /**
   * "record": a counted Finances record represents it. "personalRowViaFinances": it is linked to a personal row that is
   * itself already counted through Bills / a Payments account, so counting it again would double it.
   */
  excludedReason: "record" | "personalRowViaFinances" | null;
  allocation: Allocation;
  includesEstimates: boolean;
};

export type LinkResult = {
  itemId: string;
  link: RecordLink | PersonalExpenseLink | PersonalDebtLink;
  active: boolean;
  /** Why an inactive link does nothing (the cost is then counted in full). */
  reason?: "missing" | "notIncluded" | "noAmount" | "duplicate";
};

export type PersonView = {
  person: Person;
  included: boolean;
  income: { status: Status; monthlyCents: number | null; lowCents: number | null; irregular: boolean; estimate: boolean };
  /** The person's own plan outflow, before reconciliation. */
  planOutflowCents: number;
  /** Personal rows that a shared cost or joint debt already represents (excluded from the household totals only). */
  reconciledAwayCents: number;
  /** The person's own spending as the household counts it (after reconciliation). */
  personalSpendingCents: number;
  spendingStatus: Status;
  plan: FinancialPlan;
};

export type LedgerRow = {
  person: Person;
  included: boolean;
  incomeCents: number | null;
  personalSpendingCents: number;
  contributionsCents: number;
  /** income - personal - contributions; null when the income is unknown or the person is outside the totals. */
  remainingCents: number | null;
};

/**
 * The timing assumption behind a goal's "required per month", exposed so the UI can state it:
 * months are CALENDAR months counted from today's month to the target date's month, and a target later in the
 * current month counts as 1 month. It is not a count of 30-day periods and ignores the day of the month otherwise.
 */
export const GOAL_TIMING_RULE = "calendarMonths" as const;
export type GoalTiming = { rule: typeof GOAL_TIMING_RULE; fromMonth: string; toMonth: string; monthsLeft: number; laterDayThisMonthCountsAsOne: boolean };

export type GoalStatus = "noTarget" | "noDate" | "achieved" | "pastDue" | "noContributions" | "onTrack" | "short";
export type GoalResult = {
  id: string;
  name: string;
  status: GoalStatus;
  /** Monthly amount needed to reach the target by the date (only when both are known). */
  requiredMonthlyCents: number | null;
  plannedMonthlyCents: number;
  shortByMonthlyCents: number | null;
  monthsLeft: number | null;
  /** The month counting behind monthsLeft (null when there is no future target date to count to). */
  timing: GoalTiming | null;
};

export type ProvisionalAssumption = "incomeIncomplete" | "spendingIncomplete" | "unassignedCoveredByHouseholdIncome";
/** A figure that must be shown as provisional, together with every assumption it rests on. */
export type ProvisionalAvailable = { cents: number; assumptions: ProvisionalAssumption[] };

export type HouseholdPlan = {
  hasPartner: boolean;
  partnerIncluded: boolean;
  me: PersonView;
  partner: PersonView | null;

  income: Total & { lowCents: number | null };
  spending: {
    /** Every actual household cost, whoever funds it, partner excluded or not. */
    totalHousehold: Total;
    /**
     * Responsibility, in three parts that add up to the total (never merged):
     *  - assigned to INCLUDED members: their own personal spending plus the contributions they stated;
     *  - assigned to an EXCLUDED partner: what that partner stated they pay toward shared costs and joint debts;
     *  - NOT YET ASSIGNED: the part of shared items nobody was stated to pay (never attributed to Me).
     */
    assignedToIncluded: Total;
    assignedToExcludedPartnerCents: number;
    unassignedCents: number;
    components: { mePersonalCents: number; partnerPersonalCents: number; sharedCostsCents: number; jointDebtPaymentsCents: number };
  };
  /**
   * Pooled income minus the included members' responsibility and the not-yet-assigned amount. DEFINITIVE (a value in
   * `cents`) only when income and spending are complete and, with an excluded partner, nothing is left unassigned.
   * Otherwise `cents` is null and `provisional` carries a clearly labeled estimate (or null if nothing can be computed).
   */
  available: Total & { provisional: ProvisionalAvailable | null };
  shortfall: "definite" | "none" | "unknown";

  savings: { plannedCents: number; goalContributionsCents: number; capacityCents: number | null; shortfallAfterSavings: boolean };
  debtBalances: { jointCents: number; personalCents: number; totalCents: number; missingJointBalances: number };

  sharedItems: SharedItemResult[];
  links: LinkResult[];
  ledger: { me: LedgerRow; partner: LedgerRow | null; unassignedCents: number };
  goals: GoalResult[];
  composition: { adults: number | null; children: number | null; otherMembers: number | null; size: { status: Status; total: number | null; knownTotal: number } };
  issues: Issue[];
};

// ── Small helpers ────────────────────────────────────────────────────────

const cents = (n: number | null | undefined): number | null => (n === null || n === undefined ? null : toCents(n));
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Exact match for short names; a substring match only when BOTH are at least 5 characters (avoids "tv" or "gas" noise). */
const contains = (a: string, b: string) => (a.length >= 3 && a === b) || (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)));
const isMoney = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * Splits one item's total by the contributions the user STATED. Nothing is assumed: an item with no stated payer is
 * entirely "not yet assigned", and contributions that exceed the total are invalid (treated as not stated).
 */
export function allocate(totalCents: number, c: Contributions): Allocation {
  const stated = c.me !== null || c.partner !== null;
  const me = cents(c.me);
  const pt = cents(c.partner);
  const bad = [c.me, c.partner].some((v) => v !== null && !isMoney(v));
  if (bad) return { meCents: 0, partnerCents: 0, unassignedCents: totalCents, status: "invalid" };
  const sum = (me ?? 0) + (pt ?? 0);
  if (sum > totalCents) return { meCents: 0, partnerCents: 0, unassignedCents: totalCents, status: "invalid" };
  // A $0 item has nothing to assign, so it is fully assigned even though no payer was stated.
  const status: ContributionStatus = !stated ? (totalCents === 0 ? "assigned" : "unassigned") : sum === totalCents ? "assigned" : "partial";
  return { meCents: me ?? 0, partnerCents: pt ?? 0, unassignedCents: totalCents - sum, status };
}

export type ContributionError = "invalid" | "overAssigned";
/** Validation for a form (dollars): amounts must be >= 0 with at most 2 decimals, and together must not exceed the total. */
export function contributionError(totalDollars: number, c: Contributions): ContributionError | null {
  for (const v of [c.me, c.partner]) {
    if (v === null) continue;
    if (!isMoney(v) || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return "invalid";
  }
  return (cents(c.me) ?? 0) + (cents(c.partner) ?? 0) > toCents(totalDollars) ? "overAssigned" : null;
}

/**
 * Returns NEW contributions with the suggestion applied. Call this only after the user confirms. It never overwrites a
 * contribution that has since been entered for that person, and it never mutates its input.
 */
export function applyContributionSuggestion(c: Contributions, s: ContributionSuggestion): Contributions {
  if (c[s.person] !== null) return { ...c };
  return { ...c, [s.person]: s.cents / 100 };
}

// ── Goals ────────────────────────────────────────────────────────────────

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/** Calendar months from today's month to the target's month (a later day this month counts as 1); 0 when not in the future. */
export function monthsUntil(todayISO: string, targetISO: string): number {
  if (targetISO <= todayISO) return 0;
  return Math.max(1, monthIndex(targetISO) - monthIndex(todayISO));
}

export function goalTiming(todayISO: string, targetISO: string): GoalTiming {
  const monthsLeft = monthsUntil(todayISO, targetISO);
  return { rule: GOAL_TIMING_RULE, fromMonth: todayISO.slice(0, 7), toMonth: targetISO.slice(0, 7), monthsLeft, laterDayThisMonthCountsAsOne: monthsLeft === 1 && todayISO.slice(0, 7) === targetISO.slice(0, 7) };
}

export function goalProgress(g: SharedGoal, todayISO: string, plannedMonthlyCents: number): GoalResult {
  const base = { id: g.id, name: g.name, plannedMonthlyCents, requiredMonthlyCents: null as number | null, shortByMonthlyCents: null as number | null, monthsLeft: null as number | null, timing: null as GoalTiming | null };
  const target = cents(g.targetAmount);
  if (target === null) return { ...base, status: "noTarget" };
  const saved = cents(g.savedAmount) ?? 0;
  if (saved >= target) return { ...base, status: "achieved" };
  if (!g.targetDate) return { ...base, status: "noDate" };
  const months = monthsUntil(todayISO, g.targetDate);
  if (months === 0) return { ...base, status: "pastDue", monthsLeft: 0, timing: goalTiming(todayISO, g.targetDate) };
  const required = Math.ceil((target - saved) / months);
  const out = { ...base, requiredMonthlyCents: required, monthsLeft: months, timing: goalTiming(todayISO, g.targetDate) };
  if (plannedMonthlyCents <= 0) return { ...out, status: "noContributions", shortByMonthlyCents: required };
  return plannedMonthlyCents >= required ? { ...out, status: "onTrack", shortByMonthlyCents: 0 } : { ...out, status: "short", shortByMonthlyCents: required - plannedMonthlyCents };
}

// ── Composition ──────────────────────────────────────────────────────────

export type CompositionError = "range" | "integer";
export const COMPOSITION_LIMITS = { adults: [1, 10], children: [0, 15], otherMembers: [0, 15] } as const;

export function compositionErrors(c: Composition): Partial<Record<keyof Composition, CompositionError>> {
  const out: Partial<Record<keyof Composition, CompositionError>> = {};
  for (const k of ["adults", "children", "otherMembers"] as const) {
    const v = c[k];
    if (v === null) continue;
    if (!Number.isInteger(v)) out[k] = "integer";
    else if (v < COMPOSITION_LIMITS[k][0] || v > COMPOSITION_LIMITS[k][1]) out[k] = "range";
  }
  return out;
}

/** Household SIZE (people who live there). This is deliberately not tax-dependent eligibility. */
export function householdSize(c: Composition): { status: Status; total: number | null; knownTotal: number } {
  const parts = [c.adults, c.children, c.otherMembers];
  const known = parts.filter((p): p is number => p !== null);
  const knownTotal = known.reduce((a, b) => a + b, 0);
  const status: Status = known.length === 0 ? "unknown" : known.length === parts.length ? "complete" : "partial";
  return { status, total: status === "complete" ? knownTotal : null, knownTotal };
}

// ── The household plan ───────────────────────────────────────────────────

type Counted = { bills: Set<string>; subs: Set<string>; accounts: Set<string>; allBillIds: Set<string>; allSubIds: Set<string>; allAccountIds: Set<string> };

function countedRecords(me: FinancialProfile, r: HouseholdInputs["records"], todayISO: string): Counted {
  const recurring = (b: Bill) => !b.archivedAt && BILL_PERIODS_PER_YEAR[b.recurrence] !== null;
  const activeBillIds = new Set(r.bills.filter(recurring).map((b) => b.id));
  const bills = new Set(me.useBills ? r.bills.filter((b) => recurring(b) && b.expectedAmount !== null).map((b) => b.id) : []);
  const subs = new Set(
    me.useSubscriptions
      ? r.subscriptions
          .filter((s) => effectiveStatus(s, todayISO).status === "active" && s.currency === BASE_CURRENCY && monthlyCents(s) !== null)
          .filter((s) => !(me.useBills && s.billId && activeBillIds.has(s.billId)))
          .map((s) => s.id)
      : []
  );
  return {
    bills,
    subs,
    accounts: new Set(me.useAccounts ? r.accounts.map((a) => a.id) : []),
    allBillIds: new Set(r.bills.filter(recurring).map((b) => b.id)),
    allSubIds: new Set(r.subscriptions.map((s) => s.id)),
    allAccountIds: new Set(r.accounts.map((a) => a.id)),
  };
}

type LinkState = { active: boolean; reason?: LinkResult["reason"] };

function recordLinkState(link: RecordLink, me: FinancialProfile, r: HouseholdInputs["records"], c: Counted): LinkState {
  switch (link.kind) {
    case "bill": {
      if (!c.allBillIds.has(link.id)) return { active: false, reason: "missing" };
      if (!me.useBills) return { active: false, reason: "notIncluded" };
      return c.bills.has(link.id) ? { active: true } : { active: false, reason: "noAmount" };
    }
    case "subscription": {
      const sub = r.subscriptions.find((s) => s.id === link.id);
      if (!sub) return { active: false, reason: "missing" };
      if (!me.useSubscriptions) return { active: false, reason: "notIncluded" };
      // Counted directly, or counted through the bill it is linked to (the Phase 1 rule).
      if (c.subs.has(sub.id) || (me.useBills && !!sub.billId && c.bills.has(sub.billId))) return { active: true };
      return { active: false, reason: "noAmount" };
    }
    case "account": {
      if (!c.allAccountIds.has(link.id)) return { active: false, reason: "missing" };
      return me.useAccounts ? { active: true } : { active: false, reason: "notIncluded" };
    }
  }
}

function personalExpenseRow(p: FinancialProfile, category: ExpenseCategory): { cents: number; viaFinances: boolean } | null {
  const e = p.expenses[category];
  if (!e) return null;
  // Phase 1 rule: a row marked "already in my Bills" is not counted while Bills are included.
  const viaFinances = !!e.covered && p.useBills;
  return { cents: viaFinances ? 0 : toCents(e.amount), viaFinances };
}

function personalDebtRow(p: FinancialProfile, accounts: readonly PaymentAccount[], debtId: string): { payment: number; balance: number; viaFinances: boolean } | null {
  const d = p.debts.find((x) => x.id === debtId);
  if (!d) return null;
  // Phase 1 rule: a debt tied to an included Payments account is counted there, not here.
  const viaFinances = p.useAccounts && !!d.accountId && accounts.some((a) => a.id === d.accountId);
  return viaFinances ? { payment: 0, balance: 0, viaFinances } : { payment: cents(d.monthlyPayment) ?? 0, balance: cents(d.balance) ?? 0, viaFinances };
}

function incomeView(plan: FinancialPlan) {
  const i = plan.income;
  return { status: (i.monthlyCents === null ? "unknown" : "complete") as Status, monthlyCents: i.monthlyCents, lowCents: i.irregular ? i.lowCents : i.monthlyCents, irregular: i.irregular, estimate: i.basis === "estimate" };
}

function spendingStatusOf(plan: FinancialPlan): Status {
  // Income is its own unknown (reported under income); it must not make the person's SPENDING look incomplete.
  const spendingGap = plan.missing.some((k) => k !== "income") || plan.subscriptions.otherCurrency > 0;
  if (!spendingGap) return "complete";
  const signals = (plan.expenses.providedCount > 0 ? 1 : 0) + (plan.missing.includes("obligations") ? 0 : 1) + (plan.missing.includes("subscriptions") ? 0 : 1);
  return signals === 0 ? "unknown" : "partial";
}

function planMissing(plan: FinancialPlan, scope: Person): MissingItem[] {
  const items = plan.missing.filter((k) => k !== "income").map((key) => ({ scope, key: key as string }));
  if (plan.subscriptions.otherCurrency > 0) items.push({ scope, key: "otherCurrencySubscriptions" });
  return items;
}

export function buildHouseholdPlan(inputs: HouseholdInputs): HouseholdPlan {
  const { me: meIn, partner: partnerIn, shared, composition, records, todayISO } = inputs;
  const issues: Issue[] = [];
  const partnerIncluded = !!partnerIn && partnerIn.included;

  // 1. Each person's own plan comes from the existing, tested calculation.
  const mePlan = buildPlan({ profile: meIn.profile, bills: records.bills, accounts: records.accounts, subscriptions: records.subscriptions, todayISO });
  // A partner has no Finances records of their own (they are the signed-in user's), so none are read for them; their
  // "subscriptions not included" gap is not a real gap, exactly as on the Partner tab.
  const partnerPlan = partnerIn
    ? buildPlan({ profile: { ...partnerIn.profile, useBills: false, useAccounts: false, useSubscriptions: true }, bills: [], accounts: [], subscriptions: [], todayISO })
    : null;
  const counted = countedRecords(meIn.profile, records, todayISO);
  const profiles: Record<Person, FinancialProfile | null> = { me: meIn.profile, partner: partnerIn ? partnerIn.profile : null };
  const adjust = { me: { expenses: 0, debts: 0, balances: 0 }, partner: { expenses: 0, debts: 0, balances: 0 } };
  const linksOut: LinkResult[] = [];
  const usedPersonalExpense = new Set<string>();
  const usedPersonalDebt = new Set<string>();
  // What each linked personal row already costs that person, per shared item (the basis of a SUGGESTED contribution).
  const rowBasis = new Map<string, Record<Person, number>>();
  const addBasis = (itemId: string, person: Person, c: number) => {
    const cur = rowBasis.get(itemId) ?? { me: 0, partner: 0 };
    cur[person] += c;
    rowBasis.set(itemId, cur);
  };

  // Resolves a personal-row link: the row is excluded from that person's household spending (never deleted).
  // Returns true when the linked personal row is itself already represented in Finances (so the shared entry is the duplicate).
  const personalExpenseLink = (itemId: string, l: PersonalExpenseLink): boolean => {
    const p = profiles[l.person];
    const row = p ? personalExpenseRow(p, l.category) : null;
    const key = `${l.person}|${l.category}`;
    if (row === null) {
      linksOut.push({ itemId, link: l, active: false, reason: "missing" });
      issues.push({ code: "linkTargetMissing", severity: "info", ref: itemId, person: l.person });
      return false;
    }
    if (usedPersonalExpense.has(key)) {
      linksOut.push({ itemId, link: l, active: false, reason: "duplicate" });
      issues.push({ code: "duplicateLink", severity: "info", ref: itemId, person: l.person });
      return false;
    }
    usedPersonalExpense.add(key);
    linksOut.push({ itemId, link: l, active: true });
    adjust[l.person].expenses += row.cents;
    addBasis(itemId, l.person, row.cents);
    return row.viaFinances;
  };
  const personalDebtLink = (itemId: string, l: PersonalDebtLink): boolean => {
    const p = profiles[l.person];
    const row = p ? personalDebtRow(p, l.person === "me" ? records.accounts : [], l.debtId) : null;
    const key = `${l.person}|${l.debtId}`;
    if (row === null) {
      linksOut.push({ itemId, link: l, active: false, reason: "missing" });
      issues.push({ code: "linkTargetMissing", severity: "info", ref: itemId, person: l.person });
      return false;
    }
    if (usedPersonalDebt.has(key)) {
      linksOut.push({ itemId, link: l, active: false, reason: "duplicate" });
      issues.push({ code: "duplicateLink", severity: "info", ref: itemId, person: l.person });
      return false;
    }
    usedPersonalDebt.add(key);
    linksOut.push({ itemId, link: l, active: true });
    adjust[l.person].debts += row.payment;
    adjust[l.person].balances += row.balance;
    addBasis(itemId, l.person, row.payment);
    return row.viaFinances;
  };

  // 2. Shared costs: reconcile, then allocate by the contributions that were stated. Without a partner there is nobody
  //    to have paid a partner share, so such a stated amount is not honoured (it stays unassigned) and is flagged.
  const effective = (id: string, c: Contributions): Contributions => {
    if (partnerIn || c.partner === null) return c;
    issues.push({ code: "contributionsInvalid", severity: "warning", ref: id, reason: "noPartner" });
    return { me: c.me, partner: null };
  };
  // Contributions on an item that a counted record already represents: kept for display only.
  const informationalOf = (id: string, entered: number, c: Contributions): SharedItemResult["informational"] => {
    const stated = c.me !== null || c.partner !== null;
    if (!stated) return null;
    const a = allocate(entered, effective(id, c));
    if (a.status === "invalid") {
      issues.push({ code: "contributionsInvalid", severity: "warning", ref: id });
      return null;
    }
    issues.push({ code: "contributionsInformationalOnLinked", severity: "info", ref: id });
    return { meCents: a.meCents, partnerCents: a.partnerCents };
  };
  // A linked personal row can suggest what a person contributes. Suggestions are only computed here, never applied.
  const suggestionsOf = (id: string, a: Allocation, c: Contributions): ContributionSuggestion[] => {
    const basis = rowBasis.get(id);
    if (!basis) return [];
    const rows = (["me", "partner"] as const)
      .filter((person) => (person === "me" || partnerIn) && c[person] === null && basis[person] > 0)
      .map((person) => ({ person, row: basis[person] }));
    const wanted = rows.reduce((x, r) => x + r.row, 0);
    const remaining = a.unassignedCents;
    if (wanted === 0 || remaining <= 0) return [];
    // Nobody is prioritized: when the rows together exceed what is unassigned, each is scaled by its own share
    // (largest remainder keeps the whole cents summing exactly to the unassigned amount).
    const capped = wanted > remaining;
    const exact = rows.map((r) => (capped ? (r.row * remaining) / wanted : r.row));
    const cents = exact.map(Math.floor);
    if (capped) {
      let left = remaining - cents.reduce((x, y) => x + y, 0);
      const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e), row: rows[i].row })).sort((p, q) => q.frac - p.frac || q.row - p.row);
      for (const o of order) {
        if (left <= 0) break;
        cents[o.i] += 1;
        left -= 1;
      }
    }
    return rows.map((r, i) => ({ person: r.person, cents: cents[i], sourceCents: r.row, capped: capped && cents[i] < r.row, source: "linkedPersonalRow" as const })).filter((x) => x.cents > 0);
  };
  const items: SharedItemResult[] = [];
  const sharedEstimate: boolean[] = [];
  for (const e of shared.expenses) {
    if (!isMoney(e.amount)) {
      issues.push({ code: "invalidAmount", severity: "warning", ref: e.id });
      continue;
    }
    const totalCents = toCents(e.amount);
    let represented: RecordLink | null = null;
    for (const l of e.links) {
      if (l.kind === "personalExpense") continue;
      const st = recordLinkState(l, meIn.profile, records, counted);
      linksOut.push({ itemId: e.id, link: l, active: st.active, reason: st.reason });
      if (st.active && !represented) represented = l;
      if (!st.active) issues.push({ code: st.reason === "missing" ? "linkTargetMissing" : "linkInactive", severity: "info", ref: e.id, reason: st.reason });
    }
    let viaCoveredRow = false;
    for (const l of e.links) if (l.kind === "personalExpense" && personalExpenseLink(e.id, l)) viaCoveredRow = true;
    const stated = e.contributions.me !== null || e.contributions.partner !== null;
    if (represented || viaCoveredRow) {
      items.push({ id: e.id, kind: "expense", label: e.label, enteredCents: totalCents, informational: stated ? informationalOf(e.id, totalCents, e.contributions) : null, suggestions: [], totalCents: 0, counted: false, representedBy: represented, excludedReason: represented ? "record" : "personalRowViaFinances", allocation: { meCents: 0, partnerCents: 0, unassignedCents: 0, status: "assigned" }, includesEstimates: false });
      continue;
    }
    const alloc = allocate(totalCents, effective(e.id, e.contributions));
    if (alloc.status === "invalid") issues.push({ code: "contributionsInvalid", severity: "warning", ref: e.id });
    else if (alloc.status === "unassigned") issues.push({ code: "payerNotSet", severity: "info", ref: e.id, cents: totalCents });
    items.push({ id: e.id, kind: "expense", label: e.label, enteredCents: totalCents, informational: null, suggestions: suggestionsOf(e.id, alloc, e.contributions), totalCents, counted: true, representedBy: null, excludedReason: null, allocation: alloc, includesEstimates: e.basis === "estimate" });
    sharedEstimate.push(e.basis === "estimate");
  }

  // 3. Joint debts: the monthly payment is a shared cost; the balance stays separate.
  let jointBalanceCents = 0;
  let missingJointBalances = 0;
  let missingJointPayments = 0;
  for (const d of shared.debts) {
    let represented: RecordLink | null = null;
    for (const l of d.links) {
      if (l.kind === "personalDebt") continue;
      const st = recordLinkState(l, meIn.profile, records, counted);
      linksOut.push({ itemId: d.id, link: l, active: st.active, reason: st.reason });
      if (st.active && !represented) represented = l;
      if (!st.active) issues.push({ code: st.reason === "missing" ? "linkTargetMissing" : "linkInactive", severity: "info", ref: d.id, reason: st.reason });
    }
    let viaTrackedDebt = false;
    for (const l of d.links) if (l.kind === "personalDebt" && personalDebtLink(d.id, l)) viaTrackedDebt = true;
    if (represented || viaTrackedDebt) {
      const entered = d.monthlyPayment !== null && isMoney(d.monthlyPayment) ? toCents(d.monthlyPayment) : 0;
      items.push({ id: d.id, kind: "debtPayment", label: d.name, enteredCents: entered, informational: informationalOf(d.id, entered, d.contributions), suggestions: [], totalCents: 0, counted: false, representedBy: represented, excludedReason: represented ? "record" : "personalRowViaFinances", allocation: { meCents: 0, partnerCents: 0, unassignedCents: 0, status: "assigned" }, includesEstimates: false });
      continue; // balance is counted through the Payments account
    }
    if (d.balance === null || !isMoney(d.balance)) missingJointBalances += 1;
    else jointBalanceCents += toCents(d.balance);
    if (d.monthlyPayment === null || !isMoney(d.monthlyPayment)) {
      missingJointPayments += 1;
      continue;
    }
    const totalCents = toCents(d.monthlyPayment);
    const alloc = allocate(totalCents, effective(d.id, d.contributions));
    if (alloc.status === "invalid") issues.push({ code: "contributionsInvalid", severity: "warning", ref: d.id });
    else if (alloc.status === "unassigned") issues.push({ code: "payerNotSet", severity: "info", ref: d.id, cents: totalCents });
    items.push({ id: d.id, kind: "debtPayment", label: d.name, enteredCents: totalCents, informational: null, suggestions: suggestionsOf(d.id, alloc, d.contributions), totalCents, counted: true, representedBy: null, excludedReason: null, allocation: alloc, includesEstimates: d.basis === "estimate" });
    sharedEstimate.push(d.basis === "estimate");
  }

  // 4. People.
  const personView = (person: Person, plan: FinancialPlan, included: boolean): PersonView => {
    const reconciledAway = adjust[person].expenses + adjust[person].debts;
    return {
      person,
      included,
      income: incomeView(plan),
      planOutflowCents: plan.outflowCents,
      reconciledAwayCents: reconciledAway,
      personalSpendingCents: plan.outflowCents - reconciledAway,
      spendingStatus: spendingStatusOf(plan),
      plan,
    };
  };
  const meView = personView("me", mePlan, true);
  const partnerView = partnerPlan ? personView("partner", partnerPlan, partnerIncluded) : null;

  // 5. Income (only included earners), with unknown kept apart from $0.
  const earners = [meView, ...(partnerView && partnerIncluded ? [partnerView] : [])];
  const known = earners.filter((p) => p.income.monthlyCents !== null);
  const incomeKnown = known.reduce((s, p) => s + (p.income.monthlyCents as number), 0);
  const incomeStatus: Status = known.length === 0 ? "unknown" : known.length === earners.length ? "complete" : "partial";
  const incomeMissing: MissingItem[] = earners.filter((p) => p.income.monthlyCents === null).map((p) => ({ scope: p.person, key: "income" }));
  for (const m of incomeMissing) issues.push({ code: m.scope === "me" ? "meIncomeUnknown" : "partnerIncomeUnknown", severity: "warning", person: m.scope as Person });
  const lows = earners.map((p) => p.income.lowCents);
  const lowCents = lows.every((l) => l !== null) ? (lows as number[]).reduce((a, b) => a + b, 0) : null;
  const income = { ...total(incomeKnown, incomeStatus, incomeMissing, known.some((p) => p.income.estimate)), lowCents };

  // 6. Spending: total household vs funded by included members.
  const sharedCostsCents = items.filter((i) => i.kind === "expense" && i.counted).reduce((s, i) => s + i.totalCents, 0);
  const jointPayCents = items.filter((i) => i.kind === "debtPayment" && i.counted).reduce((s, i) => s + i.totalCents, 0);
  const mePersonal = meView.personalSpendingCents;
  const partnerPersonal = partnerView && partnerIncluded ? partnerView.personalSpendingCents : 0;
  const totalHouseholdCents = mePersonal + partnerPersonal + sharedCostsCents + jointPayCents;
  const counts = items.filter((i) => i.counted);
  const meContrib = counts.reduce((s, i) => s + i.allocation.meCents, 0);
  const partnerContrib = counts.reduce((s, i) => s + i.allocation.partnerCents, 0);
  const unassigned = counts.reduce((s, i) => s + i.allocation.unassignedCents, 0);
  // Responsibility is three-way. An excluded partner's STATED contributions are outside the pooled income; anything
  // not yet assigned stays explicitly unassigned: it is not attributed to Me, and not assumed to be the partner's.
  const partnerExcluded = !!partnerView && !partnerIncluded;
  const assignedToExcluded = partnerExcluded ? partnerContrib : 0;
  const assignedToIncludedKnown = mePersonal + partnerPersonal + meContrib + (partnerIncluded ? partnerContrib : 0);
  if (assignedToExcluded > 0) issues.push({ code: "partnerExcludedFundsSharedCosts", severity: "info", person: "partner", cents: assignedToExcluded });
  if (partnerExcluded && unassigned > 0) issues.push({ code: "unassignedWithExcludedPartner", severity: "warning", cents: unassigned });

  const sharedExpensesStatus: Status = shared.expenses.length > 0 || shared.noSharedExpenses ? "complete" : "unknown";
  const jointStatus: Status = shared.debts.length > 0 ? (missingJointPayments > 0 ? "partial" : "complete") : shared.noSharedDebts ? "complete" : "unknown";
  if (partnerIn && sharedExpensesStatus === "unknown") issues.push({ code: "sharedCostsUnanswered", severity: "info" });
  if (partnerIn && jointStatus === "unknown") issues.push({ code: "sharedDebtsUnanswered", severity: "info" });
  const spendingParts: { status: Status; missing: MissingItem[] }[] = [
    { status: meView.spendingStatus, missing: planMissing(mePlan, "me") },
    ...(partnerView && partnerIncluded ? [{ status: partnerView.spendingStatus, missing: planMissing(partnerPlan as FinancialPlan, "partner") }] : []),
    // Shared costs only matter once there is a partner to share them with.
    ...(partnerIn ? [{ status: sharedExpensesStatus, missing: sharedExpensesStatus === "unknown" ? [{ scope: "shared" as const, key: "sharedCosts" }] : [] }] : []),
    ...(partnerIn ? [{ status: jointStatus, missing: [...(jointStatus === "unknown" ? [{ scope: "shared" as const, key: "sharedDebts" }] : []), ...(missingJointPayments > 0 ? [{ scope: "shared" as const, key: "jointDebtPayments" }] : [])] }] : []),
  ];
  const spendingStatus: Status = spendingParts.every((p) => p.status === "complete") ? "complete" : spendingParts.every((p) => p.status === "unknown") ? "unknown" : "partial";
  const spendingMissing = spendingParts.flatMap((p) => p.missing);
  const estimates = mePlan.includesEstimates || (partnerIncluded && !!partnerPlan?.includesEstimates) || sharedEstimate.some(Boolean);
  const totalHousehold = total(totalHouseholdCents, spendingStatus, spendingMissing, estimates);
  const assignedToIncluded = total(assignedToIncludedKnown, spendingStatus, spendingMissing, estimates);

  // 7. Available cash. DEFINITIVE only when income and spending are complete and, with an excluded partner, nothing is
  //    left unassigned (it could be theirs). Otherwise a PROVISIONAL figure is offered, with its assumptions listed.
  //    The not-yet-assigned amount is subtracted in the provisional figure (the cautious reading), never attributed.
  const unassignedBlocks = partnerExcluded && unassigned > 0;
  const definitive = incomeStatus === "complete" && spendingStatus === "complete" && !unassignedBlocks;
  const availCents = incomeKnown - (assignedToIncludedKnown + unassigned);
  const availStatus: Status = definitive ? "complete" : incomeStatus === "complete" ? "partial" : "unknown";
  const assumptions: ProvisionalAssumption[] = [];
  if (incomeStatus === "partial") assumptions.push("incomeIncomplete");
  if (spendingStatus !== "complete") assumptions.push("spendingIncomplete");
  if (unassignedBlocks) assumptions.push("unassignedCoveredByHouseholdIncome");
  const provisional: ProvisionalAvailable | null = definitive || incomeStatus === "unknown" ? null : { cents: availCents, assumptions };
  const availBase = total(availCents, availStatus, [...incomeMissing, ...spendingMissing], income.includesEstimates || estimates);
  const available = { ...availBase, knownCents: provisional ? provisional.cents : availStatus === "complete" ? availCents : 0, provisional };
  // A shortfall is DEFINITE when what is certainly the household's already exceeds its income (unknown costs only add).
  const certainFunded = assignedToIncludedKnown + (partnerExcluded ? 0 : unassigned);
  const shortfall: HouseholdPlan["shortfall"] = incomeStatus === "complete" ? (incomeKnown - certainFunded < 0 ? "definite" : definitive ? "none" : "unknown") : "unknown";

  // 8. Savings (planned savings are not spending, as in the personal plan) and shared goals.
  const goalResults: GoalResult[] = [];
  let goalContrib = 0;
  for (const g of shared.goals) {
    const mePart = g.contributions.me !== null && isMoney(g.contributions.me) ? toCents(g.contributions.me) : 0;
    const ptPart = g.contributions.partner !== null && isMoney(g.contributions.partner) ? toCents(g.contributions.partner) : 0;
    // The planned monthly total is what the goal gets (an excluded partner's money is still toward the goal);
    // only the INCLUDED members' share not already inside their monthly savings is added to household savings.
    goalResults.push(goalProgress(g, todayISO, mePart + ptPart));
    goalContrib += (g.countedInSavings.me ? 0 : mePart) + (partnerIncluded && !g.countedInSavings.partner ? ptPart : 0);
  }
  const plannedCents = mePlan.plannedSavingsCents + (partnerView && partnerIncluded && partnerPlan ? partnerPlan.plannedSavingsCents : 0) + goalContrib;
  const afterSavings = definitive ? availCents - plannedCents : null;

  // 9. Debt balances stay apart from every monthly figure.
  const personalBalances = mePlan.debtBalanceCents - adjust.me.balances + (partnerView && partnerIncluded && partnerPlan ? partnerPlan.debtBalanceCents - adjust.partner.balances : 0);

  // 10. Ledger: income - personal - contributions = remaining; Not-yet-assigned is kept separate.
  const ledgerRow = (v: PersonView, contrib: number): LedgerRow => ({
    person: v.person,
    included: v.included,
    incomeCents: v.included ? v.income.monthlyCents : null,
    personalSpendingCents: v.personalSpendingCents,
    contributionsCents: contrib,
    remainingCents: v.included && v.income.monthlyCents !== null ? v.income.monthlyCents - v.personalSpendingCents - contrib : null,
  });

  // 11. Possible overlaps (reported only; nothing is excluded without an explicit link).
  const linked = (id: string, person: Person, category: ExpenseCategory) => linksOut.some((l) => l.itemId === id && l.link.kind === "personalExpense" && l.link.person === person && l.link.category === category);
  const billOverlapCats = new Set(meIn.profile.useBills ? billExpenseOverlaps(records.bills) : []);
  for (const e of shared.expenses) {
    const it = items.find((i) => i.id === e.id);
    if (!it || !it.counted) continue;
    for (const p of [meView, ...(partnerView && partnerIncluded ? [partnerView] : [])]) {
      const row = personalExpenseRow(profiles[p.person] as FinancialProfile, e.category);
      if (row && row.cents > 0 && !linked(e.id, p.person, e.category)) issues.push({ code: "possibleSharedPersonalOverlap", severity: "warning", ref: e.id, person: p.person, cents: Math.min(row.cents, it.totalCents) });
    }
    if (billOverlapCats.has(e.category) && !e.links.some((l) => l.kind === "bill")) issues.push({ code: "possibleBillOverlap", severity: "warning", ref: e.id });
    // Likely subscription match by name or provider: a WARNING only. It never excludes anything; only an explicit link does.
    const label = norm(e.label);
    const match = records.subscriptions.find((s) => counted.subs.has(s.id) && (contains(norm(s.name), label) || contains(norm(s.provider), label)));
    if (match && !e.links.some((l) => l.kind === "subscription")) issues.push({ code: "possibleSubscriptionOverlap", severity: "warning", ref: e.id, related: match.id });
  }
  for (const d of shared.debts) {
    const it = items.find((i) => i.id === d.id);
    if (!it || !it.counted) continue;
    const name = norm(d.name);
    for (const p of [meView, ...(partnerView && partnerIncluded ? [partnerView] : [])]) {
      const dup = (profiles[p.person] as FinancialProfile).debts.some((x) => contains(norm(x.name), name) && !d.links.some((l) => l.kind === "personalDebt" && l.person === p.person && l.debtId === x.id));
      if (dup) issues.push({ code: "possibleDuplicateJointDebt", severity: "warning", ref: d.id, person: p.person });
    }
  }
  if (partnerIn && composition.adults !== null && composition.adults < 2) issues.push({ code: "compositionAdultsBelowEarners", severity: "info" });

  return {
    hasPartner: !!partnerIn,
    partnerIncluded,
    me: meView,
    partner: partnerView,
    income,
    spending: {
      totalHousehold,
      assignedToIncluded,
      assignedToExcludedPartnerCents: assignedToExcluded,
      unassignedCents: unassigned,
      components: { mePersonalCents: mePersonal, partnerPersonalCents: partnerPersonal, sharedCostsCents, jointDebtPaymentsCents: jointPayCents },
    },
    available,
    shortfall,
    savings: { plannedCents, goalContributionsCents: goalContrib, capacityCents: afterSavings === null ? null : Math.max(0, afterSavings), shortfallAfterSavings: afterSavings !== null && afterSavings < 0 },
    debtBalances: { jointCents: jointBalanceCents, personalCents: personalBalances, totalCents: jointBalanceCents + personalBalances, missingJointBalances },
    sharedItems: items,
    links: linksOut,
    ledger: { me: ledgerRow(meView, meContrib), partner: partnerView ? ledgerRow(partnerView, partnerContrib) : null, unassignedCents: unassigned },
    goals: goalResults,
    composition: { adults: composition.adults, children: composition.children, otherMembers: composition.otherMembers, size: householdSize(composition) },
    issues,
  };
}

// ── Accounting invariants ────────────────────────────────────────────────

/**
 * Re-checks the accounting identities that must hold for every plan. Returns a list of violations (empty = sound).
 * Used by the tests on every scenario, and available as a development-time assertion.
 */
export function accountingInvariantViolations(p: HouseholdPlan): string[] {
  const v: string[] = [];
  const s = p.spending;
  const intOk = (n: number | null) => n === null || Number.isInteger(n);
  const all: (number | null)[] = [
    p.income.cents, p.income.knownCents, s.totalHousehold.cents, s.totalHousehold.knownCents, s.assignedToIncluded.cents, s.assignedToIncluded.knownCents,
    s.assignedToExcludedPartnerCents, s.unassignedCents, p.available.cents, p.available.knownCents, p.available.provisional ? p.available.provisional.cents : null, p.ledger.unassignedCents,
    ...p.sharedItems.flatMap((i) => [i.totalCents, i.enteredCents, i.allocation.meCents, i.allocation.partnerCents, i.allocation.unassignedCents, ...i.suggestions.map((x) => x.cents), ...(i.informational ? [i.informational.meCents, i.informational.partnerCents] : [])]),
  ];
  if (!all.every(intOk)) v.push("INV-0: every amount is whole cents");

  const c = s.components;
  if (c.mePersonalCents + c.partnerPersonalCents + c.sharedCostsCents + c.jointDebtPaymentsCents !== s.totalHousehold.knownCents) v.push("INV-1: total household spending = personal + shared + joint-debt payments");
  if (s.assignedToIncluded.knownCents + s.assignedToExcludedPartnerCents + s.unassignedCents !== s.totalHousehold.knownCents) v.push("INV-2: total = assigned to included + assigned to excluded partner + not yet assigned");
  if (s.assignedToExcludedPartnerCents < 0 || s.assignedToExcludedPartnerCents > c.sharedCostsCents + c.jointDebtPaymentsCents) v.push("INV-2b: what an excluded partner is assigned is a part of the shared costs");
  if (s.unassignedCents < 0 || s.unassignedCents > c.sharedCostsCents + c.jointDebtPaymentsCents) v.push("INV-2g: not-yet-assigned is a part of the shared costs");
  if (s.unassignedCents !== p.ledger.unassignedCents) v.push("INV-2h: the ledger and the spending breakdown agree on what is not yet assigned");
  if (!p.partnerIncluded && p.partner && c.partnerPersonalCents !== 0) v.push("INV-2c: an excluded partner's personal costs are outside the totals");
  const counted = p.sharedItems.filter((i) => i.counted);
  const partnerStated = counted.reduce((x, i) => x + i.allocation.partnerCents, 0);
  const meStated = counted.reduce((x, i) => x + i.allocation.meCents, 0);
  if (!p.partnerIncluded && p.partner && s.assignedToExcludedPartnerCents !== partnerStated) v.push("INV-2d: assigned to the excluded partner equals their stated contributions");
  if ((p.partnerIncluded || !p.partner) && s.assignedToExcludedPartnerCents !== 0) v.push("INV-2e: nothing is assigned to an excluded partner while the partner is included (or absent)");
  const includedPersonal = c.mePersonalCents + c.partnerPersonalCents;
  if (s.assignedToIncluded.knownCents !== includedPersonal + meStated + (p.partnerIncluded ? partnerStated : 0)) v.push("INV-2f: assigned to included = their personal spending + their stated contributions");

  for (const i of p.sharedItems) {
    const a = i.allocation;
    if (i.counted && a.meCents + a.partnerCents + a.unassignedCents !== i.totalCents) v.push(`INV-3: contributions + unassigned = total for ${i.id}`);
    if (!i.counted && (i.totalCents !== 0 || a.meCents + a.partnerCents + a.unassignedCents !== 0)) v.push(`INV-3b: an uncounted item contributes nothing (${i.id})`);
    if (!i.counted && i.informational && i.informational.meCents + i.informational.partnerCents > i.enteredCents) v.push(`INV-3c: informational contributions never exceed the entered amount (${i.id})`);
    if (i.counted && i.informational) v.push(`INV-3d: only an item represented elsewhere carries informational contributions (${i.id})`);
    if (i.counted !== (i.excludedReason === null)) v.push(`INV-7a: an item is counted exactly when it has no exclusion reason (${i.id})`);
    if (i.excludedReason === "record" && !i.representedBy) v.push(`INV-7b: a record-represented item names its record (${i.id})`);
    if (a.status === "unassigned" && (a.meCents !== 0 || a.partnerCents !== 0 || a.unassignedCents !== i.totalCents)) v.push(`INV-11: no payer stated means fully unassigned, never split (${i.id})`);
    const suggested = i.suggestions.reduce((x, y) => x + y.cents, 0);
    if (suggested > a.unassignedCents || (!i.counted && i.suggestions.length > 0)) v.push(`INV-12: suggestions are only for counted items and never exceed what is unassigned (${i.id})`);
  }

  const L = p.ledger;
  const rem = (r: LedgerRow | null) => (r && r.included ? r.remainingCents : 0);
  if (p.available.status === "complete") {
    if (rem(L.me) === null || rem(L.partner) === null) v.push("INV-4a: complete availability needs every included person's remaining");
    else if ((rem(L.me) as number) + (rem(L.partner) as number) - L.unassignedCents !== p.available.cents) v.push("INV-4: sum of remaining - not yet assigned = household available");
    if (p.available.provisional) v.push("INV-6d: a definitive available figure has no provisional twin");
    if (p.partner && !p.partnerIncluded && L.unassignedCents > 0) v.push("INV-6e: no definitive available while an excluded partner leaves costs unassigned");
  } else {
    if (p.available.cents !== null) v.push("INV-6: a non-definitive available figure has no definitive value");
    if (p.available.provisional && p.available.provisional.assumptions.length === 0) v.push("INV-6f: a provisional figure lists its assumptions");
    const prov = p.available.provisional;
    if (prov && prov.assumptions.length === 1 && prov.assumptions[0] === "unassignedCoveredByHouseholdIncome" && p.income.status === "complete") {
      if ((rem(L.me) as number) + (rem(L.partner) as number) - L.unassignedCents !== prov.cents) v.push("INV-4p: the provisional figure follows the ledger identity");
    }
  }
  if (p.income.status !== "complete" && p.available.cents !== null) v.push("INV-6g: available is withheld while an included income is unknown");
  if (p.income.status === "unknown" && p.available.provisional) v.push("INV-6h: with no known income there is no provisional figure either");
  for (const t of [p.income, s.totalHousehold, s.assignedToIncluded, p.available]) {
    if ((t.status === "complete") !== (t.cents !== null)) v.push("INV-6b: only a complete total has a value");
    if (t.status === "unknown" && t.knownCents !== 0 && t !== s.assignedToIncluded && t !== s.totalHousehold && t !== p.available) v.push("INV-6c: an unknown total has nothing known");
  }
  if (p.debtBalances.totalCents !== p.debtBalances.jointCents + p.debtBalances.personalCents) v.push("INV-9: debt balances add up and stay out of monthly figures");
  if (!p.me.included || p.ledger.me.included !== true) v.push("INV-13: Me is always included");
  return v;
}

export { EXPENSE_CATEGORIES };

// Presentation helpers for the Planner's "Your Financial Plan" screen: the spending breakdown behind the donut
// chart and the rule-based "Next steps". Both are derived ONLY from an already-built plan (src/lib/financialPlanner.ts);
// they add no new financial logic, never estimate a missing amount, and involve no AI.

import { EXPENSE_CATEGORIES, type ExpenseCategory, type FinancialPlan, type FinancialProfile, type PlannerStep } from "@/lib/financialPlanner";
import { toCents } from "@/lib/bills";

export type SegmentKey = ExpenseCategory | "obligations" | "subscriptions";

export type BreakdownSegment = { key: SegmentKey; cents: number; percent: number };

export type Breakdown = {
  /** Largest first. Only known, positive amounts: a missing amount is never drawn as a slice. */
  segments: BreakdownSegment[];
  /** Equal to the plan's total outflow. */
  totalCents: number;
};

/** Whole-number percentages that add up to exactly 100 (largest-remainder rounding). */
export function wholePercents(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - floors[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i] += 1;
    left -= 1;
  }
  return floors;
}

/**
 * Display text for a segment's share. The whole-number percentages are rounded
 * so they add up to 100, which can show a tiny but real slice as "0%" or "1%";
 * any nonzero slice under 1% of the total reads "<1%" instead. A true zero stays "0%".
 */
export function percentText(cents: number, totalCents: number, percent: number): string {
  if (cents > 0 && totalCents > 0 && cents * 100 < totalCents) return "<1%";
  return `${percent}%`;
}

export function spendingBreakdown(plan: FinancialPlan, profile: Pick<FinancialProfile, "expenses" | "useBills">): Breakdown {
  const raw: { key: SegmentKey; cents: number }[] = [];
  for (const cat of EXPENSE_CATEGORIES) {
    const e = profile.expenses[cat];
    if (!e) continue;
    if (e.covered && profile.useBills) continue; // already inside the Bills figure
    raw.push({ key: cat, cents: toCents(e.amount) });
  }
  raw.push({ key: "obligations", cents: plan.obligationsCents });
  raw.push({ key: "subscriptions", cents: plan.subscriptions.monthlyCents });
  const kept = raw.filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
  const pct = wholePercents(kept.map((k) => k.cents));
  return { segments: kept.map((k, i) => ({ ...k, percent: pct[i] })), totalCents: kept.reduce((a, b) => a + b.cents, 0) };
}

export type NextStep =
  | { kind: "addIncome"; step: PlannerStep }
  | { kind: "addExpenses"; step: PlannerStep; count: number }
  | { kind: "addObligations"; step: PlannerStep }
  | { kind: "includeSubscriptions" }
  | { kind: "billAmounts"; count: number }
  | { kind: "shortfall" }
  | { kind: "capacity"; cents: number }
  | { kind: "debtBalance"; cents: number };

/**
 * The few things the plan itself says to do next, in a fixed priority order. Every item is a direct reading of
 * the plan (what is missing, whether spending exceeds income, what is left to save); none is a judgment about
 * what the user should do with their money.
 */
export function nextSteps(plan: FinancialPlan, limit = 4): NextStep[] {
  const out: NextStep[] = [];
  if (plan.income.monthlyCents === null) out.push({ kind: "addIncome", step: 1 });
  if (plan.missing.includes("expenses")) out.push({ kind: "addExpenses", step: 3, count: plan.expenses.missing.length });
  if (plan.missing.includes("obligations")) out.push({ kind: "addObligations", step: 4 });
  if (plan.missing.includes("subscriptions")) out.push({ kind: "includeSubscriptions" });
  if (plan.missing.includes("billAmounts")) out.push({ kind: "billAmounts", count: plan.bills.missingCount });
  if (plan.shortfall) out.push({ kind: "shortfall" });
  else if (plan.savingsCapacityCents !== null && plan.savingsCapacityCents > 0 && !plan.incomplete) out.push({ kind: "capacity", cents: plan.savingsCapacityCents });
  if (plan.debtBalanceCents > 0) out.push({ kind: "debtBalance", cents: plan.debtBalanceCents });
  return out.slice(0, limit);
}

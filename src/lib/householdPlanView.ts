import type { FinancialProfile } from "@/lib/financialPlanner";
import type { GoalResult, HouseholdPlan, SharedHousehold } from "@/lib/householdPlan";
import { UNKNOWN, figureFrom, type AvailableView, type Figure, type OverviewModel } from "@/lib/householdOverview";
import { wholePercents } from "@/lib/plannerView";
import { goalPercent, goalTone, type GoalStatusTone } from "@/lib/sharedGoalDraft";

// Pure view-model for Tools > Planner > Household > Plan (Phase 2, Step 5). It does NOT calculate household finances:
// every amount comes from buildHouseholdPlan (through buildOverview for the display rules). What it adds is judgement
// about HOW a figure may be shown:
//   * a chart is drawn only when its total is complete and its parts add up to it; otherwise it is hidden, never guessed
//   * unknown stays unknown and an explicit zero stays zero
//   * planned contributions and assigned responsibility are labelled as plans, never as payments made
//   * planned savings and debt balances are kept out of spending
//   * a provisional available figure is never turned into a "left after savings" figure
//   * progress percentages are display-only and capped at 100

export type SegmentKey = "mePersonal" | "partnerPersonal" | "shared" | "debtPayments" | "me" | "partner" | "excludedPartner" | "unassigned";
export type ChartSegment = { key: SegmentKey; cents: number; percent: number };
export type ChartView = {
  shown: boolean;
  /** Why it is not drawn: the total isn't complete, or there is nothing to show. */
  hiddenReason: "incomplete" | "empty" | null;
  totalCents: number | null;
  /** Every applicable part (zeros included, so an explicit $0 stays visible). Percentages add up to exactly 100 when shown. */
  segments: ChartSegment[];
  /** Parts that are listed but NOT drawn because nothing is known about them (never shown as $0). Only an unstated excluded partner. */
  omitted: SegmentKey[];
};

export type FlowRow = { key: "mePersonal" | "partnerPersonal" | "shared" | "debtPayments"; figure: Figure };

export type GoalRow = {
  id: string;
  name: string;
  status: GoalResult["status"];
  tone: GoalStatusTone;
  requiredCents: number | null;
  plannedCents: number;
  /** Whether anyone's contribution was stated at all (so "planned $0" can be told apart from "nothing stated"). */
  plannedStated: boolean;
  /** Monthly shortfall against what is needed (null when no requirement can be worked out). */
  shortByCents: number | null;
  /** Planned contributions above what is needed each month. Informational only: it never blocks anything. */
  aheadByCents: number;
  /** Saved / target as a whole percent, display-only and capped at 100. null unless both amounts are known. */
  percent: number | null;
  /** Target known but the amount saved was never entered: the monthly need assumes nothing is saved yet. */
  savedUnknownAssumption: boolean;
  timing: GoalResult["timing"];
  hint: "noTarget" | "noDate" | "pastDue" | null;
  counted: { me: boolean; partner: boolean };
};

export type PlanView = {
  /** true when the available-cash figure is not final (provisional or unknown). */
  provisional: boolean;
  flow: { income: Figure; spending: Figure; rows: FlowRow[] };
  available: AvailableView;
  shortfall: HouseholdPlan["shortfall"];
  breakdown: ChartView;
  distribution: ChartView;
  savings: {
    /** Monthly savings entered in the planners (not bills, not spending). */
    inPlanners: Figure;
    /** What shared goals are planned to receive each month (contributions, not payments made). */
    goalsPlanned: Figure;
    /** The part of that which is new money for household savings (the rest is already inside someone's planner savings). */
    goalsCounted: Figure;
    /** Left after planned savings. Only known when available cash is final. */
    afterSavings: { kind: "amount"; cents: number } | { kind: "unknown" };
    shortfallAfterSavings: boolean;
  };
  goals: GoalRow[];
  debts: { joint: Figure; personal: Figure; total: Figure; someUnknown: boolean };
};

export type PlanViewInput = {
  plan: HouseholdPlan;
  model: OverviewModel;
  shared: SharedHousehold;
  profiles: { me: FinancialProfile; partner: FinancialProfile | null };
  /** The stored shared data could not be fully read, so shared figures are only "at least". */
  unreadable: boolean;
};

const atLeastIfAny = (cents: number, estimate = false): Figure => (cents > 0 ? { kind: "atLeast", cents, estimate } : UNKNOWN);

function chart(total: Figure, parts: { key: SegmentKey; cents: number }[], applicable: boolean, omitted: SegmentKey[] = []): ChartView {
  if (!applicable) return { shown: false, hiddenReason: "empty", totalCents: null, segments: [], omitted: [] };
  if (total.kind !== "amount") return { shown: false, hiddenReason: "incomplete", totalCents: null, segments: [], omitted: [] };
  if (total.cents <= 0) return { shown: false, hiddenReason: "empty", totalCents: total.cents, segments: [], omitted: [] };
  // The KNOWN parts must add up to the complete total; if they ever didn't, drawing them would mislead, so don't.
  if (parts.reduce((s, p) => s + p.cents, 0) !== total.cents) return { shown: false, hiddenReason: "incomplete", totalCents: total.cents, segments: [], omitted: [] };
  const pct = wholePercents(parts.map((p) => p.cents));
  return { shown: true, hiddenReason: null, totalCents: total.cents, segments: parts.map((p, i) => ({ key: p.key, cents: p.cents, percent: pct[i] })), omitted };
}

export function buildPlanView(i: PlanViewInput): PlanView {
  const { plan, model, shared, profiles, unreadable } = i;
  const partnerIn = plan.hasPartner && plan.partnerIncluded;
  const c = plan.spending.components;
  const estExpenses = plan.sharedItems.some((x) => x.counted && x.kind === "expense" && x.includesEstimates);
  const estDebts = plan.sharedItems.some((x) => x.counted && x.kind === "debtPayment" && x.includesEstimates);

  // ── cash-flow rows ──
  const expAnswered = shared.expenses.length > 0 || shared.noSharedExpenses;
  const debtAnswered = shared.debts.length > 0 || shared.noSharedDebts;
  const missingPayment = shared.debts.some((d) => d.monthlyPayment === null);
  const sharedFig: Figure = expAnswered && !unreadable ? { kind: "amount", cents: c.sharedCostsCents, estimate: estExpenses } : atLeastIfAny(c.sharedCostsCents, estExpenses);
  const debtFig: Figure = debtAnswered && !missingPayment && !unreadable ? { kind: "amount", cents: c.jointDebtPaymentsCents, estimate: estDebts } : atLeastIfAny(c.jointDebtPaymentsCents, estDebts);
  const rows: FlowRow[] = [{ key: "mePersonal", figure: figureFrom(plan.me.spendingStatus, plan.me.personalSpendingCents, plan.me.plan.includesEstimates) }];
  if (partnerIn && plan.partner) rows.push({ key: "partnerPersonal", figure: figureFrom(plan.partner.spendingStatus, plan.partner.personalSpendingCents, plan.partner.plan.includesEstimates) });
  rows.push({ key: "shared", figure: sharedFig }, { key: "debtPayments", figure: debtFig });

  // ── charts (hidden unless complete) ──
  const spendParts: { key: SegmentKey; cents: number }[] = [{ key: "mePersonal", cents: c.mePersonalCents }];
  if (partnerIn) spendParts.push({ key: "partnerPersonal", cents: c.partnerPersonalCents });
  spendParts.push({ key: "shared", cents: c.sharedCostsCents }, { key: "debtPayments", cents: c.jointDebtPaymentsCents });
  const breakdown = chart(model.spending.figure, spendParts, true);

  const respParts: { key: SegmentKey; cents: number }[] = [];
  const respOmitted: SegmentKey[] = [];
  let respComplete = true;
  for (const r of model.responsibility.rows) {
    if (r.figure.kind === "amount") respParts.push({ key: r.key, cents: r.figure.cents });
    else if (r.key === "excludedPartner" && !r.stated) respOmitted.push(r.key); // nothing stated: unknown, listed but not drawn
    else respComplete = false; // an included person's own spending is unknown: the total is not complete either
  }
  if (model.responsibility.unassigned) respParts.push({ key: "unassigned", cents: model.responsibility.unassigned.cents });
  const distribution = respComplete ? chart(model.spending.figure, respParts, true, respOmitted) : chart(UNKNOWN, respParts, true);

  // ── savings (kept apart from spending) ──
  const profs = [profiles.me, ...(partnerIn && profiles.partner ? [profiles.partner] : [])];
  const known = profs.filter((p) => p.savingsMonthly !== null);
  const inPlannersCents = (plan.me.plan.plannedSavingsCents) + (partnerIn && plan.partner ? plan.partner.plan.plannedSavingsCents : 0);
  const inPlanners: Figure = known.length === 0 ? UNKNOWN : known.length === profs.length ? { kind: "amount", cents: inPlannersCents, estimate: false } : atLeastIfAny(inPlannersCents);
  const goalsPlannedCents = plan.goals.reduce((s, g) => s + g.plannedMonthlyCents, 0);
  const final = model.available.kind === "definitive";
  const afterSavings = final && plan.savings.capacityCents !== null ? ({ kind: "amount", cents: plan.savings.capacityCents } as const) : ({ kind: "unknown" } as const);

  // ── goals ──
  const goals: GoalRow[] = plan.goals.map((r) => {
    const g = shared.goals.find((x) => x.id === r.id);
    const required = r.requiredMonthlyCents;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      tone: goalTone(r.status),
      requiredCents: required,
      plannedCents: r.plannedMonthlyCents,
      plannedStated: !!g && (g.contributions.me !== null || g.contributions.partner !== null),
      shortByCents: r.shortByMonthlyCents,
      aheadByCents: required !== null && r.plannedMonthlyCents > required ? r.plannedMonthlyCents - required : 0,
      percent: g ? goalPercent(g) : null,
      savedUnknownAssumption: !!g && g.savedAmount === null && g.targetAmount !== null,
      timing: r.timing,
      hint: r.status === "noTarget" ? "noTarget" : r.status === "noDate" ? "noDate" : r.status === "pastDue" ? "pastDue" : null,
      counted: g ? { ...g.countedInSavings } : { me: false, partner: false },
    };
  });

  // ── debt balances (never spending) ──
  const b = plan.debtBalances;
  const personalUnknown = profs.some((p) => p.debts.some((d) => d.balance === null));
  const jointUnknown = b.missingJointBalances > 0 || (!debtAnswered && b.jointCents === 0);
  const joint: Figure = unreadable || b.missingJointBalances > 0 ? atLeastIfAny(b.jointCents) : !debtAnswered && b.jointCents === 0 ? UNKNOWN : { kind: "amount", cents: b.jointCents, estimate: false };
  const personal: Figure = personalUnknown ? atLeastIfAny(b.personalCents) : { kind: "amount", cents: b.personalCents, estimate: false };
  const total: Figure = joint.kind === "amount" && personal.kind === "amount" ? { kind: "amount", cents: b.totalCents, estimate: false } : atLeastIfAny(b.totalCents);

  return {
    provisional: model.available.kind !== "definitive",
    flow: { income: model.income.figure, spending: model.spending.figure, rows },
    available: model.available,
    shortfall: model.shortfall,
    breakdown,
    distribution,
    savings: {
      inPlanners,
      goalsPlanned: { kind: "amount", cents: goalsPlannedCents, estimate: false },
      goalsCounted: { kind: "amount", cents: plan.savings.goalContributionsCents, estimate: false },
      afterSavings,
      shortfallAfterSavings: final && plan.savings.shortfallAfterSavings,
    },
    goals,
    debts: { joint, personal, total, someUnknown: jointUnknown || personalUnknown },
  };
}

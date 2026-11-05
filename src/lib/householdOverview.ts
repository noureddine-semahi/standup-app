import type { Subscription } from "@/lib/subscriptions";
import type { HouseholdPlan, IssueCode, ProvisionalAssumption, SharedHousehold, Status, Total } from "@/lib/householdPlan";
import type { SharedIntegrity, SharedRow } from "@/lib/householdShared";

// Pure view-model for Tools > Planner > Household > Overview. It only RESHAPES what buildHouseholdPlan already worked
// out into things a screen can show; it does no accounting of its own (no new sums beyond choosing which known figure
// to display). Its job is the display rules:
//   * unknown is never shown as $0                       -> Figure "unknown"
//   * a partial total is "at least" what is known         -> Figure "atLeast"
//   * definitive vs provisional available cash            -> AvailableView
//   * assigned responsibility is what people SAID they cover, not payments made (labelled by the screen)
//   * nothing is split 50/50: only stated contributions appear; the rest is "not yet assigned"
//   * contributions on Finances-linked costs are shown as information and never added to a total

/** How a money value may be shown. Only "amount" is a full figure. */
export type Figure =
  | { kind: "amount"; cents: number; estimate: boolean }
  /** A partial total: at least this much is known; the rest is missing (never to be shown as the whole). */
  | { kind: "atLeast"; cents: number; estimate: boolean }
  | { kind: "unknown" };

export const UNKNOWN: Figure = { kind: "unknown" };

/** A complete total is an amount; a partial one with something known is "at least"; otherwise unknown (never $0). */
export function figureOf(t: Pick<Total, "status" | "cents" | "knownCents" | "includesEstimates">): Figure {
  if (t.status === "complete" && t.cents !== null) return { kind: "amount", cents: t.cents, estimate: t.includesEstimates };
  if (t.status === "partial" && t.knownCents > 0) return { kind: "atLeast", cents: t.knownCents, estimate: t.includesEstimates };
  return UNKNOWN;
}

/** A figure built from a status and a known sum (used for per-person rows). */
export function figureFrom(status: Status, knownCents: number, estimate = false): Figure {
  return figureOf({ status, cents: status === "complete" ? knownCents : null, knownCents, includesEstimates: estimate });
}

export type OverviewAssumption = ProvisionalAssumption | "storedDataUnreadable";

export type AvailableView =
  /** Definitive: income and spending are complete. `tone` is for colour only. */
  | { kind: "definitive"; cents: number; tone: "positive" | "negative" | "none"; estimate: boolean }
  /** Provisional: must be labelled as such together with every assumption it rests on. */
  | { kind: "provisional"; cents: number; assumptions: OverviewAssumption[]; estimate: boolean }
  | { kind: "unknown" };

export type ResponsibilityRow = {
  key: "me" | "partner" | "excludedPartner";
  /** The name to show (the partner's own name, or "Me"). */
  name: string;
  /** What they said they cover: their own costs plus the contributions they stated. Not what they have paid. */
  figure: Figure;
  /** Their own personal spending as the household counts it. */
  personal: Figure;
  /** The contributions they stated toward shared costs and joint debts (known, so shown even when `personal` is not). */
  towardSharedCents: number;
  excluded: boolean;
  /**
   * Whether the person's share of shared costs was actually stated. An included person is always "stated"; an EXCLUDED
   * partner is stated only when some counted shared cost has a contribution entered for them (an explicit $0 counts).
   * "Nothing stated" is unknown, never a confirmed $0.
   */
  stated: boolean;
};

export type OverviewWarningCode =
  | "meIncomeUnknown"
  | "partnerIncomeUnknown"
  | "sharedCostsUnanswered"
  | "sharedDebtsUnanswered"
  | "payerNotSet"
  | "spendingIncomplete"
  | "unassignedWithExcludedPartner"
  | "contributionsInvalid"
  | "invalidAmount"
  | "compositionAdultsBelowEarners"
  | "partnerExcludedFundsSharedCosts"
  | "storedDataUnreadable";

export type OverviewWarning = {
  code: OverviewWarningCode;
  severity: "info" | "warning";
  /** Which person a warning is about, so the screen can say "your" for Me. */
  person?: "me" | "partner";
  /** A person's display name, a shared item's label, a count or an amount, depending on the code. */
  name?: string;
  label?: string;
  count?: number;
  cents?: number;
};

export type DuplicateCode = "possibleBillOverlap" | "possibleSubscriptionOverlap" | "possibleSharedPersonalOverlap" | "possibleDuplicateJointDebt";
export type DuplicateWarning = { code: DuplicateCode; itemId: string; label: string; relatedName?: string; person?: "me" | "partner"; personName?: string; cents?: number };

export type OverviewModel = {
  hasPartner: boolean;
  partnerIncluded: boolean;
  names: { me: string; partner: string | null };
  income: { figure: Figure; lowCents: number | null };
  spending: { figure: Figure };
  shared: {
    /** false until the household has answered (items entered, or "none") for BOTH shared costs and joint debts. */
    figure: Figure;
    expenseCount: number;
    debtCount: number;
    countedCount: number;
    /** Items already counted through a Finances record (shown, not added again). */
    representedCount: number;
    answered: { expenses: boolean; debts: boolean };
  };
  available: AvailableView;
  shortfall: HouseholdPlan["shortfall"];
  responsibility: {
    rows: ResponsibilityRow[];
    /** Shared amounts nobody was stated to pay. Never attributed to anyone. null = nothing shared to assign. */
    unassigned: { cents: number; itemCount: number } | null;
  };
  /**
   * Shared costs where SOME of the cost was stated to a person and the rest was not. `assignedCents` is what people
   * said they cover (not what was paid); `unassignedCents` is the remainder nobody was stated to cover.
   */
  partial: { id: string; label: string; totalCents: number; assignedCents: number; unassignedCents: number }[];
  /** Contributions entered on costs a Finances record already counts: information only, never in a total. */
  informational: { id: string; label: string; meCents: number; partnerCents: number }[];
  warnings: OverviewWarning[];
  duplicates: DuplicateWarning[];
  integrity: { ok: boolean; unreadableCount: number; kinds: Record<string, number> };
  size: { status: Status; total: number | null; knownTotal: number; parts: { adults: number | null; children: number | null; otherMembers: number | null } };
};

export type OverviewInput = {
  plan: HouseholdPlan;
  shared: SharedHousehold;
  integrity: SharedIntegrity;
  droppedItems: number;
  meName: string;
  partnerName: string | null;
  subscriptions: readonly Pick<Subscription, "id" | "name">[];
};

const DUP_CODES: readonly IssueCode[] = ["possibleBillOverlap", "possibleSubscriptionOverlap", "possibleSharedPersonalOverlap", "possibleDuplicateJointDebt"];
const WARN_CODES: readonly IssueCode[] = [
  "meIncomeUnknown", "partnerIncomeUnknown", "sharedCostsUnanswered", "sharedDebtsUnanswered", "unassignedWithExcludedPartner",
  "contributionsInvalid", "invalidAmount", "compositionAdultsBelowEarners", "partnerExcludedFundsSharedCosts",
];

export function buildOverview(input: OverviewInput): OverviewModel {
  const { plan, shared, integrity } = input;
  const unreadable = !integrity.ok;
  const labelOf = new Map<string, string>();
  for (const e of shared.expenses) labelOf.set(e.id, e.label);
  for (const d of shared.debts) labelOf.set(d.id, d.name);
  const partnerName = input.partnerName ?? null;
  const nameOf = (p?: "me" | "partner") => (p === "partner" ? partnerName ?? "" : input.meName);

  // ── shared summary ────────────────────────────────────────────────────
  const expAnswered = shared.expenses.length > 0 || shared.noSharedExpenses;
  const debtAnswered = shared.debts.length > 0 || shared.noSharedDebts;
  const sharedKnown = plan.spending.components.sharedCostsCents + plan.spending.components.jointDebtPaymentsCents;
  const missingPayment = shared.debts.some((d) => d.monthlyPayment === null);
  const anyEstimate = plan.sharedItems.some((i) => i.counted && i.includesEstimates);
  // Complete only when both lists are answered and every joint debt has a payment; otherwise what is known is "at least".
  let sharedFigure: Figure = UNKNOWN;
  if (expAnswered && debtAnswered && !missingPayment && !unreadable) sharedFigure = { kind: "amount", cents: sharedKnown, estimate: anyEstimate };
  else if (sharedKnown > 0) sharedFigure = { kind: "atLeast", cents: sharedKnown, estimate: anyEstimate };

  // ── income / spending ─────────────────────────────────────────────────
  const income = figureOf(plan.income); // income does not come from shared data, so unreadable shared data never changes it
  const spendingFig = figureOf(plan.spending.totalHousehold);
  const spending: Figure = unreadable && spendingFig.kind === "amount" ? { kind: "atLeast", cents: spendingFig.cents, estimate: spendingFig.estimate } : spendingFig;

  // ── available cash ────────────────────────────────────────────────────
  const a = plan.available;
  let available: AvailableView = { kind: "unknown" };
  if (a.cents !== null) {
    const tone = a.cents < 0 ? "negative" : a.cents > 0 ? "positive" : "none";
    available = unreadable
      ? { kind: "provisional", cents: a.cents, assumptions: ["storedDataUnreadable"], estimate: a.includesEstimates }
      : { kind: "definitive", cents: a.cents, tone, estimate: a.includesEstimates };
  } else if (a.provisional) {
    available = { kind: "provisional", cents: a.provisional.cents, assumptions: unreadable ? [...a.provisional.assumptions, "storedDataUnreadable"] : [...a.provisional.assumptions], estimate: a.includesEstimates };
  }

  // ── responsibility ────────────────────────────────────────────────────
  const rows: ResponsibilityRow[] = [];
  const personRow = (key: "me" | "partner", name: string): ResponsibilityRow | null => {
    const view = key === "me" ? plan.me : plan.partner;
    const ledger = key === "me" ? plan.ledger.me : plan.ledger.partner;
    if (!view || !ledger || !ledger.included) return null;
    const personal = figureFrom(view.spendingStatus, view.personalSpendingCents, view.plan.includesEstimates);
    const contrib = ledger.contributionsCents;
    // personal unknown + contributions stated -> "at least the contributions", never just the contributions as if whole.
    let figure: Figure;
    if (personal.kind === "amount") figure = { kind: "amount", cents: personal.cents + contrib, estimate: personal.estimate };
    else if (personal.kind === "atLeast") figure = { kind: "atLeast", cents: personal.cents + contrib, estimate: personal.estimate };
    else figure = contrib > 0 ? { kind: "atLeast", cents: contrib, estimate: false } : UNKNOWN;
    return { key, name, figure, personal, towardSharedCents: contrib, excluded: false, stated: true };
  };
  const me = personRow("me", input.meName);
  if (me) rows.push(me);
  if (plan.hasPartner && plan.partnerIncluded && partnerName !== null) {
    const p = personRow("partner", partnerName);
    if (p) rows.push(p);
  }
  if (plan.hasPartner && !plan.partnerIncluded && partnerName !== null) {
    const c = plan.spending.assignedToExcludedPartnerCents;
    const countedIds = new Set(plan.sharedItems.filter((i) => i.counted && i.allocation.status !== "invalid").map((i) => i.id));
    const stated = [...input.shared.expenses, ...input.shared.debts].some((x) => countedIds.has(x.id) && x.contributions.partner !== null);
    rows.push({ key: "excludedPartner", name: partnerName, figure: c > 0 || stated ? { kind: "amount", cents: c, estimate: false } : UNKNOWN, personal: UNKNOWN, towardSharedCents: c, excluded: true, stated: c > 0 || stated });
  }
  const countedItems = plan.sharedItems.filter((i) => i.counted);
  const unassignedItems = countedItems.filter((i) => i.allocation.unassignedCents > 0);
  const unassigned = countedItems.length > 0 ? { cents: plan.spending.unassignedCents, itemCount: unassignedItems.length } : null;

  // ── warnings ──────────────────────────────────────────────────────────
  const warnings: OverviewWarning[] = [];
  const duplicates: DuplicateWarning[] = [];
  const subName = new Map(input.subscriptions.map((s) => [s.id, s.name]));
  let payerNotSet = 0;
  let payerNotSetCents = 0;
  for (const issue of plan.issues) {
    if (issue.code === "payerNotSet") {
      payerNotSet++;
      payerNotSetCents += issue.cents ?? 0;
      continue;
    }
    if ((DUP_CODES as readonly string[]).includes(issue.code)) {
      duplicates.push({
        code: issue.code as DuplicateCode,
        itemId: issue.ref ?? "",
        label: labelOf.get(issue.ref ?? "") ?? "",
        relatedName: issue.related ? subName.get(issue.related) : undefined,
        person: issue.person,
        personName: issue.person ? nameOf(issue.person) : undefined,
        cents: issue.cents,
      });
      continue;
    }
    if (!(WARN_CODES as readonly string[]).includes(issue.code)) continue;
    warnings.push({ code: issue.code as OverviewWarningCode, severity: issue.severity, person: issue.person, name: issue.person ? nameOf(issue.person) : undefined, label: labelOf.get(issue.ref ?? ""), cents: issue.cents });
  }
  if (payerNotSet > 0) warnings.push({ code: "payerNotSet", severity: "info", count: payerNotSet, cents: payerNotSetCents });
  for (const [view, name] of [[plan.me, input.meName], [plan.hasPartner && plan.partnerIncluded ? plan.partner : null, partnerName ?? ""]] as const) {
    if (view && view.spendingStatus !== "complete") warnings.push({ code: "spendingIncomplete", severity: "warning", person: view === plan.me ? "me" : "partner", name });
  }
  if (unreadable) warnings.unshift({ code: "storedDataUnreadable", severity: "warning", count: input.droppedItems + integrity.issues.filter((i) => i.code !== "malformedItem" && i.code !== "duplicateId" && i.code !== "overLimit").length });

  const kinds: Record<string, number> = {};
  for (const i of integrity.issues) kinds[i.code] = (kinds[i.code] ?? 0) + 1;

  const partial = countedItems
    .filter((i) => i.allocation.status === "partial" && i.allocation.unassignedCents > 0)
    .map((i) => ({ id: i.id, label: i.label, totalCents: i.totalCents, assignedCents: i.allocation.meCents + i.allocation.partnerCents, unassignedCents: i.allocation.unassignedCents }));

  const informational = plan.sharedItems
    .filter((i) => i.informational && !i.counted)
    .map((i) => ({ id: i.id, label: i.label, meCents: i.informational!.meCents, partnerCents: i.informational!.partnerCents }));

  return {
    hasPartner: plan.hasPartner,
    partnerIncluded: plan.partnerIncluded,
    names: { me: input.meName, partner: partnerName },
    income: { figure: income, lowCents: plan.income.lowCents },
    spending: { figure: spending },
    shared: {
      figure: sharedFigure,
      expenseCount: shared.expenses.length,
      debtCount: shared.debts.length,
      countedCount: countedItems.length,
      representedCount: plan.sharedItems.length - countedItems.length,
      answered: { expenses: expAnswered, debts: debtAnswered },
    },
    available,
    shortfall: plan.shortfall,
    responsibility: { rows, unassigned },
    partial,
    informational,
    warnings,
    duplicates,
    integrity: { ok: integrity.ok, unreadableCount: input.droppedItems, kinds },
    size: { ...plan.composition.size, parts: { adults: plan.composition.adults, children: plan.composition.children, otherMembers: plan.composition.otherMembers } },
  };
}

// ── export of the original stored data ───────────────────────────────────

export const EXPORT_FORMAT = "standup-household-shared";

/**
 * The JSON a user can download when stored household data has problems: the stored columns exactly as read (so nothing
 * is lost even if the app cannot display it), plus the integrity findings. It never contains credentials, tokens,
 * user ids or any other table's data.
 */
export function buildExportJson(stored: SharedRow, integrity: SharedIntegrity): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: 1,
      note: "Original household shared data exactly as stored. Nothing was changed or removed.",
      fingerprint: integrity.fingerprint,
      integrityIssues: integrity.issues,
      stored,
    },
    null,
    2
  );
}

export const EXPORT_FILE_NAME = "standup-household-original-data.json";

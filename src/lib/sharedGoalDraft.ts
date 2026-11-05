import { toCents } from "@/lib/bills";
import type { Contributions, GoalResult, SharedGoal } from "@/lib/householdPlan";
import { SHARED_LIMITS, newSharedId } from "@/lib/householdShared";
import { readField, type FieldValue } from "@/lib/sharedExpenseDraft";

// Pure helpers for the shared-goal form (Phase 2, Step 4C). Same rules as the other forms:
//   * a blank box is UNANSWERED (null); a typed 0 is a real 0 (amount saved, or a person's planned contribution)
//   * goals are SAVINGS, not spending: planned contributions are monthly amounts toward the goal and are never bills or
//     debt payments (the household plan keeps them out of spending; only the calculation module decides what is counted)
//   * "already part of {name}'s monthly savings" is the user's explicit statement (countedInSavings); nothing is
//     inferred, and the personal planner's savings are never changed
// Required monthly amount, status, months left and the calendar-month rule all come from goalProgress() in householdPlan.

export type GoalDraft = {
  id: string | null;
  name: string;
  target: string;
  date: string;
  saved: string;
  me: string;
  partner: string;
  /** The user says this person's contribution is already inside their personal monthly savings. */
  meCounted: boolean;
  partnerCounted: boolean;
};

export const emptyGoalDraft = (): GoalDraft => ({ id: null, name: "", target: "", date: "", saved: "", me: "", partner: "", meCounted: false, partnerCounted: false });

const text = (n: number | null): string => (n === null ? "" : String(n));

export function goalToDraft(g: SharedGoal): GoalDraft {
  return { id: g.id, name: g.name, target: text(g.targetAmount), date: g.targetDate ?? "", saved: text(g.savedAmount), me: text(g.contributions.me), partner: text(g.contributions.partner), meCounted: g.countedInSavings.me, partnerCounted: g.countedInSavings.partner };
}

export type GoalErrorCode = "nameRequired" | "nameTooLong" | "targetInvalid" | "targetZero" | "dateInvalid" | "savedInvalid" | "meInvalid" | "partnerInvalid";
export type GoalDraftResult = { errors: { code: GoalErrorCode }[]; goal: SharedGoal | null };

const isISODate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const valueOrNull = (f: FieldValue): number | null => (f.state === "value" ? f.value : null);

/** The amount a person plans per month, when it is a real amount above $0 (only then can it be "already in their savings"). */
const positive = (f: FieldValue) => f.state === "value" && f.value > 0;

export function checkGoalDraft(d: GoalDraft, opts: { hasPartner: boolean }): GoalDraftResult {
  const errors: { code: GoalErrorCode }[] = [];
  const name = d.name.trim();
  if (name === "") errors.push({ code: "nameRequired" });
  else if (name.length > SHARED_LIMITS.label) errors.push({ code: "nameTooLong" });
  const target = readField(d.target);
  const saved = readField(d.saved);
  const me = readField(d.me);
  const partner = opts.hasPartner ? readField(d.partner) : ({ state: "empty" } as FieldValue);
  if (target.state === "invalid") errors.push({ code: "targetInvalid" });
  else if (target.state === "value" && target.value <= 0) errors.push({ code: "targetZero" });
  if (saved.state === "invalid") errors.push({ code: "savedInvalid" });
  if (me.state === "invalid") errors.push({ code: "meInvalid" });
  if (partner.state === "invalid") errors.push({ code: "partnerInvalid" });
  const date = d.date.trim();
  if (date !== "" && !isISODate(date)) errors.push({ code: "dateInvalid" });
  if (errors.length > 0) return { errors, goal: null };
  return {
    errors,
    goal: {
      id: d.id ?? newSharedId(),
      name,
      targetAmount: valueOrNull(target),
      targetDate: date === "" ? null : date,
      savedAmount: valueOrNull(saved),
      contributions: { me: valueOrNull(me), partner: valueOrNull(partner) } as Contributions,
      // A flag only means something for a person who actually plans to put money in.
      countedInSavings: { me: d.meCounted && positive(me), partner: opts.hasPartner && d.partnerCounted && positive(partner) },
    },
  };
}

/** Saved / target as a whole percent (0–100), only when BOTH are known and the target is above $0. Display only. */
export function goalPercent(g: Pick<SharedGoal, "targetAmount" | "savedAmount">): number | null {
  if (g.targetAmount === null || g.savedAmount === null || g.targetAmount <= 0) return null;
  return Math.min(100, Math.floor((Math.min(toCents(g.savedAmount), toCents(g.targetAmount)) * 100) / toCents(g.targetAmount)));
}

export type GoalStatusTone = "complete" | "partial" | "todo";
/** Which chip tone a status gets. The status itself comes from goalProgress(). */
export const goalTone = (s: GoalResult["status"]): GoalStatusTone => (s === "achieved" || s === "onTrack" ? "complete" : s === "noTarget" || s === "noDate" ? "todo" : "partial");

/** Replaces the goal with the same id, or appends a new one. Never touches the others. */
export function upsertGoal(list: readonly SharedGoal[], g: SharedGoal): SharedGoal[] {
  return list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [...list, g];
}

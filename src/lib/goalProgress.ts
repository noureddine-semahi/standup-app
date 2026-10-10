// Goal Engine Phase 2D-3: pure Target Goal progress calculation +
// formatting, shared by Goal Detail, Dashboard, and Review Today. No
// Supabase I/O, no presentation/JSX -- that stays in db.ts and each
// page respectively. Deliberately reads only plain numbers/strings, not
// an OutcomeGoal, so it has no dependency on db.ts at all.
//
// Goal Engine Phase 2D-5E adds one deliberate, separate dependency: a
// pure import from recurringGoalCycle.ts (computeCycleRange/
// RecurrenceFrequency) for the display-only current-cycle fallback
// below. recurringGoalCycle.ts itself has zero imports, so this stays
// pure-to-pure and does not reintroduce a dependency on db.ts.

import { computeCycleRange, type RecurrenceFrequency } from "@/lib/recurringGoalCycle";

export type TargetProgress =
  | { configured: false }
  | {
      configured: true;
      // Display value -- null current_value becomes 0 here, but the
      // stored value itself is never touched/mutated by this function.
      currentValue: number;
      targetValue: number;
      // Unclamped -- can exceed 100 (current > target) or be negative
      // (a negative current_value). Never used for the visual bar.
      rawPct: number;
      roundedPct: number;
      // Clamped 0..100 -- for the visual bar's width ONLY. This is the
      // one place "protect visual width from negative current values"
      // and "clamp width to 0..100" both apply.
      barPct: number;
    };

/**
 * target_value === null or <= 0 -> not configured, no percentage at
 * all (not even 0%) -- callers must show a "not configured" state
 * instead of a fake/empty progress bar.
 */
export function getTargetProgress(params: {
  currentValue: number | null;
  targetValue: number | null;
}): TargetProgress {
  const { targetValue } = params;
  if (targetValue == null || targetValue <= 0) {
    return { configured: false };
  }
  const currentValue = params.currentValue == null ? 0 : params.currentValue;
  const rawPct = (currentValue / targetValue) * 100;
  const roundedPct = Math.round(rawPct);
  const barPct = Math.max(0, Math.min(100, rawPct));
  return { configured: true, currentValue, targetValue, rawPct, roundedPct, barPct };
}

// $/€/£/¥ prefix the number with no space ("$1,750"); "%" suffixes with
// no space ("35%"); any other unit suffixes with one space ("18 jobs").
const PREFIX_SYMBOLS = new Set(["$", "€", "£", "¥"]);

// Plain decimal formatting, NOT Intl's currency style -- this project
// has no currency-conversion/locale engine and isn't building one here;
// "en-US" is pinned explicitly so grouping/decimal punctuation is
// consistent regardless of the viewer's own browser locale. Up to 2
// decimal places, and Intl.NumberFormat already never pads trailing
// zeros (1750.50 as a JS number is just 1750.5).
function formatTargetNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function applyUnit(numberText: string, unit: string | null): string {
  const trimmedUnit = unit?.trim() || null;
  if (!trimmedUnit) return numberText;
  if (PREFIX_SYMBOLS.has(trimmedUnit)) return `${trimmedUnit}${numberText}`;
  if (trimmedUnit === "%") return `${numberText}%`;
  return `${numberText} ${trimmedUnit}`;
}

/**
 * "current / target [unit]" -- the one shared Target-progress string,
 * e.g. formatTargetProgress(1750, 5000, "$") -> "$1,750 / $5,000".
 * Unit rules: $/€/£/¥ prefix each number (no space), "%" suffixes the
 * LAST number only (no space, e.g. "35 / 100%"), any other unit
 * suffixes the last number with one leading space, blank/null unit
 * omits it entirely.
 */
export function formatTargetProgress(current: number, target: number, unit: string | null): string {
  const trimmedUnit = unit?.trim() || null;
  const currentText = formatTargetNumber(current);
  const targetText = formatTargetNumber(target);

  if (trimmedUnit && PREFIX_SYMBOLS.has(trimmedUnit)) {
    return `${trimmedUnit}${currentText} / ${trimmedUnit}${targetText}`;
  }
  return `${currentText} / ${applyUnit(targetText, trimmedUnit)}`;
}

/**
 * Goal Engine Phase 2D-5E: picks whichever already-fetched cycle (if
 * any) contains today's LOCAL date -- never assumes the newest
 * historical cycle is "current" just because it's last in the list.
 * Generic rather than importing OutcomeGoalCycle from db.ts, keeping
 * this file's own "no dependency on db.ts" rule (see its header
 * comment) intact; callers pass whatever cycle-shaped rows they already
 * have (e.g. getCycleHistoryForOutcomeGoal's result).
 *
 * Returns undefined when no persisted cycle covers today -- callers
 * must show a neutral "no current cycle" state. This function never
 * creates a cycle; it only selects among ones already fetched.
 */
export function findCurrentCycle<T extends { cycle_start: string; cycle_end: string }>(
  cycles: T[],
  todayISO: string
): T | undefined {
  return cycles.find((c) => c.cycle_start <= todayISO && todayISO <= c.cycle_end);
}

// Minimum shape every current-cycle summary (persisted or derived)
// exposes -- lets Goal Detail/Dashboard/Review Today render both kinds
// through the exact same JSX, branching only on `view.kind` for the
// outer "which state" decision. OutcomeGoalCycleWithAggregation (db.ts)
// already structurally satisfies this; no import needed here to accept it.
export type RecurringCycleSummary = {
  cycle_start: string;
  cycle_end: string;
  committed: number;
  completed: number;
  canceled: number;
  rescheduledOut: number;
  open: number;
  targetCountSnapshot: number | null;
  result: string;
};

export type RecurringCurrentCycleView =
  | { kind: "persisted"; cycle: RecurringCycleSummary }
  | { kind: "derived"; cycle: RecurringCycleSummary }
  | { kind: "not_started"; recurrenceStartDate: string }
  | { kind: "unconfigured" };

// Goal Engine Phase 2D-5E (active-cycle correction): classifyCycleCommitments'
// stored result (db.ts) is a closed-cycle judgment -- "missed"/"partial"/
// "no_commitments" all assume the cycle is over. Anything
// getRecurringCurrentCycleView returns as "persisted" or "derived" is, by
// construction, always TODAY's cycle (findCurrentCycle only ever matches a
// cycle containing today), i.e. always still active -- so its displayed
// result is re-derived here from the raw completed/target numbers alone,
// never read off the stored value. "achieved" needs no correction either
// way (hitting the target is a real, immediate fact regardless of time
// left); anything else becomes "in_progress" while active.
function activeCycleResult(completed: number, targetCountSnapshot: number | null): string {
  if (targetCountSnapshot == null) return "unconfigured";
  return completed >= targetCountSnapshot ? "achieved" : "in_progress";
}

/**
 * Goal Engine Phase 2D-5E: the ONE place Goal Detail/Dashboard/Review
 * Today decide what "today's cycle" looks like for a Recurring Goal,
 * so the three surfaces cannot drift on this logic.
 *
 * Three real states (plus "unconfigured" for a Recurring Goal missing
 * frequency/start date, e.g. the transitional pre-2D-5C state):
 *
 * - "persisted": a real outcome_goal_cycles row already covers today
 *   (via findCurrentCycle) -- ALWAYS wins. Its committed/completed/
 *   canceled/rescheduledOut/open counts and its own frozen
 *   target_count_snapshot are returned exactly as stored (never
 *   recomputed from the Goal's CURRENT recurrence_target_count), but
 *   `result` is re-derived via activeCycleResult() above -- a NEW
 *   object (`{...persisted, result}`), never a mutation of the
 *   persisted cycle passed in (that same object may also live in a
 *   caller's own cycleHistory array; mutating it would corrupt that
 *   list's historical data too).
 * - "derived": no persisted row covers today, but
 *   recurrenceStartDate <= todayISO -- today's cycle boundaries are
 *   derived (display-only, via computeCycleRange) and represented as
 *   an empty cycle (every count 0). Nothing is persisted. `result`
 *   uses the same activeCycleResult() formula as "persisted" above.
 * - "not_started": todayISO < recurrenceStartDate -- checked directly
 *   (never via computeCycleRange's own throw as control flow) --
 *   there is no current cycle at all yet, distinct from "derived"'s
 *   empty-but-real cycle.
 */
export function getRecurringCurrentCycleView(params: {
  persistedCycles: RecurringCycleSummary[];
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceStartDate: string | null;
  recurrenceTargetCount: number | null;
  todayISO: string;
}): RecurringCurrentCycleView {
  const { persistedCycles, recurrenceFrequency, recurrenceStartDate, recurrenceTargetCount, todayISO } = params;

  const persisted = findCurrentCycle(persistedCycles, todayISO);
  if (persisted) {
    return {
      kind: "persisted",
      cycle: { ...persisted, result: activeCycleResult(persisted.completed, persisted.targetCountSnapshot) },
    };
  }

  if (!recurrenceFrequency || !recurrenceStartDate) return { kind: "unconfigured" };

  if (todayISO < recurrenceStartDate) {
    return { kind: "not_started", recurrenceStartDate };
  }

  const { cycleStart, cycleEnd } = computeCycleRange({
    frequency: recurrenceFrequency,
    recurrenceStartDate,
    targetDate: todayISO,
  });

  return {
    kind: "derived",
    cycle: {
      cycle_start: cycleStart,
      cycle_end: cycleEnd,
      committed: 0,
      completed: 0,
      canceled: 0,
      rescheduledOut: 0,
      open: 0,
      targetCountSnapshot: recurrenceTargetCount,
      result: activeCycleResult(0, recurrenceTargetCount),
    },
  };
}

/**
 * Goal Engine Phase 2D-5E: a cycle is historical once the local date has
 * advanced strictly past its cycle_end -- a same-day Daily cycle
 * (cycle_start === cycle_end === today) stays active all day and only
 * becomes historical the next day, with no special-casing per
 * frequency (the same plain string comparison applies uniformly).
 * Local "YYYY-MM-DD" string comparison only, same convention as
 * findCurrentCycle above -- never Date/toISOString().
 */
export function isCycleFinished(cycle: { cycle_end: string }, todayISO: string): boolean {
  return cycle.cycle_end < todayISO;
}

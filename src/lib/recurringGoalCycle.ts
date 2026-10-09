// Goal Engine Phase 2D-5A: pure Recurring Goal cycle-boundary arithmetic.
// No Supabase I/O, no presentation -- resolveOrCreateCycle (db.ts) is the
// only caller that turns this into a persisted row. Deliberately NOT a
// general recurrence-rule engine: three frequencies, each with one fixed
// rule, nothing configurable beyond what's listed below.
//
// LOCAL DATE ARITHMETIC ONLY. Every date here is a "YYYY-MM-DD" string
// parsed via `new Date(\`${iso}T00:00:00\`)` (no timezone suffix, so the
// runtime parses it as local midnight) and formatted back via
// toISODate() -- the same convention already used throughout db.ts
// (e.g. materializeReschedules, the overdue-reminder window). Never
// toISOString(): that reinterprets a local Date as UTC and can shift the
// date by one day depending on the viewer's offset.

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export type CycleRange = {
  cycleStart: string;
  cycleEnd: string;
};

function parseLocalDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

function formatLocalDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addLocalDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Calendar-day difference computed off each date's own local Y/M/D,
// promoted into synthetic UTC ms purely for integer day-counting (never
// used for display/storage) -- avoids a +-1 day error from DST
// transitions that plain (date.getTime() - other.getTime()) / 86400000
// would be exposed to when the two local midnights span a clock change.
function daysBetween(fromDate: Date, toDate: Date): number {
  const fromUTC = Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const toUTC = Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((toUTC - fromUTC) / 86400000);
}

/** Last calendar day of the month containing `date`, same year/month. */
function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * A Recurring Goal should never silently manufacture a cycle before its
 * own configured start -- that would backdate accountability history
 * for a period the Goal didn't exist as "recurring" yet. Callers (e.g.
 * resolveOrCreateCycle) must not catch this and fall back to some
 * default range; the correct response is to reject the date entirely
 * (e.g. refuse to schedule a Task there under this Goal).
 */
export class CycleBeforeRecurrenceStartError extends Error {
  constructor(targetDate: string, recurrenceStartDate: string) {
    super(`Target date ${targetDate} is before recurrence start date ${recurrenceStartDate}`);
    this.name = "CycleBeforeRecurrenceStartError";
  }
}

/**
 * Computes the [cycleStart, cycleEnd] window containing `targetDate`,
 * given a Goal's recurrence frequency and start-date anchor. Pure,
 * synchronous, throws CycleBeforeRecurrenceStartError for
 * targetDate < recurrenceStartDate (daily/weekly/monthly alike).
 *
 * DAILY: targetDate is its own one-day cycle.
 *
 * WEEKLY: recurrenceStartDate anchors consecutive 7-day windows
 * (anchor..anchor+6, anchor+7..anchor+13, ...); targetDate's window is
 * found by flooring the day-offset from the anchor to the nearest
 * multiple of 7.
 *
 * MONTHLY: the first cycle runs from recurrenceStartDate through the
 * last day of THAT calendar month (can be a short, partial first
 * cycle); every later cycle is a full calendar month (1st..last day).
 * targetDate's cycle is found by comparing it against the first
 * cycle's end, then walking whole-month boundaries from there.
 */
export function computeCycleRange(params: {
  frequency: RecurrenceFrequency;
  recurrenceStartDate: string;
  targetDate: string;
}): CycleRange {
  const { frequency, recurrenceStartDate, targetDate } = params;
  const anchor = parseLocalDate(recurrenceStartDate);
  const target = parseLocalDate(targetDate);

  if (target.getTime() < anchor.getTime()) {
    throw new CycleBeforeRecurrenceStartError(targetDate, recurrenceStartDate);
  }

  if (frequency === "daily") {
    return { cycleStart: targetDate, cycleEnd: targetDate };
  }

  if (frequency === "weekly") {
    const dayOffset = daysBetween(anchor, target);
    const windowIndex = Math.floor(dayOffset / 7);
    const cycleStart = addLocalDays(anchor, windowIndex * 7);
    const cycleEnd = addLocalDays(cycleStart, 6);
    return { cycleStart: formatLocalDate(cycleStart), cycleEnd: formatLocalDate(cycleEnd) };
  }

  // monthly
  const firstCycleEnd = endOfMonth(anchor);
  if (target.getTime() <= firstCycleEnd.getTime()) {
    return { cycleStart: recurrenceStartDate, cycleEnd: formatLocalDate(firstCycleEnd) };
  }
  const cycleStart = startOfMonth(target);
  const cycleEnd = endOfMonth(target);
  return { cycleStart: formatLocalDate(cycleStart), cycleEnd: formatLocalDate(cycleEnd) };
}

// Goal Engine Phase 2C-2: pure destination-URL logic for "take me to where
// this Task is currently scheduled and actionable" navigation (Dashboard/
// Goal Detail -> Today/Tomorrow/a calendar date). Deliberately isolated
// from src/lib/supabase/db.ts -- this is pure routing/string logic with no
// Supabase I/O, a different concern from that file's data-layer focus,
// even though a couple of similarly-pure date helpers (toISODate/addDays)
// already live there for other reasons.

/**
 * Builds the execution-page URL for a Task's current scheduled date,
 * carrying the terminal id (for the destination's fast-path DOM lookup)
 * and the root id (for the destination's fallback re-resolution if the
 * terminal id is no longer the live one by the time it loads -- see
 * getConceptualTaskById, Phase 2C-1).
 *
 * Returns null when there's no valid scheduled date to send the user to
 * -- deliberately never invents a destination (e.g. for a standalone
 * Task row with a null plan_date, which shouldn't normally happen since
 * goals.plan_id is NOT NULL, but is handled defensively rather than
 * assumed away).
 */
export function getTaskExecutionDestination(params: {
  planDate: string | null;
  todayISO: string;
  tomorrowISO: string;
  terminalId: string;
  rootId: string;
}): string | null {
  const { planDate, todayISO, tomorrowISO, terminalId, rootId } = params;
  if (!planDate) return null;

  const search = new URLSearchParams({ goal: terminalId, root: rootId }).toString();

  if (planDate === todayISO) return `/standup/today?${search}`;
  if (planDate === tomorrowISO) return `/standup/tomorrow?${search}`;
  return `/standup/date/${planDate}?${search}`;
}

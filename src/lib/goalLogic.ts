import type { Goal } from "@/lib/supabase/db";

export type DraftGoal = Partial<Goal> & {
  title: string;
  sort_order: number;
  priority?: number;
};

export const MAX_GOALS = 10;
export const DEFAULT_PRIORITY = 3;
export const DEMOTED_PRIORITY = 2;

export function normalizeGoals(goals: DraftGoal[]) {
  return goals.map((g, idx) => ({
    ...g,
    sort_order: idx,
    title: (g.title ?? "").trim(),
    priority:
      typeof g.priority === "number" && Number.isFinite(g.priority)
        ? g.priority
        : DEFAULT_PRIORITY,
  }));
}

export function compactForUI(dbGoals: Goal[]) {
  const sorted = [...dbGoals]
    .map((g) => ({
      ...g,
      title: (g.title ?? "").toString(),
      sort_order: Number.isFinite(g.sort_order) ? g.sort_order : 0,
      priority:
        typeof g.priority === "number" && Number.isFinite(g.priority)
          ? g.priority
          : DEFAULT_PRIORITY,
    }))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const nonEmpty = sorted.filter((g) => (g.title ?? "").trim().length > 0);

  const compacted: DraftGoal[] = nonEmpty.map((g, idx) => ({
    ...g,
    title: (g.title ?? "").toString(),
    sort_order: idx,
    priority:
      typeof g.priority === "number" && Number.isFinite(g.priority)
        ? g.priority
        : DEFAULT_PRIORITY,
  }));

  // Pads with blank rows purely so there are always at least 3 entry
  // boxes to type into -- the 3-commitment minimum is a submission rule
  // (enforced by each page's own canSubmit/submit check), not something
  // this display-only padding decides; no position here is "required."
  while (compacted.length < 3) {
    compacted.push({
      title: "",
      sort_order: compacted.length,
      priority: DEFAULT_PRIORITY,
    });
  }

  return compacted.slice(0, Math.max(3, MAX_GOALS));
}

/**
 * Position-agnostic: a Commitment is any non-empty Task, wherever it sits
 * in the array -- there is no "first 3" slot with special status. Keeps
 * every non-empty row (trimmed), reindexes sort_order, and caps at
 * MAX_GOALS. Does not pad to a minimum -- the 3-commitment minimum is a
 * submission rule each page checks directly (total non-empty count), not
 * something this function enforces by shape; a caller saving a draft with
 * 0, 1, or 2 Tasks gets back exactly that many; save/autosave reflects
 * real state, and separately gates whether that state can be submitted.
 */
export function compactForSave(current: DraftGoal[]) {
  return normalizeGoals(current)
    .map((g) => ({ ...g, title: (g.title ?? "").trim() }))
    .filter((g) => g.title.length > 0)
    .slice(0, MAX_GOALS)
    .map((g, idx) => ({
      ...g,
      sort_order: idx,
      priority:
        typeof g.priority === "number" && Number.isFinite(g.priority)
          ? g.priority
          : DEFAULT_PRIORITY,
    }));
}

/**
 * Display order only, never persisted — P1 sorts to the top, then P2, etc.,
 * with tied priorities keeping their relative array order. Returns each
 * goal paired with its real index in the input array (`originalIdx`) so a
 * caller can still drive drag/priority/remove handlers against the true
 * underlying array position — no position is structurally special (see
 * compactForSave, which is position-agnostic), this function just never
 * reorders the real array regardless.
 */
export function sortGoalsForDisplay<T extends { priority?: number }>(goals: T[]): { g: T; originalIdx: number }[] {
  return goals
    .map((g, originalIdx) => ({ g, originalIdx }))
    .sort((a, b) => {
      const ap =
        typeof a.g.priority === "number" && Number.isFinite(a.g.priority) ? a.g.priority : DEFAULT_PRIORITY;
      const bp =
        typeof b.g.priority === "number" && Number.isFinite(b.g.priority) ? b.g.priority : DEFAULT_PRIORITY;
      if (ap !== bp) return ap - bp;
      return a.originalIdx - b.originalIdx;
    });
}

export function applyPriorityChange(prev: DraftGoal[], idx: number, newP: number) {
  const next = prev.map((g) => ({ ...g }));
  next[idx].priority = newP;

  if (newP === 1) {
    for (let i = 0; i < next.length; i++) {
      if (i !== idx && (next[i].priority ?? DEFAULT_PRIORITY) === 1) {
        next[i].priority = DEMOTED_PRIORITY;
      }
    }
  }

  return next;
}

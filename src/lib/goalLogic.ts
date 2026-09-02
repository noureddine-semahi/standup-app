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

  while (compacted.length < 3) {
    compacted.push({
      title: "",
      sort_order: compacted.length,
      priority: DEFAULT_PRIORITY,
    });
  }

  for (let i = 0; i < Math.min(3, compacted.length); i++) {
    if (
      typeof compacted[i].priority !== "number" ||
      !Number.isFinite(compacted[i].priority)
    ) {
      compacted[i].priority = DEFAULT_PRIORITY;
    }
  }

  return compacted.slice(0, Math.max(3, MAX_GOALS));
}

export function compactForSave(current: DraftGoal[]) {
  const normalized = normalizeGoals(current);

  const first3 = normalized.slice(0, 3).map((g) => ({
    ...g,
    title: (g.title ?? "").trim(),
    priority:
      typeof g.priority === "number" && Number.isFinite(g.priority)
        ? g.priority
        : DEFAULT_PRIORITY,
  }));

  const optionalNonEmpty = normalized
    .slice(3)
    .map((g) => ({ ...g, title: (g.title ?? "").trim() }))
    .filter((g) => g.title.length > 0);

  const combined: DraftGoal[] = [...first3, ...optionalNonEmpty]
    .slice(0, MAX_GOALS)
    .map((g, idx) => ({
      ...g,
      sort_order: idx,
      priority:
        typeof g.priority === "number" && Number.isFinite(g.priority)
          ? g.priority
          : DEFAULT_PRIORITY,
    }));

  while (combined.length < 3) {
    combined.push({
      title: "",
      sort_order: combined.length,
      priority: DEFAULT_PRIORITY,
    });
  }

  for (let i = 0; i < 3; i++) {
    combined[i] = {
      ...combined[i],
      priority:
        typeof combined[i].priority === "number" &&
        Number.isFinite(combined[i].priority)
          ? combined[i].priority
          : DEFAULT_PRIORITY,
    };
  }

  return combined;
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

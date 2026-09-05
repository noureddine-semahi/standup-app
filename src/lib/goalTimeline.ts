import { formatDateDisplay, type GoalStatus } from "@/lib/supabase/db";
import { statusLabel } from "@/lib/goalStatus";

export type TimelineEntry = {
  key: string;
  kind: "history" | "note";
  label: string;
  timestamp: string;
};

export type TimelineNote = {
  id?: string;
  note: string;
  created_at: string;
  kind?: string;
};

export type TimelineGoal = {
  created_at?: string | null;
  reviewed_at?: string | null;
  status?: GoalStatus | null;
  rescheduled_to?: string | null;
  reschedule_reason?: string | null;
};

/**
 * One chronological timeline per goal, ascending (creation first, most
 * recent action last) — shared by Review Today and a past day's archive
 * view so the two never drift apart.
 *
 * Status changes, priority changes, reviews, and reschedules are logged as
 * their own timestamped `goal_notes` row the moment they happen (see
 * logGoalEvent in db.ts), distinguished from real user notes by `kind`.
 * Goals actioned before that logging existed have no such row, so this
 * falls back to a synthesized entry from the goal's own current-state
 * fields (reviewed_at/status/rescheduled_to) using the best real timestamp
 * available — only when no real logged event of that kind exists yet, so
 * it never duplicates once an action gets logged live.
 */
export function buildGoalTimeline(goal: TimelineGoal, notes: TimelineNote[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  if (goal.created_at) {
    entries.push({ key: "created", kind: "history", label: "Goal created", timestamp: goal.created_at });
  }

  notes.forEach((note, i) => {
    entries.push({
      key: note.id ?? `note-${i}`,
      kind: note.kind && note.kind !== "note" ? "history" : "note",
      label: note.note,
      timestamp: note.created_at,
    });
  });

  const hasLoggedKind = (kind: string) => notes.some((n) => n.kind === kind);
  const fallbackTimestamp = goal.reviewed_at ?? goal.created_at ?? new Date(0).toISOString();

  if (goal.reviewed_at && !hasLoggedKind("reviewed")) {
    entries.push({
      key: "reviewed-fallback",
      kind: "history",
      label: "Marked as reviewed",
      timestamp: goal.reviewed_at,
    });
  }

  if (goal.status && goal.status !== "not_started" && !hasLoggedKind("status_change")) {
    entries.push({
      key: "status-fallback",
      kind: "history",
      label: `Status: ${statusLabel(goal.status)}`,
      timestamp: fallbackTimestamp,
    });
  }

  if (goal.rescheduled_to && !hasLoggedKind("rescheduled")) {
    entries.push({
      key: "rescheduled-fallback",
      kind: "history",
      label: `Rescheduled to ${formatDateDisplay(goal.rescheduled_to)}${
        goal.reschedule_reason ? ` — "${goal.reschedule_reason}"` : ""
      }`,
      timestamp: fallbackTimestamp,
    });
  }

  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return entries;
}

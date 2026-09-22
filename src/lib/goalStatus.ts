import type { GoalStatus } from "@/lib/supabase/db";
import type { TranslationKey } from "@/lib/i18n/en";

// "postponed" is never set anywhere except rescheduleGoalToDate() — there is
// no other action in the app that produces it — so it's really the same
// event as being rescheduled, not a distinct outcome. Every display below
// treats it that way rather than as its own separate "Postponed" state.
//
// Takes `t` (the useLanguage() hook's translate function) rather than
// returning a literal string, since this is a plain function outside React
// — it has no way to know the current language on its own.
export function statusLabel(status: GoalStatus, t: (key: TranslationKey) => string) {
  switch (status) {
    case "not_started": return t("status.notStarted");
    case "in_progress": return t("status.inProgress");
    case "completed": return t("status.completed");
    case "attempted": return t("status.attempted");
    case "postponed": return t("status.rescheduled");
    case "blocked": return t("status.blocked");
    case "canceled": return t("status.canceled");
    default: return status;
  }
}

export function statusPillClass(status: GoalStatus) {
  switch (status) {
    case "completed": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "in_progress": return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    case "blocked": return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "postponed": return "bg-purple-500/15 text-purple-300 border-purple-500/30";
    case "attempted": return "bg-purple-500/15 text-purple-300 border-purple-500/30";
    case "canceled": return "bg-slate-500/15 text-slate-300 border-slate-500/30";
    case "not_started":
    default: return "bg-white/10 text-white/70 border-white/20";
  }
}

export type StatusChipColors = { bg: string; border: string; color: string };

// Distinct color per status, used for the compact status chip (styled like
// .priority-select). `color` references a --status-X CSS variable
// (globals.css) rather than a literal hex, so it re-tints darker for light
// mode automatically — see the comment on --priority-1 there for why.
export function statusChipColors(status: GoalStatus): StatusChipColors {
  switch (status) {
    case "completed":
      return { bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.45)", color: "var(--status-completed)" };
    case "in_progress":
      return { bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.45)", color: "var(--status-in-progress)" };
    case "blocked":
      return { bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.45)", color: "var(--status-blocked)" };
    case "postponed":
      return { bg: "rgba(168, 85, 247, 0.12)", border: "rgba(168, 85, 247, 0.45)", color: "var(--status-postponed)" };
    case "attempted":
      return { bg: "rgba(168, 85, 247, 0.12)", border: "rgba(168, 85, 247, 0.45)", color: "var(--status-postponed)" };
    case "canceled":
      return { bg: "rgba(100, 116, 139, 0.15)", border: "rgba(100, 116, 139, 0.5)", color: "var(--status-canceled)" };
    case "not_started":
    default:
      return { bg: "rgba(var(--tint-rgb), 0.06)", border: "rgba(var(--tint-rgb), 0.18)", color: "rgba(var(--tint-rgb), 0.7)" };
  }
}

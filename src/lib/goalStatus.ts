import type { GoalStatus } from "@/lib/supabase/db";

export function statusLabel(status: GoalStatus) {
  switch (status) {
    case "not_started": return "Not started";
    case "in_progress": return "In progress";
    case "completed": return "Completed";
    case "attempted": return "Attempted";
    case "postponed": return "Postponed";
    case "blocked": return "Blocked";
    case "canceled": return "Canceled";
    default: return status;
  }
}

export function statusPillClass(status: GoalStatus) {
  switch (status) {
    case "completed": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "in_progress": return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    case "blocked": return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "postponed": return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "attempted": return "bg-purple-500/15 text-purple-300 border-purple-500/30";
    case "canceled": return "bg-slate-500/15 text-slate-300 border-slate-500/30";
    case "not_started":
    default: return "bg-white/10 text-white/70 border-white/20";
  }
}

export function statusIcon(status: GoalStatus) {
  switch (status) {
    case "completed": return "✅";
    case "in_progress": return "⚙️";
    case "blocked": return "🚫";
    case "postponed": return "⏸️";
    case "attempted": return "🔸";
    case "canceled": return "❌";
    case "not_started":
    default: return "✓";
  }
}

export type StatusChipColors = { bg: string; border: string; color: string };

// Distinct color per status, used for the compact status chip (styled like .priority-select).
export function statusChipColors(status: GoalStatus): StatusChipColors {
  switch (status) {
    case "completed":
      return { bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.45)", color: "#6ee7b7" };
    case "in_progress":
      return { bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.45)", color: "#93c5fd" };
    case "blocked":
      return { bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.45)", color: "#fca5a5" };
    case "postponed":
      return { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.45)", color: "#fcd34d" };
    case "attempted":
      return { bg: "rgba(168, 85, 247, 0.12)", border: "rgba(168, 85, 247, 0.45)", color: "#d8b4fe" };
    case "canceled":
      return { bg: "rgba(100, 116, 139, 0.15)", border: "rgba(100, 116, 139, 0.5)", color: "#cbd5e1" };
    case "not_started":
    default:
      return { bg: "rgba(255, 255, 255, 0.06)", border: "rgba(255, 255, 255, 0.18)", color: "rgba(255, 255, 255, 0.7)" };
  }
}

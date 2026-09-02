export type PriorityMeta = {
  label: string;
  color: string;
  bg: string;
  border: string;
};

export const PRIORITY_META: Record<number, PriorityMeta> = {
  1: { label: "Highest", color: "#f87171", bg: "rgba(239, 68, 68, 0.10)", border: "rgba(239, 68, 68, 0.35)" },
  2: { label: "High", color: "#fb923c", bg: "rgba(249, 115, 22, 0.10)", border: "rgba(249, 115, 22, 0.35)" },
  3: { label: "Medium", color: "#facc15", bg: "rgba(250, 204, 21, 0.10)", border: "rgba(250, 204, 21, 0.35)" },
  4: { label: "Low", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.08)", border: "rgba(148, 163, 184, 0.28)" },
  5: { label: "Lowest", color: "#64748b", bg: "rgba(71, 85, 105, 0.08)", border: "rgba(71, 85, 105, 0.28)" },
};

export function getPriorityMeta(priority: number): PriorityMeta {
  return PRIORITY_META[priority] ?? PRIORITY_META[3];
}

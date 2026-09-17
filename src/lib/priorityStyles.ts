export type PriorityMeta = {
  label: string;
  color: string;
  bg: string;
  border: string;
};

// `color` references the --priority-N CSS variable (globals.css) rather
// than a literal hex, so every consumer (priority chips, the goal card's
// whole border) re-tints darker for light mode automatically — the same
// pastel that pops on a dark canvas is near-invisible as text on a light
// one. `bg`/`border` stay literal low-opacity rgba; translucent overlays
// don't have the same contrast problem flat text does.
export const PRIORITY_META: Record<number, PriorityMeta> = {
  1: { label: "Highest", color: "var(--priority-1)", bg: "rgba(239, 68, 68, 0.10)", border: "rgba(239, 68, 68, 0.35)" },
  2: { label: "High", color: "var(--priority-2)", bg: "rgba(249, 115, 22, 0.10)", border: "rgba(249, 115, 22, 0.35)" },
  3: { label: "Medium", color: "var(--priority-3)", bg: "rgba(250, 204, 21, 0.10)", border: "rgba(250, 204, 21, 0.35)" },
  4: { label: "Low", color: "var(--priority-4)", bg: "rgba(148, 163, 184, 0.08)", border: "rgba(148, 163, 184, 0.28)" },
  5: { label: "Lowest", color: "var(--priority-5)", bg: "rgba(71, 85, 105, 0.08)", border: "rgba(71, 85, 105, 0.28)" },
};

export function getPriorityMeta(priority: number): PriorityMeta {
  return PRIORITY_META[priority] ?? PRIORITY_META[3];
}

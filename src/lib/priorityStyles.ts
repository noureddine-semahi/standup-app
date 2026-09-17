import type { TranslationKey } from "@/lib/i18n/en";

// `label` is a translation key, not the literal text — this is a plain
// object outside React with no way to know the current language on its
// own, so the one consumer (RescheduleModal) calls t(opt.label) itself.
export type PriorityMeta = {
  label: TranslationKey;
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
  1: { label: "priority.highest", color: "var(--priority-1)", bg: "rgba(239, 68, 68, 0.10)", border: "rgba(239, 68, 68, 0.35)" },
  2: { label: "priority.high", color: "var(--priority-2)", bg: "rgba(249, 115, 22, 0.10)", border: "rgba(249, 115, 22, 0.35)" },
  3: { label: "priority.medium", color: "var(--priority-3)", bg: "rgba(250, 204, 21, 0.10)", border: "rgba(250, 204, 21, 0.35)" },
  4: { label: "priority.low", color: "var(--priority-4)", bg: "rgba(148, 163, 184, 0.08)", border: "rgba(148, 163, 184, 0.28)" },
  5: { label: "priority.lowest", color: "var(--priority-5)", bg: "rgba(71, 85, 105, 0.08)", border: "rgba(71, 85, 105, 0.28)" },
};

export function getPriorityMeta(priority: number): PriorityMeta {
  return PRIORITY_META[priority] ?? PRIORITY_META[3];
}

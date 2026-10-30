"use client";

import { ChevronDown, Maximize2, Minus, X } from "lucide-react";

// The integrated window-control trio at a goal card's upper-right corner:
// EXPAND | COLLAPSE | CLOSE, one connected piece of hardware (a shared steel
// housing around three adjacent chambers -- see .goal-ctl-bar in
// globals.css). Purple = full screen, green = collapse <-> restore (one
// toggle), red = close. Purely presentational: it owns no state and no card
// logic.
// Each chamber is its own real <button>; the caller passes the card's
// EXISTING handler for each action (or nothing, in which case the chamber
// stays physically present but dimmed and inert, so the assembly's
// geometry never changes with card state).
type Chamber = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  // Collapse chamber only: the card is currently collapsed, so the same
  // toggle now RESTORES it (icon changes; the chamber stays actionable).
  restore?: boolean;
};

export default function GoalCardControls({
  groupLabel,
  expand,
  collapse,
  close,
  className,
}: {
  groupLabel: string;
  expand: Chamber;
  collapse: Chamber;
  close: Chamber;
  className?: string;
}) {
  const chambers: Array<[string, Chamber, React.ReactNode]> = [
    ["expand", expand, <Maximize2 key="i" size={13} strokeWidth={2.4} />],
    [
      "collapse",
      collapse,
      collapse.restore ? <ChevronDown key="i" size={14} strokeWidth={3} /> : <Minus key="i" size={14} strokeWidth={2.8} />,
    ],
    ["close", close, <X key="i" size={14} strokeWidth={2.6} />],
  ];
  return (
    <div className={`goal-ctl-bar${className ? ` ${className}` : ""}`} role="group" aria-label={groupLabel}>
      {chambers.map(([kind, c, icon]) => (
        <button
          key={kind}
          type="button"
          className={`goal-ctl goal-ctl--${kind}`}
          onClick={c.onClick}
          disabled={c.disabled || !c.onClick}
          title={c.label}
          aria-label={c.label}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

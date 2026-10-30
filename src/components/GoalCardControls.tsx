"use client";

import { ChevronDown, Maximize2, Minimize2, Minus, X } from "lucide-react";

// The integrated window-control trio of a goal card: FULL SCREEN | COLLAPSE |
// CLOSE, one connected piece of hardware (a shared steel housing around
// three adjacent chambers -- see .goal-ctl-bar in globals.css).
//   purple  = full-screen toggle (normal <-> full screen)
//   green   = collapse <-> restore toggle (normal <-> collapsed row)
//   red     = delete / remove, with the card's existing eligibility
// Purely presentational: it owns no state and no card logic. Each chamber is
// its own real <button>; the caller passes the card's EXISTING handler for
// each action (or nothing, in which case the chamber stays physically
// present but dimmed and inert, so the assembly's geometry never changes
// with card state).
type Chamber = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
};

export default function GoalCardControls({
  groupLabel,
  expand,
  collapse,
  close,
  fullScreen = false,
  collapsed = false,
  className,
}: {
  groupLabel: string;
  expand: Chamber;
  collapse: Chamber;
  close: Chamber;
  // The card is currently shown full screen: the purple chamber then shows
  // the exit icon (the caller supplies the matching label / handler).
  fullScreen?: boolean;
  // The card is currently a collapsed row: the green chamber then shows the
  // restore icon (it stays actionable -- the same toggle restores it).
  collapsed?: boolean;
  className?: string;
}) {
  const chambers: Array<[string, Chamber, string, React.ReactNode]> = [
    [
      "expand",
      expand,
      fullScreen ? "fullscreen" : "normal",
      fullScreen ? <Minimize2 key="i" size={13} strokeWidth={2.4} /> : <Maximize2 key="i" size={13} strokeWidth={2.4} />,
    ],
    [
      "collapse",
      collapse,
      collapsed ? "restore" : "collapse",
      collapsed ? <ChevronDown key="i" size={14} strokeWidth={3} /> : <Minus key="i" size={14} strokeWidth={2.8} />,
    ],
    ["close", close, "delete", <X key="i" size={14} strokeWidth={2.6} />],
  ];
  return (
    <div className={`goal-ctl-bar${className ? ` ${className}` : ""}`} role="group" aria-label={groupLabel}>
      {chambers.map(([kind, c, state, icon]) => (
        <button
          key={kind}
          type="button"
          className={`goal-ctl goal-ctl--${kind}`}
          data-state={state}
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

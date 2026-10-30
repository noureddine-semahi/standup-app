"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { ChevronDown, Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// The window controls of a goal card: FULL SCREEN | COLLAPSE | REMOVE, one
// connected piece of hardware (a shared steel housing around three adjacent
// chambers -- see .goal-ctl-bar in globals.css).
//   purple  = full-screen toggle (normal <-> full screen)
//   green   = collapse <-> restore toggle (normal <-> collapsed row)
//   red     = remove request (the caller opens a confirmation first)
// Purely presentational: it owns no card logic. Each chamber is its own real
// <button>; the caller passes the card's EXISTING handler for each action (or
// nothing, in which case the chamber stays physically present but dimmed and
// inert, so the assembly's geometry never changes with card state).
//
// On desktop the three chambers are always exposed. On phones the assembly
// rests as a compact "pill" with three dots; tapping it unfolds the same
// housing into the three chambers. Only one pill is open at a time (a tiny
// module-level store, since the cards are siblings with no shared parent), a
// tap outside closes it without activating whatever is underneath, and a
// non-destructive action closes it again. `pinned` keeps it permanently open
// (full screen, nested task rows). All of this is presentation state: it never
// touches goal data, saves or submits.
type Chamber = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
};

let openPillId: string | null = null;
const pillListeners = new Set<() => void>();
function setOpenPill(id: string | null) {
  if (openPillId === id) return;
  openPillId = id;
  pillListeners.forEach((l) => l());
}
function subscribePill(l: () => void) {
  pillListeners.add(l);
  return () => {
    pillListeners.delete(l);
  };
}
const getOpenPill = () => openPillId;
const getServerOpenPill = () => null;

/** Closes whichever card's pill is open (e.g. after a remove confirmation). */
export function closeGoalCardPills() {
  setOpenPill(null);
}

export default function GoalCardControls({
  groupLabel,
  expand,
  collapse,
  close,
  fullScreen = false,
  collapsed = false,
  pinned = false,
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
  // Keep the three chambers exposed on every viewport (no pill).
  pinned?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openId = useSyncExternalStore(subscribePill, getOpenPill, getServerOpenPill);
  const open = pinned || openId === id;

  // Tap outside closes the pill and swallows that one click, so the tap can't
  // also activate whatever control happens to be underneath.
  useEffect(() => {
    if (pinned || openId !== id) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
      setOpenPill(null);
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 450);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [id, openId, pinned]);

  // A card that unmounts while open must not leave a stale open id behind.
  useEffect(() => {
    return () => {
      if (openPillId === id) setOpenPill(null);
    };
  }, [id]);

  const chambers: Array<[string, Chamber, string, React.ReactNode, boolean]> = [
    [
      "expand",
      expand,
      fullScreen ? "fullscreen" : "normal",
      fullScreen ? <Minimize2 key="i" size={13} strokeWidth={2.4} /> : <Maximize2 key="i" size={13} strokeWidth={2.4} />,
      true,
    ],
    [
      "collapse",
      collapse,
      collapsed ? "restore" : "collapse",
      collapsed ? <ChevronDown key="i" size={14} strokeWidth={3} /> : <Minus key="i" size={14} strokeWidth={2.8} />,
      true,
    ],
    // Remove never closes the pill by itself: it opens a confirmation, and
    // that flow closes the pill when it ends.
    ["close", close, "delete", <X key="i" size={14} strokeWidth={2.6} />, false],
  ];

  return (
    <div
      ref={rootRef}
      className={`goal-ctl-bar${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={groupLabel}
      data-open={open ? "true" : "false"}
      data-pinned={pinned ? "true" : "false"}
    >
      <button
        type="button"
        className="goal-ctl-pill"
        aria-label={t("goalCard.showControls")}
        aria-expanded={open}
        tabIndex={open ? -1 : 0}
        onClick={() => setOpenPill(id)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <div className="goal-ctl-chambers">
        {chambers.map(([kind, c, state, icon, closesPill]) => (
          <button
            key={kind}
            type="button"
            className={`goal-ctl goal-ctl--${kind}`}
            data-state={state}
            onClick={() => {
              c.onClick?.();
              if (closesPill) setOpenPill(null);
            }}
            disabled={c.disabled || !c.onClick}
            title={c.label}
            aria-label={c.label}
            tabIndex={open ? 0 : -1}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}

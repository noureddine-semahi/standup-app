"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import SwitchLed from "@/components/SwitchLed";

// Compact slide-to-logout control for the avatar dropdown: the same 40x22
// track and 16px knob as ThemeToggle / LanguageToggle, with a restrained red
// accent. Dragging the knob all the way to the far end asks for confirmation
// (LogoutConfirmModal); letting go anywhere short of the end snaps it back, and
// a plain tap does nothing. It never logs out by itself, and nothing is
// persisted -- the knob only rests at the end while the confirmation or the
// logout itself is in flight. Track styling is inline (like the other two
// toggles) so it can't be lost to stylesheet ordering/caching.
const RED = "#e5484d";
const WIDTH = 40;
const HEIGHT = 22;
const KNOB = 16;
const TRAVEL = WIDTH - KNOB - 4;

export default function LogoutSwitch({
  active,
  disabled,
  onRequest,
}: {
  active: boolean;
  disabled?: boolean;
  onRequest: () => void;
}) {
  const { t } = useLanguage();
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onRequestRef = useRef(onRequest);
  useEffect(() => {
    onRequestRef.current = onRequest;
  });
  // Drop any in-flight window listeners if the control unmounts mid-drag.
  useEffect(() => () => cleanupRef.current?.(), []);

  const x = active ? TRAVEL : dragX;
  const progress = x / TRAVEL;

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (disabled || active || (e.pointerType === "mouse" && e.button !== 0)) return;
    // No text selection / native drag while sliding.
    e.preventDefault();
    const startX = e.clientX;
    let delta = 0;
    setDragging(true);

    // Window-level tracking (not just pointer capture) so a real browser that
    // cancels the pointer or leaves the button mid-slide can't strand the drag.
    const move = (ev: PointerEvent) => {
      delta = Math.min(TRAVEL, Math.max(0, ev.clientX - startX));
      setDragX(delta);
    };
    const finish = (ev: PointerEvent) => {
      if (ev.type === "pointerup") delta = Math.min(TRAVEL, Math.max(0, ev.clientX - startX));
      cleanup();
      setDragging(false);
      setDragX(0);
      // A cancel counts by how far the knob had got, so the slide isn't lost
      // to the browser interrupting the gesture right at the end.
      if (delta >= TRAVEL - 1) onRequestRef.current();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      cleanupRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    cleanupRef.current = cleanup;
  }

  return (
    <span className="logout-switch inline-flex items-center flex-shrink-0" style={{ gap: "6px" }}>
      <span aria-hidden="true" className="logout-switch-icon inline-flex" style={{ lineHeight: 1, color: RED }}>
        <LogOut size={12} />
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={t("nav.logout")}
        title={t("nav.logoutSlideHint")}
        disabled={disabled}
        // Pointer taps are ignored (slide required); a keyboard / assistive-tech
        // activation arrives with detail === 0 and asks for confirmation directly.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.detail === 0 && !active) onRequest();
          // A pointer tap isn't enough -- nudge the knob so it's clear it must be slid.
          else if (!active && !disabled) {
            setDragX(8);
            window.setTimeout(() => setDragX(0), 220);
          }
        }}
        className="logout-switch-track relative rounded-full flex-shrink-0"
        style={{
          width: `${WIDTH}px`,
          height: `${HEIGHT}px`,
          padding: 0,
          cursor: disabled ? "default" : "grab",
          opacity: disabled ? 0.6 : 1,
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          background: `linear-gradient(to bottom, rgba(255,255,255,0.12) 0%, transparent 45%), linear-gradient(to right, rgba(239,68,72,${0.12 + progress * 0.7}), rgba(239,68,72,${0.06 + progress * 0.6})), rgba(var(--tint-rgb),0.12)`,
          border: `1px solid rgba(239,68,72,${0.4 + progress * 0.4})`,
          boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.1), inset 0 -1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px -1px rgba(0,0,0,0.3)${progress > 0.6 ? ", 0 0 8px -1px rgba(239,68,72,0.7)" : ""}`,
        }}
        onPointerDown={onPointerDown}
        onDragStart={(e) => e.preventDefault()}
      >
        <span
          className="absolute rounded-full"
          style={{
            width: `${KNOB}px`,
            height: `${KNOB}px`,
            top: "2px",
            left: "2px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "radial-gradient(circle at 32% 28%, #ffffff 0%, #e4e9f0 45%, #a8b2c0 100%)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.45), inset 0 1px 1px 0 rgba(255,255,255,0.9), inset 0 -1px 1px 0 rgba(0,0,0,0.12)",
            transform: `translateX(${x}px)`,
            transition: dragging ? "none" : "transform 0.2s ease",
          }}
        >
          <SwitchLed color={active || progress > 0.5 ? "#ef4444" : "#22c55e"} size={8} />
        </span>
      </button>
      <span className="logout-switch-label" style={{ fontSize: "0.68rem", lineHeight: 1, fontWeight: 700, color: RED }}>
        {active && disabled ? t("nav.loggingOut") : t("nav.logout")}
      </span>
    </span>
  );
}

/** Confirmation shown before the existing logout handler runs. Cancel / Escape / backdrop leave the session untouched. */
export function LogoutConfirmModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelHandlerRef = useRef(onCancel);
  const busyRef = useRef(busy);
  useEffect(() => {
    cancelHandlerRef.current = onCancel;
    busyRef.current = busy;
  });

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) cancelHandlerRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div className="confirm-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="logout-confirm-title"
        aria-describedby="logout-confirm-body"
      >
        <div className="confirm-modal-icon" aria-hidden="true">
          <LogOut size={22} strokeWidth={2.4} />
        </div>
        <h2 id="logout-confirm-title" className="confirm-modal-title">
          {t("nav.logoutConfirmTitle")}
        </h2>
        <p id="logout-confirm-body" className="confirm-modal-body">
          {t("nav.logoutConfirmBody")}
        </p>
        <div className="confirm-modal-actions">
          <button ref={cancelRef} type="button" className="btn standup-metal-btn confirm-modal-btn" onClick={onCancel} disabled={busy}>
            {t("today.cancel")}
          </button>
          <button
            type="button"
            className="btn standup-metal-btn standup-metal-btn--danger confirm-modal-btn"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t("nav.loggingOut") : t("nav.logout")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

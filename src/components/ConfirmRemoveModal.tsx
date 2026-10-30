"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// The shared destructive confirmation for removing a goal/task from a card's
// control bar. The red chamber only ever OPENS this; nothing is removed until
// the explicit "Remove Task" button runs the page's existing remove handler
// (passed in as onConfirm). Cancel / Escape / the backdrop leave the goal
// untouched. Remove is single-shot: while it runs, both buttons are inert.
export default function ConfirmRemoveModal({
  open,
  goalTitle,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  goalTitle: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const cancelHandlerRef = useRef(onCancel);
  cancelHandlerRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) cancelHandlerRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="confirm-modal-backdrop"
      onClick={() => {
        if (!busyRef.current) onCancel();
      }}
    >
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-remove-title"
        aria-describedby="confirm-remove-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-modal-icon" aria-hidden="true">
          <AlertTriangle size={22} strokeWidth={2.4} />
        </div>
        <h2 id="confirm-remove-title" className="confirm-modal-title">
          {t("goalCard.removeTitle")}
        </h2>
        <p id="confirm-remove-body" className="confirm-modal-body">
          {t("goalCard.removeBody", { title: goalTitle })}
        </p>
        <div className="confirm-modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn standup-metal-btn confirm-modal-btn"
            onClick={onCancel}
            disabled={busy}
          >
            {t("today.cancel")}
          </button>
          <button
            type="button"
            className="btn standup-metal-btn standup-metal-btn--danger confirm-modal-btn"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? t("goalCard.removing") : t("goalCard.removeConfirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

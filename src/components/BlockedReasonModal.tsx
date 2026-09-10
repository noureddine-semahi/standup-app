"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

type BlockedReasonModalProps = {
  goalTitle: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

/** Required-reason prompt shown before a goal is marked Blocked — the reason is saved as a real note on the goal's timeline, so a blocked goal always explains itself later. */
export default function BlockedReasonModal({ goalTitle, saving, error, onCancel, onConfirm }: BlockedReasonModalProps) {
  const [reason, setReason] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div
        className="card"
        style={{ maxWidth: "480px", width: "100%", position: "relative", zIndex: 10000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-1">What's blocking this?</h2>
        <p className="mt-1 text-sm text-white/70">
          "{goalTitle}" will be marked Blocked. The reason is saved to this goal's timeline.
        </p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={saving}
          placeholder="e.g. Waiting on approval from..."
          autoFocus
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50 resize-none"
          rows={3}
        />

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => onConfirm(reason)}
            disabled={saving || !reason.trim()}
            className="btn btn-primary flex-1"
          >
            {saving ? "Saving…" : "Mark Blocked"}
          </button>
          <button onClick={onCancel} disabled={saving} className="btn btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}

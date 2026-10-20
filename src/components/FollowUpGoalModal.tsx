"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type FollowUpGoalModalProps = {
  originTitle: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (title: string) => void;
};

/** Prompt shown when creating a "follow-up" goal for tomorrow from a resolved goal on Today's page — reused by both the toolbar button and the post-action toast offer. */
export default function FollowUpGoalModal({ originTitle, saving, error, onCancel, onConfirm }: FollowUpGoalModalProps) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(originTitle);
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
        <h2 className="text-xl font-bold mb-1">{t("today.followUpModalTitle")}</h2>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
          placeholder={t("today.followUpTitlePlaceholder")}
          autoFocus
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
        />

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => onConfirm(title)}
            disabled={saving || !title.trim()}
            className="btn standup-metal-btn standup-metal-btn--accent flex-1"
          >
            {saving ? t("today.followUpCreating") : t("today.followUpCreateButton")}
          </button>
          <button onClick={onCancel} disabled={saving} className="btn standup-metal-btn">
            {t("today.followUpCancel")}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}

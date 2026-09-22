"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Users, Globe } from "lucide-react";
import type { AchievementDef } from "@/lib/achievements";
import type { PostVisibility } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** Full-screen "just unlocked" celebration for a single achievement — the Dashboard queues these one at a time when getLifetimeStats() crosses a threshold it hasn't shown before. See markAchievementSeen/getSeenAchievementIds in the Dashboard page for why an achievement only ever shows here once. Offers sharing it to the feed right in this same moment rather than as a separate step. */
export default function AchievementUnlockedModal({
  achievement,
  onDismiss,
  onShare,
}: {
  achievement: AchievementDef;
  onDismiss: () => void;
  onShare: (visibility: PostVisibility) => void;
}) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  function handleShare(visibility: PostVisibility) {
    if (sharing) return;
    setSharing(true);
    onShare(visibility);
  }

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
        if (e.target === e.currentTarget && !sharing) onDismiss();
      }}
    >
      <div
        className="card card-highlight text-center"
        style={{
          maxWidth: "380px",
          width: "100%",
          position: "relative",
          zIndex: 10000,
          boxShadow: "0 0 60px -12px rgba(245, 158, 11, 0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs uppercase tracking-wider text-amber-300 font-semibold mb-3">
          {t("achievementModal.unlocked")}
        </div>
        <div
          className="mx-auto mb-4 flex items-center justify-center rounded-full"
          style={{
            width: "84px",
            height: "84px",
            background: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            color: "rgb(252, 211, 77)",
          }}
        >
          <achievement.icon size={40} strokeWidth={1.75} />
        </div>
        <h2 className="text-2xl font-bold mb-2">{t(achievement.titleKey)}</h2>
        <p className="text-sm text-white/70 mb-6">{t(achievement.descriptionKey)}</p>

        <p className="text-xs text-white/50 mb-2">{t("achievementModal.sharePrompt")}</p>
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => handleShare("connections")}
            disabled={sharing}
            className="btn flex-1"
            style={{ padding: "0.5rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
          >
            <Users size={14} /> {t("today.publishConnectionsBtn")}
          </button>
          <button
            type="button"
            onClick={() => handleShare("everyone")}
            disabled={sharing}
            className="btn flex-1"
            style={{ padding: "0.5rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
          >
            <Globe size={14} /> {t("today.publishEveryoneBtn")}
          </button>
        </div>
        <button onClick={onDismiss} disabled={sharing} className="btn btn-primary w-full">
          {sharing ? t("achievementModal.sharing") : t("achievementModal.skip")}
        </button>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}

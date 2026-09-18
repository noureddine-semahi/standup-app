"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { AchievementDef } from "@/lib/achievements";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** Full-screen "just unlocked" celebration for a single achievement — the Dashboard queues these one at a time when getLifetimeStats() crosses a threshold it hasn't shown before. See markAchievementSeen/getSeenAchievementIds in the Dashboard page for why an achievement only ever shows here once. */
export default function AchievementUnlockedModal({
  achievement,
  onDismiss,
}: {
  achievement: AchievementDef;
  onDismiss: () => void;
}) {
  const { t } = useLanguage();
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
        if (e.target === e.currentTarget) onDismiss();
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
        <div className="text-6xl mb-4">{achievement.icon}</div>
        <h2 className="text-2xl font-bold mb-2">{t(achievement.titleKey)}</h2>
        <p className="text-sm text-white/70 mb-6">{t(achievement.descriptionKey)}</p>
        <button onClick={onDismiss} className="btn btn-primary w-full">
          {t("achievementModal.nice")}
        </button>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type CommunityGuidelinesModalProps = {
  saving: boolean;
  error: string | null;
  onDecline: () => void;
  onAgree: () => void;
};

/**
 * Hard gate shown the first time a user opens Community — no scroll-to-
 * bottom requirement like PrivacyConsentModal (this is a short set of
 * rules, not a legal document), but otherwise the same shape: portal,
 * scroll-locked body, no backdrop-click or Esc dismissal, an explicit
 * acknowledgment required before the space is usable.
 */
export default function CommunityGuidelinesModal({ saving, error, onDecline, onAgree }: CommunityGuidelinesModalProps) {
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
        padding: "1rem",
      }}
    >
      <div
        className="card"
        style={{ maxWidth: "520px", width: "100%", position: "relative", zIndex: 10000 }}
      >
        <h2 className="text-xl font-bold mb-1">{t("social.guidelinesTitle")}</h2>
        <p className="mt-1 text-sm text-white/70">{t("social.guidelinesIntro")}</p>

        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/80">
          <p>{t("social.guidelinesDecency")}</p>
          <p>{t("social.guidelinesScope")}</p>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button onClick={onAgree} disabled={saving} className="btn btn-primary flex-1">
            {saving ? t("social.guidelinesSaving") : t("social.guidelinesAgree")}
          </button>
          <button onClick={onDecline} disabled={saving} className="btn btn-ghost">
            {t("social.guidelinesNotNow")}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}

"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type PrivacyConsentModalProps = {
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Shown before signup actually creates the account — the user must scroll the policy to the bottom before "I Agree" unlocks. */
export default function PrivacyConsentModal({ saving, error, onCancel, onConfirm }: PrivacyConsentModalProps) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.clientHeight <= 8) setScrolledToBottom(true);
  }, [mounted]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setScrolledToBottom(true);
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
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div
        className="card"
        style={{ maxWidth: "560px", width: "100%", position: "relative", zIndex: 10000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-1">{t("signup.privacyConsentTitle")}</h2>
        <p className="mt-1 text-sm text-white/70">{t("signup.privacyConsentIntro")}</p>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="mt-4 max-h-[60vh] overflow-y-auto rounded-xl border border-white/10 bg-white/5 px-4 py-4"
        >
          <PrivacyPolicyContent />
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!scrolledToBottom && (
          <p className="mt-3 text-xs text-white/50">{t("signup.privacyConsentScrollHint")}</p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={onConfirm}
            disabled={saving || !scrolledToBottom}
            className="btn btn-primary flex-1"
          >
            {saving ? t("signup.creatingAccount") : t("signup.privacyConsentAgree")}
          </button>
          <button onClick={onCancel} disabled={saving} className="btn btn-ghost">
            {t("signup.privacyConsentCancel")}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}

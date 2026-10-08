"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import type { OutcomeGoalType } from "@/lib/supabase/db";

const CONTENT: Record<
  OutcomeGoalType,
  { option: TranslationKey; description: TranslationKey; examples: TranslationKey[]; behavior: TranslationKey }
> = {
  one_time: {
    option: "goalType.oneTime.option",
    description: "goalType.oneTime.description",
    examples: ["goalType.oneTime.example1", "goalType.oneTime.example2", "goalType.oneTime.example3"],
    behavior: "goalType.oneTime.behavior",
  },
  ongoing: {
    option: "goalType.ongoing.option",
    description: "goalType.ongoing.description",
    examples: ["goalType.ongoing.example1", "goalType.ongoing.example2", "goalType.ongoing.example3"],
    behavior: "goalType.ongoing.behavior",
  },
  recurring: {
    option: "goalType.recurring.option",
    description: "goalType.recurring.description",
    examples: ["goalType.recurring.example1", "goalType.recurring.example2", "goalType.recurring.example3"],
    behavior: "goalType.recurring.behavior",
  },
  target: {
    option: "goalType.target.option",
    description: "goalType.target.description",
    examples: ["goalType.target.example1", "goalType.target.example2", "goalType.target.example3"],
    behavior: "goalType.target.behavior",
  },
};

/**
 * Purely informational -- shown when the user SELECTS a Goal Type, not a
 * confirmation. The selection has already happened by the time this
 * renders; every dismissal path here (Got it / backdrop / Escape) only
 * ever closes the modal, never touches the caller's selected type. Same
 * portal/backdrop/body-scroll-lock shape as BlockedReasonModal (the
 * existing small-informational-modal pattern in this codebase) -- no new
 * modal system, no X close (none of the sibling modals have one either).
 */
export default function GoalTypeInfoModal({
  goalType,
  onDismiss,
}: {
  goalType: OutcomeGoalType;
  onDismiss: () => void;
}) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const content = CONTENT[goalType];

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  if (!mounted) return null;

  return createPortal(
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
        className="card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-type-info-title"
        style={{ maxWidth: "440px", width: "100%", position: "relative", zIndex: 10000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="goal-type-info-title" className="text-xl font-bold mb-1">
          {t(content.option)}
        </h2>
        <p className="mt-1 text-sm text-white/70">{t(content.description)}</p>

        <div className="mt-3 text-[11px] uppercase tracking-wide text-white/40 font-semibold">
          {t("goalType.examplesLabel")}
        </div>
        <ul className="mt-1 space-y-1 text-sm text-white/70 list-disc list-inside">
          {content.examples.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>

        <p className="mt-3 text-sm text-white/70">{t(content.behavior)}</p>

        <div className="flex gap-3 mt-4">
          <button type="button" onClick={onDismiss} className="btn btn-primary flex-1">
            {t("goalType.gotIt")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

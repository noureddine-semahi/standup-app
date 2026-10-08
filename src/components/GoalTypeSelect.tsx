"use client";

import { useId } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import type { OutcomeGoalType } from "@/lib/supabase/db";

const GOAL_TYPE_OPTIONS: OutcomeGoalType[] = ["one_time", "ongoing", "recurring", "target"];

const OPTION_LABEL_KEY: Record<OutcomeGoalType, TranslationKey> = {
  one_time: "goalType.oneTime.option",
  ongoing: "goalType.ongoing.option",
  recurring: "goalType.recurring.option",
  target: "goalType.target.option",
};

/**
 * Shared four-option Goal Type dropdown -- the one common field (besides
 * Goal title) every Major Goal creation/edit surface needs (Today's and
 * Tomorrow's own creation flows, Goal Detail's Edit Goal form). Deliberately
 * NOT bundled with a title field or any Task-row handling -- those stay
 * page-specific (see Goal Engine Phase 2B-1's own inspection notes on why
 * a full shared form would overcomplicate things). A native <select> with
 * a real <label htmlFor> (not just a placeholder/aria-label) per this
 * phase's own accessibility requirement.
 */
export default function GoalTypeSelect({
  value,
  onChange,
  disabled,
  id,
}: {
  value: OutcomeGoalType;
  onChange: (value: OutcomeGoalType) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useLanguage();
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <div>
      <label htmlFor={selectId} className="block text-[11px] text-white/40 mb-1">
        {t("goalType.fieldLabel")}
      </label>
      <select
        id={selectId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as OutcomeGoalType)}
        className="appearance-none rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-white/30 disabled:opacity-50"
      >
        {GOAL_TYPE_OPTIONS.map((gt) => (
          <option key={gt} value={gt}>
            {t(OPTION_LABEL_KEY[gt])}
          </option>
        ))}
      </select>
    </div>
  );
}

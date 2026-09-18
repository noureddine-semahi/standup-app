"use client";

import { GLIMPSE_REACTIONS } from "@/lib/glimpseReactions";
import type { GlimpseReaction } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** The 4 fixed reaction buttons, shared by GlimpseCard and PublicFeedCard. */
export default function GlimpseReactionPicker({
  myReaction,
  reacting,
  onPick,
}: {
  myReaction: GlimpseReaction | null;
  reacting: boolean;
  onPick: (reaction: GlimpseReaction) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex gap-1.5">
      {GLIMPSE_REACTIONS.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => onPick(r.value)}
          disabled={reacting}
          title={t(r.labelKey)}
          className="btn"
          style={{
            padding: "0.25rem 0.5rem",
            fontSize: "0.85rem",
            background: myReaction === r.value ? "rgba(245, 158, 11, 0.25)" : undefined,
            borderColor: myReaction === r.value ? "rgba(245, 158, 11, 0.6)" : undefined,
          }}
        >
          {r.emoji}
        </button>
      ))}
    </div>
  );
}

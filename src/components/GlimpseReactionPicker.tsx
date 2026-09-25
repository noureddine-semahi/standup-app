"use client";

import { GLIMPSE_REACTIONS } from "@/lib/glimpseReactions";
import type { GlimpseReaction } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { hexToRgba } from "@/lib/color";

/** The 4 fixed reaction buttons, shared by every PostCard and comment row. */
export default function GlimpseReactionPicker({
  myReaction,
  reacting,
  onPick,
  counts,
}: {
  myReaction: GlimpseReaction | null;
  reacting: boolean;
  onPick: (reaction: GlimpseReaction) => void;
  // Per-type counts (e.g. { like: 2, fire: 1 }) — a type with zero
  // reactions is just absent. Optional so any existing caller that
  // hasn't been updated to fetch counts yet still renders correctly.
  counts?: Record<string, number>;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex gap-1.5">
      {GLIMPSE_REACTIONS.map((r) => {
        const count = counts?.[r.value] ?? 0;
        return (
          <button
            key={r.value}
            type="button"
            onClick={() => onPick(r.value)}
            disabled={reacting}
            title={t(r.labelKey)}
            className="btn"
            style={{
              padding: "0.25rem 0.5rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              color: myReaction === r.value ? r.color : hexToRgba(r.color, 0.75),
              background: myReaction === r.value ? hexToRgba(r.color, 0.18) : undefined,
              borderColor: myReaction === r.value ? hexToRgba(r.color, 0.55) : undefined,
              // A glow, not just a tint — matches the app's LED motif (see
              // .led-dot's own box-shadow glow). Picked (lit) gets the full
              // glow; unpicked (ghost) gets a faint one, still enough to read
              // as that reaction's real color rather than a flat outline.
              filter: `drop-shadow(0 0 ${myReaction === r.value ? 4 : 2}px ${hexToRgba(r.color, myReaction === r.value ? 0.6 : 0.35)})`,
            }}
          >
            <r.icon size={15} strokeWidth={2.25} />
            {count > 0 && <span style={{ fontSize: "0.7rem", fontWeight: 600 }}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

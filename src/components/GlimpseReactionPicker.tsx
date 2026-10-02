"use client";

import { useRef, useState } from "react";
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
  // Which reaction just got tapped, purely to trigger its brief pop/glow
  // animation — cleared after the animation's own duration. Separate from
  // myReaction (which can reflect un-picking, i.e. going back to null) so
  // the animation still plays on the button the user actually tapped.
  const [poppedValue, setPoppedValue] = useState<GlimpseReaction | null>(null);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handlePick(reaction: GlimpseReaction) {
    onPick(reaction);
    if (popTimerRef.current) clearTimeout(popTimerRef.current);
    setPoppedValue(reaction);
    popTimerRef.current = setTimeout(() => setPoppedValue(null), 300);
  }

  return (
    <div className="flex gap-1">
      {GLIMPSE_REACTIONS.map((r) => {
        const count = counts?.[r.value] ?? 0;
        return (
          <button
            key={r.value}
            type="button"
            onClick={() => handlePick(r.value)}
            disabled={reacting}
            title={t(r.labelKey)}
            className={`btn${poppedValue === r.value ? " reaction-pulse" : ""}`}
            style={{
              padding: "0.2rem 0.45rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              color: myReaction === r.value ? r.color : hexToRgba(r.color, 0.75),
              background: myReaction === r.value ? hexToRgba(r.color, 0.18) : undefined,
              borderColor: myReaction === r.value ? hexToRgba(r.color, 0.55) : undefined,
              // A glow, not just a tint — matches the app's LED motif (see
              // .led-dot's own box-shadow glow). Picked (lit) gets the full
              // glow; unpicked (ghost) gets a faint one, still enough to read
              // as that reaction's real color rather than a flat outline.
              filter: `drop-shadow(0 0 ${myReaction === r.value ? 4 : 2}px ${hexToRgba(r.color, myReaction === r.value ? 0.6 : 0.35)})`,
              "--reaction-color": hexToRgba(r.color, 0.65),
            } as React.CSSProperties}
          >
            <r.icon size={14} strokeWidth={2.25} className={poppedValue === r.value ? "reaction-pop-icon" : undefined} />
            {count > 0 && <span style={{ fontSize: "0.68rem", fontWeight: 600 }}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

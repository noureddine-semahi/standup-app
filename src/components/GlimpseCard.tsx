"use client";

import { useEffect, useState } from "react";
import {
  getPublishedGlimpse,
  getMyReactionForOwner,
  setGlimpseReaction,
  type GlimpseGoal,
  type GlimpseReaction,
} from "@/lib/supabase/db";
import { statusIcon, statusLabel } from "@/lib/goalStatus";
import { GLIMPSE_REACTIONS } from "@/lib/glimpseReactions";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * One connection's published-today snapshot on the Dashboard's Glimpses
 * section — title/status only (never notes/checklist/attachments), plus a
 * one-of-four reaction picker. Self-fetches and renders nothing while
 * loading or once loaded if the owner hasn't published today (or isn't
 * actually an accepted connection) — get_published_glimpse() returns an
 * empty list either way, so there's nothing extra to branch on here.
 */
export default function GlimpseCard({
  ownerId,
  displayName,
  planDateISO,
  onVisibleChange,
}: {
  ownerId: string;
  displayName: string | null;
  planDateISO: string;
  // Reports once loading settles whether this card actually has anything
  // to show — lets the parent tell "still checking" apart from "checked
  // every connection, none have published" for its own empty state.
  onVisibleChange?: (ownerId: string, visible: boolean) => void;
}) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<GlimpseGoal[]>([]);
  const [myReaction, setMyReaction] = useState<GlimpseReaction | null>(null);
  const [reacting, setReacting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [glimpseGoals, reaction] = await Promise.all([
          getPublishedGlimpse(ownerId, planDateISO),
          getMyReactionForOwner(ownerId, planDateISO),
        ]);
        if (cancelled) return;
        setGoals(glimpseGoals);
        setMyReaction(reaction);
        onVisibleChange?.(ownerId, glimpseGoals.length > 0);
      } catch {
        // Non-fatal — the card just renders nothing for this connection.
        if (!cancelled) onVisibleChange?.(ownerId, false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, planDateISO]);

  async function pickReaction(reaction: GlimpseReaction) {
    if (reacting) return;
    const next = myReaction === reaction ? null : reaction;
    const prev = myReaction;
    setReacting(true);
    setMyReaction(next);
    try {
      await setGlimpseReaction(ownerId, planDateISO, next);
    } catch {
      setMyReaction(prev);
    } finally {
      setReacting(false);
    }
  }

  if (loading || goals.length === 0) return null;

  const completed = goals.filter((g) => g.status === "completed").length;

  return (
    <div className="goal-row-compact">
      <div className="goal-row-compact-body p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-sm font-semibold text-white truncate">{displayName ?? "—"}</span>
          <span className="text-xs text-white/50 flex-shrink-0">
            {t("dashboard.glimpseProgress", { completed, total: goals.length })}
          </span>
        </div>

        <div className="space-y-1 mb-3">
          {goals.map((g) => (
            <div key={g.goal_id} className="flex items-center gap-2 text-xs">
              <span title={statusLabel(g.status, t)}>{statusIcon(g.status)}</span>
              <span className="truncate text-white/80">{g.title}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-1.5">
          {GLIMPSE_REACTIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => pickReaction(r.value)}
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
      </div>
    </div>
  );
}

"use client";

import { statusIcon, statusLabel } from "@/lib/goalStatus";
import { useGlimpseReaction } from "@/lib/glimpseReactions";
import GlimpseReactionPicker from "@/components/GlimpseReactionPicker";
import type { GlimpseGoal, GlimpseReaction } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * One "Everyone"-visibility post on the Social page's Public Feed. Purely
 * presentational — the Social page bulk-fetches the feed and everyone's
 * reactions up front (getPublicFeed + getMyReactionsForOwners), so unlike
 * GlimpseCard this never self-fetches; it only owns reaction state via the
 * shared hook. displayName is already resolved to a generic fallback by
 * the caller when the poster has no display_name set — never an email or
 * raw id, since (unlike a connection) the viewer never supplied this
 * person's email themselves.
 */
export default function PublicFeedCard({
  ownerId,
  displayName,
  goals,
  planDateISO,
  initialReaction,
}: {
  ownerId: string;
  displayName: string;
  goals: GlimpseGoal[];
  planDateISO: string;
  initialReaction: GlimpseReaction | null;
}) {
  const { t } = useLanguage();
  const { myReaction, reacting, pickReaction } = useGlimpseReaction(ownerId, planDateISO, initialReaction);

  const completed = goals.filter((g) => g.status === "completed").length;

  return (
    <div className="goal-row-compact">
      <div className="goal-row-compact-body p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-sm font-semibold text-white truncate">{displayName}</span>
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

        <GlimpseReactionPicker myReaction={myReaction} reacting={reacting} onPick={pickReaction} />
      </div>
    </div>
  );
}

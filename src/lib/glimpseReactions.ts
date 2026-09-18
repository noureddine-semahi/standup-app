import { useEffect, useState } from "react";
import { setPostReaction, type GlimpseReaction } from "@/lib/supabase/db";
import type { TranslationKey } from "@/lib/i18n/en";

export const GLIMPSE_REACTIONS: { value: GlimpseReaction; emoji: string; labelKey: TranslationKey }[] = [
  { value: "like", emoji: "👍", labelKey: "glimpse.reactionLike" },
  { value: "support", emoji: "🤝", labelKey: "glimpse.reactionSupport" },
  { value: "fire", emoji: "🔥", labelKey: "glimpse.reactionFire" },
  { value: "clap", emoji: "👏", labelKey: "glimpse.reactionClap" },
];

export function glimpseReactionEmoji(reaction: GlimpseReaction): string {
  return GLIMPSE_REACTIONS.find((r) => r.value === reaction)?.emoji ?? "👍";
}

/**
 * Owns the optimistic-update state machine for one post's reaction — every
 * PostCard uses this so a fix here applies everywhere instead of several
 * independently-maintained copies. Does NOT fetch the initial value itself;
 * the caller supplies it (the feed already returns each post's
 * myReaction in one call).
 */
export function usePostReaction(postId: string, initialReaction: GlimpseReaction | null) {
  const [myReaction, setMyReaction] = useState(initialReaction);
  const [reacting, setReacting] = useState(false);

  // Keeps this in sync if the parent re-fetches with a different initial
  // value (e.g. a feed refresh).
  useEffect(() => {
    setMyReaction(initialReaction);
  }, [initialReaction]);

  async function pickReaction(reaction: GlimpseReaction) {
    if (reacting) return;
    const next = myReaction === reaction ? null : reaction;
    const prev = myReaction;
    setReacting(true);
    setMyReaction(next);
    try {
      await setPostReaction(postId, next);
    } catch {
      setMyReaction(prev);
    } finally {
      setReacting(false);
    }
  }

  return { myReaction, reacting, pickReaction };
}

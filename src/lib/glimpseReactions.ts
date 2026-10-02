import { useEffect, useState } from "react";
import { ThumbsUp, HeartHandshake, Flame, Hand, type LucideIcon } from "lucide-react";
import { setPostReaction, setCommentReaction, type GlimpseReaction } from "@/lib/supabase/db";
import type { TranslationKey } from "@/lib/i18n/en";

// Each reaction gets its own accent (reusing hues the app already assigns
// meaning to elsewhere) rather than one uniform gray -- 4 identical-looking
// buttons is what made picking a reaction harder to scan than the old
// distinct, colorful emoji set.
export const GLIMPSE_REACTIONS: { value: GlimpseReaction; icon: LucideIcon; labelKey: TranslationKey; color: string }[] = [
  { value: "like", icon: ThumbsUp, labelKey: "glimpse.reactionLike", color: "#60a5fa" },
  { value: "support", icon: HeartHandshake, labelKey: "glimpse.reactionSupport", color: "#f43f5e" },
  { value: "fire", icon: Flame, labelKey: "glimpse.reactionFire", color: "#f59e0b" },
  { value: "clap", icon: Hand, labelKey: "glimpse.reactionClap", color: "#34d399" },
];

/**
 * Owns the optimistic-update state machine for one post's reaction — every
 * PostCard uses this so a fix here applies everywhere instead of several
 * independently-maintained copies. Does NOT fetch the initial value itself;
 * the caller supplies it (the feed already returns each post's
 * myReaction in one call).
 */
export function usePostReaction(postId: string, initialReaction: GlimpseReaction | null, initialCounts: Record<string, number> = {}) {
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

  // Optimistic display counts -- the server snapshot (initialCounts) plus
  // whatever delta the user's own still-settling pick has caused, so the
  // number on screen moves the instant you tap instead of waiting for the
  // next feed refetch to catch up with the real count.
  const counts = { ...initialCounts };
  if (myReaction !== initialReaction) {
    if (initialReaction) counts[initialReaction] = Math.max(0, (counts[initialReaction] ?? 0) - 1);
    if (myReaction) counts[myReaction] = (counts[myReaction] ?? 0) + 1;
  }

  return { myReaction, reacting, pickReaction, counts };
}

/**
 * Same optimistic state machine as usePostReaction, kept as a separate
 * copy rather than a shared generic — post/comment reactions are checked
 * against different owning entities server-side (own-post vs. own-comment)
 * and will keep drifting independently, so a shared abstraction over two
 * call sites isn't worth the indirection yet.
 */
export function useCommentReaction(commentId: string, initialReaction: GlimpseReaction | null, initialCounts: Record<string, number> = {}) {
  const [myReaction, setMyReaction] = useState(initialReaction);
  const [reacting, setReacting] = useState(false);

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
      await setCommentReaction(commentId, next);
    } catch {
      setMyReaction(prev);
    } finally {
      setReacting(false);
    }
  }

  // Same optimistic-count treatment as usePostReaction above.
  const counts = { ...initialCounts };
  if (myReaction !== initialReaction) {
    if (initialReaction) counts[initialReaction] = Math.max(0, (counts[initialReaction] ?? 0) - 1);
    if (myReaction) counts[myReaction] = (counts[myReaction] ?? 0) + 1;
  }

  return { myReaction, reacting, pickReaction, counts };
}

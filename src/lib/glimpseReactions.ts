import type { GlimpseReaction } from "@/lib/supabase/db";
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

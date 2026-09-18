"use client";

import Avatar from "@/components/Avatar";
import { statusIcon, statusLabel } from "@/lib/goalStatus";
import { usePostReaction } from "@/lib/glimpseReactions";
import GlimpseReactionPicker from "@/components/GlimpseReactionPicker";
import { ACHIEVEMENTS } from "@/lib/achievements";
import type { Post } from "@/lib/supabase/db";
import { formatDateTimeDisplay } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * One feed item, any type — replaces the earlier GlimpseCard/PublicFeedCard
 * split now that every post (goal glimpse, achievement, motivational) goes
 * through one getFeed() call and one reaction system. Purely presentational.
 */
export default function PostCard({ post }: { post: Post }) {
  const { t } = useLanguage();
  const { myReaction, reacting, pickReaction } = usePostReaction(post.id, post.myReaction);
  const displayName = post.displayName ?? t("social.anonymousUser");

  return (
    <div className="goal-row-compact">
      <div className="goal-row-compact-body p-3">
        <div className="flex items-center gap-2 mb-2">
          <Avatar avatarUrl={post.avatarUrl} label={displayName} size={28} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{displayName}</div>
            <div className="text-[10px] text-white/40">{formatDateTimeDisplay(post.createdAt)}</div>
          </div>
        </div>

        {post.type === "goal_glimpse" && post.goals && (
          <>
            <div className="mb-2 text-xs text-white/50">
              {t("dashboard.glimpseProgress", {
                completed: post.goals.filter((g) => g.status === "completed").length,
                total: post.goals.length,
              })}
            </div>
            <div className="space-y-1 mb-3">
              {post.goals.map((g) => (
                <div key={g.goal_id} className="flex items-center gap-2 text-xs">
                  <span title={statusLabel(g.status, t)}>{statusIcon(g.status)}</span>
                  <span className="truncate text-white/80">{g.title}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {post.type === "achievement" &&
          (() => {
            const achievement = ACHIEVEMENTS.find((a) => a.id === post.achievementId);
            if (!achievement) return null;
            return (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">{achievement.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-white">{t(achievement.titleKey)}</div>
                  <div className="text-xs text-white/60">{t(achievement.descriptionKey)}</div>
                </div>
              </div>
            );
          })()}

        {post.type === "motivational" && post.body && (
          <p className="text-sm text-white/80 mb-3 whitespace-pre-wrap">{post.body}</p>
        )}

        <GlimpseReactionPicker myReaction={myReaction} reacting={reacting} onPick={pickReaction} />
      </div>
    </div>
  );
}

"use client";

import Avatar from "@/components/Avatar";
import { Lock, Forward } from "lucide-react";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import { usePostReaction } from "@/lib/glimpseReactions";
import GlimpseReactionPicker from "@/components/GlimpseReactionPicker";
import CommentThread from "@/components/CommentThread";
import PostImage from "@/components/PostImage";
import SharePostButton from "@/components/SharePostButton";
import { ACHIEVEMENTS } from "@/lib/achievements";
import type { Post } from "@/lib/supabase/db";
import { formatDateTimeDisplay } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * One feed item, any type — replaces the earlier GlimpseCard/PublicFeedCard
 * split now that every post (goal glimpse, achievement, motivational) goes
 * through one getFeed() call and one reaction system. Purely presentational.
 */
export default function PostCard({
  post,
  commentCount = 0,
  shareableConnections = [],
}: {
  post: Post;
  commentCount?: number;
  // Accepted connections the current viewer can share this post with —
  // omitted (or empty) simply hides the Share button rather than erroring,
  // so a caller that hasn't wired connections through yet still renders.
  shareableConnections?: { id: string; displayName: string | null }[];
}) {
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

        {post.sharedByDisplayName && (
          <div className="mb-2 inline-flex items-center gap-1 text-xs text-white/50">
            <Forward size={11} /> {t("social.sharedByLabel", { name: post.sharedByDisplayName })}
          </div>
        )}

        {post.type === "goal_glimpse" && post.goals && (
          <>
            <div className="mb-2 text-xs text-white/50">
              {t("dashboard.glimpseProgress", {
                completed: post.goals.filter((g) => g.status === "completed").length,
                total: post.goals.length,
              })}
            </div>
            {post.visibility === "individual" && post.targetDisplayName && (
              <div className="mb-2 inline-flex items-center gap-1 text-xs text-white/50">
                <Lock size={11} /> {t("today.publishSharedWithLabel", { name: post.targetDisplayName })}
              </div>
            )}
            <div className="space-y-1 mb-3">
              {post.goals.map((g) => {
                const color = statusChipColors(g.status).color;
                return (
                  <div key={g.goal_id} className="flex items-center gap-2 text-xs">
                    {/* Each goal's real status color, not inherited text
                        color — this list previously rendered every icon
                        the same flat tone regardless of completed/blocked/
                        rescheduled/etc. A small glow (matching the app's
                        LED motif — see .led-dot's own glow) makes the
                        color read as genuinely "lit," not just tinted. */}
                    <span
                      title={statusLabel(g.status, t)}
                      className="inline-flex flex-shrink-0"
                      style={{ color, filter: `drop-shadow(0 0 3px ${color})` }}
                    >
                      <StatusIcon status={g.status} />
                    </span>
                    <span className="truncate text-white/80">{g.title}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {post.type === "achievement" &&
          (() => {
            const achievement = ACHIEVEMENTS.find((a) => a.id === post.achievementId);
            if (!achievement) return null;
            return (
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="flex-shrink-0 flex items-center justify-center rounded-full"
                  style={{
                    width: "36px",
                    height: "36px",
                    background: "rgba(245, 158, 11, 0.12)",
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                    color: "rgb(252, 211, 77)",
                  }}
                >
                  <achievement.icon size={18} strokeWidth={1.75} />
                </div>
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
        {post.type === "motivational" && post.imagePath && <PostImage imagePath={post.imagePath} />}

        <div className="flex items-center gap-2 flex-wrap">
          <GlimpseReactionPicker myReaction={myReaction} reacting={reacting} onPick={pickReaction} counts={post.reactionCounts} />
          {shareableConnections.length > 0 && (
            <SharePostButton postId={post.id} connections={shareableConnections} />
          )}
        </div>
        <CommentThread postId={post.id} initialCommentCount={post.commentCount || commentCount} />
      </div>
    </div>
  );
}

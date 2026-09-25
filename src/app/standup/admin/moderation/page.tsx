"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  isCurrentUserAdmin,
  getAdminFeed,
  adminDeletePost,
  getAdminPostComments,
  adminDeleteComment,
  formatDateTimeDisplay,
  type AdminFeedPost,
  type PostComment,
} from "@/lib/supabase/db";
import StatusIcon from "@/components/StatusIcon";
import { MessageCircle, ThumbsUp, Trash2 } from "lucide-react";

// English-only by design, same as the rest of Admin — an internal tool,
// not a user-facing surface.

const TYPE_LABELS: Record<string, string> = {
  goal_glimpse: "Goal Glimpse",
  achievement: "Achievement",
  motivational: "Motivational",
};

export default function ModerationPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  const [feed, setFeed] = useState<AdminFeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [busyPostIds, setBusyPostIds] = useState<Set<string>>(new Set());

  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, PostComment[]>>({});
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [busyCommentIds, setBusyCommentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function init() {
      let isAdmin = false;
      try {
        isAdmin = await isCurrentUserAdmin();
      } catch {
        isAdmin = false;
      }
      setAuthorized(isAdmin);
      setChecking(false);
      if (!isAdmin) {
        router.push("/standup/dashboard");
        return;
      }
      refreshFeed();
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function refreshFeed() {
    setFeedLoading(true);
    setFeedError(null);
    return getAdminFeed()
      .then(setFeed)
      .catch((e: any) => setFeedError(e?.message ?? "Failed to load feed."))
      .finally(() => setFeedLoading(false));
  }

  function setPostBusy(id: string, busy: boolean) {
    setBusyPostIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleDeletePost(post: AdminFeedPost) {
    if (busyPostIds.has(post.id)) return;
    const preview = post.body || post.achievementId || TYPE_LABELS[post.type] || post.type;
    if (!window.confirm(`Remove this post by ${post.displayName ?? "this user"}?\n\n"${preview}"\n\nThis cannot be undone.`)) {
      return;
    }
    setPostBusy(post.id, true);
    try {
      await adminDeletePost(post.id);
      setFeed((prev) => prev.filter((p) => p.id !== post.id));
      if (expandedPostId === post.id) setExpandedPostId(null);
    } catch (e: any) {
      setFeedError(e?.message ?? "Failed to remove post.");
    } finally {
      setPostBusy(post.id, false);
    }
  }

  async function toggleComments(postId: string) {
    if (expandedPostId === postId) {
      setExpandedPostId(null);
      return;
    }
    setExpandedPostId(postId);
    if (commentsByPost[postId]) return;
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const comments = await getAdminPostComments(postId);
      setCommentsByPost((prev) => ({ ...prev, [postId]: comments }));
    } catch (e: any) {
      setCommentsError(e?.message ?? "Failed to load comments.");
    } finally {
      setCommentsLoading(false);
    }
  }

  async function handleDeleteComment(comment: PostComment) {
    if (busyCommentIds.has(comment.id)) return;
    if (!window.confirm(`Remove this comment by ${comment.displayName ?? "this user"}?\n\n"${comment.body}"\n\nThis cannot be undone.`)) {
      return;
    }
    setBusyCommentIds((prev) => new Set(prev).add(comment.id));
    try {
      await adminDeleteComment(comment.id);
      setCommentsByPost((prev) => ({
        ...prev,
        [comment.postId]: (prev[comment.postId] ?? []).filter((c) => c.id !== comment.id),
      }));
      setFeed((prev) =>
        prev.map((p) => (p.id === comment.postId ? { ...p, commentCount: Math.max(0, p.commentCount - 1) } : p))
      );
    } catch (e: any) {
      setCommentsError(e?.message ?? "Failed to remove comment.");
    } finally {
      setBusyCommentIds((prev) => {
        const next = new Set(prev);
        next.delete(comment.id);
        return next;
      });
    }
  }

  if (checking || !authorized) {
    return <div className="card">Checking access…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="card card-highlight">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Community Moderation</h1>
            <p className="mt-2 text-white/70">
              Every post ever published, regardless of its own visibility setting — for enforcing
              the community guidelines, not for everyday browsing.
            </p>
          </div>
          <Link href="/standup/admin" className="btn btn-ghost whitespace-nowrap">
            ← Admin
          </Link>
        </div>
        {feedError && <p className="mt-3 text-sm text-red-300">{feedError}</p>}
      </div>

      <div className="card">
        {feedLoading ? (
          <p className="text-sm text-white/50 text-center py-8">Loading…</p>
        ) : feed.length === 0 ? (
          <p className="text-sm text-white/50 text-center py-8">No posts yet.</p>
        ) : (
          <div className="divide-y divide-white/10">
            {feed.map((post) => (
              <div key={post.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-semibold text-white">{post.displayName ?? "Unknown user"}</span>
                      <span className="text-white/40">·</span>
                      <span className="text-white/60">{TYPE_LABELS[post.type] ?? post.type}</span>
                      <span className="text-white/40">·</span>
                      <span className="text-white/60">{post.visibility}</span>
                      {post.visibility === "individual" && post.targetDisplayName && (
                        <span className="text-white/50">(to {post.targetDisplayName})</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-white/40">{formatDateTimeDisplay(post.createdAt)}</div>

                    {post.type === "motivational" && post.body && (
                      <p className="mt-2 text-sm text-white/80 whitespace-pre-wrap">{post.body}</p>
                    )}
                    {post.type === "achievement" && post.achievementId && (
                      <p className="mt-2 text-sm text-white/60">Achievement: {post.achievementId}</p>
                    )}
                    {post.type === "goal_glimpse" && post.goals && (
                      <div className="mt-2 space-y-1">
                        {post.goals.map((g) => (
                          <div key={g.goal_id} className="flex items-center gap-2 text-xs">
                            <StatusIcon status={g.status} size={12} />
                            <span className="text-white/70 truncate">{g.title}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 flex items-center gap-4 text-xs text-white/50">
                      <span className="inline-flex items-center gap-1">
                        <ThumbsUp size={12} /> {post.reactionCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleComments(post.id)}
                        className="inline-flex items-center gap-1 hover:text-white/80 transition"
                      >
                        <MessageCircle size={12} /> {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeletePost(post)}
                    disabled={busyPostIds.has(post.id)}
                    className="btn flex-shrink-0 inline-flex items-center gap-1.5"
                    style={{ borderColor: "rgba(239, 68, 68, 0.35)", color: "#fca5a5" }}
                  >
                    <Trash2 size={13} /> {busyPostIds.has(post.id) ? "Removing…" : "Remove"}
                  </button>
                </div>

                {expandedPostId === post.id && (
                  <div className="mt-3 ml-4 pl-3 space-y-2" style={{ borderLeft: "2px solid rgba(255,255,255,0.1)" }}>
                    {commentsError && <p className="text-xs text-red-300">{commentsError}</p>}
                    {commentsLoading && !commentsByPost[post.id] ? (
                      <p className="text-xs text-white/50">Loading comments…</p>
                    ) : (commentsByPost[post.id] ?? []).length === 0 ? (
                      <p className="text-xs text-white/50">No comments.</p>
                    ) : (
                      (commentsByPost[post.id] ?? []).map((c) => (
                        <div key={c.id} className="flex items-start justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white/80">
                              {c.displayName ?? "Unknown user"}
                              {c.parentCommentId && <span className="ml-1 text-white/40">(reply)</span>}
                            </div>
                            <div className="text-xs text-white/70 mt-0.5">{c.body}</div>
                            <div className="text-[10px] text-white/40 mt-0.5">{formatDateTimeDisplay(c.createdAt)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(c)}
                            disabled={busyCommentIds.has(c.id)}
                            className="btn flex-shrink-0"
                            style={{ padding: "0.2rem 0.5rem", fontSize: "0.65rem", borderColor: "rgba(239, 68, 68, 0.35)", color: "#fca5a5" }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

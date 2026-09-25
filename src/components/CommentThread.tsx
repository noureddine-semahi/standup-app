"use client";

import { useState } from "react";
import { MessageSquare, ChevronDown, ChevronRight, Trash2, Reply as ReplyIcon } from "lucide-react";
import Avatar from "@/components/Avatar";
import GlimpseReactionPicker from "@/components/GlimpseReactionPicker";
import { useCommentReaction } from "@/lib/glimpseReactions";
import {
  getPostComments,
  addPostComment,
  deletePostComment,
  addMention,
  getCurrentUserId,
  formatDateTimeDisplay,
  type PostComment,
} from "@/lib/supabase/db";
import MentionInput from "@/components/MentionInput";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

const COMMENT_MAX_LENGTH = 500;

/**
 * Comment thread under one PostCard — one level of replies only (a reply
 * can't itself be replied to, matching the DB trigger). Lazy: loads on
 * first expand, not on every feed render. Adds/deletes refetch the whole
 * thread rather than optimistically splicing, since add_post_comment's
 * RPC return has no profiles join (displayName/avatarUrl would be null
 * until a real fetch resolves them anyway).
 */
export default function CommentThread({
  postId,
  initialCommentCount,
  connections = [],
}: {
  postId: string;
  initialCommentCount: number;
  // Accepted connections the current viewer can @mention here — omitted
  // simply disables mention autocomplete, matching SharePostButton's
  // optional-prop convention.
  connections?: { id: string; displayName: string | null }[];
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [count, setCount] = useState(initialCommentCount);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftMentionedIds, setDraftMentionedIds] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyMentionedIds, setReplyMentionedIds] = useState<string[]>([]);
  const [postingReply, setPostingReply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  async function loadComments() {
    setLoading(true);
    setError(null);
    try {
      const [rows, uid] = await Promise.all([getPostComments(postId), getCurrentUserId()]);
      setComments(rows);
      setCount(rows.length);
      setCurrentUserId(uid);
      setLoaded(true);
    } catch (e: any) {
      setError(e?.message ?? t("comments.failedLoad"));
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) await loadComments();
  }

  async function handlePost(
    body: string,
    parentCommentId: string | null,
    mentionedIds: string[],
    clearDraft: () => void,
    clearMentionedIds: () => void,
    setBusy: (v: boolean) => void
  ) {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > COMMENT_MAX_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const newComment = await addPostComment(postId, trimmed, parentCommentId);
      // Best-effort, same reasoning as the post composer's own mentions:
      // a mention failing shouldn't undo a comment that already posted.
      if (mentionedIds.length > 0) {
        await Promise.allSettled(mentionedIds.map((id) => addMention(postId, id, newComment.id)));
      }
      clearDraft();
      clearMentionedIds();
      setReplyingToId(null);
      const rows = await getPostComments(postId);
      setComments(rows);
      setCount(rows.length);
    } catch (e: any) {
      setError(e?.message ?? t("comments.failedPost"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(commentId: string) {
    if (busyIds.has(commentId)) return;
    setBusyIds((prev) => new Set(prev).add(commentId));
    setError(null);
    try {
      await deletePostComment(commentId);
      const rows = await getPostComments(postId);
      setComments(rows);
      setCount(rows.length);
    } catch (e: any) {
      setError(e?.message ?? t("comments.failedDelete"));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(commentId);
        return next;
      });
    }
  }

  const topLevel = comments.filter((c) => c.parentCommentId === null);
  const repliesFor = (id: string) => comments.filter((c) => c.parentCommentId === id);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggleExpanded}
        className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80 transition"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <MessageSquare size={12} />
        {t("comments.toggle")}{count > 0 ? ` (${count})` : ""}
      </button>

      {expanded && (
        <div className="mt-2 space-y-3">
          {loading && <div className="text-xs text-white/40">{t("comments.loading")}</div>}
          {error && <div className="text-xs text-red-400">{error}</div>}

          {!loading && loaded && topLevel.length === 0 && (
            <div className="text-xs text-white/40 italic">{t("comments.noCommentsYet")}</div>
          )}

          {topLevel.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              isOwn={comment.userId === currentUserId}
              busy={busyIds.has(comment.id)}
              onDelete={() => handleDelete(comment.id)}
              onReply={() => {
                setReplyingToId((prev) => (prev === comment.id ? null : comment.id));
                setReplyDraft("");
              }}
              replying={replyingToId === comment.id}
              replyDraft={replyDraft}
              onReplyDraftChange={setReplyDraft}
              onReplyMentionedIdsChange={setReplyMentionedIds}
              onSubmitReply={() =>
                handlePost(replyDraft, comment.id, replyMentionedIds, () => setReplyDraft(""), () => setReplyMentionedIds([]), setPostingReply)
              }
              postingReply={postingReply}
              connections={connections}
              t={t}
            >
              {repliesFor(comment.id).map((reply) => (
                <CommentRow
                  key={reply.id}
                  comment={reply}
                  isOwn={reply.userId === currentUserId}
                  busy={busyIds.has(reply.id)}
                  onDelete={() => handleDelete(reply.id)}
                  isReply
                  connections={connections}
                  t={t}
                />
              ))}
            </CommentRow>
          ))}

          <div className="flex items-center gap-2">
            <MentionInput
              value={draft}
              onChange={(v) => setDraft(v.slice(0, COMMENT_MAX_LENGTH))}
              connections={connections}
              onMentionedIdsChange={setDraftMentionedIds}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handlePost(draft, null, draftMentionedIds, () => setDraft(""), () => setDraftMentionedIds([]), setPosting);
                }
              }}
              placeholder={t("comments.placeholder")}
              disabled={posting}
              className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => handlePost(draft, null, draftMentionedIds, () => setDraft(""), () => setDraftMentionedIds([]), setPosting)}
              disabled={posting || !draft.trim()}
              className="btn"
              style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}
            >
              {posting ? t("comments.posting") : t("comments.postButton")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  isOwn,
  busy,
  onDelete,
  isReply = false,
  onReply,
  replying,
  replyDraft,
  onReplyDraftChange,
  onReplyMentionedIdsChange,
  onSubmitReply,
  postingReply,
  connections = [],
  children,
  t,
}: {
  comment: PostComment;
  isOwn: boolean;
  busy: boolean;
  onDelete: () => void;
  isReply?: boolean;
  onReply?: () => void;
  replying?: boolean;
  replyDraft?: string;
  onReplyDraftChange?: (v: string) => void;
  onReplyMentionedIdsChange?: (ids: string[]) => void;
  onSubmitReply?: () => void;
  postingReply?: boolean;
  connections?: { id: string; displayName: string | null }[];
  children?: React.ReactNode;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const { myReaction, reacting, pickReaction } = useCommentReaction(comment.id, comment.myReaction);
  const displayName = comment.displayName ?? t("social.anonymousUser");

  return (
    <div className={isReply ? "ml-6 pl-3 border-l border-white/10" : ""}>
      <div className="flex items-start gap-2">
        <Avatar avatarUrl={comment.avatarUrl} label={displayName} size={22} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white truncate">{displayName}</span>
            <span className="text-[10px] text-white/40">{formatDateTimeDisplay(comment.createdAt)}</span>
          </div>
          <div className="text-sm text-white/80 whitespace-pre-wrap">{comment.body}</div>
          <div className="mt-1 flex items-center gap-3">
            <GlimpseReactionPicker myReaction={myReaction} reacting={reacting} onPick={pickReaction} counts={comment.reactionCounts} />
            {!isReply && onReply && (
              <button type="button" onClick={onReply} className="inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-white/80">
                <ReplyIcon size={11} /> {t("comments.replyButton")}
              </button>
            )}
            {isOwn && (
              <button type="button" onClick={onDelete} disabled={busy} className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-red-400">
                <Trash2 size={11} />
              </button>
            )}
          </div>

          {replying && (
            <div className="mt-2 flex items-center gap-2">
              <MentionInput
                value={replyDraft ?? ""}
                onChange={(v) => onReplyDraftChange?.(v.slice(0, COMMENT_MAX_LENGTH))}
                connections={connections}
                onMentionedIdsChange={onReplyMentionedIdsChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSubmitReply?.();
                  }
                }}
                placeholder={t("comments.replyPlaceholder")}
                disabled={postingReply}
                className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={onSubmitReply}
                disabled={postingReply || !replyDraft?.trim()}
                className="btn"
                style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
              >
                {postingReply ? t("comments.posting") : t("comments.postButton")}
              </button>
            </div>
          )}

          {children && <div className="mt-2 space-y-2">{children}</div>}
        </div>
      </div>
    </div>
  );
}

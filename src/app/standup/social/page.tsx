"use client";

import { useEffect, useRef, useState } from "react";
import {
  listConnections,
  respondToConnectionRequest,
  removeConnection,
  connectionDisplayName,
  getFeed,
  getPostCommentCounts,
  getCurrentUserId,
  getOrCreateProfile,
  acceptCommunityGuidelines,
  createMotivationalPost,
  getDiscoverableUsers,
  sendConnectionRequestToUser,
  uploadPostImage,
  POST_IMAGE_ALLOWED_TYPES,
  POST_IMAGE_MAX_BYTES,
  type Connection,
  type Post,
  type PostVisibility,
  type DiscoverableUser,
} from "@/lib/supabase/db";
import { useRouter } from "next/navigation";
import PostCard from "@/components/PostCard";
import Avatar from "@/components/Avatar";
import GoalAssignmentsPanel from "@/components/GoalAssignmentsPanel";
import CommunityGuidelinesModal from "@/components/CommunityGuidelinesModal";
import { notifyNotificationsUpdated } from "@/lib/notificationsBus";
import { Users, Globe, LayoutGrid, UserPlus, UserCheck, ImagePlus, X, ClipboardList } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

const MOTIVATIONAL_POST_MAX_LENGTH = 280;

type SocialTab = "myFeed" | "global" | "circle" | "friends" | "goals";

export default function SocialPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  // null = not checked yet (render nothing rather than flash the feed
  // before we know). false = must acknowledge before anything below is
  // usable. See CommunityGuidelinesModal.
  const [guidelinesAccepted, setGuidelinesAccepted] = useState<boolean | null>(null);
  const [guidelinesSaving, setGuidelinesSaving] = useState(false);
  const [guidelinesError, setGuidelinesError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SocialTab>("myFeed");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connError, setConnError] = useState<string | null>(null);
  // Per-row busy tracking so accepting/declining/removing one row doesn't
  // block interaction with the others while its request is in flight.
  const [busyConnectionIds, setBusyConnectionIds] = useState<Set<string>>(new Set());

  const [discoverUsers, setDiscoverUsers] = useState<DiscoverableUser[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [discoverLoadingMore, setDiscoverLoadingMore] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [busyDiscoverIds, setBusyDiscoverIds] = useState<Set<string>>(new Set());

  const [feed, setFeed] = useState<Post[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});

  const [postBody, setPostBody] = useState("");
  const [postVisibility, setPostVisibility] = useState<PostVisibility>("connections");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postImageFile, setPostImageFile] = useState<File | null>(null);
  const [postImagePreviewUrl, setPostImagePreviewUrl] = useState<string | null>(null);
  const postImageInputRef = useRef<HTMLInputElement | null>(null);

  function refreshConnections() {
    return listConnections()
      .then(setConnections)
      .catch((e: any) => setConnError(e?.message ?? t("social.failedLoadConnections")));
  }

  function refreshDiscover() {
    setDiscoverLoading(true);
    setDiscoverError(null);
    return getDiscoverableUsers()
      .then(setDiscoverUsers)
      .catch((e: any) => setDiscoverError(e?.message ?? t("social.failedLoadDiscover")))
      .finally(() => setDiscoverLoading(false));
  }

  async function handleLoadMoreDiscover() {
    if (discoverLoadingMore || discoverUsers.length === 0) return;
    const last = discoverUsers[discoverUsers.length - 1];
    setDiscoverLoadingMore(true);
    setDiscoverError(null);
    try {
      const more = await getDiscoverableUsers(last.createdAt, last.id);
      setDiscoverUsers((prev) => [...prev, ...more]);
    } catch (e: any) {
      setDiscoverError(e?.message ?? t("social.failedLoadDiscover"));
    } finally {
      setDiscoverLoadingMore(false);
    }
  }

  function setDiscoverBusy(id: string, busy: boolean) {
    setBusyDiscoverIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleInvite(user: DiscoverableUser) {
    if (busyDiscoverIds.has(user.id) || user.invited) return;
    setDiscoverBusy(user.id, true);
    setDiscoverError(null);
    try {
      await sendConnectionRequestToUser(user.id);
      setDiscoverUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, invited: true } : u)));
    } catch (e: any) {
      setDiscoverError(e?.message ?? t("social.failedInvite"));
    } finally {
      setDiscoverBusy(user.id, false);
    }
  }

  function refreshFeed() {
    setFeedLoading(true);
    return getFeed()
      .then(async (rows) => {
        setFeed(rows);
        try {
          setCommentCounts(await getPostCommentCounts(rows.map((p) => p.id)));
        } catch {
          // Non-fatal — comment toggles just start uncounted for this load.
        }
      })
      .catch((e: any) => setFeedError(e?.message ?? t("social.failedLoadFeed")))
      .finally(() => setFeedLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    getCurrentUserId()
      .then(setCurrentUserId)
      .catch(() => {});
    refreshConnections().finally(() => setLoading(false));
    refreshFeed();
    refreshDiscover();
    // Fail open on a transient error here rather than locking the user
    // out of Community entirely — this is a rules acknowledgment, not a
    // legal gate, so the safer failure mode is "let them in."
    getOrCreateProfile()
      .then((p) => setGuidelinesAccepted(!!p.community_guidelines_accepted_at))
      .catch(() => setGuidelinesAccepted(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAgreeToGuidelines() {
    setGuidelinesSaving(true);
    setGuidelinesError(null);
    try {
      await acceptCommunityGuidelines();
      setGuidelinesAccepted(true);
    } catch (e: any) {
      setGuidelinesError(e?.message ?? t("social.guidelinesFailed"));
    } finally {
      setGuidelinesSaving(false);
    }
  }

  function setConnectionBusy(id: string, busy: boolean) {
    setBusyConnectionIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleRespond(id: string, accept: boolean) {
    if (busyConnectionIds.has(id)) return;
    setConnectionBusy(id, true);
    setConnError(null);
    try {
      await respondToConnectionRequest(id, accept);
      refreshConnections();
      notifyNotificationsUpdated();
      // A declined request falls back into the discoverable pool.
      if (!accept) refreshDiscover();
    } catch (e: any) {
      setConnError(e?.message ?? t("social.failedRespondRequest"));
    } finally {
      setConnectionBusy(id, false);
    }
  }

  async function handleRemoveConnection(id: string) {
    if (busyConnectionIds.has(id)) return;
    setConnectionBusy(id, true);
    setConnError(null);
    try {
      await removeConnection(id);
      refreshConnections();
      notifyNotificationsUpdated();
      // Cancelling an outgoing request or removing an accepted connection
      // both put this person back into the discoverable pool.
      refreshDiscover();
    } catch (e: any) {
      setConnError(e?.message ?? t("social.failedRemoveConnection"));
    } finally {
      setConnectionBusy(id, false);
    }
  }

  function handlePostImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPostError(null);
    if (!POST_IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setPostError(t("social.photoTypeInvalid"));
      return;
    }
    if (file.size > POST_IMAGE_MAX_BYTES) {
      setPostError(t("social.photoTooLarge"));
      return;
    }
    if (postImagePreviewUrl) URL.revokeObjectURL(postImagePreviewUrl);
    setPostImageFile(file);
    setPostImagePreviewUrl(URL.createObjectURL(file));
  }

  function clearPostImage() {
    if (postImagePreviewUrl) URL.revokeObjectURL(postImagePreviewUrl);
    setPostImageFile(null);
    setPostImagePreviewUrl(null);
  }

  // Revoke the blob URL on unmount too, not just on explicit clear/post —
  // otherwise navigating away with an image still selected leaks it.
  useEffect(() => {
    return () => {
      if (postImagePreviewUrl) URL.revokeObjectURL(postImagePreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postImagePreviewUrl]);

  async function handlePost() {
    const trimmed = postBody.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      let imagePath: string | null = null;
      if (postImageFile) imagePath = await uploadPostImage(postImageFile);
      await createMotivationalPost(trimmed, postVisibility, imagePath);
      setPostBody("");
      clearPostImage();
      await refreshFeed();
    } catch (e: any) {
      setPostError(e?.message ?? t("social.failedPost"));
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return <div className="card">{t("dashboard.loading")}</div>;
  }

  const incoming = connections.filter((c) => c.status === "pending" && c.direction === "incoming");
  const outgoing = connections.filter((c) => c.status === "pending" && c.direction === "outgoing");
  const accepted = connections.filter((c) => c.status === "accepted");

  // Tabs are a plain client-side filter over the one already-fetched feed
  // page — no extra query per tab, since getFeed() already returns exactly
  // the rows RLS allows (own + everyone + connections-visible).
  const globalPosts = feed.filter((p) => p.visibility === "everyone");
  const circlePosts = feed.filter((p) => p.visibility === "connections" && p.userId !== currentUserId);
  const visiblePosts = activeTab === "global" ? globalPosts : activeTab === "circle" ? circlePosts : feed;

  const TABS: { key: SocialTab; labelKey: TranslationKey; icon: typeof Users }[] = [
    { key: "myFeed", labelKey: "social.tabMyFeed", icon: LayoutGrid },
    { key: "global", labelKey: "social.tabGlobal", icon: Globe },
    { key: "circle", labelKey: "social.tabCircle", icon: Users },
    { key: "friends", labelKey: "social.tabFriends", icon: UserPlus },
    { key: "goals", labelKey: "social.tabGoals", icon: ClipboardList },
  ];

  return (
    <div className="space-y-6">
      {guidelinesAccepted === false && (
        <CommunityGuidelinesModal
          saving={guidelinesSaving}
          error={guidelinesError}
          onAgree={handleAgreeToGuidelines}
          onDecline={() => router.push("/standup/dashboard")}
        />
      )}
      <div className="card card-highlight">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t("social.title")}</h1>
        <p className="text-white/70">{t("social.subtitle")}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="btn inline-flex items-center gap-1.5"
              style={{
                background: activeTab === tab.key ? "rgba(245, 158, 11, 0.2)" : undefined,
                borderColor: activeTab === tab.key ? "rgba(245, 158, 11, 0.6)" : undefined,
              }}
            >
              <tab.icon size={14} /> {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {activeTab !== "friends" && (
        <>
          {/* Composer — a motivational post is the one content type a user
              writes themselves; goal glimpses come from Today's Publish
              buttons, achievements auto-post on unlock. */}
          <div className="card card-highlight">
            <textarea
              value={postBody}
              onChange={(e) => setPostBody(e.target.value.slice(0, MOTIVATIONAL_POST_MAX_LENGTH))}
              placeholder={t("social.composerPlaceholder")}
              disabled={posting}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50 resize-none"
            />

            <input
              ref={postImageInputRef}
              type="file"
              accept={POST_IMAGE_ALLOWED_TYPES.join(",")}
              onChange={handlePostImageSelected}
              disabled={posting}
              className="hidden"
            />
            {postImagePreviewUrl ? (
              <div className="mt-2 relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={postImagePreviewUrl}
                  alt=""
                  className="h-24 w-24 rounded-lg object-cover border border-white/10"
                />
                <button
                  type="button"
                  onClick={clearPostImage}
                  disabled={posting}
                  className="absolute -top-2 -right-2 flex items-center justify-center rounded-full"
                  style={{ width: "22px", height: "22px", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.2)" }}
                  title={t("social.removePhoto")}
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => postImageInputRef.current?.click()}
                disabled={posting}
                className="btn mt-2 inline-flex items-center gap-1.5"
                style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
              >
                <ImagePlus size={13} /> {t("social.addPhoto")}
              </button>
            )}

            <div className="flex items-center justify-between gap-2 mt-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPostVisibility("connections")}
                  className="btn"
                  style={{
                    padding: "0.3rem 0.6rem",
                    fontSize: "0.75rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    background: postVisibility === "connections" ? "rgba(245, 158, 11, 0.2)" : undefined,
                    borderColor: postVisibility === "connections" ? "rgba(245, 158, 11, 0.6)" : undefined,
                  }}
                >
                  <Users size={12} /> {t("today.publishConnectionsBtn")}
                </button>
                <button
                  type="button"
                  onClick={() => setPostVisibility("everyone")}
                  className="btn"
                  style={{
                    padding: "0.3rem 0.6rem",
                    fontSize: "0.75rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    background: postVisibility === "everyone" ? "rgba(245, 158, 11, 0.2)" : undefined,
                    borderColor: postVisibility === "everyone" ? "rgba(245, 158, 11, 0.6)" : undefined,
                  }}
                >
                  <Globe size={12} /> {t("today.publishEveryoneBtn")}
                </button>
              </div>
              <button
                type="button"
                onClick={handlePost}
                disabled={posting || !postBody.trim()}
                className="btn btn-primary text-sm px-4 py-2 whitespace-nowrap"
              >
                {posting ? t("social.posting") : t("social.postButton")}
              </button>
            </div>
            {postError && <p className="mt-2 text-xs text-red-300">{postError}</p>}
          </div>

          {/* Feed — every post type (goal glimpses, achievements, motivational)
              the viewer is allowed to see for the active tab, newest first. */}
          <div className="card card-highlight">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{t("social.publicFeedTitle")}</h2>
              <p className="mt-1 text-sm text-white/60">{t("social.publicFeedSubtitle")}</p>
            </div>
            {feedError && <p className="mb-3 text-xs text-red-300">{feedError}</p>}
            {!feedLoading && visiblePosts.length === 0 ? (
              <p className="text-sm text-white/50">{t("social.noPublicPostsToday")}</p>
            ) : (
              <div className="space-y-3">
                {visiblePosts.map((post) => (
                  <PostCard key={post.id} post={post} commentCount={commentCounts[post.id] ?? 0} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "friends" && (
        <>
          <div className="card card-highlight">
            <h2 className="text-lg font-semibold mb-1">{t("social.discoverTitle")}</h2>
            <p className="text-sm text-white/60 mb-4">{t("social.discoverSubtitle")}</p>

            {discoverError && <p className="mb-3 text-xs text-red-300">{discoverError}</p>}

            {discoverLoading ? (
              <p className="text-sm text-white/50">{t("dashboard.loading")}</p>
            ) : discoverUsers.length === 0 ? (
              <p className="text-sm text-white/50 italic">{t("social.noOneToDiscover")}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {discoverUsers.map((user) => {
                    const name = user.displayName ?? t("social.anonymousUser");
                    const busy = busyDiscoverIds.has(user.id);
                    return (
                      <div
                        key={user.id}
                        className="flex flex-col items-center gap-2 rounded-xl p-3 text-center"
                        style={{ background: "rgba(var(--tint-rgb), 0.04)", border: "1px solid rgba(var(--tint-rgb), 0.1)" }}
                      >
                        <Avatar avatarUrl={user.avatarUrl} label={name} size={56} />
                        <div className="text-sm text-white/85 truncate w-full">{name}</div>
                        <button
                          type="button"
                          onClick={() => handleInvite(user)}
                          disabled={busy || user.invited}
                          className="btn w-full inline-flex items-center justify-center gap-1.5"
                          style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                        >
                          {user.invited ? (
                            <>
                              <UserCheck size={12} /> {t("social.invitationSent")}
                            </>
                          ) : busy ? (
                            t("social.inviting")
                          ) : (
                            t("social.invite")
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={handleLoadMoreDiscover}
                    disabled={discoverLoadingMore}
                    className="btn"
                    style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }}
                  >
                    {discoverLoadingMore ? t("dashboard.loading") : t("social.loadMore")}
                  </button>
                </div>
              </>
            )}
          </div>

          <div
            className="card"
            style={{ background: "rgba(var(--tint-rgb), 0.03)", border: "1px solid rgba(var(--tint-rgb), 0.08)" }}
          >
          <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">
            {t("social.connectionsTitle")}
          </div>
          <p className="text-xs text-white/60 mb-3">{t("social.connectionsBody")}</p>
          {connError && <p className="mt-2 text-xs text-red-300">{connError}</p>}

          <div className="mt-4 space-y-4">
            {incoming.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
                  {t("social.incomingRequests")}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {incoming.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-col items-center gap-2 rounded-xl p-3 text-center"
                      style={{ background: "rgba(var(--tint-rgb), 0.04)", border: "1px solid rgba(var(--tint-rgb), 0.1)" }}
                    >
                      <Avatar avatarUrl={c.otherAvatarUrl} label={connectionDisplayName(c, t)} size={56} />
                      <div className="text-sm text-white/85 truncate w-full">{connectionDisplayName(c, t)}</div>
                      <div className="flex gap-1.5 w-full">
                        <button
                          type="button"
                          onClick={() => handleRespond(c.id, true)}
                          disabled={busyConnectionIds.has(c.id)}
                          className="btn flex-1"
                          style={{ padding: "0.3rem 0.4rem", fontSize: "0.72rem" }}
                        >
                          {t("social.accept")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRespond(c.id, false)}
                          disabled={busyConnectionIds.has(c.id)}
                          className="btn flex-1"
                          style={{ padding: "0.3rem 0.4rem", fontSize: "0.72rem" }}
                        >
                          {t("social.decline")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {outgoing.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
                  {t("social.outgoingRequests")}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {outgoing.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-col items-center gap-2 rounded-xl p-3 text-center"
                      style={{ background: "rgba(var(--tint-rgb), 0.04)", border: "1px solid rgba(var(--tint-rgb), 0.1)" }}
                    >
                      <Avatar avatarUrl={c.otherAvatarUrl} label={connectionDisplayName(c, t)} size={56} />
                      <div className="text-sm text-white/85 truncate w-full">{connectionDisplayName(c, t)}</div>
                      <button
                        type="button"
                        onClick={() => handleRemoveConnection(c.id)}
                        disabled={busyConnectionIds.has(c.id)}
                        className="btn w-full"
                        style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                      >
                        {t("social.cancelRequest")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
                {t("social.yourConnections")}
              </div>
              {accepted.length === 0 ? (
                <p className="text-xs text-white/40 italic">{t("social.noConnectionsYet")}</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {accepted.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-col items-center gap-2 rounded-xl p-3 text-center"
                      style={{ background: "rgba(var(--tint-rgb), 0.04)", border: "1px solid rgba(var(--tint-rgb), 0.1)" }}
                    >
                      <Avatar avatarUrl={c.otherAvatarUrl} label={connectionDisplayName(c, t)} size={56} />
                      <div className="text-sm text-white/85 truncate w-full">{connectionDisplayName(c, t)}</div>
                      <button
                        type="button"
                        onClick={() => handleRemoveConnection(c.id)}
                        disabled={busyConnectionIds.has(c.id)}
                        className="btn w-full"
                        style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                      >
                        {t("social.removeConnection")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
        </>
      )}

      {activeTab === "goals" && (
        <GoalAssignmentsPanel />
      )}
    </div>
  );
}

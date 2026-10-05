"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  createTeamGoal,
  getDiscoverableUsers,
  sendConnectionRequestToUser,
  uploadPostImage,
  uploadPostVideo,
  addMention,
  POST_IMAGE_ALLOWED_TYPES,
  POST_IMAGE_MAX_BYTES,
  POST_VIDEO_ALLOWED_TYPES,
  POST_VIDEO_MAX_BYTES,
  POST_VIDEO_MAX_DURATION_SECONDS,
  type Connection,
  type Post,
  type PostVisibility,
  type DiscoverableUser,
} from "@/lib/supabase/db";
import { useRouter, useSearchParams } from "next/navigation";
import PostCard from "@/components/PostCard";
import Avatar from "@/components/Avatar";
import GoalAssignmentsPanel from "@/components/GoalAssignmentsPanel";
import CommunityGuidelinesModal from "@/components/CommunityGuidelinesModal";
import MentionInput from "@/components/MentionInput";
import PageLoadingState from "@/components/PageLoadingState";
import { notifyNotificationsUpdated } from "@/lib/notificationsBus";
import { Users, Globe, LayoutGrid, UserPlus, UserCheck, UserCircle, ImagePlus, Video, X, ClipboardList, ListChecks, Plus, Trash2, MoreVertical } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

const MOTIVATIONAL_POST_MAX_LENGTH = 280;

type SocialTab = "myFeed" | "global" | "circle" | "myPosts" | "friends" | "goals";
const SOCIAL_TAB_VALUES: SocialTab[] = ["myFeed", "global", "circle", "myPosts", "friends", "goals"];

export default function SocialPage() {
  const { t } = useLanguage();
  const router = useRouter();
  // Deep-linking in from the notification bell/Dashboard — ?tab= picks
  // the starting tab, ?post=/&comment= are which post/comment to scroll
  // to and highlight once the feed loads (see the scroll effect below).
  // Read once on mount; Social never writes these back to the URL itself
  // (tab clicks are plain setActiveTab, not router.push), so there's no
  // risk of this fighting with later in-page navigation.
  const searchParams = useSearchParams();
  const highlightPostId = searchParams.get("post");
  const highlightCommentId = searchParams.get("comment");
  const scrolledToHighlightRef = useRef(false);
  const [loading, setLoading] = useState(true);
  // null = not checked yet (render nothing rather than flash the feed
  // before we know). false = must acknowledge before anything below is
  // usable. See CommunityGuidelinesModal.
  const [guidelinesAccepted, setGuidelinesAccepted] = useState<boolean | null>(null);
  const [guidelinesSaving, setGuidelinesSaving] = useState(false);
  const [guidelinesError, setGuidelinesError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SocialTab>(() => {
    const tabParam = searchParams.get("tab");
    return SOCIAL_TAB_VALUES.includes(tabParam as SocialTab) ? (tabParam as SocialTab) : "myFeed";
  });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connError, setConnError] = useState<string | null>(null);
  // Per-row busy tracking so accepting/declining/removing one row doesn't
  // block interaction with the others while its request is in flight.
  const [busyConnectionIds, setBusyConnectionIds] = useState<Set<string>>(new Set());
  // At most one accepted-connection card's "⋯" menu open at a time — same
  // single-ref click-outside pattern as Header's own More panel. Remove now
  // lives there instead of being the card's one big visible button, which
  // made the Connections list read as administrative rather than social.
  const [openConnMenuId, setOpenConnMenuId] = useState<string | null>(null);
  const connMenuRef = useRef<HTMLDivElement | null>(null);

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
  const [postMentionedIds, setPostMentionedIds] = useState<string[]>([]);
  const [postVisibility, setPostVisibility] = useState<PostVisibility>("connections");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postImageFile, setPostImageFile] = useState<File | null>(null);
  const [postImagePreviewUrl, setPostImagePreviewUrl] = useState<string | null>(null);
  const postImageInputRef = useRef<HTMLInputElement | null>(null);
  // A post carries at most one attachment (image XOR video) -- selecting a
  // video while an image preview is showing isn't reachable through the UI
  // (the Add buttons are hidden once either is set), so no extra mutual-
  // exclusion handling is needed beyond that.
  const [postVideoFile, setPostVideoFile] = useState<File | null>(null);
  const [postVideoPreviewUrl, setPostVideoPreviewUrl] = useState<string | null>(null);
  const postVideoInputRef = useRef<HTMLInputElement | null>(null);

  // Team Goal composer — collapsed by default (its own small form, not
  // merged into the motivational composer above) since it needs a
  // structurally different shape: a title, optional details, a dynamic
  // list of starter checklist items, and no image/video attachment.
  const [showTeamGoalComposer, setShowTeamGoalComposer] = useState(false);
  const [teamGoalTitle, setTeamGoalTitle] = useState("");
  const [teamGoalDetails, setTeamGoalDetails] = useState("");
  const [teamGoalItemDrafts, setTeamGoalItemDrafts] = useState<string[]>(["", ""]);
  const [teamGoalVisibility, setTeamGoalVisibility] = useState<Exclude<PostVisibility, "individual">>("connections");
  const [creatingTeamGoal, setCreatingTeamGoal] = useState(false);
  const [teamGoalError, setTeamGoalError] = useState<string | null>(null);

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

  // One-shot scroll-to-and-highlight for a deep link from the bell
  // dropdown/a mention/a post-activity notification — guarded by a ref
  // so it only fires once per page load, not on every feed refresh
  // afterward (e.g. after reacting to something).
  useEffect(() => {
    if (scrolledToHighlightRef.current || feedLoading || !highlightPostId) return;
    const el = document.querySelector(`[data-post-id="${highlightPostId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      scrolledToHighlightRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedLoading, feed, highlightPostId]);

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

  useEffect(() => {
    if (!openConnMenuId) return;
    function handleClickOutside(e: MouseEvent) {
      if (connMenuRef.current && !connMenuRef.current.contains(e.target as Node)) {
        setOpenConnMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openConnMenuId]);

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

  async function handlePostVideoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPostError(null);
    if (!POST_VIDEO_ALLOWED_TYPES.includes(file.type)) {
      setPostError(t("social.videoTypeInvalid"));
      return;
    }
    if (file.size > POST_VIDEO_MAX_BYTES) {
      setPostError(t("social.videoTooLarge"));
      return;
    }
    // Duration needs the file's metadata loaded, so this check is async —
    // uploadPostVideo re-checks it too at actual upload time regardless.
    const video = document.createElement("video");
    video.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    const durationOk = await new Promise<boolean>((resolve) => {
      video.onloadedmetadata = () => resolve(video.duration <= POST_VIDEO_MAX_DURATION_SECONDS);
      video.onerror = () => resolve(true); // unreadable — don't block, uploadPostVideo will re-check
      video.src = objectUrl;
    });
    if (!durationOk) {
      URL.revokeObjectURL(objectUrl);
      setPostError(t("social.videoTooLong"));
      return;
    }
    if (postVideoPreviewUrl) URL.revokeObjectURL(postVideoPreviewUrl);
    setPostVideoFile(file);
    setPostVideoPreviewUrl(objectUrl);
  }

  function clearPostVideo() {
    if (postVideoPreviewUrl) URL.revokeObjectURL(postVideoPreviewUrl);
    setPostVideoFile(null);
    setPostVideoPreviewUrl(null);
  }

  useEffect(() => {
    return () => {
      if (postVideoPreviewUrl) URL.revokeObjectURL(postVideoPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postVideoPreviewUrl]);

  async function handlePost() {
    const trimmed = postBody.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      let imagePath: string | null = null;
      let videoPath: string | null = null;
      if (postImageFile) imagePath = await uploadPostImage(postImageFile);
      if (postVideoFile) videoPath = await uploadPostVideo(postVideoFile);
      const newPostId = await createMotivationalPost(trimmed, postVisibility, imagePath, videoPath);
      // Best-effort: a mention failing (e.g. the connection was removed
      // mid-composition) shouldn't undo the post itself, which already
      // succeeded by this point.
      if (newPostId) {
        await Promise.allSettled(postMentionedIds.map((id) => addMention(newPostId, id)));
      }
      setPostBody("");
      setPostMentionedIds([]);
      clearPostImage();
      clearPostVideo();
      await refreshFeed();
    } catch (e: any) {
      setPostError(e?.message ?? t("social.failedPost"));
    } finally {
      setPosting(false);
    }
  }

  async function handleCreateTeamGoal() {
    const title = teamGoalTitle.trim();
    if (!title || creatingTeamGoal) return;
    setCreatingTeamGoal(true);
    setTeamGoalError(null);
    try {
      await createTeamGoal(title, teamGoalDetails.trim() || null, teamGoalVisibility, teamGoalItemDrafts);
      setTeamGoalTitle("");
      setTeamGoalDetails("");
      setTeamGoalItemDrafts(["", ""]);
      setShowTeamGoalComposer(false);
      await refreshFeed();
    } catch (e: any) {
      setTeamGoalError(e?.message ?? t("teamGoal.failedCreate"));
    } finally {
      setCreatingTeamGoal(false);
    }
  }

  if (loading) {
    return <PageLoadingState label={t("dashboard.loading")} />;
  }

  const incoming = connections.filter((c) => c.status === "pending" && c.direction === "incoming");
  const outgoing = connections.filter((c) => c.status === "pending" && c.direction === "outgoing");
  const accepted = connections.filter((c) => c.status === "accepted");
  const shareableConnections = accepted.map((c) => ({ id: c.otherUserId, displayName: c.otherDisplayName }));

  // Tabs are a plain client-side filter over the one already-fetched feed
  // page — no extra query per tab, since getFeed() already returns exactly
  // the rows RLS allows (own + everyone + connections-visible).
  const globalPosts = feed.filter((p) => p.visibility === "everyone");
  const circlePosts = feed.filter((p) => p.visibility === "connections" && p.userId !== currentUserId);
  const myPosts = feed.filter((p) => p.userId === currentUserId);
  const visiblePosts =
    activeTab === "global" ? globalPosts : activeTab === "circle" ? circlePosts : activeTab === "myPosts" ? myPosts : feed;
  const teamGoalPosts = feed.filter((p) => p.type === "team_goal");

  // Per-tab accent colors (reusing GLIMPSE_REACTIONS' existing palette for
  // 4 of the 6 — blue/rose/amber/emerald are already this app's established
  // reaction colors — plus two new ones for Circle/Friends) rather than the
  // single shared amber used everywhere else active-state color is used.
  // Explicit user call, reference image attached: inactive tabs show a
  // dim version of their own color instead of staying neutral/gray.
  // descriptionKey backs the per-tab compact hero below the tab bar, which
  // replaced a single generic "Community" header repeated on every tab —
  // explicit user call ("let the page's actual content begin almost
  // immediately"), same descriptionKey pattern Tools already uses, except
  // here the title ALSO swaps per tab (Tools keeps one fixed title).
  const TABS: { key: SocialTab; labelKey: TranslationKey; icon: typeof Users; color: string; descriptionKey: TranslationKey }[] = [
    { key: "myFeed", labelKey: "social.tabMyFeed", icon: LayoutGrid, color: "#60a5fa", descriptionKey: "social.descMyFeed" },
    { key: "global", labelKey: "social.tabGlobal", icon: Globe, color: "#34d399", descriptionKey: "social.descGlobal" },
    { key: "circle", labelKey: "social.tabCircle", icon: Users, color: "#a78bfa", descriptionKey: "social.descCircle" },
    { key: "myPosts", labelKey: "social.tabMyPosts", icon: UserCircle, color: "#f43f5e", descriptionKey: "social.descMyPosts" },
    { key: "friends", labelKey: "social.tabFriends", icon: UserPlus, color: "#22d3ee", descriptionKey: "social.descFriends" },
    { key: "goals", labelKey: "social.tabGoals", icon: ClipboardList, color: "#f59e0b", descriptionKey: "social.descGoals" },
  ];
  const activeTabMeta = TABS.find((tab) => tab.key === activeTab)!;

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
      {/* Browser-tab / hanging-folder navigation, now sitting directly on
          top of (and visually merged with) the Community heading card
          right below it, same treatment as the Tools page — explicit
          user call. This wrapper (not space-y-6) is what lets the tab
          bar sit flush against the card that follows it — see
          .folder-tabbar's negative margin-bottom in globals.css for the
          actual overlap that erases the seam under the active tab. */}
      <div>
        <div className="folder-tabbar folder-tabbar-community" role="tablist">
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={t(tab.labelKey)}
                title={t(tab.labelKey)}
                onClick={() => setActiveTab(tab.key)}
                className={`folder-tab folder-tab-community${isActive ? " folder-tab-active" : ""}`}
                style={{ "--tab-color": tab.color } as React.CSSProperties}
              >
                <tab.icon size={15} />
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </div>

        {/* Compact, per-tab hero — replaces a single generic "Community"
            header that repeated on every sub-tab and ate a lot of mobile
            vertical space before any actual tab content appeared. */}
        <div className="card card-highlight folder-tabbar-panel">
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: activeTabMeta.color }}>
              <activeTabMeta.icon size={20} />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold">{t(activeTabMeta.labelKey)}</h1>
          </div>
          <p className="text-sm text-white/70">{t(activeTabMeta.descriptionKey)}</p>
        </div>
      </div>

      {/* Motivational composer + general feed — My Feed/Global/My Circle/
          My Posts only. Friends and Goals are purpose-built (people-first
          and team-goals-first respectively) rather than sharing this same
          top template — explicit user call. */}
      {(activeTab === "myFeed" || activeTab === "global" || activeTab === "circle" || activeTab === "myPosts") && (
        <div className="space-y-6">
          {/* Composer — a motivational post is the one content type a user
              writes themselves; goal glimpses come from Today's Publish
              buttons, achievements auto-post on unlock. */}
          <div className="card card-highlight">
            <MentionInput
              multiline
              value={postBody}
              onChange={(v) => setPostBody(v.slice(0, MOTIVATIONAL_POST_MAX_LENGTH))}
              connections={shareableConnections}
              onMentionedIdsChange={setPostMentionedIds}
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
            <input
              ref={postVideoInputRef}
              type="file"
              accept={POST_VIDEO_ALLOWED_TYPES.join(",")}
              onChange={handlePostVideoSelected}
              disabled={posting}
              className="hidden"
            />
            {/* A post carries at most one attachment — image XOR video —
                so the two "Add" buttons only show while neither is set. */}
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
            ) : postVideoPreviewUrl ? (
              <div className="mt-2 relative inline-block">
                <video src={postVideoPreviewUrl} controls muted className="max-h-40 rounded-lg border border-white/10" />
                <button
                  type="button"
                  onClick={clearPostVideo}
                  disabled={posting}
                  className="absolute -top-2 -right-2 flex items-center justify-center rounded-full"
                  style={{ width: "22px", height: "22px", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.2)" }}
                  title={t("social.removeVideo")}
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => postImageInputRef.current?.click()}
                  disabled={posting}
                  className="btn inline-flex items-center gap-1.5"
                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                >
                  <ImagePlus size={13} /> {t("social.addPhoto")}
                </button>
                <button
                  type="button"
                  onClick={() => postVideoInputRef.current?.click()}
                  disabled={posting}
                  className="btn inline-flex items-center gap-1.5"
                  style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                >
                  <Video size={13} /> {t("social.addVideo")}
                </button>
              </div>
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
            <div className="my-2 flex items-center gap-4">
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(var(--tint-rgb),0.2), transparent)" }} />
              <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
                {t("social.latestActivityDivider")}
              </div>
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(var(--tint-rgb),0.2), transparent)" }} />
            </div>
            {feedError && <p className="mb-3 text-xs text-red-300">{feedError}</p>}
            {!feedLoading && visiblePosts.length === 0 ? (
              <p className="text-sm text-white/50">{t("social.noPublicPostsToday")}</p>
            ) : (
              <div className="space-y-3">
                {visiblePosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    commentCount={commentCounts[post.id] ?? 0}
                    shareableConnections={shareableConnections}
                    highlighted={post.id === highlightPostId}
                    autoExpandComments={post.id === highlightPostId && !!highlightCommentId}
                    highlightCommentId={post.id === highlightPostId ? highlightCommentId : null}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "friends" && (
        <div className="space-y-6">
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
                      <div className="conn-request-actions">
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
                      className="relative flex flex-col items-center gap-2 rounded-xl p-3 text-center"
                      style={{ background: "rgba(var(--tint-rgb), 0.04)", border: "1px solid rgba(var(--tint-rgb), 0.1)" }}
                    >
                      <span className="conn-state-badge conn-state-pending">{t("social.statePending")}</span>
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
                      className="relative flex flex-col items-center gap-2 rounded-xl p-3 text-center"
                      style={{ background: "rgba(var(--tint-rgb), 0.04)", border: "1px solid rgba(var(--tint-rgb), 0.1)" }}
                    >
                      {/* Relationship state — explicit user call: a user
                          should be able to tell Invite/Pending/Connected
                          apart at a glance, not just infer it from which
                          section a card happens to sit in. */}
                      <span className="conn-state-badge conn-state-connected">{t("social.stateConnected")}</span>

                      <Avatar avatarUrl={c.otherAvatarUrl} label={connectionDisplayName(c, t)} size={56} />
                      <div className="text-sm text-white/85 truncate w-full">{connectionDisplayName(c, t)}</div>

                      <div className="flex items-center gap-1.5 w-full">
                        <Link
                          href={`/standup/social/profile/${c.otherUserId}`}
                          className="btn flex-1"
                          style={{ padding: "0.3rem 0.5rem", fontSize: "0.72rem" }}
                        >
                          {t("social.viewProfile")}
                        </Link>
                        {/* Remove now lives behind this menu instead of
                            being the card's one big visible action —
                            explicit user call ("Remove being the main
                            button makes the page feel administrative
                            rather than social"). */}
                        <div className="relative" ref={openConnMenuId === c.id ? connMenuRef : undefined}>
                          <button
                            type="button"
                            onClick={() => setOpenConnMenuId((prev) => (prev === c.id ? null : c.id))}
                            className="btn flex-shrink-0"
                            style={{ padding: "0.3rem 0.4rem" }}
                            title={t("social.moreActions")}
                            aria-label={t("social.moreActions")}
                          >
                            <MoreVertical size={14} />
                          </button>
                          {openConnMenuId === c.id && (
                            <div className="conn-card-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenConnMenuId(null);
                                  handleRemoveConnection(c.id);
                                }}
                                disabled={busyConnectionIds.has(c.id)}
                                className="conn-card-menu-item conn-card-menu-item-danger"
                              >
                                <Trash2 size={13} /> {t("social.removeConnection")}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Goals — purpose-built around team/shared goals instead of sharing
          the motivational composer/feed template (explicit user call:
          "Goals should lead with team/community goals"). Team Goal
          composer moved here from the generic block above; the filtered
          team_goal list leads, with the existing 1:1 Assigned Goals
          shortcut panel below it. */}
      {activeTab === "goals" && (
        <div className="space-y-6">
          {!showTeamGoalComposer ? (
            <button
              type="button"
              onClick={() => setShowTeamGoalComposer(true)}
              className="btn btn-primary inline-flex items-center gap-1.5"
            >
              <ListChecks size={14} /> {t("teamGoal.startButton")}
            </button>
          ) : (
            <div className="card card-highlight">
              <h2 className="text-lg font-semibold mb-1">{t("teamGoal.composerTitle")}</h2>
              <p className="text-sm text-white/60 mb-3">{t("teamGoal.composerSubtitle")}</p>

              <input
                type="text"
                value={teamGoalTitle}
                onChange={(e) => setTeamGoalTitle(e.target.value)}
                disabled={creatingTeamGoal}
                placeholder={t("teamGoal.titlePlaceholder")}
                className="w-full mb-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
              />
              <textarea
                value={teamGoalDetails}
                onChange={(e) => setTeamGoalDetails(e.target.value)}
                disabled={creatingTeamGoal}
                placeholder={t("teamGoal.detailsPlaceholder")}
                rows={2}
                className="w-full mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50 resize-none"
              />

              <div className="text-xs uppercase tracking-wide text-white/40 font-semibold mb-2">
                {t("teamGoal.checklistLabel")}
              </div>
              <div className="space-y-2 mb-2">
                {teamGoalItemDrafts.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item}
                      onChange={(e) =>
                        setTeamGoalItemDrafts((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                      }
                      disabled={creatingTeamGoal}
                      placeholder={t("teamGoal.itemPlaceholder", { n: idx + 1 })}
                      className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                    />
                    {teamGoalItemDrafts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setTeamGoalItemDrafts((prev) => prev.filter((_, i) => i !== idx))}
                        disabled={creatingTeamGoal}
                        className="btn flex-shrink-0"
                        style={{ padding: "0.35rem" }}
                        title={t("teamGoal.removeItem")}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setTeamGoalItemDrafts((prev) => [...prev, ""])}
                disabled={creatingTeamGoal}
                className="btn inline-flex items-center gap-1.5 mb-3"
                style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
              >
                <Plus size={13} /> {t("teamGoal.addAnotherItem")}
              </button>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTeamGoalVisibility("connections")}
                    className="btn"
                    style={{
                      padding: "0.3rem 0.6rem",
                      fontSize: "0.75rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      background: teamGoalVisibility === "connections" ? "rgba(245, 158, 11, 0.2)" : undefined,
                      borderColor: teamGoalVisibility === "connections" ? "rgba(245, 158, 11, 0.6)" : undefined,
                    }}
                  >
                    <Users size={12} /> {t("today.publishConnectionsBtn")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTeamGoalVisibility("everyone")}
                    className="btn"
                    style={{
                      padding: "0.3rem 0.6rem",
                      fontSize: "0.75rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      background: teamGoalVisibility === "everyone" ? "rgba(245, 158, 11, 0.2)" : undefined,
                      borderColor: teamGoalVisibility === "everyone" ? "rgba(245, 158, 11, 0.6)" : undefined,
                    }}
                  >
                    <Globe size={12} /> {t("today.publishEveryoneBtn")}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTeamGoalComposer(false)}
                    disabled={creatingTeamGoal}
                    className="btn text-sm px-3 py-2"
                  >
                    {t("teamGoal.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateTeamGoal}
                    disabled={creatingTeamGoal || !teamGoalTitle.trim()}
                    className="btn btn-primary text-sm px-4 py-2 whitespace-nowrap"
                  >
                    {creatingTeamGoal ? t("teamGoal.creating") : t("teamGoal.createButton")}
                  </button>
                </div>
              </div>
              {teamGoalError && <p className="mt-2 text-xs text-red-300">{teamGoalError}</p>}
            </div>
          )}

          <div className="card card-highlight">
            <h2 className="text-lg font-semibold mb-1">{t("teamGoal.activeListTitle")}</h2>
            {teamGoalPosts.length === 0 ? (
              <p className="text-sm text-white/50">{t("teamGoal.noneYet")}</p>
            ) : (
              <div className="space-y-3">
                {teamGoalPosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    commentCount={commentCounts[post.id] ?? 0}
                    shareableConnections={shareableConnections}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-4">
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(var(--tint-rgb),0.2), transparent)" }} />
              <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
                {t("teamGoal.assignedGoalsDivider")}
              </div>
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(var(--tint-rgb),0.2), transparent)" }} />
            </div>
            <GoalAssignmentsPanel />
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

// A dedicated profile page for one connection, reached from Connections'
// "View profile" — replaces the old ConnectionProfileModal popup with a
// real page so there's room for that person's own activity feed, not just
// their name/avatar/connected-since date. Reuses the exact same data this
// app already fetches elsewhere (listConnections/getFeed), so privacy is
// inherited for free: getFeed() already returns only what RLS allows the
// current viewer to see, and this page just filters that same set down to
// one author client-side, the same technique the Social page itself
// already uses for its own My Posts tab.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  listConnections,
  removeConnection,
  connectionDisplayName,
  getFeed,
  getPostCommentCounts,
  formatDateTimeDisplay,
  type Connection,
  type Post,
} from "@/lib/supabase/db";
import { notifyNotificationsUpdated } from "@/lib/notificationsBus";
import Avatar from "@/components/Avatar";
import PostCard from "@/components/PostCard";
import PageLoadingState from "@/components/PageLoadingState";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function ConnectionProfilePage() {
  const { t } = useLanguage();
  const params = useParams();
  const userId = params.userId as string;

  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [shareableConnections, setShareableConnections] = useState<{ id: string; displayName: string | null }[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  // Desktop always shows About (it has its own column); this only governs
  // the collapsed-by-default mobile disclosure below the identity block.
  const [aboutExpanded, setAboutExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [connections, feed] = await Promise.all([listConnections(), getFeed()]);
        if (cancelled) return;
        setConnection(connections.find((c) => c.otherUserId === userId) ?? null);
        setShareableConnections(
          connections.filter((c) => c.status === "accepted").map((c) => ({ id: c.otherUserId, displayName: c.otherDisplayName }))
        );
        const userPosts = feed.filter((p) => p.userId === userId);
        setPosts(userPosts);
        if (userPosts.length > 0) {
          try {
            setCommentCounts(await getPostCommentCounts(userPosts.map((p) => p.id)));
          } catch {
            // Non-fatal, same handling as the Social page's own feed load.
          }
        }
      } catch {
        if (!cancelled) setConnection(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleRemove() {
    if (!connection || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeConnection(connection.id);
      notifyNotificationsUpdated();
      setRemoved(true);
    } catch (e: any) {
      setRemoveError(e?.message ?? t("social.failedRemoveConnection"));
    } finally {
      setRemoving(false);
    }
  }

  if (loading) {
    return <PageLoadingState label={t("dashboard.loading")} />;
  }

  const name = connection ? connectionDisplayName(connection, t) : "";

  return (
    <div className="space-y-6">
      <Link href="/standup/social?tab=friends" className="btn btn-ghost bottom-nav-btn">
        {t("social.backToConnections")}
      </Link>

      {!connection ? (
        <div className="card card-highlight text-center py-12">
          <p className="text-white/70">{t("social.connectionNotFound")}</p>
        </div>
      ) : removed ? (
        <div className="card card-highlight text-center py-12">
          <p className="text-white/70">{t("social.connectionRemoved")}</p>
        </div>
      ) : (
        <>
          <div className="card card-highlight">
            {/* Desktop (sm:+): identity (left) and About (right) sit side
                by side. Mobile: identity stays centered, full-width, as
                before; About moves below as a collapsible disclosure
                instead of a second column. */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-6">
              <div className="flex flex-col items-center text-center sm:items-start sm:text-left sm:w-56 sm:flex-shrink-0">
                <div className="flex justify-center sm:justify-start w-full mb-3">
                  <Avatar avatarUrl={connection.otherAvatarUrl} label={name} size={80} />
                </div>
                <h1 className="text-xl font-bold mb-2">{name}</h1>
                <div className="flex justify-center sm:justify-start w-full mb-2">
                  <span
                    className={connection.status === "accepted" ? "conn-state-badge conn-state-connected" : "conn-state-badge conn-state-pending"}
                    style={{ position: "static" }}
                  >
                    {connection.status === "accepted" ? t("social.stateConnected") : t("social.statePending")}
                  </span>
                </div>
                {connection.status === "accepted" && (
                  <p className="text-sm text-white/50 mb-4">
                    {t("social.connectedSince", { date: formatDateTimeDisplay(connection.responded_at ?? connection.created_at) })}
                  </p>
                )}

                {connection.status === "accepted" && (
                  <div className="mt-2 flex flex-col items-center sm:items-start gap-2 w-full">
                    {!confirmingRemove ? (
                      <button type="button" onClick={() => setConfirmingRemove(true)} className="btn social-destructive-btn">
                        {t("social.removeConnection")}
                      </button>
                    ) : (
                      <>
                        <p className="text-sm text-white/70">{t("social.removeConnectionConfirmQuestion")}</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={handleRemove} disabled={removing} className="btn social-destructive-btn">
                            {removing ? t("social.removing") : t("social.removeConnectionConfirmYes")}
                          </button>
                          <button type="button" onClick={() => setConfirmingRemove(false)} disabled={removing} className="btn">
                            {t("social.neverMind")}
                          </button>
                        </div>
                      </>
                    )}
                    {removeError && <p className="text-xs text-red-300">{removeError}</p>}
                  </div>
                )}
              </div>

              {/* About — desktop only; always visible (no collapse) since
                  it has its own column and doesn't compete for space with
                  the identity block the way it would stacked on mobile. */}
              <div className="hidden sm:block flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">
                  {t("social.aboutTitle")}
                </div>
                <p className="text-sm text-white/80 whitespace-pre-wrap">
                  {connection.otherBio || t("social.noBioYet")}
                </p>
              </div>
            </div>

            {/* About — mobile only; collapsed by default below the
                identity block instead of always taking up scroll space. */}
            <div className="sm:hidden mt-4 pt-4" style={{ borderTop: "1px solid rgba(var(--tint-rgb), 0.08)" }}>
              <button
                type="button"
                onClick={() => setAboutExpanded((v) => !v)}
                aria-expanded={aboutExpanded}
                className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-white/50 font-semibold"
              >
                {aboutExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t("social.aboutTitle")}
              </button>
              {aboutExpanded && (
                <p className="text-sm text-white/80 whitespace-pre-wrap mt-2">
                  {connection.otherBio || t("social.noBioYet")}
                </p>
              )}
            </div>
          </div>

          <div className="card card-highlight">
            <div className="my-2 flex items-center gap-4">
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(var(--tint-rgb),0.2), transparent)" }} />
              <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
                {t("social.latestActivityDivider")}
              </div>
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(var(--tint-rgb),0.2), transparent)" }} />
            </div>
            {posts.length === 0 ? (
              <p className="text-sm text-white/50">{t("social.noActivityYet")}</p>
            ) : (
              <div className="space-y-3">
                {posts.map((post) => (
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
        </>
      )}
    </div>
  );
}

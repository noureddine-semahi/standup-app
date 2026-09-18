"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import {
  getOrCreateProfile,
  getLifetimeStats,
  getReferralLink,
  markShared,
  listConnections,
  sendConnectionRequest,
  respondToConnectionRequest,
  removeConnection,
  type Profile,
  type LifetimeStats,
  type Connection,
} from "@/lib/supabase/db";
import { setTheme } from "@/lib/theme";
import { onPointsUpdated } from "@/lib/pointsBus";
import AnimatedNumber from "@/components/AnimatedNumber";
import { getLevelInfo } from "@/lib/levels";
import { ACHIEVEMENTS } from "@/lib/achievements";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function ProfilePage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [connError, setConnError] = useState<string | null>(null);
  const [connEmail, setConnEmail] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [sendRequestMsg, setSendRequestMsg] = useState<string | null>(null);
  // Per-row busy tracking so accepting/declining/removing one row doesn't
  // block interaction with the others while its request is in flight.
  const [busyConnectionIds, setBusyConnectionIds] = useState<Set<string>>(new Set());

  function refreshConnections() {
    listConnections()
      .then(setConnections)
      .catch((e: any) => setConnError(e?.message ?? t("profile.failedLoadConnections")));
  }

  function setConnectionBusy(id: string, busy: boolean) {
    setBusyConnectionIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSendRequest() {
    const email = connEmail.trim();
    if (!email || sendingRequest) return;
    setSendingRequest(true);
    setConnError(null);
    setSendRequestMsg(null);
    try {
      await sendConnectionRequest(email);
      setConnEmail("");
      setSendRequestMsg(t("profile.connectionRequestSent"));
      refreshConnections();
    } catch (e: any) {
      setConnError(e?.message ?? t("profile.failedLoadConnections"));
    } finally {
      setSendingRequest(false);
    }
  }

  async function handleRespond(id: string, accept: boolean) {
    if (busyConnectionIds.has(id)) return;
    setConnectionBusy(id, true);
    setConnError(null);
    try {
      await respondToConnectionRequest(id, accept);
      refreshConnections();
    } catch (e: any) {
      setConnError(e?.message ?? t("profile.failedRespondRequest"));
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
    } catch (e: any) {
      setConnError(e?.message ?? t("profile.failedRemoveConnection"));
    } finally {
      setConnectionBusy(id, false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const u = session?.user ?? null;
        setUser(u);

        const p = await getOrCreateProfile();
        setProfile(p);

        const stats = await getLifetimeStats();
        setLifetimeStats(stats);
      } finally {
        setLoading(false);
      }
    }
    load();
    refreshConnections();

    const unsubscribePoints = onPointsUpdated(() => {
      getOrCreateProfile()
        .then((p) => setProfile(p))
        .catch(() => {});
    });

    return unsubscribePoints;
  }, []);

  async function handleShare() {
    const link = user ? getReferralLink(user.id) : "";
    const text = t("profile.shareText");

    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    try {
      if (canNativeShare) {
        await navigator.share({ title: "StandUp", text, url: link });
      } else {
        await navigator.clipboard.writeText(`${text} ${link}`);
        setShareMsg(t("profile.linkCopied"));
        setTimeout(() => setShareMsg(null), 2000);
      }
      await markShared();
      const p = await getOrCreateProfile();
      setProfile(p);
    } catch {
      // Share sheet cancelled or clipboard denied — leave shared_at untouched.
    }
  }

  async function handleCopyLink() {
    const link = user ? getReferralLink(user.id) : "";
    try {
      await navigator.clipboard.writeText(link);
      setShareMsg(t("profile.linkCopied"));
      setTimeout(() => setShareMsg(null), 2000);
    } catch {
      // ignore
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);

    try {
      await supabase.auth.signOut();
      // Signed-out visitors always see dark by default.
      setTheme("dark");
      // Full reload, not router.push — a client-side navigation right after
      // signOut() could still see the stale in-memory session for a moment
      // and bounce back to a protected page, which looked like logout
      // "didn't work" until a second click.
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  }

  if (loading) {
    return <div className="card">{t("profile.loading")}</div>;
  }

  const levelInfo = getLevelInfo(profile?.points ?? 0);
  const achievementStats = {
    longestStreak: lifetimeStats?.longestStreak ?? 0,
    totalDaysClosed: lifetimeStats?.totalDaysClosed ?? 0,
    totalGoalsCompleted: lifetimeStats?.totalGoalsCompleted ?? 0,
    totalPoints: profile?.points ?? 0,
    maxGoalsCompletedInDay: lifetimeStats?.maxGoalsCompletedInDay ?? 0,
    totalReferrals: lifetimeStats?.totalReferrals ?? 0,
    hasShared: !!profile?.shared_at,
    reschedulesCompleted: lifetimeStats?.reschedulesCompleted ?? 0,
    trackedGoalsCompleted: lifetimeStats?.trackedGoalsCompleted ?? 0,
  };
  const referralLink = user ? getReferralLink(user.id) : "";
  const daysSinceJoined = user?.created_at
    ? Math.max(0, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000))
    : 0;

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        <div className="flex flex-col items-center text-center flex-shrink-0">
          <div
            className="flex items-center justify-center rounded-full text-3xl font-bold overflow-hidden"
            style={{
              width: "84px",
              height: "84px",
              background: "linear-gradient(135deg, var(--accent-purple), var(--accent-blue))",
              color: "white",
            }}
          >
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt={t("common.profilePhotoAlt")} className="w-full h-full object-cover" />
            ) : (
              (profile?.display_name || user?.email || "U").charAt(0).toUpperCase()
            )}
          </div>
          <div className="mt-4 text-2xl font-bold text-white">
            {profile?.display_name || user?.email?.split("@")[0] || t("common.user")}
          </div>
          <div className="mt-1 text-sm text-white/50">{user?.email}</div>
        </div>

        <div className="flex-1 grid grid-cols-1 gap-3 w-full" style={{ boxSizing: "border-box" }}>
          <Link
            href="/standup/settings"
            className="btn flex items-center justify-between"
            style={{ boxSizing: "border-box", width: "100%" }}
          >
            <span className="flex-1 text-left">Profile &amp; Settings</span>
            <span className="flex items-center gap-2">
              <ThemeToggle size="sm" />
              <LanguageToggle size="sm" />
            </span>
          </Link>
          <Link
            href="/standup/history"
            className="btn text-center"
            style={{ boxSizing: "border-box", width: "100%" }}
          >
            {t("profile.dataMetrics")}
          </Link>
          {profile?.is_admin && (
            <Link
              href="/standup/admin"
              className="btn text-center"
              style={{ boxSizing: "border-box", width: "100%" }}
            >
              {t("profile.adminPanel")}
            </Link>
          )}
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="btn"
            style={{ boxSizing: "border-box", width: "100%" }}
          >
            {loggingOut ? t("nav.loggingOut") : t("nav.logout")}
          </button>
        </div>
      </div>

      {profile && (
        <div
          className="mt-8 rounded-2xl p-6 text-center"
          style={{
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.2)",
          }}
        >
          <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
            {t("dashboard.stat.totalPoints")}
          </div>
          <div className="mt-2 text-4xl font-bold text-white">
            <AnimatedNumber value={profile.points} />
          </div>

          <div className="mt-5 max-w-xs mx-auto">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300">
                Level {levelInfo.level} · {t(levelInfo.nameKey)}
              </span>
              <span className="text-white/50">
                {levelInfo.pointsToNext !== null ? t("profile.toNext", { points: levelInfo.pointsToNext }) : t("dashboard.maxLevel")}
              </span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full overflow-hidden bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${levelInfo.progressPct}%`,
                  background: "linear-gradient(90deg, var(--accent-purple), var(--accent-blue))",
                }}
              />
            </div>
          </div>

          <div
            className="mt-6 grid grid-cols-3 gap-3 pt-5"
            style={{ borderTop: "1px solid rgba(var(--tint-rgb), 0.1)" }}
          >
            <div>
              <div className="text-lg font-bold text-white">{daysSinceJoined}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-white/50">{t("profile.daysJoined")}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{lifetimeStats?.totalGoalsCompleted ?? 0}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-white/50">{t("profile.goalsCompletedStat")}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{lifetimeStats?.totalGoalsSubmitted ?? 0}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-white/50">{t("profile.goalsSubmittedStat")}</div>
            </div>
          </div>
        </div>
      )}

      {/* Achievements — one-time badges, mostly continuity milestones (see
          src/lib/achievements.ts). Unlocked ones are colored; locked ones
          stay visible but dimmed, as a preview of what's next. */}
      <div className="mt-8">
        <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
          {t("profile.achievementsTitle")}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {ACHIEVEMENTS.map((a) => {
            const unlocked = a.isUnlocked(achievementStats);
            return (
              <div
                key={a.id}
                className="rounded-xl p-3 text-center transition"
                style={{
                  background: unlocked ? "rgba(16, 185, 129, 0.08)" : "rgba(var(--tint-rgb), 0.03)",
                  border: unlocked ? "1px solid rgba(16, 185, 129, 0.25)" : "1px solid rgba(var(--tint-rgb), 0.08)",
                  opacity: unlocked ? 1 : 0.5,
                }}
                title={t(a.descriptionKey)}
              >
                <div className="text-2xl" style={{ filter: unlocked ? "none" : "grayscale(1)" }}>
                  {a.icon}
                </div>
                <div className="mt-1.5 text-[11px] font-semibold text-white leading-tight">
                  {t(a.titleKey)}
                </div>
                <div className="mt-1 text-[10px] text-white/50 leading-snug">{t(a.descriptionKey)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invite & Share — one action covers both: the shared link doubles as
          a referral link, so sharing your progress and inviting a friend
          are the same button. */}
      <div
        className="mt-8 rounded-2xl p-5"
        style={{ background: "rgba(var(--tint-rgb), 0.03)", border: "1px solid rgba(var(--tint-rgb), 0.08)" }}
      >
        <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">
          {t("profile.inviteShareTitle")}
        </div>
        <p className="text-xs text-white/60 mb-3">
          {t("profile.inviteShareBody")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            readOnly
            value={referralLink}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70"
          />
          <button onClick={handleCopyLink} className="btn text-sm px-4 py-2 whitespace-nowrap">
            {t("profile.copyLink")}
          </button>
          <button onClick={handleShare} className="btn btn-primary text-sm px-4 py-2 whitespace-nowrap">
            {t("profile.share")}
          </button>
        </div>
        {shareMsg && <p className="mt-2 text-xs text-emerald-300">{shareMsg}</p>}
      </div>

      {/* Connections — email request/accept, gates who can see a Published
          day on Dashboard's Glimpses section and react to it. */}
      <div
        className="mt-8 rounded-2xl p-5"
        style={{ background: "rgba(var(--tint-rgb), 0.03)", border: "1px solid rgba(var(--tint-rgb), 0.08)" }}
      >
        <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">
          {t("profile.connectionsTitle")}
        </div>
        <p className="text-xs text-white/60 mb-3">{t("profile.connectionsBody")}</p>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={connEmail}
            onChange={(e) => setConnEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSendRequest();
              }
            }}
            placeholder={t("profile.connectionEmailPlaceholder")}
            disabled={sendingRequest}
            className="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSendRequest}
            disabled={sendingRequest || !connEmail.trim()}
            className="btn btn-primary text-sm px-4 py-2 whitespace-nowrap"
          >
            {sendingRequest ? t("profile.sendingRequest") : t("profile.sendRequest")}
          </button>
        </div>
        {sendRequestMsg && <p className="mt-2 text-xs text-emerald-300">{sendRequestMsg}</p>}
        {connError && <p className="mt-2 text-xs text-red-300">{connError}</p>}

        {(() => {
          const incoming = connections.filter((c) => c.status === "pending" && c.direction === "incoming");
          const outgoing = connections.filter((c) => c.status === "pending" && c.direction === "outgoing");
          const accepted = connections.filter((c) => c.status === "accepted");

          return (
            <div className="mt-4 space-y-4">
              {incoming.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
                    {t("profile.incomingRequests")}
                  </div>
                  <div className="space-y-1.5">
                    {incoming.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
                        <span className="text-sm text-white/85 truncate">{c.otherDisplayName ?? c.otherUserId}</span>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRespond(c.id, true)}
                            disabled={busyConnectionIds.has(c.id)}
                            className="btn"
                            style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                          >
                            {t("profile.accept")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRespond(c.id, false)}
                            disabled={busyConnectionIds.has(c.id)}
                            className="btn"
                            style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                          >
                            {t("profile.decline")}
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
                    {t("profile.outgoingRequests")}
                  </div>
                  <div className="space-y-1.5">
                    {outgoing.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
                        <span className="text-sm text-white/85 truncate">{c.otherDisplayName ?? c.otherUserId}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveConnection(c.id)}
                          disabled={busyConnectionIds.has(c.id)}
                          className="btn flex-shrink-0"
                          style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                        >
                          {t("profile.cancelRequest")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-1.5">
                  {t("profile.yourConnections")}
                </div>
                {accepted.length === 0 ? (
                  <p className="text-xs text-white/40 italic">{t("profile.noConnectionsYet")}</p>
                ) : (
                  <div className="space-y-1.5">
                    {accepted.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
                        <span className="text-sm text-white/85 truncate">{c.otherDisplayName ?? c.otherUserId}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveConnection(c.id)}
                          disabled={busyConnectionIds.has(c.id)}
                          className="btn flex-shrink-0"
                          style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                        >
                          {t("profile.removeConnection")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

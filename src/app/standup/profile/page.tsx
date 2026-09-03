"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOrCreateProfile,
  getLifetimeStats,
  getReferralLink,
  markShared,
  type Profile,
  type LifetimeStats,
} from "@/lib/supabase/db";
import { onPointsUpdated } from "@/lib/pointsBus";
import AnimatedNumber from "@/components/AnimatedNumber";
import { getLevelInfo } from "@/lib/levels";
import { ACHIEVEMENTS } from "@/lib/achievements";

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const {
          data: { user: u },
        } = await supabase.auth.getUser();
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

    const unsubscribePoints = onPointsUpdated(() => {
      getOrCreateProfile()
        .then((p) => setProfile(p))
        .catch(() => {});
    });

    return unsubscribePoints;
  }, []);

  async function handleShare() {
    const link = user ? getReferralLink(user.id) : "";
    const text = "I'm building daily execution habits with StandUp — join me!";

    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    try {
      if (canNativeShare) {
        await navigator.share({ title: "StandUp", text, url: link });
      } else {
        await navigator.clipboard.writeText(`${text} ${link}`);
        setShareMsg("Link copied to clipboard!");
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
      setShareMsg("Link copied to clipboard!");
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
      router.push("/");
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  }

  if (loading) {
    return <div className="card">Loading profile…</div>;
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
              <img src={profile.avatar_url} alt="Profile photo" className="w-full h-full object-cover" />
            ) : (
              (profile?.display_name || user?.email || "U").charAt(0).toUpperCase()
            )}
          </div>
          <div className="mt-4 text-2xl font-bold text-white">
            {profile?.display_name || user?.email?.split("@")[0] || "User"}
          </div>
          <div className="mt-1 text-sm text-white/50">{user?.email}</div>
        </div>

        <div className="flex-1 grid grid-cols-1 gap-3 w-full" style={{ boxSizing: "border-box" }}>
          <Link
            href="/standup/settings"
            className="btn text-center"
            style={{ boxSizing: "border-box", width: "100%" }}
          >
            Profile &amp; Settings
          </Link>
          <Link
            href="/standup/history"
            className="btn text-center"
            style={{ boxSizing: "border-box", width: "100%" }}
          >
            Points &amp; Usage History
          </Link>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="btn"
            style={{ boxSizing: "border-box", width: "100%" }}
          >
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>

      {profile && (
        <div
          className="mt-8 rounded-2xl p-6 text-center"
          style={{
            background: "rgba(168, 85, 247, 0.08)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
          }}
        >
          <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
            Total Points
          </div>
          <div className="mt-2 text-4xl font-bold text-white">
            <AnimatedNumber value={profile.points} />
          </div>

          <div className="mt-5 max-w-xs mx-auto">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-purple-300">
                Level {levelInfo.level} · {levelInfo.name}
              </span>
              <span className="text-white/50">
                {levelInfo.pointsToNext !== null ? `${levelInfo.pointsToNext} to next` : "Max level"}
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
            style={{ borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}
          >
            <div>
              <div className="text-lg font-bold text-white">{daysSinceJoined}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-white/50">Days Joined</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{lifetimeStats?.totalGoalsCompleted ?? 0}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-white/50">Goals Completed</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white">{lifetimeStats?.totalGoalsSubmitted ?? 0}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-white/50">Goals Submitted</div>
            </div>
          </div>
        </div>
      )}

      {/* Achievements — one-time badges, mostly continuity milestones (see
          src/lib/achievements.ts). Unlocked ones are colored; locked ones
          stay visible but dimmed, as a preview of what's next. */}
      <div className="mt-8">
        <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-3">
          Achievements
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {ACHIEVEMENTS.map((a) => {
            const unlocked = a.isUnlocked(achievementStats);
            return (
              <div
                key={a.id}
                className="rounded-xl p-3 text-center transition"
                style={{
                  background: unlocked ? "rgba(16, 185, 129, 0.08)" : "rgba(255, 255, 255, 0.03)",
                  border: unlocked ? "1px solid rgba(16, 185, 129, 0.25)" : "1px solid rgba(255, 255, 255, 0.08)",
                  opacity: unlocked ? 1 : 0.5,
                }}
                title={a.description}
              >
                <div className="text-2xl" style={{ filter: unlocked ? "none" : "grayscale(1)" }}>
                  {a.icon}
                </div>
                <div className="mt-1.5 text-[11px] font-semibold text-white leading-tight">
                  {a.title}
                </div>
                <div className="mt-1 text-[10px] text-white/50 leading-snug">{a.description}</div>
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
        style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.08)" }}
      >
        <div className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-2">
          Invite &amp; Share
        </div>
        <p className="text-xs text-white/60 mb-3">
          Share your progress — friends who join and complete their first day earn you 25 bonus points.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            readOnly
            value={referralLink}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70"
          />
          <button onClick={handleCopyLink} className="btn text-sm px-4 py-2 whitespace-nowrap">
            Copy Link
          </button>
          <button onClick={handleShare} className="btn btn-primary text-sm px-4 py-2 whitespace-nowrap">
            Share
          </button>
        </div>
        {shareMsg && <p className="mt-2 text-xs text-emerald-300">{shareMsg}</p>}
      </div>
    </div>
  );
}

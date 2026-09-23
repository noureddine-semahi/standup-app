"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  toISODate,
  addDays,
  formatDateDisplay,
  getPlanWithGoals,
  getOrCreateProfile,
  getStreak,
  getOverdueSummary,
  getLifetimeStats,
  hoursUntilMidnight,
  createAchievementPost,
  getStreakPassBalance,
  listConnections,
  getMyGoalAssignments,
  type Goal,
  type Profile,
  type DailyPlan,
  type OverdueSummary,
  type PostVisibility,
  type StreakPassBalance,
  type Connection,
  type GoalAssignment,
} from "@/lib/supabase/db";
import PendingNotifications from "@/components/PendingNotifications";
import { supabase } from "@/lib/supabase/client";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import {
  Hourglass, Bot, Hand, PartyPopper, TriangleAlert, AlarmClock, Sparkles, Flame,
  MessageCircle, Zap, CheckCircle2, Target, ClipboardList, FileEdit, Ticket, Lock, Unlock,
} from "lucide-react";
import { onPointsUpdated } from "@/lib/pointsBus";
import AnimatedNumber from "@/components/AnimatedNumber";
import ProgressCircle from "@/components/ProgressCircle";
import AssistantPanel from "@/components/AssistantPanel";
import AchievementUnlockedModal from "@/components/AchievementUnlockedModal";
import { getLevelInfo } from "@/lib/levels";
import { ACHIEVEMENTS, type AchievementDef, type AchievementStats } from "@/lib/achievements";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

const ACHIEVEMENTS_SEEN_KEY_PREFIX = "standup-achievements-seen-";

function getSeenAchievementIds(userId: string): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(ACHIEVEMENTS_SEEN_KEY_PREFIX + userId);
    if (raw === null) return null; // distinguishes "never run before" from "seen nothing yet"
    return new Set(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveSeenAchievementIds(userId: string, ids: Iterable<string>) {
  try {
    window.localStorage.setItem(ACHIEVEMENTS_SEEN_KEY_PREFIX + userId, JSON.stringify([...ids]));
  } catch {
    // Private browsing / storage disabled — worst case, this account sees
    // its already-earned achievements celebrated again on the next load.
  }
}

/**
 * ✅ Reuse the "Tomorrow page" visual language:
 * - gradient backgrounds by "importance"
 * - stronger borders
 * - hover scale
 * - glass panels
 */

const MOTIVATIONAL_MESSAGE_KEYS: TranslationKey[] = [
  "motivation.msg1", "motivation.msg2", "motivation.msg3", "motivation.msg4",
  "motivation.msg5", "motivation.msg6", "motivation.msg7", "motivation.msg8",
  "motivation.msg9", "motivation.msg10", "motivation.msg11", "motivation.msg12",
  "motivation.msg13", "motivation.msg14", "motivation.msg15", "motivation.msg16",
  "motivation.msg17", "motivation.msg18",
];

const WIDGETS = [
  {
    key: "points",
    title: "Total Points",
    tone: "neutral",
  },
  {
    key: "progress",
    title: "Today's Progress",
    tone: "yellow",
  },
  {
    key: "completed",
    title: "Completed Today",
    tone: "emerald",
  },
  {
    key: "status",
    title: "Day Status",
    tone: "violet",
  },
] as const;

export default function DashboardPage() {
  const { t } = useLanguage();
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [pendingAchievements, setPendingAchievements] = useState<AchievementDef[]>([]);
  const [showAssistant, setShowAssistant] = useState(false);
  // Bumped by the assistant after it actually takes an action, so the main
  // data-loading effect below re-runs and picks up whatever it just
  // changed — the assistant's own API route has no way to update this
  // page's React state directly.
  const [refreshKey, setRefreshKey] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);
  const [passBalance, setPassBalance] = useState<StreakPassBalance | null>(null);
  const [pointsView, setPointsView] = useState<"total" | "today">("total");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [goalAssignments, setGoalAssignments] = useState<GoalAssignment[]>([]);

  // Cycles to a new (different) random quote every ~10s — see the effect
  // below, which reschedules itself off motivationIndex the same way the
  // Total Points / Points Earned Today card auto-swaps.
  const [motivationIndex, setMotivationIndex] = useState(() =>
    Math.floor(Math.random() * MOTIVATIONAL_MESSAGE_KEYS.length)
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      setMotivationIndex((prev) => {
        if (MOTIVATIONAL_MESSAGE_KEYS.length <= 1) return prev;
        let next = Math.floor(Math.random() * MOTIVATIONAL_MESSAGE_KEYS.length);
        while (next === prev) next = Math.floor(Math.random() * MOTIVATIONAL_MESSAGE_KEYS.length);
        return next;
      });
    }, 10000);
    return () => window.clearTimeout(id);
  }, [motivationIndex]);

  const [todayPlan, setTodayPlan] = useState<DailyPlan | null>(null);
  const [todayGoals, setTodayGoals] = useState<Goal[]>([]);

  const [tomorrowPlan, setTomorrowPlan] = useState<DailyPlan | null>(null);
  const [tomorrowGoals, setTomorrowGoals] = useState<Goal[]>([]);
  const [overdue, setOverdue] = useState<OverdueSummary>({ count: 0, oldestDate: null });
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});

  const [latestNotes, setLatestNotes] = useState<Record<string, string>>({});

  // Welcome banner for brand-new accounts — dismissal is remembered per
  // device so it never comes back once acknowledged, even before the
  // "new user" heuristic below naturally stops being true.
  const [welcomeDismissed, setWelcomeDismissed] = useState(true);
  useEffect(() => {
    try {
      setWelcomeDismissed(window.localStorage.getItem("standup-welcome-dismissed") === "1");
    } catch {
      // Private browsing / storage disabled — just show it every time, harmless.
    }
  }, []);
  function dismissWelcome() {
    setWelcomeDismissed(true);
    try {
      window.localStorage.setItem("standup-welcome-dismissed", "1");
    } catch {
      // ignore
    }
  }

  function dismissAchievement(achievement: AchievementDef) {
    if (user) {
      const seen = getSeenAchievementIds(user.id) ?? new Set<string>();
      seen.add(achievement.id);
      saveSeenAchievementIds(user.id, seen);
    }
    setPendingAchievements((prev) => prev.filter((a) => a.id !== achievement.id));
  }

  // The unique index on (user_id, achievement_id) makes this safe to call
  // even if this same unlock was already posted from another device --
  // createAchievementPost swallows the resulting duplicate-key error.
  async function shareAchievement(achievement: AchievementDef, visibility: PostVisibility) {
    try {
      await createAchievementPost(achievement.id, visibility);
    } catch {
      // Non-fatal — a failed share shouldn't block dismissing the popup.
    }
    dismissAchievement(achievement);
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

        // These eight don't depend on each other, so they run as one batch
        // instead of a serial chain of awaits. lifetimeStats/connections/
        // goalAssignments are swallowed into a null/[] on failure so one bad
        // query can't sink the whole dashboard load via Promise.all's
        // fail-fast behavior — the achievement popup or notifications
        // section just gets skipped for this load, same as before.
        const [p, s, todayResult, tomorrowResult, lifetimeStats, passes, conns, assignments] = await Promise.all([
          getOrCreateProfile(),
          getStreak(),
          getPlanWithGoals(todayISO),
          getPlanWithGoals(tomorrowISO),
          u ? getLifetimeStats().catch(() => null) : Promise.resolve(null),
          u ? getStreakPassBalance().catch(() => null) : Promise.resolve(null),
          u ? listConnections().catch(() => []) : Promise.resolve([]),
          u ? getMyGoalAssignments().catch(() => []) : Promise.resolve([]),
        ]);
        setProfile(p);
        setStreak(s);
        setTodayPlan(todayResult.plan);
        setTodayGoals(todayResult.goals);
        setTomorrowPlan(tomorrowResult.plan);
        setTomorrowGoals(tomorrowResult.goals);
        setConnections(conns);
        setGoalAssignments(assignments);
        setPassBalance(passes);

        getOverdueSummary(todayISO)
          .then(setOverdue)
          .catch(() => {});

        // Achievement "just unlocked" popup — compares the current unlocked
        // set against what this device has already been shown. First run
        // ever for this account+device seeds silently (getSeenAchievementIds
        // returns null) rather than congratulating for everything already
        // earned before this feature existed; only genuinely new unlocks on
        // later loads actually queue a popup.
        if (u && lifetimeStats) {
          const achievementStats: AchievementStats = {
            longestStreak: lifetimeStats.longestStreak,
            totalDaysClosed: lifetimeStats.totalDaysClosed,
            totalGoalsCompleted: lifetimeStats.totalGoalsCompleted,
            totalPoints: p.points,
            maxGoalsCompletedInDay: lifetimeStats.maxGoalsCompletedInDay,
            totalReferrals: lifetimeStats.totalReferrals,
            hasShared: !!p.shared_at,
            reschedulesCompleted: lifetimeStats.reschedulesCompleted,
            trackedGoalsCompleted: lifetimeStats.trackedGoalsCompleted,
          };

          const unlocked = ACHIEVEMENTS.filter((a) => a.isUnlocked(achievementStats));
          const seen = getSeenAchievementIds(u.id);

          if (seen === null) {
            saveSeenAchievementIds(u.id, unlocked.map((a) => a.id));
          } else {
            const newlyUnlocked = unlocked.filter((a) => !seen.has(a.id));
            if (newlyUnlocked.length > 0) setPendingAchievements(newlyUnlocked);
          }
        }

        const allGoalIds = [...todayResult.goals, ...tomorrowResult.goals].map((g) => g.id).filter(Boolean);
        if (allGoalIds.length > 0) {
          const { data: notesData } = await supabase
            .from("goal_notes")
            .select("goal_id, note, created_at")
            .in("goal_id", allGoalIds)
            .order("created_at", { ascending: false });
          const counts: Record<string, number> = {};
          const latest: Record<string, string> = {};
          (notesData ?? []).forEach((n) => {
            counts[n.goal_id] = (counts[n.goal_id] ?? 0) + 1;
            if (!latest[n.goal_id]) latest[n.goal_id] = n.note; // first hit per goal = most recent (query ordered desc)
          });
          setNoteCounts(counts);
          setLatestNotes(latest);
        }
      } catch (error) {
        console.error("Dashboard load error:", error);
      } finally {
        setLoading(false);
      }
    }

    load();

    // Points earned elsewhere (e.g. closing out Today) wouldn't otherwise
    // be reflected here until the dashboard is fully remounted — refetch
    // just the profile so the points widget stays current.
    const unsubscribe = onPointsUpdated(() => {
      getOrCreateProfile()
        .then((p) => setProfile(p))
        .catch(() => {});
    });

    return unsubscribe;
  }, [todayISO, tomorrowISO, refreshKey]);

  // Total Points / Points Earned Today auto-swap in place every ~6.5s, on
  // top of the manual tap-to-flip, so both numbers surface without needing
  // a second card. Keyed off pointsView (not a bare interval) so a manual
  // tap resets the countdown instead of risking a flip right on its heels.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setPointsView((v) => (v === "total" ? "today" : "total"));
    }, 6500);
    return () => window.clearTimeout(id);
  }, [pointsView]);

  // Goals assigned out to a connection (declined ones excluded), keyed by
  // this user's own goals.id — same map shape Today/Tomorrow's own pages
  // use, so a goal assigned from either shows the same "assigned to
  // {name}" info here too instead of looking like any other goal. Must
  // stay above the early loading return below — hooks can't be
  // conditionally skipped.
  const assignedOutByGoalId = useMemo(() => {
    const map = new Map<string, GoalAssignment>();
    for (const a of goalAssignments) {
      if (a.direction === "assigned" && a.status !== "declined" && a.assignerGoalId) {
        map.set(a.assignerGoalId, a);
      }
    }
    return map;
  }, [goalAssignments]);

  if (loading) {
    return <div className="card">{t("dashboard.loading")}</div>;
  }

  // Today stats
  const todayP1 = todayGoals.find((g) => g.priority === 1);
  const todayPending = todayGoals.filter((g) => !g.reviewed_at).length;
  // "Attempted" = reviewed, full stop — the outcome status (completed,
  // blocked, postponed, etc.) never factors into this. Closing the day
  // itself works the same way: it only ever checks reviewed_at, never
  // status, so this mirrors the actual gating rule.
  const todayReviewed = todayGoals.filter((g) => !!g.reviewed_at).length;
  const todayTotal = todayGoals.length;
  const todayCompleted = todayGoals.filter((g) => g.status === "completed").length;
  const todayPostponed = todayGoals.filter((g) => g.status === "postponed").length;
  const todayBlocked = todayGoals.filter((g) => g.status === "blocked").length;
  const todayAttemptedStatus = todayGoals.filter((g) => g.status === "attempted").length;
  const todayInProgress = todayGoals.filter((g) => g.status === "in_progress").length;
  const todayAttemptedPct = todayTotal > 0 ? Math.round((todayReviewed / todayTotal) * 100) : 0;
  const todayCompletedPct = todayTotal > 0 ? Math.round((todayCompleted / todayTotal) * 100) : 0;
  const todayOtherOutcomes = [
    todayPostponed > 0 ? t("dashboard.outcomeRescheduled", { count: todayPostponed }) : null,
    todayBlocked > 0 ? t("dashboard.outcomeBlocked", { count: todayBlocked }) : null,
    todayAttemptedStatus > 0 ? t("dashboard.outcomeAttempted", { count: todayAttemptedStatus }) : null,
    todayInProgress > 0 ? t("dashboard.outcomeInProgress", { count: todayInProgress }) : null,
  ].filter(Boolean) as string[];
  const todayClosed = !!todayPlan?.reviewed_at;
  const todayPointsEarned = (todayPlan?.awareness_points ?? 0) + (todayPlan?.closure_points ?? 0);

  // Tomorrow stats
  const tomorrowTotal = tomorrowGoals.length;
  const tomorrowSubmitted = tomorrowPlan?.status === "submitted";

  // Sort goals by priority
  const sortGoals = (goals: Goal[]) => {
    return [...goals].sort((a, b) => {
      const ap = typeof a.priority === "number" ? a.priority : 999;
      const bp = typeof b.priority === "number" ? b.priority : 999;
      if (ap !== bp) return ap - bp;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  };

  const sortedTodayGoals = sortGoals(todayGoals);
  const sortedTomorrowGoals = sortGoals(tomorrowGoals);

  const levelInfo = getLevelInfo(profile?.points ?? 0);

  // Heuristic for "hasn't really used the app yet" — no points earned and
  // nothing drafted for either today or tomorrow. Good enough without a
  // dedicated "onboarded" flag; worst case a lightly-used account sees a
  // friendly reminder banner once, which is a low-cost false positive.
  const isNewUser = (profile?.points ?? 0) === 0 && todayGoals.length === 0 && tomorrowGoals.length === 0;

  // No push/email in this app, so the only "reminder" is a banner shown
  // while the user is actually looking at the dashboard — fires once
  // there are 6 or fewer hours left in the local day and today still has
  // unreviewed goals.
  const hoursLeftToday = hoursUntilMidnight();
  const showEndOfDayReminder = !todayClosed && todayTotal > 0 && todayPending > 0 && hoursLeftToday <= 6;

  return (
    <div className="space-y-6">
      {/* ✅ Header + widgets INSIDE one "main card" (Tomorrow-style) */}
        <div
          className="card card-highlight dashboard-shell"
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
            <div>
              <h1 className="text-3xl font-bold">{t("nav.dashboard")}</h1>
              <p className="mt-2 text-white/70">{t("dashboard.subtitle")}</p>

              {/* Level badge — points-based, see src/lib/levels.ts. Links to
                  Profile, where the fuller level + achievements view lives. */}
              <Link
                href="/standup/profile"
                className="mt-4 inline-flex items-center gap-3 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 hover:bg-amber-500/15 transition"
              >
                <span className="text-xs font-bold text-amber-300">
                  Lv {levelInfo.level} · {t(levelInfo.nameKey)}
                </span>
                <span className="relative h-1.5 w-20 rounded-full overflow-hidden bg-white/10">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${levelInfo.progressPct}%`,
                      background: "linear-gradient(90deg, var(--accent-purple), var(--accent-blue))",
                    }}
                  />
                </span>
                <span className="text-[11px] text-white/50">
                  {levelInfo.pointsToNext !== null ? t("dashboard.pointsToNext", { points: levelInfo.pointsToNext }) : t("dashboard.maxLevel")}
                </span>
              </Link>
            </div>

            <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start sm:flex-wrap">
              <div className="flex gap-2 sm:order-2">
                <Link href="/standup/today" className="btn text-sm whitespace-nowrap">
                  {t("nav.reviewToday")}
                </Link>
                <Link href="/standup/tomorrow" className="btn text-sm whitespace-nowrap">
                  {t("nav.planTomorrow")}
                </Link>
              </div>
              <button type="button" onClick={() => setShowAssistant(true)} className="btn sm:order-1 inline-flex items-center gap-2">
                <Bot size={15} /> {t("dashboard.assistant")}
              </button>
            </div>
          </div>

          {/* One-time welcome banner for brand-new accounts — see
              isNewUser/welcomeDismissed above. Separate from the rotating
              Motivation card below, which is a recurring nicety rather than
              onboarding content. */}
          {isNewUser && !welcomeDismissed && (
            <div
              className="mt-6 rounded-2xl p-5"
              style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-base font-bold text-white"><Hand size={17} /> {t("dashboard.welcomeTitle")}</div>
                  <p className="mt-2 text-sm text-white/70 leading-relaxed">
                    {t("dashboard.welcomePart1")}<b>{t("nav.planTomorrow")}</b>{t("dashboard.welcomePart2")}
                    <b>{t("nav.reviewToday")}</b>{t("dashboard.welcomePart3")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismissWelcome}
                  aria-label={t("dashboard.dismissWelcome")}
                  className="flex-shrink-0 text-white/50 hover:text-white/80 transition text-lg leading-none"
                >
                  ×
                </button>
              </div>
              <Link
                href="/standup/tomorrow"
                className="btn btn-primary mt-4 inline-block"
                onClick={dismissWelcome}
              >
                {t("dashboard.planTomorrowArrow")}
              </Link>
            </div>
          )}

          {/* Encouragement banner — both halves of the daily loop are done:
              today reviewed and closed, tomorrow's plan submitted. Not
              dismissible, same as the "Day closed" indicator on Today's own
              page — it's a status reflection, not a nag, so it just shows
              for as long as it's accurately true. */}
          {todayClosed && tomorrowSubmitted && (
            <div
              className="mt-6 rounded-2xl p-5"
              style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)" }}
            >
              <div className="flex items-center gap-2 text-base font-bold text-emerald-300">
                <PartyPopper size={18} /> {t("dashboard.allCaughtUpTitle")}
              </div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                {t("dashboard.allCaughtUpBody")}
              </p>
            </div>
          )}

          {/* Overdue warning — past days that were submitted but never
              reviewed/closed. These can't be reviewed retroactively (past
              days are view-only), so this just surfaces the gap and points
              at Calendar, where any goal still worth pursuing can be
              re-attempted (rescheduled) forward. */}
          {overdue.count > 0 && (
            <div
              className="mt-6 rounded-2xl p-5"
              style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.35)" }}
            >
              <div className="flex items-center gap-2 text-base font-bold text-amber-300">
                <TriangleAlert size={17} /> {t(overdue.count === 1 ? "dashboard.overdueTitle.one" : "dashboard.overdueTitle.other", { count: overdue.count })}
              </div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                {t("dashboard.overdueBody")}
              </p>
              <Link href="/standup/calendar?unreviewed=1" className="btn mt-4 inline-block">
                {t("dashboard.viewUnreviewed")}
              </Link>
            </div>
          )}

          {/* End-of-day reminder — the only "notification" this app can give
              without push/email: a banner shown while the dashboard is open,
              once there are 6 or fewer hours left and today isn't closed. */}
          {showEndOfDayReminder && (
            <div
              className="mt-6 rounded-2xl p-5"
              style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.35)" }}
            >
              <div className="flex items-center gap-2 text-base font-bold text-amber-300">
                <AlarmClock size={17} /> {hoursLeftToday < 1 ? t("dashboard.hoursLeftLessThanHour") : t("dashboard.hoursLeft", { hours: Math.round(hoursLeftToday) })}
              </div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                {t(todayPending === 1 ? "dashboard.pendingReviewBanner.one" : "dashboard.pendingReviewBanner.other", { count: todayPending })}
              </p>
              <Link href="/standup/today" className="btn mt-4 inline-block">
                {t("nav.reviewToday")} →
              </Link>
            </div>
          )}

          {/* Welcome / Motivation — one full-length card on its own row */}
          <div
            className="mt-6 card card-highlight"
          >
            <div className="p-4 flex items-center gap-4">
              {profile?.avatar_url && (
                <div
                  className="flex-shrink-0 rounded-full overflow-hidden"
                  style={{ width: "48px", height: "48px" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.avatar_url} alt={t("common.profilePhotoAlt")} className="w-full h-full object-cover" />
                </div>
              )}
              <div key={motivationIndex} className="card-swap-fade">
                <div className="flex items-center gap-1.5 text-sm text-white/70"><Sparkles size={13} /> {t("dashboard.motivationLabel")}</div>
                <div className="mt-2 text-base font-semibold text-white leading-snug">
                  {t(MOTIVATIONAL_MESSAGE_KEYS[motivationIndex], {
                    name: profile?.display_name || user?.email?.split("@")[0] || t("motivation.fallbackName"),
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Stat tiles — two rows of three */}
          <div className="mt-3 grid gap-2 sm:gap-3 grid-cols-2 lg:grid-cols-3">
            {/* Attempted — reviewed, regardless of outcome. This is the
                metric closing the day actually depends on. */}
            <div
              className="card card-highlight stat-tile"
            >
              <div className="text-center sm:text-left sm:flex sm:items-center sm:gap-4">
                <div className="relative mx-auto sm:mx-0" style={{ width: 48, height: 48 }}>
                  <ProgressCircle percent={todayAttemptedPct} color="var(--accent-blue)" size={48} strokeWidth={5} />
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white">
                    {todayAttemptedPct}%
                  </div>
                </div>
                <div className="mt-1.5 sm:mt-0 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{t("dashboard.stat.attempted")}</div>
                  <div className="mt-1 sm:mt-1.5 text-xs font-normal text-white/50">
                    {todayTotal > 0
                      ? t("dashboard.goalsAttempted", { reviewed: todayReviewed, total: todayTotal })
                      : t("dashboard.noGoals")}
                    {todayPending > 0 && ` • ${t("dashboard.pendingCount", { count: todayPending })}`}
                  </div>
                </div>
              </div>
            </div>

            {/* Completed — the specific "completed" outcome only. Separate
                from Attempted on purpose: what a goal gets marked as is
                secondary detail on top of the attempt itself. */}
            <div
              className="card card-highlight stat-tile"
            >
              <div className="text-center sm:text-left sm:flex sm:items-center sm:gap-4">
                <div className="relative mx-auto sm:mx-0" style={{ width: 48, height: 48 }}>
                  <ProgressCircle percent={todayCompletedPct} color="var(--accent-emerald)" size={48} strokeWidth={5} />
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white">
                    {todayCompletedPct}%
                  </div>
                </div>
                <div className="mt-1.5 sm:mt-0 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{t("status.completed")}</div>
                  <div className="mt-1 sm:mt-1.5 text-xs font-normal text-white/50">
                    {todayTotal > 0
                      ? t("dashboard.goalsCompleted", { completed: todayCompleted, total: todayTotal })
                      : t("dashboard.noGoals")}
                    {todayOtherOutcomes.length > 0 && ` • ${todayOtherOutcomes.join(" • ")}`}
                  </div>
                </div>
              </div>
            </div>

            {/* Streak */}
            <div
              className="card card-highlight stat-tile"
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{t("dashboard.stat.streak")}</div>
                <div className="mt-2 sm:mt-3 flex items-center gap-1.5 text-2xl sm:text-3xl font-bold text-white">
                  {streak} {streak > 0 && <Flame className="text-orange-400" size={22} />}
                </div>
                <div className="mt-1.5 text-xs font-normal text-white/50">
                  {streak > 0 ? t("dashboard.keepGoing") : t("dashboard.startStreak")}
                </div>
              </div>
            </div>

            {/* Streak passes */}
            {passBalance !== null && (
              <div className="card card-highlight stat-tile">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{t("dashboard.stat.streakPasses")}</div>
                  <div className="mt-2 sm:mt-3 flex items-center gap-1.5 text-2xl sm:text-3xl font-bold text-white">
                    {passBalance.available} <Ticket className="text-teal-400" size={20} />
                  </div>
                  <div className="mt-1.5 text-xs font-normal text-white/50">
                    {t("dashboard.streakPassHint")}
                  </div>
                </div>
              </div>
            )}

            {/* Total Points / Points Earned Today — one interchangeable
                card slot, tap to flip between the two metrics. */}
            <div
              className="card card-highlight stat-tile cursor-pointer transition"
              role="button"
              tabIndex={0}
              onClick={() => setPointsView((v) => (v === "total" ? "today" : "total"))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPointsView((v) => (v === "total" ? "today" : "total"));
                }
              }}
            >
              <div key={pointsView} className="card-swap-fade">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                    {pointsView === "total" ? t("dashboard.stat.totalPoints") : t("dashboard.stat.pointsToday")}
                  </div>
                  <div className="text-[10px] text-white/40 flex-shrink-0">⇄</div>
                </div>
                <div className="mt-2 sm:mt-3 text-2xl sm:text-3xl font-bold text-white">
                  <AnimatedNumber value={pointsView === "total" ? profile?.points ?? 0 : todayPointsEarned} />
                </div>
                <div className="mt-1.5 text-xs font-normal text-white/50">
                  {pointsView === "total"
                    ? t("dashboard.tapToday")
                    : todayPointsEarned > 0
                    ? t("dashboard.tapTotal")
                    : t("dashboard.reviewToEarn")}
                </div>
              </div>
            </div>

            {/* Day Status */}
            <div
              className="card card-highlight stat-tile"
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{t("dashboard.stat.dayStatus")}</div>
                <div className="mt-2 sm:mt-3 text-lg sm:text-xl font-bold">
                  {todayClosed ? (
                    <span className="text-emerald-300">{t("dashboard.closed")}</span>
                  ) : (
                    <span className="text-amber-300">{t("dashboard.active")}</span>
                  )}
                </div>
                <div className="mt-1.5 text-xs font-normal text-white/50">
                  {todayClosed ? t("dashboard.tomorrowUnlocked") : t("dashboard.closeToUnlock")}
                </div>
              </div>
            </div>

            {/* Tomorrow's Plan Status */}
            <div
              className="card card-highlight stat-tile"
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{t("dashboard.stat.tomorrowPlan")}</div>
                <div className="mt-2 sm:mt-3 text-lg sm:text-xl font-bold">
                  {tomorrowTotal === 0 ? (
                    <span className="text-white/50">{t("status.notStarted")}</span>
                  ) : tomorrowSubmitted ? (
                    <span className="text-emerald-300">{t("dashboard.submitted")}</span>
                  ) : (
                    <span className="text-amber-300">{t("dashboard.pending")}</span>
                  )}
                </div>
                <div className="mt-1.5 text-xs font-normal text-white/50">
                  {tomorrowTotal === 0
                    ? t("dashboard.noGoalsDrafted")
                    : tomorrowSubmitted
                    ? t("dashboard.goalsSet", { count: tomorrowTotal })
                    : t("dashboard.goalsDrafted", { count: tomorrowTotal })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <PendingNotifications
          connections={connections}
          goalAssignments={goalAssignments}
          onChange={() => setRefreshKey((k) => k + 1)}
        />

        {/* ✅ P1 Goal Highlight (use Tomorrow-like stronger red styling) */}
        {todayP1 && (
          <Link href="/standup/today" className="block">
            <div
              className="card card-highlight transition-all duration-300 hover:scale-[1.005] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-red-300">
                      {t("dashboard.p1Badge")}
                    </span>
                    {!todayP1.reviewed_at && (
                      <span className="text-xs font-normal text-white/50">{t("dashboard.pendingReviewShort")}</span>
                    )}
                    {todayP1.reviewed_at && (
                      <span className="text-xs font-normal text-white/50">{t("dashboard.reviewedCheck")}</span>
                    )}
                  </div>

                  {/* The goal itself is the actual content here — biggest,
                      boldest text on the card, with real breathing room
                      above/below so it doesn't compete with the label row. */}
                  <div className="mt-5 text-2xl font-bold text-white leading-snug">
                    {todayP1.title}
                  </div>

                  {todayP1.details && (
                    <div className="mt-2 text-sm font-normal text-white/70">{todayP1.details}</div>
                  )}

                  <div className="mt-5 text-xs font-normal uppercase tracking-wide text-white/50">
                    {t("dashboard.statusLabel")}
                  </div>
                  <div className="mt-1 text-base font-semibold text-white">
                    {statusLabel(todayP1.status, t)}
                  </div>

                  {(() => {
                    const assignment = assignedOutByGoalId.get(todayP1.id);
                    if (!assignment) return null;
                    return (
                      <div className="mt-3 text-xs text-white/50 inline-flex items-center gap-1">
                        {assignment.assignmentType === "exclusive" ? <Lock size={11} /> : <Unlock size={11} />}
                        {t("goalAssign.assignedToLabel", {
                          name: assignment.recipientDisplayName ?? t("social.anonymousUser"),
                        })}
                        {assignment.status === "pending" && <span>· {t("social.assignmentPending")}</span>}
                        {assignment.status === "accepted" && assignment.recipientGoalStatus && (
                          <span className="inline-flex items-center gap-1">
                            · <StatusIcon status={assignment.recipientGoalStatus} size={11} />{" "}
                            {statusLabel(assignment.recipientGoalStatus, t)}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="text-white/50">→</div>
              </div>
            </div>
          </Link>
        )}

        {/* Today & Tomorrow Overview Grid (keep logic; enhance row styles) */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Today Overview */}
          {/* min-w-0 on both the grid item and its card is required — CSS Grid
              items default to min-width:auto, so a long unbreakable note
              preview below could otherwise stretch this whole column (and
              the card inside it) past the viewport instead of truncating. */}
          <Link href="/standup/today" className="block min-w-0">
            <div
              className="card card-highlight transition cursor-pointer h-full min-w-0"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white">{t("dashboard.todaysGoals")}</h2>
                <span className="text-xs text-white/50">{formatDateDisplay(todayISO)}</span>
              </div>

              {sortedTodayGoals.length === 0 ? (
                <div className="text-white/60 text-sm py-8 text-center">
                  {t("dashboard.noGoalsToday")}
                  <div className="mt-2 text-xs text-white/50">
                    {t("dashboard.setYesterday")}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedTodayGoals.map((g, idx) => {
                    const reviewed = !!g.reviewed_at;
                    const priority = g.priority;
                    const assignment = assignedOutByGoalId.get(g.id);

                    return (
                      <div
                        key={g.id}
                        className="goal-row-compact text-sm transition-all duration-300"
                        data-pending={!reviewed}
                        style={{
                          "--p-color": typeof priority === "number" ? getPriorityMeta(priority).color : "rgba(var(--tint-rgb),0.2)",
                        } as React.CSSProperties}
                      >
                        {/* Corner number tag — nothing else competing for
                            space next to it, so the title can never overflow
                            no matter how narrow the screen or long the title. */}
                        <div className="goal-number-sm">{idx + 1}</div>
                        <div className="goal-row-compact-body">
                        <div className="truncate text-base font-medium text-white/90">{g.title}</div>

                        {/* Chips and note preview live on their own rows
                            below the title, instead of all fighting for
                            space in one row — that's what was forcing
                            horizontal overflow. */}
                        <div className="mt-1.5 flex items-center gap-2">
                          {typeof priority === "number" && (
                            <div
                              className="priority-chip-sm"
                              style={{
                                "--p-bg": getPriorityMeta(priority).bg,
                                "--p-border": getPriorityMeta(priority).border,
                                "--p-color": getPriorityMeta(priority).color,
                              } as React.CSSProperties}
                            >
                              P{priority}
                            </div>
                          )}

                          <div
                            className="status-chip-sm"
                            style={{
                              "--chip-bg": reviewed ? statusChipColors(g.status).bg : "rgba(245, 158, 11, 0.08)",
                              "--chip-border": reviewed ? statusChipColors(g.status).border : "rgba(245, 158, 11, 0.3)",
                              "--chip-color": reviewed ? statusChipColors(g.status).color : "#fcd34d",
                            } as React.CSSProperties}
                            title={reviewed ? t("dashboard.reviewedDash", { status: statusLabel(g.status, t) }) : t("dashboard.pendingReviewShort")}
                          >
                            {reviewed ? (
                              <>
                                <span>{statusLabel(g.status, t)}</span>
                                <StatusIcon status={g.status} size={12} />
                              </>
                            ) : (
                              <>
                                <span>{t("dashboard.pending")}</span>
                                <Hourglass size={12} />
                              </>
                            )}
                          </div>
                        </div>

                        {assignment && (
                          <div className="mt-1.5 truncate text-xs text-white/50 inline-flex items-center gap-1">
                            {assignment.assignmentType === "exclusive" ? <Lock size={11} /> : <Unlock size={11} />}
                            {t("goalAssign.assignedToLabel", {
                              name: assignment.recipientDisplayName ?? t("social.anonymousUser"),
                            })}
                            {assignment.status === "pending" && <span>· {t("social.assignmentPending")}</span>}
                            {assignment.status === "accepted" && assignment.recipientGoalStatus && (
                              <span className="inline-flex items-center gap-1">
                                · <StatusIcon status={assignment.recipientGoalStatus} size={11} />{" "}
                                {statusLabel(assignment.recipientGoalStatus, t)}
                              </span>
                            )}
                          </div>
                        )}

                        {noteCounts[g.id] > 0 && (
                          <div
                            className="mt-1.5 truncate text-xs text-cyan-300/80"
                            title={`${t(noteCounts[g.id] === 1 ? "dashboard.noteCount.one" : "dashboard.noteCount.other", { count: noteCounts[g.id] })}: ${latestNotes[g.id] ?? ""}`}
                          >
                            <MessageCircle className="inline-block align-text-bottom mr-1" size={12} />{latestNotes[g.id]}
                          </div>
                        )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between text-xs text-white/60">
                <span>
                  {t("dashboard.reviewedCompletedSummary", { reviewed: todayReviewed, completed: todayCompleted })}
                </span>
                <span className="text-white/50">→</span>
              </div>
            </div>
          </Link>

          {/* Tomorrow Overview */}
          <Link href="/standup/tomorrow" className="block min-w-0">
            <div
              className="card card-highlight transition cursor-pointer h-full min-w-0"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white">{t("dashboard.stat.tomorrowPlan")}</h2>
                <span className="text-xs text-white/50">{formatDateDisplay(tomorrowISO)}</span>
              </div>

              {sortedTomorrowGoals.length === 0 ? (
                <div className="text-white/60 text-sm py-8 text-center">
                  {t("dashboard.noPlanYet")}
                  <div className="mt-2 text-xs text-white/50">
                    {t("dashboard.setAtLeast3")}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedTomorrowGoals.slice(0, 5).map((g, idx) => {
                    const priority = g.priority;
                    const assignment = assignedOutByGoalId.get(g.id);

                    return (
                      <div
                        key={g.id}
                        className="goal-row-compact text-sm transition-all duration-300"
                        style={{
                          "--p-color": typeof priority === "number" ? getPriorityMeta(priority).color : "rgba(var(--tint-rgb),0.2)",
                        } as React.CSSProperties}
                      >
                        <div className="goal-number-sm">{idx + 1}</div>
                        <div className="goal-row-compact-body">
                        <div className="truncate text-base font-medium text-white/90">{g.title}</div>

                        {typeof priority === "number" && (
                          <div className="mt-1.5">
                            <div
                              className="priority-chip-sm"
                              style={{
                                "--p-bg": getPriorityMeta(priority).bg,
                                "--p-border": getPriorityMeta(priority).border,
                                "--p-color": getPriorityMeta(priority).color,
                              } as React.CSSProperties}
                            >
                              P{priority}
                            </div>
                          </div>
                        )}

                        {assignment && (
                          <div className="mt-1.5 truncate text-xs text-white/50 inline-flex items-center gap-1">
                            {assignment.assignmentType === "exclusive" ? <Lock size={11} /> : <Unlock size={11} />}
                            {t("goalAssign.assignedToLabel", {
                              name: assignment.recipientDisplayName ?? t("social.anonymousUser"),
                            })}
                            {assignment.status === "pending" && <span>· {t("social.assignmentPending")}</span>}
                            {assignment.status === "accepted" && assignment.recipientGoalStatus && (
                              <span className="inline-flex items-center gap-1">
                                · <StatusIcon status={assignment.recipientGoalStatus} size={11} />{" "}
                                {statusLabel(assignment.recipientGoalStatus, t)}
                              </span>
                            )}
                          </div>
                        )}

                        {noteCounts[g.id] > 0 && (
                          <div
                            className="mt-1.5 truncate text-xs text-cyan-300/80"
                            title={`${t(noteCounts[g.id] === 1 ? "dashboard.noteCount.one" : "dashboard.noteCount.other", { count: noteCounts[g.id] })}: ${latestNotes[g.id] ?? ""}`}
                          >
                            <MessageCircle className="inline-block align-text-bottom mr-1" size={12} />{latestNotes[g.id]}
                          </div>
                        )}
                        </div>
                      </div>
                    );
                  })}

                  {sortedTomorrowGoals.length > 5 && (
                    <div className="text-xs text-white/50 text-center py-1">
                      {t("dashboard.moreGoals", { count: sortedTomorrowGoals.length - 5 })}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between text-xs text-white/60">
                <span>
                  {t("dashboard.goalsCount", { count: tomorrowTotal })}{tomorrowSubmitted ? t("dashboard.suffixSubmitted") : t("dashboard.suffixDraft")}
                </span>
                <span className="text-white/50">→</span>
              </div>
            </div>
          </Link>
        </div>

        {/* Quick Actions (unchanged) */}
        <div
          className="card card-highlight"
        >
          <h2 className="text-lg font-semibold mb-4">{t("dashboard.quickActions")}</h2>
          <div className="flex flex-wrap gap-3">
            {todayPending > 0 && (
              <Link href="/standup/today" className="btn btn-primary inline-flex items-center gap-2">
                <Zap size={15} /> {t(todayPending > 1 ? "dashboard.reviewPending.other" : "dashboard.reviewPending.one", { count: todayPending })}
              </Link>
            )}
            {!todayClosed && todayTotal > 0 && todayPending === 0 && (
              <Link href="/standup/today" className="btn btn-primary inline-flex items-center gap-2">
                <CheckCircle2 size={15} /> {t("dashboard.closeOutDay")}
              </Link>
            )}
            {tomorrowTotal === 0 && (
              <Link href="/standup/tomorrow" className="btn btn-primary inline-flex items-center gap-2">
                <Target size={15} /> {t("nav.planTomorrow")}
              </Link>
            )}
            <Link href="/standup/today" className="btn inline-flex items-center gap-2">
              <ClipboardList size={15} /> {t("dashboard.todaysGoals")}
            </Link>
            <Link href="/standup/tomorrow" className="btn inline-flex items-center gap-2">
              <FileEdit size={15} /> {t("dashboard.stat.tomorrowPlan")}
            </Link>
          </div>
        </div>

        {showAssistant && (
          <AssistantPanel
            onClose={() => setShowAssistant(false)}
            onActionTaken={() => setRefreshKey((k) => k + 1)}
          />
        )}

        {pendingAchievements[0] && (
          <AchievementUnlockedModal
            achievement={pendingAchievements[0]}
            onDismiss={() => dismissAchievement(pendingAchievements[0])}
            onShare={(visibility) => shareAchievement(pendingAchievements[0], visibility)}
          />
        )}
      </div>
  );
}

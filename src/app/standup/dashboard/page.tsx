"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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
  getStreakPassCoveredDates,
  listConnections,
  getMyGoalAssignments,
  getMyMentions,
  getMyPostActivityNotifications,
  ensurePaymentReminderGoals,
  type Goal,
  type Profile,
  type DailyPlan,
  type OverdueSummary,
  type PostVisibility,
  type StreakPassBalance,
  type Connection,
  type GoalAssignment,
  type Mention,
  type PostActivityNotification,
} from "@/lib/supabase/db";
import PendingNotifications from "@/components/PendingNotifications";
import PageLoadingState from "@/components/PageLoadingState";
import { supabase } from "@/lib/supabase/client";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import {
  Hourglass, Bot, Hand, PartyPopper, TriangleAlert, AlarmClock, Sparkles, Flame,
  MessageCircle, Zap, CheckCircle2, Target, ClipboardList, FileEdit, Ticket, Lock, Unlock,
  Sunrise, ChevronRight,
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
  // Phase 9B: tracks the critical load path only (profile/streak/today's
  // plan/tomorrow's plan -- the values every stat tile, the P1 card, and
  // both goal lists directly display). The other data sources batched
  // alongside them (achievements, connections, assignments, mentions,
  // post activity, streak passes) already degrade gracefully via their
  // own .catch(() => fallback) -- a failure there was never promoted
  // into loadError, matching how they already behaved before this phase.
  const [loadError, setLoadError] = useState(false);
  // Separate from `loading` on purpose: `loading` still drives the
  // full-page PageLoadingState skeleton for the initial mount (and any
  // refreshKey-triggered reload, unchanged from before). `retrying`
  // only covers an explicit Retry click, so the error banner/button stay
  // visible with their own busy state instead of being replaced by the
  // full skeleton.
  const [retrying, setRetrying] = useState(false);
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
  // Mirrors Today page's own coveredByPassToday -- a pass-covered day
  // closes itself the moment its date becomes "today", so Dashboard's own
  // todayClosed (the "Tomorrow Unlocked" banner, end-of-day reminder, etc.)
  // needs the same treatment rather than duplicating Today's derivation
  // incorrectly.
  const [coveredByPassToday, setCoveredByPassToday] = useState(false);
  const [pointsView, setPointsView] = useState<"total" | "today">("total");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [goalAssignments, setGoalAssignments] = useState<GoalAssignment[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [postActivity, setPostActivity] = useState<PostActivityNotification[]>([]);
  const [paymentGoalsAddedMsg, setPaymentGoalsAddedMsg] = useState<string | null>(null);

  // Cycles to a new (different) random quote every ~10s — see the effect
  // below, which reschedules itself off motivationIndex the same way the
  // Total Points / Points Earned Today card auto-swaps.
  const [motivationIndex, setMotivationIndex] = useState(() =>
    Math.floor(Math.random() * MOTIVATIONAL_MESSAGE_KEYS.length)
  );
  // Holds the OUTGOING index only during the brief transition, so the old
  // message can render (absolutely positioned) sliding up and out while
  // the new one slides up into place underneath it. Cleared by the
  // incoming element's onAnimationEnd, not a timer, so it can never
  // outlive the animation it's there for — except under prefers-reduced-
  // motion, where it's never set in the first place (that animation never
  // plays, so onAnimationEnd would never fire to clear it).
  const [prevMotivationIndex, setPrevMotivationIndex] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setMotivationIndex((prev) => {
        if (MOTIVATIONAL_MESSAGE_KEYS.length <= 1) return prev;
        let next = Math.floor(Math.random() * MOTIVATIONAL_MESSAGE_KEYS.length);
        while (next === prev) next = Math.floor(Math.random() * MOTIVATIONAL_MESSAGE_KEYS.length);
        const prefersReducedMotion =
          typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (!prefersReducedMotion) setPrevMotivationIndex(prev);
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

  // Phase 9B: lifted out of the mount effect (as a stable useCallback) so
  // the new Retry button can re-run the exact same sequence instead of
  // duplicating it. Behavior is otherwise unchanged from before this
  // phase -- same batch, same per-source fallbacks, same side effects.
  const load = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const u = session?.user ?? null;
        setUser(u);

        // These nine don't depend on each other, so they run as one batch
        // instead of a serial chain of awaits. lifetimeStats/connections/
        // goalAssignments are swallowed into a null/[] on failure so one bad
        // query can't sink the whole dashboard load via Promise.all's
        // fail-fast behavior — the achievement popup or notifications
        // section just gets skipped for this load, same as before.
        const [p, s, todayResult, tomorrowResult, lifetimeStats, passes, conns, assignments, myMentions, myPostActivity, coveredDates] = await Promise.all([
          getOrCreateProfile(),
          getStreak(),
          getPlanWithGoals(todayISO),
          getPlanWithGoals(tomorrowISO),
          u ? getLifetimeStats().catch(() => null) : Promise.resolve(null),
          u ? getStreakPassBalance().catch(() => null) : Promise.resolve(null),
          u ? listConnections().catch(() => []) : Promise.resolve([]),
          u ? getMyGoalAssignments().catch(() => []) : Promise.resolve([]),
          u ? getMyMentions().catch(() => []) : Promise.resolve([]),
          u ? getMyPostActivityNotifications().catch(() => []) : Promise.resolve([]),
          u ? getStreakPassCoveredDates(todayISO, todayISO).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
        ]);
        setProfile(p);
        setStreak(s);
        setTodayPlan(todayResult.plan);
        setTodayGoals(todayResult.goals);
        setTomorrowPlan(tomorrowResult.plan);
        setTomorrowGoals(tomorrowResult.goals);
        setConnections(conns);
        setGoalAssignments(assignments);
        setMentions(myMentions);
        setPostActivity(myPostActivity);
        setPassBalance(passes);
        setCoveredByPassToday(coveredDates.has(todayISO));

        getOverdueSummary(todayISO)
          .then(setOverdue)
          .catch(() => {});

        // Payment reminders are auto-created (not a tap-to-add suggestion
        // like recurring templates) -- explicit user call. Dashboard is
        // usually the first page visited after sign-in, so checking here
        // too (alongside Today/Tomorrow/the date-detail page) gives this
        // the best chance of catching a due reminder close to real time.
        if (u) {
          ensurePaymentReminderGoals(todayISO)
            .then((created) => {
              if (created.length > 0) {
                getPlanWithGoals(todayISO)
                  .then((r) => setTodayGoals(r.goals))
                  .catch(() => {});
                setPaymentGoalsAddedMsg(t("tomorrow.paymentGoalsAdded", { names: created.map((a) => a.name).join(", ") }));
              }
            })
            .catch(() => {});
        }

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

        // Reached the end without throwing -- the critical path (profile/
        // streak/both plans) succeeded, so any previous load-failure state
        // no longer applies, including after a successful Retry.
        setLoadError(false);
      } catch (error) {
        // Only the 4 un-caught calls above (profile/streak/today's plan/
        // tomorrow's plan) can actually reach this catch -- every other
        // source in the Promise.all already swallows its own failure into
        // a null/[] fallback and was never meant to block the page. Those
        // 4 are exactly the values every stat tile, the P1 card, and both
        // goal lists display directly, so a failure here genuinely means
        // "this dashboard's numbers can't be trusted" -- the bar Phase 9A
        // set for showing the new error state instead of silently
        // rendering zeroed-out content.
        console.error("Dashboard load error:", error);
        setLoadError(true);
      }
    }, [todayISO, tomorrowISO, t]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));

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
      if (a.direction === "assigned" && a.status !== "declined" && a.status !== "canceled" && a.assignerGoalId) {
        map.set(a.assignerGoalId, a);
      }
    }
    return map;
  }, [goalAssignments]);

  // Phase 9B: re-runs the exact same load() a Retry click as the initial
  // mount does. Guarded by `retrying` so a second click while one is
  // already in flight is a no-op instead of firing a duplicate request.
  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    await load();
    setRetrying(false);
  }

  if (loading) {
    return <PageLoadingState label={t("dashboard.loading")} />;
  }

  // Phase 9B: shown only when the critical load path actually failed (see
  // the comment on load()'s catch block) -- never for the already-
  // gracefully-degraded optional data sources. Header kept minimal (just
  // the page title) since the full header card needs `profile` to render
  // its level badge, which is exactly what failed to load.
  if (loadError) {
    return (
      <div className="space-y-6">
        <div className="card card-highlight dashboard-shell">
          <h1 className="text-3xl font-bold">{t("nav.dashboard")}</h1>
        </div>
        <div className="dashboard-banner dashboard-banner-danger" role="alert">
          <div className="dashboard-banner-heading">
            <TriangleAlert size={17} /> {t("dashboard.loadErrorTitle")}
          </div>
          <p className="dashboard-banner-body">{t("dashboard.loadErrorBody")}</p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            aria-busy={retrying}
            className="btn btn-primary dashboard-banner-cta"
          >
            {retrying ? t("dashboard.retrying") : t("dashboard.retry")}
          </button>
        </div>
      </div>
    );
  }

  // Today stats
  const todayP1 = todayGoals.find((g) => g.priority === 1);
  // An exclusive-and-accepted assigned-out goal is excluded from THIS
  // user's own review requirement on Today's own page (see
  // src/app/standup/today/page.tsx's reviewableGoals) -- its reviewed_at
  // never gets set on the assigner's own frozen copy, since it's the
  // recipient's to review now. Without the same exclusion here, the
  // Quick Actions "Review N Pending Goal" button (and this banner) could
  // point at a day that's already fully closed, with nothing left to
  // actually review -- exactly the mismatch that got reported.
  const todayReviewableGoals = todayGoals.filter((g) => {
    const a = assignedOutByGoalId.get(g.id);
    return !(a?.assignmentType === "exclusive" && a.status === "accepted");
  });
  const todayPending = todayReviewableGoals.filter((g) => !g.reviewed_at).length;
  // "Attempted" = reviewed, full stop — the outcome status (completed,
  // blocked, postponed, etc.) never factors into this. Closing the day
  // itself works the same way: it only ever checks reviewed_at, never
  // status, so this mirrors the actual gating rule.
  const todayReviewed = todayReviewableGoals.filter((g) => !!g.reviewed_at).length;
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
  const todayClosed = !!todayPlan?.reviewed_at || coveredByPassToday;
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
                <Link href="/standup/today" className="btn btn-tint btn-teal text-sm whitespace-nowrap inline-flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> {t("nav.reviewToday")}
                </Link>
                <Link href="/standup/tomorrow" className="btn btn-tint btn-amber-tint text-sm whitespace-nowrap inline-flex items-center gap-1.5">
                  <Sunrise size={14} /> {t("nav.planTomorrow")}
                </Link>
              </div>
              <button type="button" onClick={() => setShowAssistant(true)} className="btn btn-tint btn-purple text-sm whitespace-nowrap sm:order-1 inline-flex items-center gap-1.5">
                <Bot size={14} /> {t("dashboard.assistant")}
              </button>
            </div>
          </div>

          {/* One-time welcome banner for brand-new accounts — see
              isNewUser/welcomeDismissed above. Separate from the rotating
              Motivation card (moved below, after the P1 highlight, in
              Phase 9B), which is a recurring nicety rather than onboarding
              content.
              Phase 9B: CTA downgraded from .btn-primary to plain .btn --
              banners are lightweight information/attention surfaces, not
              primary-CTA-weight objects (see .dashboard-banner's own
              comment in globals.css), and Quick Actions below is the
              page's one established "what should I do next" location --
              a new account could otherwise show two simultaneous
              .btn-primary buttons (this one + Quick Actions' own "Plan
              Tomorrow") communicating equal top importance. */}
          {isNewUser && !welcomeDismissed && (
            <div className="mt-6 dashboard-banner dashboard-banner-attention">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="dashboard-banner-heading"><Hand size={17} /> {t("dashboard.welcomeTitle")}</div>
                  <p className="dashboard-banner-body">
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
                className="btn dashboard-banner-cta inline-block"
                onClick={dismissWelcome}
              >
                {t("dashboard.planTomorrowArrow")}
              </Link>
            </div>
          )}

          {paymentGoalsAddedMsg && (
            <div className="mt-6 dashboard-banner dashboard-banner-attention flex items-center justify-between gap-4">
              <span className="text-sm text-white/80">{paymentGoalsAddedMsg}</span>
              <button
                type="button"
                onClick={() => setPaymentGoalsAddedMsg(null)}
                aria-label={t("dashboard.dismissWelcome")}
                className="flex-shrink-0 text-white/50 hover:text-white/80 transition text-lg leading-none"
              >
                ×
              </button>
            </div>
          )}

          {/* Encouragement banner — both halves of the daily loop are done:
              today reviewed and closed, tomorrow's plan submitted. Not
              dismissible, same as the "Day closed" indicator on Today's own
              page — it's a status reflection, not a nag, so it just shows
              for as long as it's accurately true. */}
          {todayClosed && tomorrowSubmitted && (
            <div className="mt-6 dashboard-banner dashboard-banner-success">
              <div className="dashboard-banner-heading">
                <PartyPopper size={18} /> {t("dashboard.allCaughtUpTitle")}
              </div>
              <p className="dashboard-banner-body">
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
            <div className="mt-6 dashboard-banner dashboard-banner-attention">
              <div className="dashboard-banner-heading">
                <TriangleAlert size={17} /> {t(overdue.count === 1 ? "dashboard.overdueTitle.one" : "dashboard.overdueTitle.other", { count: overdue.count })}
              </div>
              <p className="dashboard-banner-body">
                {t("dashboard.overdueBody")}
              </p>
              <Link href="/standup/calendar?unreviewed=1" className="btn dashboard-banner-cta inline-block">
                {t("dashboard.viewUnreviewed")}
              </Link>
            </div>
          )}

          {/* End-of-day reminder — the only "notification" this app can give
              without push/email: a banner shown while the dashboard is open,
              once there are 6 or fewer hours left and today isn't closed. */}
          {showEndOfDayReminder && (
            <div className="mt-6 dashboard-banner dashboard-banner-attention">
              <div className="dashboard-banner-heading">
                <AlarmClock size={17} /> {hoursLeftToday < 1 ? t("dashboard.hoursLeftLessThanHour") : t("dashboard.hoursLeft", { hours: Math.round(hoursLeftToday) })}
              </div>
              <p className="dashboard-banner-body">
                {t(todayPending === 1 ? "dashboard.pendingReviewBanner.one" : "dashboard.pendingReviewBanner.other", { count: todayPending })}
              </p>
              <Link href="/standup/today" className="btn dashboard-banner-cta inline-block">
                {t("nav.reviewToday")} →
              </Link>
            </div>
          )}

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
          mentions={mentions}
          postActivity={postActivity}
          onChange={() => setRefreshKey((k) => k + 1)}
        />

        {/* ✅ P1 Goal Highlight (use Tomorrow-like stronger red styling) */}
        {todayP1 && (() => {
          const assignment = assignedOutByGoalId.get(todayP1.id);
          // Once handed off exclusively (and accepted), this user's own copy
          // never gets touched again -- its reviewed_at/status sit frozen at
          // whatever they were at assignment time. Mirror the recipient's
          // live status instead, same fix as Today's own page.
          const isExclusive = assignment?.assignmentType === "exclusive" && assignment.status === "accepted";
          const effectiveStatus = isExclusive && assignment?.recipientGoalStatus ? assignment.recipientGoalStatus : todayP1.status;
          const effectiveReviewed = isExclusive ? true : !!todayP1.reviewed_at;

          // Once the P1 goal is completed, collapse the big focus card
          // into a compact success state — explicit user call, this
          // frees up height for whatever's actually still actionable
          // instead of keeping the full card around just to say "done."
          if (effectiveStatus === "completed") {
            return (
              <Link href={`/standup/today?goal=${todayP1.id}`} className="block">
                <div className="plan-submitted-card w-full">
                  <CheckCircle2 size={16} />
                  <div className="plan-submitted-title">
                    {t("dashboard.p1CompletedTitle", { title: todayP1.title })}
                  </div>
                </div>
              </Link>
            );
          }

          return (
          <Link href={`/standup/today?goal=${todayP1.id}`} className="block">
            <div
              className="card card-highlight transition-all duration-300 hover:scale-[1.005] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-red-300">
                      {t("dashboard.p1Badge")}
                    </span>
                    {!effectiveReviewed && (
                      <span className="text-xs font-normal text-white/50">{t("dashboard.pendingReviewShort")}</span>
                    )}
                    {effectiveReviewed && (
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
                    {statusLabel(effectiveStatus, t)}
                  </div>

                  {assignment && (
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
                  )}
                </div>

                <div className="text-white/50">→</div>
              </div>
            </div>
          </Link>
          );
        })()}

        {/* Motivation — Phase 9B: moved here (after the P1 highlight,
            before Today/Tomorrow) from its previous spot right after the
            banners/before the stat tiles. Decorative/supportive content
            was outranking the user's actual progress and most actionable
            item in scan order; this keeps the feature exactly as-is
            (same card, same ticker animation, same copy) and only changes
            where it sits in the page. */}
        <div
          className="card card-highlight"
          style={{ padding: "8px 10px" }}
        >
          <div className="flex items-center gap-1.5 text-sm text-white/70"><Sparkles size={13} /> {t("dashboard.motivationLabel")}</div>
          {/* The new message pushes the old one up and off, rather than
              a crossfade — see .motivation-slide-in/out in globals.css.
              Only clips/absolutely-positions its children WHILE the two
              messages overlap mid-transition (is-transitioning); at rest
              (the vast majority of the time) it's a plain block sized to
              its own content, so a long message is never cut off and the
              card uses exactly as much height as the full text needs. */}
          <div className={`motivation-ticker-window mt-2${prevMotivationIndex !== null ? " is-transitioning" : ""}`}>
            {prevMotivationIndex !== null && (
              <div
                key={`prev-${prevMotivationIndex}`}
                className="motivation-slide motivation-slide-out text-lg font-semibold text-white leading-snug"
              >
                {t(MOTIVATIONAL_MESSAGE_KEYS[prevMotivationIndex], {
                  name: profile?.display_name || user?.email?.split("@")[0] || t("motivation.fallbackName"),
                })}
              </div>
            )}
            <div
              key={`cur-${motivationIndex}`}
              className={`text-lg font-semibold text-white leading-snug ${prevMotivationIndex !== null ? "motivation-slide motivation-slide-in" : ""}`}
              onAnimationEnd={() => setPrevMotivationIndex(null)}
            >
              {t(MOTIVATIONAL_MESSAGE_KEYS[motivationIndex], {
                name: profile?.display_name || user?.email?.split("@")[0] || t("motivation.fallbackName"),
              })}
            </div>
          </div>
        </div>

        {/* Today & Tomorrow Overview Grid (keep logic; enhance row styles) */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Today Overview */}
          {/* min-w-0 is required — CSS Grid items default to min-width:auto,
              so a long unbreakable note preview below could otherwise
              stretch this whole column past the viewport instead of
              truncating. Not a single big <Link> anymore (was wrapping the
              ENTIRE card) — each goal row below is now its own Link to that
              specific goal, which would otherwise nest an <a> inside an
              <a>; the header/footer get their own small Links instead. */}
          <div className="card card-highlight h-full min-w-0">
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
                  const priority = g.priority;
                  const assignment = assignedOutByGoalId.get(g.id);
                  // Mirror Today's own effectiveStatus/reviewed fix: once
                  // handed off exclusively (and accepted), this user's own
                  // copy never changes again -- show the recipient's live
                  // status instead of the frozen placeholder.
                  const isExclusive = assignment?.assignmentType === "exclusive" && assignment.status === "accepted";
                  const effectiveStatus = isExclusive && assignment?.recipientGoalStatus ? assignment.recipientGoalStatus : g.status;
                  const reviewed = isExclusive ? true : !!g.reviewed_at;

                  return (
                    <Link
                      key={g.id}
                      href={`/standup/today?goal=${g.id}`}
                      data-goal-id={g.id}
                      className="goal-row-compact goal-row-compact-link text-sm transition-all duration-300"
                      data-pending={!reviewed}
                      style={{
                        "--p-color": typeof priority === "number" ? getPriorityMeta(priority).color : "rgba(var(--tint-rgb),0.2)",
                      } as React.CSSProperties}
                    >
                      {/* Corner number tag — nothing else competing for
                          space next to it, so the title can never overflow
                          no matter how narrow the screen or long the title. */}
                      <div className="goal-number-sm">{idx + 1}</div>
                      <div className="goal-row-compact-body" style={{ paddingRight: "1.75rem" }}>
                      <div className="goal-title-clamp-2 text-base font-medium text-white/90">{g.title}</div>

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
                            "--chip-bg": reviewed ? statusChipColors(effectiveStatus).bg : "rgba(245, 158, 11, 0.08)",
                            "--chip-border": reviewed ? statusChipColors(effectiveStatus).border : "rgba(245, 158, 11, 0.3)",
                            "--chip-color": reviewed ? statusChipColors(effectiveStatus).color : "#fcd34d",
                          } as React.CSSProperties}
                          title={reviewed ? t("dashboard.reviewedDash", { status: statusLabel(effectiveStatus, t) }) : t("dashboard.pendingReviewShort")}
                        >
                          {reviewed ? (
                            <>
                              <span>{statusLabel(effectiveStatus, t)}</span>
                              <StatusIcon status={effectiveStatus} size={12} />
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
                      {/* Decorative nav cue only — the whole row above is
                          already the real tap target. */}
                      <ChevronRight size={16} className="flex-shrink-0 text-white/30" style={{ position: "absolute", right: "0.85rem", top: "50%", transform: "translateY(-50%)" }} />
                    </Link>
                  );
                })}
              </div>
            )}

            <Link href="/standup/today" className="mt-4 flex items-center justify-between text-xs text-white/60 hover:text-white/80 transition">
              <span>
                {t("dashboard.reviewedCompletedSummary", { reviewed: todayReviewed, completed: todayCompleted })}
              </span>
              <ChevronRight size={14} className="text-white/50" />
            </Link>
          </div>

          {/* Tomorrow Overview — same not-one-big-Link restructure as
              Today's card above. */}
          <div className="card card-highlight h-full min-w-0">
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
                    <Link
                      key={g.id}
                      href={`/standup/tomorrow?goal=${g.id}`}
                      data-goal-id={g.id}
                      className="goal-row-compact goal-row-compact-link text-sm transition-all duration-300"
                      style={{
                        "--p-color": typeof priority === "number" ? getPriorityMeta(priority).color : "rgba(var(--tint-rgb),0.2)",
                      } as React.CSSProperties}
                    >
                      <div className="goal-number-sm">{idx + 1}</div>
                      <div className="goal-row-compact-body" style={{ paddingRight: "1.75rem" }}>
                      <div className="goal-title-clamp-2 text-base font-medium text-white/90">{g.title}</div>

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
                      <ChevronRight size={16} className="flex-shrink-0 text-white/30" style={{ position: "absolute", right: "0.85rem", top: "50%", transform: "translateY(-50%)" }} />
                    </Link>
                  );
                })}

                {sortedTomorrowGoals.length > 5 && (
                  <div className="text-xs text-white/50 text-center py-1">
                    {t("dashboard.moreGoals", { count: sortedTomorrowGoals.length - 5 })}
                  </div>
                )}
              </div>
            )}

            <Link href="/standup/tomorrow" className="mt-4 flex items-center justify-between text-xs text-white/60 hover:text-white/80 transition">
              <span>
                {t("dashboard.goalsCount", { count: tomorrowTotal })}{tomorrowSubmitted ? t("dashboard.suffixSubmitted") : t("dashboard.suffixDraft")}
              </span>
              <ChevronRight size={14} className="text-white/50" />
            </Link>
          </div>
        </div>

        {/* Quick Actions — primary CTA(s) full-width on mobile, the two
            secondary actions side-by-side underneath (see .quick-actions-*
            in globals.css). Both secondaries are now context-aware: once
            today's reviewed/tomorrow's submitted, they swap to a ✓ success
            treatment instead of staying static labels forever. */}
        <div
          className="card card-highlight"
        >
          <h2 className="text-lg font-semibold mb-4">{t("dashboard.quickActions")}</h2>
          <div className="flex flex-col gap-3">
            <div className="quick-actions-primary">
              {todayPending > 0 && (
                <Link href="/standup/today" className="btn btn-primary inline-flex items-center justify-center gap-2">
                  <Zap size={15} /> {t(todayPending > 1 ? "dashboard.reviewPending.other" : "dashboard.reviewPending.one", { count: todayPending })}
                </Link>
              )}
              {!todayClosed && todayTotal > 0 && todayPending === 0 && (
                <Link href="/standup/today" className="btn btn-primary inline-flex items-center justify-center gap-2">
                  <CheckCircle2 size={15} /> {t("dashboard.closeOutDay")}
                </Link>
              )}
              {todayClosed && (
                <div className="plan-submitted-card">
                  <CheckCircle2 size={16} />
                  <div className="plan-submitted-title">{t("dashboard.dayCompleteTitle")}</div>
                </div>
              )}
              {tomorrowTotal === 0 && (
                <Link href="/standup/tomorrow" className="btn btn-primary inline-flex items-center justify-center gap-2">
                  <Target size={15} /> {t("nav.planTomorrow")}
                </Link>
              )}
            </div>

            <div className="quick-actions-secondary">
              <Link
                href="/standup/today"
                className={`btn btn-tint inline-flex items-center justify-center gap-2 ${todayTotal > 0 && todayPending === 0 ? "btn-teal" : "btn-blue"}`}
              >
                {todayTotal > 0 && todayPending === 0 ? <CheckCircle2 size={15} /> : <ClipboardList size={15} />}
                {todayTotal > 0 && todayPending === 0 ? t("dashboard.reviewedState") : t("dashboard.todaysGoals")}
              </Link>
              <Link
                href="/standup/tomorrow"
                className={`btn btn-tint inline-flex items-center justify-center gap-2 ${tomorrowSubmitted ? "btn-teal" : "btn-amber-tint"}`}
              >
                {tomorrowSubmitted ? <CheckCircle2 size={15} /> : <FileEdit size={15} />}
                {tomorrowSubmitted ? t("dashboard.planReadyState") : t("dashboard.stat.tomorrowPlan")}
              </Link>
            </div>
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

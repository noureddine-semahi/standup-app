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
  hoursUntilMidnight,
  type Goal,
  type Profile,
  type DailyPlan,
  type OverdueSummary,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusIcon, statusLabel, statusChipColors } from "@/lib/goalStatus";
import { onPointsUpdated } from "@/lib/pointsBus";
import AnimatedNumber from "@/components/AnimatedNumber";
import ProgressCircle from "@/components/ProgressCircle";
import { getLevelInfo } from "@/lib/levels";

/**
 * ✅ Reuse the "Tomorrow page" visual language:
 * - gradient backgrounds by "importance"
 * - stronger borders
 * - hover scale
 * - glass panels
 */

const MOTIVATIONAL_MESSAGES: Array<(name: string) => string> = [
  (name) => `Welcome back, ${name}! Let's keep working on your goals and achieve your dreams.`,
  (name) => `${name}, today is a fresh chance to move closer to what you're building.`,
  (name) => `Small steps, ${name} — consistency beats intensity every time.`,
  (name) => `You've got this, ${name}. One goal at a time.`,
  (name) => `Keep showing up, ${name} — that's how dreams become plans, and plans become reality.`,
  (name) => `${name}, discipline today is freedom tomorrow. Let's go.`,
  (name) => `Every day you show up is a step toward the life you're building, ${name}.`,
  (name) => `Progress, not perfection, ${name}. Keep pushing forward.`,
  (name) => `The greatest reward is your success, ${name} — everything else follows from it.`,
  (name) => `${name}, motivation gets you started. Habit is what keeps you going.`,
  (name) => `You don't have to be great to start, ${name}, but you have to start to be great.`,
  (name) => `Consistency is the quiet force behind every big win, ${name}.`,
  (name) => `${name}, the work you do today is the person you become tomorrow.`,
  (name) => `Discomfort today, ${name}. Freedom tomorrow.`,
  (name) => `${name}, a little progress each day adds up to big results.`,
  (name) => `Don't count the days, ${name} — make the days count.`,
  (name) => `${name}, the streak isn't the goal. Who you become while building it is.`,
  (name) => `Show up for yourself today, ${name}. That's the whole game.`,
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
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);
  const [pointsView, setPointsView] = useState<"total" | "today">("total");

  // Cycles to a new (different) random quote every ~10s — see the effect
  // below, which reschedules itself off motivationIndex the same way the
  // Total Points / Points Earned Today card auto-swaps.
  const [motivationIndex, setMotivationIndex] = useState(() =>
    Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)
  );
  const motivationalMessage = MOTIVATIONAL_MESSAGES[motivationIndex];

  useEffect(() => {
    const id = window.setTimeout(() => {
      setMotivationIndex((prev) => {
        if (MOTIVATIONAL_MESSAGES.length <= 1) return prev;
        let next = Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length);
        while (next === prev) next = Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length);
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

        const s = await getStreak();
        setStreak(s);

        getOverdueSummary(todayISO)
          .then(setOverdue)
          .catch(() => {});

        const { plan: todayP, goals: todayG } = await getPlanWithGoals(todayISO);
        setTodayPlan(todayP);
        setTodayGoals(todayG);

        const { plan: tomorrowP, goals: tomorrowG } = await getPlanWithGoals(tomorrowISO);
        setTomorrowPlan(tomorrowP);
        setTomorrowGoals(tomorrowG);

        const allGoalIds = [...todayG, ...tomorrowG].map((g) => g.id).filter(Boolean);
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
  }, [todayISO, tomorrowISO]);

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

  if (loading) {
    return <div className="card">Loading dashboard...</div>;
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
    todayPostponed > 0 ? `${todayPostponed} postponed` : null,
    todayBlocked > 0 ? `${todayBlocked} blocked` : null,
    todayAttemptedStatus > 0 ? `${todayAttemptedStatus} attempted` : null,
    todayInProgress > 0 ? `${todayInProgress} in progress` : null,
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
              <h1 className="text-3xl font-bold">Dashboard</h1>
              <p className="mt-2 text-white/70">Your daily execution overview</p>

              {/* Level badge — points-based, see src/lib/levels.ts. Links to
                  Profile, where the fuller level + achievements view lives. */}
              <Link
                href="/standup/profile"
                className="mt-4 inline-flex items-center gap-3 rounded-full border border-purple-500/25 bg-purple-500/10 px-3 py-1.5 hover:bg-purple-500/15 transition"
              >
                <span className="text-xs font-bold text-purple-300">
                  Lv {levelInfo.level} · {levelInfo.name}
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
                  {levelInfo.pointsToNext !== null ? `${levelInfo.pointsToNext} pts to next` : "Max level"}
                </span>
              </Link>
            </div>

            <div className="flex gap-2">
              <Link href="/standup/today" className="btn">
                Review Today
              </Link>
              <Link href="/standup/tomorrow" className="btn">
                Plan Tomorrow
              </Link>
            </div>
          </div>

          {/* One-time welcome banner for brand-new accounts — see
              isNewUser/welcomeDismissed above. Separate from the rotating
              Motivation card below, which is a recurring nicety rather than
              onboarding content. */}
          {isNewUser && !welcomeDismissed && (
            <div
              className="mt-6 rounded-2xl p-5"
              style={{ background: "rgba(168, 85, 247, 0.1)", border: "1px solid rgba(168, 85, 247, 0.3)" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-base font-bold text-white">👋 Welcome to StandUp!</div>
                  <p className="mt-2 text-sm text-white/70 leading-relaxed">
                    Here's the loop: <b>Plan Tomorrow</b> — set at least 3 goals — then the next day,{" "}
                    <b>Review Today</b> to mark them reviewed and close out the day. Do that daily and you'll
                    build a streak and earn points along the way.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismissWelcome}
                  aria-label="Dismiss welcome message"
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
                Plan Tomorrow →
              </Link>
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
              <div className="text-base font-bold text-amber-300">
                ⚠️ {overdue.count} past day{overdue.count === 1 ? "" : "s"} left unreviewed
              </div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Once a day passes it can't be reviewed retroactively, but you can still re-attempt
                any goals still worth pursuing by rescheduling them forward from Calendar.
              </p>
              <Link href="/standup/calendar" className="btn mt-4 inline-block">
                View Calendar →
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
              <div className="text-base font-bold text-amber-300">
                ⏰ {hoursLeftToday < 1 ? "Less than an hour" : `${Math.round(hoursLeftToday)} hours`} left
                today
              </div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                {todayPending} goal{todayPending === 1 ? "" : "s"} still need review. Close out today
                before midnight — after that it can't be reviewed retroactively.
              </p>
              <Link href="/standup/today" className="btn mt-4 inline-block">
                Review Today →
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
                  <img src={profile.avatar_url} alt="Profile photo" className="w-full h-full object-cover" />
                </div>
              )}
              <div key={motivationIndex} className="card-swap-fade">
                <div className="text-sm text-white/70">✨ Motivation</div>
                <div className="mt-2 text-base font-semibold text-white leading-snug">
                  {motivationalMessage(profile?.display_name || user?.email?.split("@")[0] || "there")}
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
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Attempted</div>
                  <div className="mt-1 sm:mt-1.5 text-xs font-normal text-white/50">
                    {todayTotal > 0
                      ? `${todayReviewed}/${todayTotal} goals attempted`
                      : "No goals"}
                    {todayPending > 0 && ` • ${todayPending} pending`}
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
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Completed</div>
                  <div className="mt-1 sm:mt-1.5 text-xs font-normal text-white/50">
                    {todayTotal > 0
                      ? `${todayCompleted}/${todayTotal} completed`
                      : "No goals"}
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
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Streak</div>
                <div className="mt-2 sm:mt-3 text-2xl sm:text-3xl font-bold text-white">
                  {streak} {streak > 0 && "🔥"}
                </div>
                <div className="mt-1.5 text-xs font-normal text-white/50">
                  {streak > 0 ? "Keep it going" : "Close today to start a streak"}
                </div>
              </div>
            </div>

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
                    {pointsView === "total" ? "Total Points" : "Points Earned Today"}
                  </div>
                  <div className="text-[10px] text-white/40 flex-shrink-0">⇄</div>
                </div>
                <div className="mt-2 sm:mt-3 text-2xl sm:text-3xl font-bold text-white">
                  <AnimatedNumber value={pointsView === "total" ? profile?.points ?? 0 : todayPointsEarned} />
                </div>
                <div className="mt-1.5 text-xs font-normal text-white/50">
                  {pointsView === "total"
                    ? "Tap to see today's points"
                    : todayPointsEarned > 0
                    ? "Tap to see total points"
                    : "Review or close today to earn points"}
                </div>
              </div>
            </div>

            {/* Day Status */}
            <div
              className="card card-highlight stat-tile"
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Day Status</div>
                <div className="mt-2 sm:mt-3 text-lg sm:text-xl font-bold">
                  {todayClosed ? (
                    <span className="text-emerald-300">Closed ✓</span>
                  ) : (
                    <span className="text-amber-300">Active</span>
                  )}
                </div>
                <div className="mt-1.5 text-xs font-normal text-white/50">
                  {todayClosed ? "Tomorrow unlocked" : "Close to unlock Tomorrow"}
                </div>
              </div>
            </div>

            {/* Tomorrow's Plan Status */}
            <div
              className="card card-highlight stat-tile"
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Tomorrow's Plan</div>
                <div className="mt-2 sm:mt-3 text-lg sm:text-xl font-bold">
                  {tomorrowTotal === 0 ? (
                    <span className="text-white/50">Not started</span>
                  ) : tomorrowSubmitted ? (
                    <span className="text-emerald-300">Submitted ✓</span>
                  ) : (
                    <span className="text-amber-300">Pending</span>
                  )}
                </div>
                <div className="mt-1.5 text-xs font-normal text-white/50">
                  {tomorrowTotal === 0
                    ? "No goals drafted yet"
                    : tomorrowSubmitted
                    ? `${tomorrowTotal} goals set`
                    : `${tomorrowTotal} goals drafted`}
                </div>
              </div>
            </div>
          </div>
        </div>

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
                      P1 - Highest Priority
                    </span>
                    {!todayP1.reviewed_at && (
                      <span className="text-xs font-normal text-white/50">Pending review</span>
                    )}
                    {todayP1.reviewed_at && (
                      <span className="text-xs font-normal text-white/50">Reviewed ✓</span>
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
                    Status
                  </div>
                  <div className="mt-1 text-base font-semibold text-white">
                    {todayP1.status
                      .replace("_", " ")
                      .replace(/\b\w/g, (l) => l.toUpperCase())}
                  </div>
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
                <h2 className="text-lg font-semibold text-white">Today's Goals</h2>
                <span className="text-xs text-white/50">{formatDateDisplay(todayISO)}</span>
              </div>

              {sortedTodayGoals.length === 0 ? (
                <div className="text-white/60 text-sm py-8 text-center">
                  No goals for today
                  <div className="mt-2 text-xs text-white/50">
                    Set yesterday's plan to see goals here
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedTodayGoals.map((g, idx) => {
                    const reviewed = !!g.reviewed_at;
                    const priority = g.priority;

                    return (
                      <div
                        key={g.id}
                        className="goal-row-compact text-sm transition-all duration-300"
                        data-pending={!reviewed}
                        style={{
                          "--p-color": typeof priority === "number" ? getPriorityMeta(priority).color : "rgba(255,255,255,0.2)",
                        } as React.CSSProperties}
                      >
                        {/* Number + title only on this row — nothing else
                            competing for space, so it can never overflow no
                            matter how narrow the screen or long the title. */}
                        <div className="flex items-center gap-3">
                          <div className="goal-number-sm">{idx + 1}</div>
                          <div className="flex-1 min-w-0 truncate text-base font-medium text-white/90">{g.title}</div>
                        </div>

                        {/* Chips and note preview live on their own rows
                            below, indented to sit under the title, instead
                            of all fighting for space in one row — that's
                            what was forcing horizontal overflow. */}
                        <div className="mt-1.5 flex items-center gap-2" style={{ paddingLeft: "32px" }}>
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
                            title={reviewed ? `Reviewed — ${statusLabel(g.status)}` : "Pending review"}
                          >
                            {reviewed ? (
                              <>
                                <span>{statusLabel(g.status)}</span>
                                <span>{statusIcon(g.status)}</span>
                              </>
                            ) : (
                              <>
                                <span>Pending</span>
                                <span>⏳</span>
                              </>
                            )}
                          </div>
                        </div>

                        {noteCounts[g.id] > 0 && (
                          <div
                            className="mt-1.5 truncate text-xs text-cyan-300/80"
                            style={{ paddingLeft: "32px" }}
                            title={`${noteCounts[g.id]} note${noteCounts[g.id] > 1 ? "s" : ""}: ${latestNotes[g.id] ?? ""}`}
                          >
                            💬 {latestNotes[g.id]}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between text-xs text-white/60">
                <span>
                  {todayReviewed} reviewed • {todayCompleted} completed
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
                <h2 className="text-lg font-semibold text-white">Tomorrow's Plan</h2>
                <span className="text-xs text-white/50">{formatDateDisplay(tomorrowISO)}</span>
              </div>

              {sortedTomorrowGoals.length === 0 ? (
                <div className="text-white/60 text-sm py-8 text-center">
                  No plan for tomorrow yet
                  <div className="mt-2 text-xs text-white/50">
                    Set at least 3 goals to get started
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedTomorrowGoals.slice(0, 5).map((g, idx) => {
                    const priority = g.priority;

                    return (
                      <div
                        key={g.id}
                        className="goal-row-compact text-sm transition-all duration-300"
                        style={{
                          "--p-color": typeof priority === "number" ? getPriorityMeta(priority).color : "rgba(255,255,255,0.2)",
                        } as React.CSSProperties}
                      >
                        <div className="flex items-center gap-3">
                          <div className="goal-number-sm">{idx + 1}</div>
                          <div className="flex-1 min-w-0 truncate text-base font-medium text-white/90">{g.title}</div>
                        </div>

                        {typeof priority === "number" && (
                          <div className="mt-1.5" style={{ paddingLeft: "32px" }}>
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

                        {noteCounts[g.id] > 0 && (
                          <div
                            className="mt-1.5 truncate text-xs text-cyan-300/80"
                            style={{ paddingLeft: "32px" }}
                            title={`${noteCounts[g.id]} note${noteCounts[g.id] > 1 ? "s" : ""}: ${latestNotes[g.id] ?? ""}`}
                          >
                            💬 {latestNotes[g.id]}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {sortedTomorrowGoals.length > 5 && (
                    <div className="text-xs text-white/50 text-center py-1">
                      +{sortedTomorrowGoals.length - 5} more goals
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between text-xs text-white/60">
                <span>
                  {tomorrowTotal} goals{tomorrowSubmitted ? " • Submitted ✓" : " • Draft"}
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
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            {todayPending > 0 && (
              <Link href="/standup/today" className="btn btn-primary">
                ⚡ Review {todayPending} Pending Goal{todayPending > 1 ? "s" : ""}
              </Link>
            )}
            {!todayClosed && todayTotal > 0 && todayPending === 0 && (
              <Link href="/standup/today" className="btn btn-primary">
                ✅ Close Out Day
              </Link>
            )}
            {tomorrowTotal === 0 && (
              <Link href="/standup/tomorrow" className="btn btn-primary">
                🎯 Plan Tomorrow
              </Link>
            )}
            <Link href="/standup/today" className="btn">
              📋 Today's Goals
            </Link>
            <Link href="/standup/tomorrow" className="btn">
              📝 Tomorrow's Plan
            </Link>
          </div>
        </div>
      </div>
  );
}

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
  type Goal,
  type Profile,
  type DailyPlan,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusIcon, statusLabel, statusChipColors } from "@/lib/goalStatus";

/**
 * ✅ Reuse the "Tomorrow page" visual language:
 * - gradient backgrounds by "importance"
 * - stronger borders
 * - hover scale
 * - glass panels
 */

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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);

  const [todayPlan, setTodayPlan] = useState<DailyPlan | null>(null);
  const [todayGoals, setTodayGoals] = useState<Goal[]>([]);

  const [tomorrowPlan, setTomorrowPlan] = useState<DailyPlan | null>(null);
  const [tomorrowGoals, setTomorrowGoals] = useState<Goal[]>([]);
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [latestNotes, setLatestNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const p = await getOrCreateProfile();
        setProfile(p);

        const s = await getStreak();
        setStreak(s);

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
  }, [todayISO, tomorrowISO]);

  if (loading) {
    return <div className="card">Loading dashboard...</div>;
  }

  // Today stats
  const todayP1 = todayGoals.find((g) => g.priority === 1);
  const todayPending = todayGoals.filter((g) => !g.reviewed_at).length;
  const todayReviewed = todayGoals.filter((g) => !!g.reviewed_at).length;
  const todayTotal = todayGoals.length;
  const todayCompleted = todayGoals.filter((g) => g.status === "completed").length;
  const todayClosed = !!todayPlan?.reviewed_at;

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

  return (
    <div className="space-y-6">
      {/* ✅ Header + widgets INSIDE one "main card" (Tomorrow-style) */}
        <div
          className="card"
          style={{
            background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
            border: "2px solid hsla(96, 91%, 49%, 0.69)",
            boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
          }}
        >
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold">Dashboard</h1>
              <p className="mt-2 text-white/70">Your daily execution overview</p>
            </div>

            <div className="hidden sm:flex gap-2">
              <Link href="/standup/today" className="btn">
                Review Today
              </Link>
              <Link href="/standup/tomorrow" className="btn">
                Plan Tomorrow
              </Link>
            </div>
          </div>

          {/* ✅ Widgets side-by-side (Tomorrow-like gradient tiles) */}
          <div className="mt-6 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {/* Streak */}
            <div
              className="card"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
                border: "1px solid hsla(0, 91%, 49%, 0.72)",
                boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
              }}
            >
              <div className="p-4">
                <div className="text-sm text-white/70">Streak</div>
                <div className="mt-2 text-3xl font-bold">
                  {streak} {streak > 0 && "🔥"}
                </div>
                <div className="mt-1 text-xs text-white/50">
                  {streak > 0 ? "Keep it going" : "Close today to start a streak"}
                </div>
              </div>
            </div>

            {/* Total Points */}
            <div
              className="card"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
                border: "1px solid hsla(0, 91%, 49%, 0.72)",
                boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
              }}
            >
              <div className="p-4">
                <div className="text-sm text-white/70">Total Points</div>
                <div className="mt-2 text-3xl font-bold">{profile?.points ?? 0}</div>
                <div className="mt-1 text-xs text-white/50">Keep building consistency</div>
              </div>
            </div>

            {/* Today's Progress */}
            <div
              className="card"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
                border: "1px solid hsla(0, 91%, 49%, 0.72)",
                boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
              }}
            >
              <div className="p-4">
                <div className="text-sm text-white/70">Today's Progress</div>
                <div className="mt-2 text-3xl font-bold">
                  {todayReviewed}/{todayTotal}
                </div>
                <div className="mt-1 text-xs text-white/50">
                  {todayPending > 0 ? `${todayPending} pending review` : "All reviewed!"}
                </div>
              </div>
            </div>

            {/* Completed Today */}
            <div
              className="card"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
                border: "1px solid hsla(0, 91%, 49%, 0.72)",
                boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
              }}
            >
              <div className="p-4">
                <div className="text-sm text-white/70">Completed Today</div>
                <div className="mt-2 text-3xl font-bold">{todayCompleted}</div>
                <div className="mt-1 text-xs text-white/50">
                  {todayTotal > 0
                    ? `${Math.round((todayCompleted / todayTotal) * 100)}% done`
                    : "No goals"}
                </div>
              </div>
            </div>

            {/* Day Status */}
            <div
              className="card"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
                border: "1px solid hsla(0, 91%, 49%, 0.72)",
                boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
              }}
            >
              <div className="p-4">
                <div className="text-sm text-white/70">Day Status</div>
                <div className="mt-2 text-xl font-bold">
                  {todayClosed ? (
                    <span className="text-emerald-300">Closed ✓</span>
                  ) : (
                    <span className="text-amber-300">Active</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-white/50">
                  {todayClosed ? "Tomorrow unlocked" : "Close to unlock Tomorrow"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ✅ P1 Goal Highlight (use Tomorrow-like stronger red styling) */}
        {todayP1 && (
          <Link href="/standup/today" className="block">
            <div
              className="card transition-all duration-300 hover:scale-[1.005] cursor-pointer"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
                border: "2px solid hsla(96, 91%, 49%, 0.69)",
                boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                      P1 - Highest Priority
                    </span>
                    {!todayP1.reviewed_at && (
                      <span className="text-xs text-white/50">Pending review</span>
                    )}
                    {todayP1.reviewed_at && (
                      <span className="text-xs text-white/60">Reviewed ✓</span>
                    )}
                  </div>

                  <div className="mt-3 text-xl font-semibold text-white">{todayP1.title}</div>

                  {todayP1.details && (
                    <div className="mt-2 text-sm text-white/70">{todayP1.details}</div>
                  )}

                  <div className="mt-3 text-sm text-white/60">
                    Status:{" "}
                    <span className="font-medium text-white">
                      {todayP1.status
                        .replace("_", " ")
                        .replace(/\b\w/g, (l) => l.toUpperCase())}
                    </span>
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
          <Link href="/standup/today" className="block">
            <div
              className="card transition cursor-pointer h-full"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
                border: "2px solid hsla(96, 91%, 49%, 0.69)",
                boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
              }}
            >
              <div className="flex items-center justify-between mb-4">
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
                <div className="space-y-2">
                  {sortedTodayGoals.map((g, idx) => {
                    const reviewed = !!g.reviewed_at;
                    const priority = g.priority;

                    return (
                      <div
                        key={g.id}
                        className="goal-row-compact flex items-center gap-3 text-sm transition-all duration-300"
                        data-pending={!reviewed}
                        style={{
                          "--p-color": typeof priority === "number" ? getPriorityMeta(priority).color : "rgba(255,255,255,0.2)",
                        } as React.CSSProperties}
                      >
                        <div className="goal-number-sm">{idx + 1}</div>

                        <div className="flex-1 truncate text-white/90">{g.title}</div>

                        {noteCounts[g.id] > 0 && (
                          <div
                            className="text-xs text-cyan-300/80 truncate"
                            style={{ maxWidth: "140px", flexShrink: 1, minWidth: 0 }}
                            title={`${noteCounts[g.id]} note${noteCounts[g.id] > 1 ? "s" : ""}: ${latestNotes[g.id] ?? ""}`}
                          >
                            💬 {latestNotes[g.id]}
                          </div>
                        )}

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
          <Link href="/standup/tomorrow" className="block">
            <div
              className="card transition cursor-pointer h-full"
              style={{
                background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
                border: "2px solid hsla(96, 91%, 49%, 0.69)",
                boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
              }}
            >
              <div className="flex items-center justify-between mb-4">
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
                <div className="space-y-2">
                  {sortedTomorrowGoals.slice(0, 5).map((g, idx) => {
                    const priority = g.priority;

                    return (
                      <div
                        key={g.id}
                        className="goal-row-compact flex items-center gap-3 text-sm transition-all duration-300"
                        style={{
                          "--p-color": typeof priority === "number" ? getPriorityMeta(priority).color : "rgba(255,255,255,0.2)",
                        } as React.CSSProperties}
                      >
                        <div className="goal-number-sm">{idx + 1}</div>

                        <div className="flex-1 truncate text-white/90">{g.title}</div>

                        {noteCounts[g.id] > 0 && (
                          <div
                            className="text-xs text-cyan-300/80 truncate"
                            style={{ maxWidth: "140px", flexShrink: 1, minWidth: 0 }}
                            title={`${noteCounts[g.id]} note${noteCounts[g.id] > 1 ? "s" : ""}: ${latestNotes[g.id] ?? ""}`}
                          >
                            💬 {latestNotes[g.id]}
                          </div>
                        )}

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
          className="card"
          style={{
            background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10), rgba(59, 130, 246, 0.06))",
            border: "2px solid hsla(96, 91%, 49%, 0.69)",
            boxShadow: "0 18px 60px rgba(114, 32, 32, 0.47)",
          }}
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

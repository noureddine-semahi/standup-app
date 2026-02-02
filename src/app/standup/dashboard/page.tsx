"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import {
  toISODate,
  addDays,
  getPlanWithGoals,
  getOrCreateProfile,
  type Goal,
  type Profile,
  type DailyPlan,
} from "@/lib/supabase/db";

export default function DashboardPage() {
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [todayPlan, setTodayPlan] = useState<DailyPlan | null>(null);
  const [todayGoals, setTodayGoals] = useState<Goal[]>([]);
  const [tomorrowPlan, setTomorrowPlan] = useState<DailyPlan | null>(null);
  const [tomorrowGoals, setTomorrowGoals] = useState<Goal[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const p = await getOrCreateProfile();
        setProfile(p);

        const { plan: todayP, goals: todayG } = await getPlanWithGoals(todayISO);
        setTodayPlan(todayP);
        setTodayGoals(todayG);

        const { plan: tomorrowP, goals: tomorrowG } = await getPlanWithGoals(tomorrowISO);
        setTomorrowPlan(tomorrowP);
        setTomorrowGoals(tomorrowG);
      } catch (error) {
        console.error("Dashboard load error:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [todayISO, tomorrowISO]);

  if (loading) {
    return (
      <AuthGate>
        <div className="card">Loading dashboard...</div>
      </AuthGate>
    );
  }

  // Today stats
  const todayP1 = todayGoals.find((g) => (g as any).priority === 1);
  const todayPending = todayGoals.filter((g) => !(g as any).reviewed_at).length;
  const todayReviewed = todayGoals.filter((g) => !!(g as any).reviewed_at).length;
  const todayTotal = todayGoals.length;
  const todayCompleted = todayGoals.filter((g) => g.status === "completed").length;
  const todayClosed = !!todayPlan?.reviewed_at;

  // Tomorrow stats
  const tomorrowTotal = tomorrowGoals.length;
  const tomorrowSubmitted = tomorrowPlan?.status === "submitted";

  // Sort goals by priority
  const sortGoals = (goals: Goal[]) => {
    return [...goals].sort((a, b) => {
      const ap = typeof (a as any).priority === "number" ? (a as any).priority : 999;
      const bp = typeof (b as any).priority === "number" ? (b as any).priority : 999;
      if (ap !== bp) return ap - bp;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  };

  const sortedTodayGoals = sortGoals(todayGoals);
  const sortedTomorrowGoals = sortGoals(tomorrowGoals);

  return (
    <AuthGate>
      <div className="space-y-6">
        {/* Header */}
        <div className="card">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="mt-2 text-white/70">Your daily execution overview</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card">
            <div className="text-sm text-white/60">Total Points</div>
            <div className="mt-2 text-3xl font-bold">{profile?.points ?? 0}</div>
            <div className="mt-1 text-xs text-white/50">Keep building consistency</div>
          </div>

          <div className="card">
            <div className="text-sm text-white/60">Today's Progress</div>
            <div className="mt-2 text-3xl font-bold">
              {todayReviewed}/{todayTotal}
            </div>
            <div className="mt-1 text-xs text-white/50">
              {todayPending > 0 ? `${todayPending} pending review` : "All reviewed!"}
            </div>
          </div>

          <div className="card">
            <div className="text-sm text-white/60">Completed Today</div>
            <div className="mt-2 text-3xl font-bold">{todayCompleted}</div>
            <div className="mt-1 text-xs text-white/50">
              {todayTotal > 0 ? `${Math.round((todayCompleted / todayTotal) * 100)}% done` : "No goals"}
            </div>
          </div>

          <div className="card">
            <div className="text-sm text-white/60">Day Status</div>
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

        {/* P1 Goal Highlight */}
        {todayP1 && (
          <Link href="/standup/today" className="block">
            <div className="card border-red-500/30 bg-red-500/5 hover:bg-red-500/10 transition cursor-pointer">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                      P1 - Highest Priority
                    </span>
                    {!(todayP1 as any).reviewed_at && (
                      <span className="text-xs text-white/50">Pending review</span>
                    )}
                    {(todayP1 as any).reviewed_at && (
                      <span className="text-xs text-white/60">Reviewed ✓</span>
                    )}
                  </div>
                  <div className="mt-3 text-xl font-semibold">{todayP1.title}</div>
                  {todayP1.details && (
                    <div className="mt-2 text-sm text-white/70">{todayP1.details}</div>
                  )}
                  <div className="mt-3 text-sm text-white/60">
                    Status:{" "}
                    <span className="font-medium">
                      {todayP1.status.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                    </span>
                  </div>
                </div>
                <div className="text-white/50">→</div>
              </div>
            </div>
          </Link>
        )}

        {/* Today & Tomorrow Overview Grid */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Today Overview */}
          <Link href="/standup/today" className="block">
            <div className="card hover:border-white/20 transition cursor-pointer h-full">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Today's Goals</h2>
                <span className="text-xs text-white/50">{todayISO}</span>
              </div>

              {sortedTodayGoals.length === 0 ? (
                <div className="text-white/60 text-sm py-8 text-center">
                  No goals for today
                  <div className="mt-2 text-xs text-white/50">Set yesterday's plan to see goals here</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedTodayGoals.map((g, idx) => {
                    const reviewed = !!(g as any).reviewed_at;
                    const priority = (g as any).priority;

                    return (
                      <div
                        key={g.id}
                        className={[
                          "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                          reviewed
                            ? "border-white/10 bg-white/5"
                            : "border-white/10 bg-white/3 border-dashed opacity-80",
                        ].join(" ")}
                      >
                        <div className="text-white/60 w-6">{idx + 1}.</div>
                        {typeof priority === "number" && priority <= 3 && (
                          <span
                            className={[
                              "rounded-full border px-2 py-0.5 text-xs font-semibold",
                              priority === 1
                                ? "bg-red-500/15 text-red-300 border-red-500/30"
                                : priority === 2
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                : "bg-white/10 text-white/70 border-white/20",
                            ].join(" ")}
                          >
                            P{priority}
                          </span>
                        )}
                        <div className="flex-1 truncate">{g.title}</div>
                        <div className="text-xs text-white/50">
                          {g.status === "completed"
                            ? "✅"
                            : g.status === "in_progress"
                            ? "🔄"
                            : g.status === "blocked"
                            ? "🚫"
                            : reviewed
                            ? "👁️"
                            : "⏸️"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between text-xs text-white/60">
                <span>{todayReviewed} reviewed • {todayCompleted} completed</span>
                <span className="text-white/50">→</span>
              </div>
            </div>
          </Link>

          {/* Tomorrow Overview */}
          <Link href="/standup/tomorrow" className="block">
            <div className="card hover:border-white/20 transition cursor-pointer h-full">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Tomorrow's Plan</h2>
                <span className="text-xs text-white/50">{tomorrowISO}</span>
              </div>

              {sortedTomorrowGoals.length === 0 ? (
                <div className="text-white/60 text-sm py-8 text-center">
                  No plan for tomorrow yet
                  <div className="mt-2 text-xs text-white/50">Set at least 3 goals to get started</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedTomorrowGoals.slice(0, 5).map((g, idx) => {
                    const priority = (g as any).priority;

                    return (
                      <div
                        key={g.id}
                        className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                      >
                        <div className="text-white/60 w-6">{idx + 1}.</div>
                        {typeof priority === "number" && priority <= 3 && (
                          <span
                            className={[
                              "rounded-full border px-2 py-0.5 text-xs font-semibold",
                              priority === 1
                                ? "bg-red-500/15 text-red-300 border-red-500/30"
                                : priority === 2
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                : "bg-white/10 text-white/70 border-white/20",
                            ].join(" ")}
                          >
                            P{priority}
                          </span>
                        )}
                        <div className="flex-1 truncate">{g.title}</div>
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

        {/* Quick Actions */}
        <div className="card">
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
    </AuthGate>
  );
}


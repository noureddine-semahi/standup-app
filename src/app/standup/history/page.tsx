"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getOrCreateProfile,
  getPointsHistory,
  getDailyActivity,
  getLifetimeStats,
  getGoalsByFilter,
  getNotesForGoals,
  formatDateDisplay,
  toISODate,
  addDays,
  type Profile,
  type PointsHistoryEntry,
  type DayActivity,
  type LifetimeStats,
  type ArchivedGoal,
} from "@/lib/supabase/db";
import AnimatedNumber from "@/components/AnimatedNumber";
import GoalTimeline from "@/components/GoalTimeline";
import { buildGoalTimeline } from "@/lib/goalTimeline";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusLabel, statusIcon, statusChipColors } from "@/lib/goalStatus";

type ActivityPeriod = "week" | "month";
type GoalListFilter = "completed" | "submitted";

export default function HistoryPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<PointsHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats | null>(null);

  const [period, setPeriod] = useState<ActivityPeriod>("week");
  const [activity, setActivity] = useState<DayActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Drill-down opened by clicking the "Goals submitted"/"Goals completed"
  // tiles below — lists every matching goal with its full history/notes.
  const [goalListFilter, setGoalListFilter] = useState<GoalListFilter | null>(null);
  const [goalList, setGoalList] = useState<ArchivedGoal[]>([]);
  const [goalNotesMap, setGoalNotesMap] = useState<Record<string, any[]>>({});
  const [goalListLoading, setGoalListLoading] = useState(false);
  const [goalListError, setGoalListError] = useState<string | null>(null);

  async function openGoalList(filter: GoalListFilter) {
    setGoalListFilter(filter);
    setGoalListLoading(true);
    setGoalListError(null);
    try {
      const goals = await getGoalsByFilter(filter);
      setGoalList(goals);
      const notes = await getNotesForGoals(goals.map((g) => g.id));
      setGoalNotesMap(notes);
    } catch (e: any) {
      setGoalListError(e?.message ?? "Failed to load goals");
    } finally {
      setGoalListLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [p, history, stats] = await Promise.all([
          getOrCreateProfile(),
          getPointsHistory(),
          getLifetimeStats(),
        ]);
        setProfile(p);
        setEntries(history);
        setLifetimeStats(stats);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load history");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    async function loadActivity() {
      setActivityLoading(true);
      setActivityError(null);
      try {
        const days = period === "week" ? 7 : 30;
        const endISO = toISODate(new Date());
        const startISO = toISODate(addDays(new Date(), -(days - 1)));
        const data = await getDailyActivity(startISO, endISO);
        setActivity(data);
      } catch (e: any) {
        setActivityError(e?.message ?? "Failed to load activity");
      } finally {
        setActivityLoading(false);
      }
    }
    loadActivity();
  }, [period]);

  if (loading) {
    return <div className="card">Loading history…</div>;
  }

  const checkedInDays = activity.filter((d) => d.checkedIn).length;
  const missedDays = activity.length - checkedInDays;
  const accomplishedDays = activity.filter((d) => d.goalsCompleted > 0).length;
  const maxCompleted = Math.max(1, ...activity.map((d) => d.goalsCompleted));

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Data &amp; Metrics</h1>
            <p className="mt-2 text-white/70">Your goals, streaks, and points, all in one place.</p>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
              Total Points
            </div>
            <div className="mt-1 text-3xl font-bold text-white">
              <AnimatedNumber value={profile?.points ?? 0} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-1">Goals &amp; Streaks</h2>
        <p className="text-sm text-white/60 mb-4">Lifetime totals across every day you've used StandUp.</p>

        {lifetimeStats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => openGoalList("submitted")}
              className="rounded-2xl bg-white/5 p-4 text-center hover:bg-white/10 transition text-left"
              style={{
                border: goalListFilter === "submitted" ? "1px solid rgba(245, 158, 11, 0.5)" : "1px solid transparent",
              }}
            >
              <div className="text-2xl font-bold text-white">{lifetimeStats.totalGoalsSubmitted}</div>
              <div className="mt-1 text-xs text-white/60">Goals submitted</div>
            </button>
            <button
              type="button"
              onClick={() => openGoalList("completed")}
              className="rounded-2xl bg-white/5 p-4 text-center hover:bg-white/10 transition text-left"
              style={{
                border: goalListFilter === "completed" ? "1px solid rgba(245, 158, 11, 0.5)" : "1px solid transparent",
              }}
            >
              <div className="text-2xl font-bold text-emerald-300">{lifetimeStats.totalGoalsCompleted}</div>
              <div className="mt-1 text-xs text-white/60">Goals completed</div>
            </button>
            <div className="rounded-2xl bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-amber-300">{lifetimeStats.totalDaysClosed}</div>
              <div className="mt-1 text-xs text-white/60">Days closed</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-sky-300">{lifetimeStats.longestStreak}</div>
              <div className="mt-1 text-xs text-white/60">Longest streak</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-white">{lifetimeStats.maxGoalsCompletedInDay}</div>
              <div className="mt-1 text-xs text-white/60">Best single day</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-white">{lifetimeStats.reschedulesCompleted}</div>
              <div className="mt-1 text-xs text-white/60">Reschedules followed through</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-white">{lifetimeStats.trackedGoalsCompleted}</div>
              <div className="mt-1 text-xs text-white/60">Tracked goals completed</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4 text-center">
              <div className="text-2xl font-bold text-white">{lifetimeStats.totalReferrals}</div>
              <div className="mt-1 text-xs text-white/60">Successful referrals</div>
            </div>
          </div>
        )}
      </div>

      {goalListFilter && (
        <div className="card">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {goalListFilter === "completed" ? "Completed Goals" : "Submitted Goals"}
              </h2>
              <p className="mt-1 text-sm text-white/60">
                {goalList.length} goal{goalList.length === 1 ? "" : "s"}, newest first — each with its full
                history and notes.
              </p>
            </div>
            <button type="button" className="btn" onClick={() => setGoalListFilter(null)}>
              ✕ Close
            </button>
          </div>

          {goalListError && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {goalListError}
            </div>
          )}

          {!goalListError && goalListLoading && (
            <div className="text-white/60 text-sm text-center py-8">Loading goals…</div>
          )}

          {!goalListError && !goalListLoading && goalList.length === 0 && (
            <div className="text-white/60 text-sm text-center py-8">Nothing here yet.</div>
          )}

          {!goalListError && !goalListLoading && goalList.length > 0 && (
            <div className="space-y-3">
              {goalList.map((g) => {
                const p = typeof g.priority === "number" ? g.priority : 3;
                const status = g.status ?? "not_started";
                return (
                  <div
                    key={g.id}
                    className="goal-row"
                    style={{ "--p-color": getPriorityMeta(p).color } as React.CSSProperties}
                  >
                    <div className="text-xs text-white/50 mb-1">
                      {g.plan_date ? formatDateDisplay(g.plan_date) : "Unknown date"}
                    </div>
                    <div className="text-lg font-semibold text-white">{g.title}</div>
                    {g.details && <div className="mt-1 text-sm text-white/60">{g.details}</div>}
                    <GoalTimeline
                      entries={buildGoalTimeline(g, goalNotesMap[g.id] ?? [])}
                      defaultExpanded={false}
                    />
                    <div className="mt-3">
                      <div
                        className="status-chip"
                        style={{
                          "--chip-bg": statusChipColors(status).bg,
                          "--chip-border": statusChipColors(status).border,
                          "--chip-color": statusChipColors(status).color,
                        } as React.CSSProperties}
                      >
                        <span>{statusIcon(status)}</span>
                        <span>{statusLabel(status)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-white/90 mb-3">Points &amp; Usage</h2>
      </div>

      <div className="card">
        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!error && entries.length === 0 && (
          <div className="text-white/60 text-sm py-8 text-center">
            No points earned yet — review your goals and close out a day to start building history.
          </div>
        )}

        {entries.length > 0 && (
          <div className="space-y-3">
            {entries.map((entry) => {
              const total = (entry.awarenessAwarded ? entry.awarenessPoints : 0) +
                (entry.closureAwarded ? entry.closurePoints : 0) +
                (entry.planningAwarded ? entry.planningPoints : 0);

              return (
                <div
                  key={entry.planDate}
                  className="flex items-center justify-between gap-4 rounded-2xl bg-white/5 px-4 py-3"
                  style={{ minHeight: "64px" }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">
                      {formatDateDisplay(entry.planDate)}
                    </div>
                    <div className="mt-1 flex flex-nowrap gap-x-3 text-xs text-white/60 overflow-x-auto">
                      {entry.planningAwarded && (
                        <span className="whitespace-nowrap">Planning +{entry.planningPoints}</span>
                      )}
                      {entry.awarenessAwarded && (
                        <span className="whitespace-nowrap">Awareness +{entry.awarenessPoints}</span>
                      )}
                      {entry.closureAwarded && (
                        <span className="whitespace-nowrap">Closure +{entry.closurePoints}</span>
                      )}
                      {entry.reviewedAt && (
                        <span className="whitespace-nowrap text-emerald-300/80">Day closed ✓</span>
                      )}
                    </div>
                  </div>
                  <div className="text-lg font-bold text-white whitespace-nowrap">+{total}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white">Activity Overview</h2>
            <p className="mt-1 text-sm text-white/60">Check-ins, misses, and completed goals over time.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPeriod("week")}
              className="btn"
              style={{
                background: period === "week" ? "rgba(245, 158, 11, 0.25)" : undefined,
                borderColor: period === "week" ? "rgba(245, 158, 11, 0.6)" : undefined,
              }}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => setPeriod("month")}
              className="btn"
              style={{
                background: period === "month" ? "rgba(245, 158, 11, 0.25)" : undefined,
                borderColor: period === "month" ? "rgba(245, 158, 11, 0.6)" : undefined,
              }}
            >
              Monthly
            </button>
          </div>
        </div>

        {activityError && (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {activityError}
          </div>
        )}

        {!activityError && activityLoading && (
          <div className="mt-6 text-white/60 text-sm text-center py-6">Loading activity…</div>
        )}

        {!activityError && !activityLoading && (
          <>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white/5 p-4 text-center">
                <div className="text-2xl font-bold text-emerald-300">{checkedInDays}</div>
                <div className="mt-1 text-xs text-white/60">Days checked in</div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 text-center">
                <div className="text-2xl font-bold text-amber-300">{missedDays}</div>
                <div className="mt-1 text-xs text-white/60">Days missed</div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 text-center">
                <div className="text-2xl font-bold text-sky-300">{accomplishedDays}</div>
                <div className="mt-1 text-xs text-white/60">Days with completed goals</div>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ height: "120px" }}>
                {activity.map((day) => {
                  const barHeightPct = day.goalsCompleted > 0
                    ? Math.max(14, (day.goalsCompleted / maxCompleted) * 100)
                    : 10;

                  const state = day.checkedIn ? "checkedIn" : day.hasPlan ? "notClosed" : "missed";
                  const color = day.checkedIn
                    ? { top: "#34d399", bottom: "#059669" }
                    : day.hasPlan
                    ? { top: "#fbbf24", bottom: "#d97706" }
                    : { top: "rgba(255,255,255,0.22)", bottom: "rgba(255,255,255,0.08)" };
                  const mark = day.checkedIn ? "✓" : day.hasPlan ? "•" : "✕";

                  return (
                    <div
                      key={day.date}
                      className="flex-1 flex flex-col items-center justify-end"
                      style={{ minWidth: period === "week" ? "28px" : "8px", height: "100%" }}
                      title={`${formatDateDisplay(day.date)} — ${
                        day.checkedIn ? "Checked in" : day.hasPlan ? "Not closed" : "Missed"
                      }, ${day.goalsCompleted}/${day.goalsTotal} goals completed`}
                    >
                      {period === "week" && (
                        <div
                          className="text-[10px] leading-none mb-1"
                          style={{
                            color: state === "checkedIn" ? "#34d399" : state === "notClosed" ? "#fbbf24" : "rgba(255,255,255,0.4)",
                          }}
                        >
                          {mark}
                        </div>
                      )}
                      <div
                        className="w-full rounded-md transition-transform duration-200 hover:scale-x-125"
                        style={{
                          height: `${barHeightPct}%`,
                          background: `linear-gradient(180deg, ${color.top}, ${color.bottom})`,
                          border: "1.5px solid rgba(0, 0, 0, 0.55)",
                          boxShadow: "0 2px 6px rgba(0, 0, 0, 0.35)",
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Key — colors + symbols, so the three states read clearly even without color */}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <div
                  className="flex items-center gap-2 rounded-full px-3 py-1.5"
                  style={{ background: "rgba(16, 185, 129, 0.12)", border: "1px solid rgba(0,0,0,0.55)" }}
                >
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded-sm text-[10px] font-bold text-black"
                    style={{ background: "linear-gradient(180deg, #34d399, #059669)", border: "1px solid rgba(0,0,0,0.55)" }}
                  >
                    ✓
                  </span>
                  <span className="text-white/70">Checked in</span>
                </div>
                <div
                  className="flex items-center gap-2 rounded-full px-3 py-1.5"
                  style={{ background: "rgba(245, 158, 11, 0.10)", border: "1px solid rgba(0,0,0,0.55)" }}
                >
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded-sm text-[10px] font-bold text-black"
                    style={{ background: "linear-gradient(180deg, #fbbf24, #d97706)", border: "1px solid rgba(0,0,0,0.55)" }}
                  >
                    •
                  </span>
                  <span className="text-white/70">Not closed</span>
                </div>
                <div
                  className="flex items-center gap-2 rounded-full px-3 py-1.5"
                  style={{ background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(0,0,0,0.55)" }}
                >
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded-sm text-[10px] font-bold text-white/70"
                    style={{ background: "rgba(255, 255, 255, 0.15)", border: "1px solid rgba(0,0,0,0.55)" }}
                  >
                    ✕
                  </span>
                  <span className="text-white/70">Missed</span>
                </div>
                <div className="ml-auto text-white/40">Bar height = goals completed that day</div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <Link href="/standup/profile" className="btn">
          ← Back to Profile
        </Link>
      </div>
    </div>
  );
}

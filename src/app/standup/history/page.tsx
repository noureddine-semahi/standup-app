"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getOrCreateProfile,
  getPointsHistory,
  getDailyActivity,
  formatDateDisplay,
  toISODate,
  addDays,
  type Profile,
  type PointsHistoryEntry,
  type DayActivity,
} from "@/lib/supabase/db";
import AnimatedNumber from "@/components/AnimatedNumber";

type ActivityPeriod = "week" | "month";

export default function HistoryPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<PointsHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<ActivityPeriod>("week");
  const [activity, setActivity] = useState<DayActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [p, history] = await Promise.all([getOrCreateProfile(), getPointsHistory()]);
        setProfile(p);
        setEntries(history);
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Points &amp; Usage History</h1>
            <p className="mt-2 text-white/70">A day-by-day record of the points you've earned.</p>
          </div>
          <div className="text-right">
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
                (entry.closureAwarded ? entry.closurePoints : 0);

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
                background: period === "week" ? "rgba(168, 85, 247, 0.25)" : undefined,
                borderColor: period === "week" ? "rgba(168, 85, 247, 0.6)" : undefined,
              }}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => setPeriod("month")}
              className="btn"
              style={{
                background: period === "month" ? "rgba(168, 85, 247, 0.25)" : undefined,
                borderColor: period === "month" ? "rgba(168, 85, 247, 0.6)" : undefined,
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
            <div className="mt-6 grid grid-cols-3 gap-3">
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

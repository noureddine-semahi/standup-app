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
  getConceptualTaskAnalytics,
  getStreak,
  getOutcomeGoals,
  getCycleHistoryForOutcomeGoal,
  formatDateDisplay,
  toISODate,
  addDays,
  type Profile,
  type PointsHistoryEntry,
  type DayActivity,
  type LifetimeStats,
  type ArchivedGoal,
  type ConceptualTaskAnalytics,
  type OutcomeGoal,
  type OutcomeGoalCycleWithAggregation,
  type CycleResultStatus,
} from "@/lib/supabase/db";
import { getTargetProgress, formatTargetProgress, getRecurringCurrentCycleView } from "@/lib/goalProgress";
import AnimatedNumber from "@/components/AnimatedNumber";
import PageLoadingState from "@/components/PageLoadingState";
import GoalTimeline from "@/components/GoalTimeline";
import { buildGoalTimeline } from "@/lib/goalTimeline";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import { Check, Dot, X, Target as TargetIcon, Repeat } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";

type ActivityPeriod = "week" | "month";

// Same small per-page lookup Dashboard/Goal Detail/Today each keep
// independently (see RECURRING_RESULT_LABEL_KEY's own comment on
// Dashboard) rather than a new shared export -- "in_progress" is
// presentation-only (getRecurringCurrentCycleView), never stored.
const RECURRING_RESULT_LABEL_KEY: Record<Exclude<CycleResultStatus, "unconfigured"> | "in_progress", TranslationKey> = {
  achieved: "recurringProgress.resultAchieved",
  partial: "recurringProgress.resultPartial",
  missed: "recurringProgress.resultMissed",
  no_commitments: "recurringProgress.resultNoCommitments",
  in_progress: "recurringProgress.resultInProgress",
};

// Follow-Through Rate and the per-priority rate share this: null means
// "nothing resolved yet" (see ConceptualTaskAnalytics.completionRate's
// own doc comment), displayed as "—" rather than a misleading 0%.
function formatRate(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

export default function HistoryPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<PointsHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats | null>(null);
  const [taskAnalytics, setTaskAnalytics] = useState<ConceptualTaskAnalytics | null>(null);
  const [streak, setStreak] = useState(0);
  const [outcomeGoals, setOutcomeGoals] = useState<OutcomeGoal[]>([]);
  const [cycleHistoryByGoalId, setCycleHistoryByGoalId] = useState<Map<string, OutcomeGoalCycleWithAggregation[]>>(
    new Map()
  );

  const [period, setPeriod] = useState<ActivityPeriod>("week");
  const [activity, setActivity] = useState<DayActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Drill-down opened by "Browse completed Tasks" below — lists every
  // completed goal row with its full history/notes. The old "submitted"
  // side of this (raw, ungated goals-row count) is gone; see Phase B's
  // report for why that KPI was removed rather than kept as a trigger.
  const [goalListOpen, setGoalListOpen] = useState(false);
  const [goalList, setGoalList] = useState<ArchivedGoal[]>([]);
  const [goalNotesMap, setGoalNotesMap] = useState<Record<string, any[]>>({});
  const [goalListLoading, setGoalListLoading] = useState(false);
  const [goalListError, setGoalListError] = useState<string | null>(null);

  async function openCompletedGoalList() {
    setGoalListOpen(true);
    setGoalListLoading(true);
    setGoalListError(null);
    try {
      const goals = await getGoalsByFilter("completed");
      setGoalList(goals);
      const notes = await getNotesForGoals(goals.map((g) => g.id));
      setGoalNotesMap(notes);
    } catch (e: any) {
      setGoalListError(e?.message ?? t("history.failedLoadGoals"));
    } finally {
      setGoalListLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [p, history, stats, analytics, currentStreak, goals] = await Promise.all([
          getOrCreateProfile(),
          getPointsHistory(),
          getLifetimeStats(),
          getConceptualTaskAnalytics(),
          getStreak(),
          getOutcomeGoals(),
        ]);
        setProfile(p);
        setEntries(history);
        setLifetimeStats(stats);
        setTaskAnalytics(analytics);
        setStreak(currentStreak);

        const active = goals.filter((g) => g.status === "active");
        setOutcomeGoals(active);

        // Only active Recurring Goals get a cycle-history fetch -- same
        // scoping Dashboard's own loadCycleHistories uses. Read-only:
        // getCycleHistoryForOutcomeGoal never creates a cycle just by
        // being called here.
        const recurringActive = active.filter((g) => g.goal_type === "recurring");
        if (recurringActive.length > 0) {
          const histories = await Promise.all(
            recurringActive.map((g) =>
              getCycleHistoryForOutcomeGoal(g.id).catch(() => [] as OutcomeGoalCycleWithAggregation[])
            )
          );
          setCycleHistoryByGoalId(new Map(recurringActive.map((g, i) => [g.id, histories[i]])));
        }
      } catch (e: any) {
        setError(e?.message ?? t("history.failedLoadHistory"));
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
        setActivityError(e?.message ?? t("history.failedLoadActivity"));
      } finally {
        setActivityLoading(false);
      }
    }
    loadActivity();
  }, [period]);

  if (loading) {
    return <PageLoadingState label={t("history.loading")} />;
  }

  const checkedInDays = activity.filter((d) => d.checkedIn).length;
  const missedDays = activity.length - checkedInDays;
  const accomplishedDays = activity.filter((d) => d.goalsCompleted > 0).length;
  const maxCompleted = Math.max(1, ...activity.map((d) => d.goalsCompleted));

  const todayISO = toISODate(new Date());
  const targetGoals = outcomeGoals.filter((g) => g.goal_type === "target");
  const recurringGoals = outcomeGoals.filter((g) => g.goal_type === "recurring");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <h1 className="text-3xl font-bold">{t("history.title")}</h1>
        <p className="mt-2 text-white/70">{t("history.subtitle")}</p>
      </div>

      {/* A. OVERVIEW */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-1">{t("history.overviewTitle")}</h2>
        <p className="text-sm text-white/60 mb-4">{t("history.overviewSubtitle")}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Follow-Through Rate carries the primary performance insight,
              so it's the one KPI tinted via --metal-color (same opt-in
              .metal-surface already supports) and given the larger
              number -- same tile size/grid position as the other three,
              not a layout change. */}
          <div className="rounded-2xl p-4 metal-surface text-center" style={{ "--metal-color": "#f59e0b" } as React.CSSProperties}>
            <div className="text-3xl font-bold text-amber-300">
              {taskAnalytics ? formatRate(taskAnalytics.completionRate) : "—"}
            </div>
            <div className="mt-1 text-xs font-semibold text-white/70">{t("history.followThroughRate")}</div>
            <div className="mt-0.5 text-[10px] text-white/40">{t("history.followThroughRateHint")}</div>
          </div>
          <div className="rounded-2xl p-4 metal-surface text-center">
            <div className="text-2xl font-bold text-sky-300">{streak}</div>
            <div className="mt-1 text-xs font-semibold text-white/70">{t("history.currentStreak")}</div>
          </div>
          <div className="rounded-2xl p-4 metal-surface text-center">
            <div className="text-2xl font-bold text-emerald-300">{lifetimeStats?.longestStreak ?? 0}</div>
            <div className="mt-1 text-xs font-semibold text-white/70">{t("history.longestStreak")}</div>
          </div>
          <div className="rounded-2xl p-4 metal-surface text-center">
            <div className="text-2xl font-bold text-white">
              <AnimatedNumber value={profile?.points ?? 0} />
            </div>
            <div className="mt-1 text-xs font-semibold text-white/70">{t("dashboard.stat.totalPoints")}</div>
          </div>
        </div>

        {/* Conceptual Task outcomes -- ONE shared panel with internal
            dividers instead of 4 separate bordered boxes, so this reads
            as one dataset rather than four more cards stacked under the
            KPI row. Values/labels/source unchanged. */}
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-white/80 mb-2">{t("history.outcomesTitle")}</h3>
          <div className="rounded-2xl bg-white/5 grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-white/10">
            <div className="p-3 text-center">
              <div className="text-xl font-bold text-emerald-300">{taskAnalytics?.completedConceptualTasks ?? 0}</div>
              <div className="mt-1 text-[11px] text-white/60">{t("history.outcomesCompleted")}</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-xl font-bold text-sky-300">{taskAnalytics?.activeConceptualTasks ?? 0}</div>
              <div className="mt-1 text-[11px] text-white/60">{t("history.outcomesActive")}</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-xl font-bold text-white/70">{taskAnalytics?.canceledConceptualTasks ?? 0}</div>
              <div className="mt-1 text-[11px] text-white/60">{t("history.outcomesCanceled")}</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-xl font-bold text-amber-300">{taskAnalytics?.brokenConceptualTasks ?? 0}</div>
              <div className="mt-1 text-[11px] text-white/60">{t("history.outcomesNeedsReview")}</div>
            </div>
          </div>
          {!!taskAnalytics?.brokenConceptualTasks && (
            <p className="mt-2 text-[11px] text-white/40">{t("history.outcomesNeedsReviewHint")}</p>
          )}
        </div>

        {/* Priority performance -- compact rows: header line (P-level +
            rate), a thin per-priority-colored progress track, then the
            total/completed/canceled counts. An empty/neutral track (no
            fill div at all) when completionRate is null, never a fake
            0%-wide fill. */}
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-white/80 mb-2">{t("history.priorityPerformanceTitle")}</h3>
          {taskAnalytics && taskAnalytics.byPriority.length > 0 ? (
            <div className="rounded-2xl bg-white/5 divide-y divide-white/10">
              {taskAnalytics.byPriority.map((p) => {
                const meta = getPriorityMeta(p.priority);
                return (
                  <div key={p.priority} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold flex-shrink-0" style={{ color: meta.color }}>
                          P{p.priority}
                        </span>
                        <span className="text-xs text-white/50 truncate">{t(meta.label)}</span>
                      </div>
                      <span className="text-sm font-bold text-white flex-shrink-0">{formatRate(p.completionRate)}</span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                      {p.completionRate != null && (
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.round(p.completionRate * 100)}%`, background: meta.color }}
                        />
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-white/50">
                      {t("history.priorityBreakdownLine", { total: p.total, completed: p.completed, canceled: p.canceled })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="dashboard-goal-empty">
              <div className="text-sm text-white/60">{t("history.priorityPerformanceEmpty")}</div>
            </div>
          )}
        </div>
      </div>

      {/* B. ACTIVITY */}
      <div className="card">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white">{t("history.activityOverview")}</h2>
            <p className="mt-1 text-sm text-white/60">{t("history.activitySubtitle")}</p>
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
              {t("history.weekly")}
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
              {t("history.monthly")}
            </button>
          </div>
        </div>

        {activityError && (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {activityError}
          </div>
        )}

        {!activityError && activityLoading && (
          <div className="mt-6 text-white/60 text-sm text-center py-6">{t("history.loadingActivity")}</div>
        )}

        {!activityError && !activityLoading && (
          <>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-white/5 p-4 text-center">
                <div className="text-2xl font-bold text-emerald-300">{checkedInDays}</div>
                <div className="mt-1 text-xs text-white/60">{t("history.daysCheckedIn")}</div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 text-center">
                <div className="text-2xl font-bold text-amber-300">{missedDays}</div>
                <div className="mt-1 text-xs text-white/60">{t("history.daysMissed")}</div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 text-center">
                <div className="text-2xl font-bold text-sky-300">{accomplishedDays}</div>
                <div className="mt-1 text-xs text-white/60">{t("history.daysWithCompleted")}</div>
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
                    : { top: "rgba(var(--tint-rgb),0.22)", bottom: "rgba(var(--tint-rgb),0.08)" };
                  const MarkIcon = day.checkedIn ? Check : day.hasPlan ? Dot : X;

                  return (
                    <div
                      key={day.date}
                      className="flex-1 flex flex-col items-center justify-end"
                      style={{ minWidth: period === "week" ? "28px" : "8px", height: "100%" }}
                      title={t("history.barTitle", {
                        date: formatDateDisplay(day.date),
                        state: day.checkedIn ? t("history.stateCheckedIn") : day.hasPlan ? t("history.stateNotClosed") : t("history.stateMissed"),
                        completed: day.goalsCompleted,
                        total: day.goalsTotal,
                      })}
                    >
                      {period === "week" && (
                        <div
                          className="mb-1"
                          style={{
                            color: state === "checkedIn" ? "#34d399" : state === "notClosed" ? "#fbbf24" : "rgba(var(--tint-rgb),0.4)",
                          }}
                        >
                          <MarkIcon size={10} strokeWidth={3} />
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
                    className="inline-flex items-center justify-center w-4 h-4 rounded-sm text-black"
                    style={{ background: "linear-gradient(180deg, #34d399, #059669)", border: "1px solid rgba(0,0,0,0.55)" }}
                  >
                    <Check size={11} strokeWidth={3} />
                  </span>
                  <span className="text-white/70">{t("history.stateCheckedIn")}</span>
                </div>
                <div
                  className="flex items-center gap-2 rounded-full px-3 py-1.5"
                  style={{ background: "rgba(245, 158, 11, 0.10)", border: "1px solid rgba(0,0,0,0.55)" }}
                >
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded-sm text-black"
                    style={{ background: "linear-gradient(180deg, #fbbf24, #d97706)", border: "1px solid rgba(0,0,0,0.55)" }}
                  >
                    <Dot size={14} strokeWidth={4} />
                  </span>
                  <span className="text-white/70">{t("history.stateNotClosed")}</span>
                </div>
                <div
                  className="flex items-center gap-2 rounded-full px-3 py-1.5"
                  style={{ background: "rgba(var(--tint-rgb), 0.05)", border: "1px solid rgba(0,0,0,0.55)" }}
                >
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 rounded-sm text-white/70"
                    style={{ background: "rgba(var(--tint-rgb), 0.15)", border: "1px solid rgba(0,0,0,0.55)" }}
                  >
                    <X size={11} strokeWidth={3} />
                  </span>
                  <span className="text-white/70">{t("history.stateMissed")}</span>
                </div>
                <div className="ml-auto text-white/40">{t("history.barHeightLegend")}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* C. GOAL PROGRESS */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-1">{t("history.goalProgressTitle")}</h2>
        <p className="text-sm text-white/60 mb-4">{t("history.goalProgressSubtitle")}</p>

        <div className="mb-4">
          <h3 className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1.5">
            <TargetIcon size={14} className="text-pink-400" /> {t("history.targetGoalsTitle")}
          </h3>
          {targetGoals.length === 0 ? (
            <div className="dashboard-goal-empty">
              <div className="text-sm text-white/60">{t("history.targetGoalsEmpty")}</div>
              <div className="mt-1 text-xs text-white/40">{t("history.targetGoalsEmptyHint")}</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {targetGoals.map((goal) => {
                const progress = getTargetProgress({ currentValue: goal.current_value, targetValue: goal.target_value });
                return (
                  <div key={goal.id} className="dashboard-goal-card min-w-0">
                    <div className="text-sm font-semibold text-white/90 truncate">{goal.title}</div>
                    {progress.configured ? (
                      <>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-white/50">
                          <span className="truncate">
                            {formatTargetProgress(progress.currentValue, progress.targetValue, goal.target_unit)}
                          </span>
                          <span className="font-bold text-pink-300/85 flex-shrink-0">{progress.roundedPct}%</span>
                        </div>
                        <div className="dashboard-goal-progress-track">
                          <div className="dashboard-goal-progress-fill" style={{ width: `${progress.barPct}%` }} />
                        </div>
                      </>
                    ) : (
                      <div className="mt-1.5 text-[11px] text-white/50">{t("goalDetail.targetNotConfigured")}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1.5">
            <Repeat size={14} className="text-pink-400" /> {t("history.recurringGoalsTitle")}
          </h3>
          {recurringGoals.length === 0 ? (
            <div className="dashboard-goal-empty">
              <div className="text-sm text-white/60">{t("history.recurringGoalsEmpty")}</div>
              <div className="mt-1 text-xs text-white/40">{t("history.recurringGoalsEmptyHint")}</div>
            </div>
          ) : (
            // One shared panel, thin per-Goal rows -- a Recurring Goal
            // list was contributing the most page length of any section
            // (per this pass' own brief), so each row prioritizes title +
            // current-cycle result/count only, no per-Goal card chrome
            // or progress bar. Same getRecurringCurrentCycleView/
            // RECURRING_RESULT_LABEL_KEY read as before -- no cycle logic
            // changed, only how compactly it's displayed.
            <div className="rounded-2xl bg-white/5 divide-y divide-white/10">
              {recurringGoals.map((goal) => {
                const view = getRecurringCurrentCycleView({
                  persistedCycles: cycleHistoryByGoalId.get(goal.id) ?? [],
                  recurrenceFrequency: goal.recurrence_frequency,
                  recurrenceStartDate: goal.recurrence_start_date,
                  recurrenceTargetCount: goal.recurrence_target_count,
                  todayISO,
                });
                return (
                  <div key={goal.id} className="flex items-center justify-between gap-3 px-3 py-2 min-w-0">
                    <div className="text-sm font-medium text-white/90 truncate min-w-0 flex-1">{goal.title}</div>
                    <div className="text-right flex-shrink-0 text-[11px] text-white/50">
                      {view.kind === "unconfigured" ? (
                        <div>{t("recurringProgress.noCurrentCycle")}</div>
                      ) : view.kind === "not_started" ? (
                        <div>{t("recurringProgress.notStartedYet", { date: formatDateDisplay(view.recurrenceStartDate) })}</div>
                      ) : view.cycle.targetCountSnapshot != null ? (
                        <>
                          <div className="font-bold text-pink-300/85">
                            {t(
                              RECURRING_RESULT_LABEL_KEY[
                                view.cycle.result as Exclude<CycleResultStatus, "unconfigured"> | "in_progress"
                              ]
                            )}
                          </div>
                          <div>
                            {t("recurringProgress.completedOfTarget", {
                              completed: view.cycle.completed,
                              target: view.cycle.targetCountSnapshot,
                            })}
                          </div>
                        </>
                      ) : (
                        <div>
                          {t(
                            view.cycle.completed === 1
                              ? "recurringProgress.completedCountSingular"
                              : "recurringProgress.completedCountPlural",
                            { count: view.cycle.completed }
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* D. HISTORY / DRILL-DOWN -- Lifetime Totals is secondary analytics
          here: one compact, muted strip of label:value pairs rather than
          5 prominent tiles, so it doesn't compete with Overview's KPIs.
          Same 5 values, same source (getLifetimeStats, untouched). */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-2">
          {t("history.lifetimeTotalsTitle")}
        </h2>

        {lifetimeStats && (
          <div className="rounded-xl bg-white/[0.03] px-4 py-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-white/50">
            <span>
              <span className="text-white/90 font-semibold">{lifetimeStats.totalDaysClosed}</span> {t("history.daysClosed")}
            </span>
            <span>
              <span className="text-white/90 font-semibold">{lifetimeStats.maxGoalsCompletedInDay}</span> {t("history.bestSingleDay")}
            </span>
            <span>
              <span className="text-white/90 font-semibold">{lifetimeStats.reschedulesCompleted}</span> {t("history.reschedulesFollowed")}
            </span>
            <span>
              <span className="text-white/90 font-semibold">{lifetimeStats.trackedGoalsCompleted}</span> {t("history.trackedGoalsCompleted")}
            </span>
            <span>
              <span className="text-white/90 font-semibold">{lifetimeStats.totalReferrals}</span> {t("history.successfulReferrals")}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={openCompletedGoalList}
          className="mt-3 text-xs text-amber-300/70 hover:text-amber-300 underline underline-offset-2"
        >
          {t("history.browseCompletedGoals")}
        </button>
      </div>

      {goalListOpen && (
        <div className="card">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{t("history.completedGoalsTitle")}</h2>
              <p className="mt-1 text-sm text-white/60">
                {t(goalList.length === 1 ? "history.goalCount.one" : "history.goalCount.other", { count: goalList.length })}
              </p>
            </div>
            <button type="button" className="btn inline-flex items-center gap-1.5" onClick={() => setGoalListOpen(false)}>
              <X size={13} /> {t("history.close")}
            </button>
          </div>

          {goalListError && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {goalListError}
            </div>
          )}

          {!goalListError && goalListLoading && (
            <div className="text-white/60 text-sm text-center py-8">{t("history.loadingGoals")}</div>
          )}

          {!goalListError && !goalListLoading && goalList.length === 0 && (
            <div className="text-white/60 text-sm text-center py-8">{t("history.nothingHereYet")}</div>
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
                    <div className="goal-row-body" style={{ paddingTop: "1.25rem" }}>
                    <div className="text-xs text-white/50 mb-1">
                      {g.plan_date ? formatDateDisplay(g.plan_date) : t("history.unknownDate")}
                    </div>
                    <div className="text-lg font-semibold text-white">{g.title}</div>
                    {g.details && <div className="mt-1 text-sm text-white/60">{g.details}</div>}
                    <GoalTimeline
                      entries={buildGoalTimeline(g, goalNotesMap[g.id] ?? [], t)}
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
                        <StatusIcon status={status} size={13} />
                        <span>{statusLabel(status, t)}</span>
                      </div>
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide mb-3">{t("history.pointsUsageTitle")}</h2>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!error && entries.length === 0 && (
          <div className="text-white/60 text-sm py-6 text-center">
            {t("history.noPointsYet")}
          </div>
        )}

        {entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry) => {
              const total = (entry.awarenessAwarded ? entry.awarenessPoints : 0) +
                (entry.closureAwarded ? entry.closurePoints : 0) +
                (entry.planningAwarded ? entry.planningPoints : 0);

              return (
                // Fixed mobile collision: the right-side "+N" used to sit
                // in a flex row with no reserved width/flex-shrink-0 next
                // to a badge line that scrolled horizontally
                // (flex-nowrap + overflow-x-auto) instead of wrapping --
                // on narrow phones the two visually overlapped around
                // whichever row had the most badges. Badges now wrap
                // (flex-wrap) onto their own line(s) under the date,
                // inside a flex-1 min-w-0 left column, while the value
                // gets an explicit flex-shrink-0 + reserved min-width on
                // its own right column -- the two can never occupy the
                // same space regardless of badge count or viewport width.
                <div key={entry.planDate} className="flex items-start justify-between gap-3 rounded-xl bg-white/5 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white">
                      {formatDateDisplay(entry.planDate)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/60">
                      {entry.planningAwarded && (
                        <span>{t("history.planning", { points: entry.planningPoints })}</span>
                      )}
                      {entry.awarenessAwarded && (
                        <span>{t("history.awareness", { points: entry.awarenessPoints })}</span>
                      )}
                      {entry.closureAwarded && (
                        <span>{t("history.closure", { points: entry.closurePoints })}</span>
                      )}
                      {entry.reviewedAt && (
                        <span className="inline-flex items-center gap-1 text-emerald-300/80">
                          <Check size={12} /> {t("history.dayClosedCheck")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-base font-bold text-white text-right flex-shrink-0" style={{ minWidth: "2.75rem" }}>
                    +{total}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-center py-2">
        <Link href="/standup/profile" className="btn">
          {t("history.backToProfile")}
        </Link>
      </div>
    </div>
  );
}

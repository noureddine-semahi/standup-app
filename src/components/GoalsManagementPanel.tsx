"use client";

// Tools -> Goals Phase 2: the first version of the central Goal
// management workspace. Read/derive-only reuse of the existing Goal
// Engine -- no new lifecycle, no new Task/cycle/assignment logic. Same
// "a Tools tab is a thin component the tab bar just mounts" architecture
// GoalAssignmentsPanel already established (see tools/page.tsx).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getOutcomeGoals,
  createOutcomeGoal,
  setOutcomeGoalStatus,
  setOutcomeGoalQuickAddHidden,
  getConceptualTasksByOutcomeGoalIds,
  getCycleHistoryForOutcomeGoal,
  toISODate,
  formatDateDisplay,
  type OutcomeGoal,
  type OutcomeGoalStatus,
  type OutcomeGoalType,
  type ConceptualTask,
  type ConceptualTaskLifecycle,
  type ArchivedGoal,
  type OutcomeGoalCycleWithAggregation,
  type CycleResultStatus,
} from "@/lib/supabase/db";
import { getTargetProgress, formatTargetProgress, getRecurringCurrentCycleView } from "@/lib/goalProgress";
import { DEFAULT_PRIORITY } from "@/lib/goalLogic";
import { statusChipColors } from "@/lib/goalStatus";
import GoalTypeSelect from "@/components/GoalTypeSelect";
import PortalDropdownMenu from "@/components/PortalDropdownMenu";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { Plus, MoreHorizontal, TriangleAlert, Eye, EyeOff, X, CheckCircle2 } from "lucide-react";

export type StatusFilter = "all" | OutcomeGoalStatus;
export type TypeFilter = "all" | OutcomeGoalType;

// Pure, exported for focused testing (see GoalsManagementPanel.test.ts)
// without needing a React/browser rendering harness -- same "pure
// decision logic lives in one place, independently testable" convention
// db.ts's own small predicates (e.g. isOutcomeGoalQuickAddEligible) use.
export function matchesGoalFilters(
  goal: Pick<OutcomeGoal, "status" | "goal_type">,
  statusFilter: StatusFilter,
  typeFilter: TypeFilter
): boolean {
  const statusOk = statusFilter === "all" || goal.status === statusFilter;
  const typeOk = typeFilter === "all" || goal.goal_type === typeFilter;
  return statusOk && typeOk;
}

// Pure: the display/toggle interpretation of hidden_from_quick_add --
// "On" means visible (not hidden). Trivial negation, but named and
// exported so the row's Quick Add indicator and Phase 1's
// isOutcomeGoalQuickAddEligible (db.ts) are verifiably reading the same
// column the same way rather than two independently-written readings
// silently drifting apart.
export function isGoalQuickAddOn(goal: Pick<OutcomeGoal, "hidden_from_quick_add">): boolean {
  return !goal.hidden_from_quick_add;
}

// Pure, composed with matchesGoalFilters via a plain && in the caller
// rather than folded into it -- matchesGoalFilters already has its own
// tests exercising its 3-arg shape; keeping search as a separate
// predicate means those stay valid unchanged. Case-insensitive,
// substring match on title only; an empty/whitespace-only search is
// defined to match everything (same as "no search").
export function matchesGoalSearch(goal: Pick<OutcomeGoal, "title">, search: string): boolean {
  const trimmed = search.trim();
  if (!trimmed) return true;
  return goal.title.toLowerCase().includes(trimmed.toLowerCase());
}

// Pure, informational-only rule -- never calls setOutcomeGoalStatus or
// mutates anything itself; the component only ever reads this to decide
// whether to show a chip. Deliberately narrow: only a one-time Goal (no
// finish-line concept for ongoing; Target/Recurring already have their
// own progress indicators) with at least one conceptual Task, where
// EVERY one is lifecycle "completed" -- canceled and broken both fail
// this (neither is "completed"), so either one correctly prevents
// readiness without needing a separate check.
export function isGoalReadyToComplete(
  goal: Pick<OutcomeGoal, "status" | "goal_type">,
  tasks: { lifecycle: ConceptualTaskLifecycle }[]
): boolean {
  if (goal.status !== "active" || goal.goal_type !== "one_time") return false;
  if (tasks.length === 0) return false;
  return tasks.every((task) => task.lifecycle === "completed");
}

// Same mapping convention as goals/[id]/page.tsx's own outcomeStatusChip
// -- OutcomeGoalStatus ("active"/"completed"/"abandoned") is a different
// enum than GoalStatus (Task statuses), so "completed"/"abandoned" borrow
// its existing completed/canceled color tokens rather than a new palette.
// Duplicated locally rather than exported/shared -- neither page
// currently exports its page-local helpers for reuse (same convention
// goals/[id]/page.tsx's own findChainAssignment comment documents).
function outcomeStatusChipColors(status: OutcomeGoalStatus): { bg: string; border: string; color: string } {
  if (status === "completed") return statusChipColors("completed");
  if (status === "abandoned") return statusChipColors("canceled");
  return { bg: "rgba(244, 114, 182, 0.12)", border: "rgba(244, 114, 182, 0.4)", color: "#f9a8d4" };
}

const GOAL_TYPE_CHIP_KEY: Record<OutcomeGoalType, TranslationKey> = {
  one_time: "goalType.oneTime.chip",
  ongoing: "goalType.ongoing.chip",
  recurring: "goalType.recurring.chip",
  target: "goalType.target.chip",
};
const GOAL_TYPE_CHIP_COLORS = {
  bg: "rgba(var(--tint-rgb), 0.06)",
  border: "rgba(var(--tint-rgb), 0.18)",
  color: "rgba(var(--tint-rgb), 0.7)",
};

// Same lookup Dashboard/Goal Detail/Progress & Insights each already
// keep independently (see their own identical comment) -- "in_progress"
// is presentation-only (getRecurringCurrentCycleView), never stored.
const RECURRING_RESULT_LABEL_KEY: Record<Exclude<CycleResultStatus, "unconfigured"> | "in_progress", TranslationKey> = {
  achieved: "recurringProgress.resultAchieved",
  partial: "recurringProgress.resultPartial",
  missed: "recurringProgress.resultMissed",
  no_commitments: "recurringProgress.resultNoCommitments",
  in_progress: "recurringProgress.resultInProgress",
};

function Chip({ label, bg, border, color, icon }: { label: string; bg: string; border: string; color: string; icon?: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold flex-shrink-0"
      style={{ background: bg, border: `1px solid ${border}`, color }}
    >
      {icon}
      {label}
    </span>
  );
}

export default function GoalsManagementPanel() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [outcomeGoals, setOutcomeGoals] = useState<OutcomeGoal[]>([]);
  const [conceptualTasks, setConceptualTasks] = useState<ConceptualTask<ArchivedGoal>[]>([]);
  const [cycleHistoryByGoalId, setCycleHistoryByGoalId] = useState<Map<string, OutcomeGoalCycleWithAggregation[]>>(
    new Map()
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchText, setSearchText] = useState("");

  const [showNewGoalForm, setShowNewGoalForm] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalType, setNewGoalType] = useState<OutcomeGoalType>("one_time");
  const [creatingGoal, setCreatingGoal] = useState(false);

  const [settingStatusId, setSettingStatusId] = useState<string | null>(null);
  const [togglingQuickAddId, setTogglingQuickAddId] = useState<string | null>(null);
  const [openMenuGoalId, setOpenMenuGoalId] = useState<string | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setMsg(null);
      try {
        const goals = await getOutcomeGoals();
        setOutcomeGoals(goals);

        if (goals.length > 0) {
          // Canonical conceptual-Task read model -- one batched call for
          // every Goal's Tasks, never a raw goals-row count and never one
          // query per row. A reschedule chain collapses to exactly one
          // conceptual Task here (collapseGoalLineages), same as
          // Dashboard's Active Goals cards and Progress & Insights.
          const tasks = await getConceptualTasksByOutcomeGoalIds(goals.map((g) => g.id));
          setConceptualTasks(tasks);

          // Only active Recurring Goals get a cycle-history fetch -- same
          // scoping Dashboard/Progress & Insights already use. Read-only:
          // getCycleHistoryForOutcomeGoal never creates a cycle just by
          // being called here.
          const recurringGoals = goals.filter((g) => g.goal_type === "recurring");
          if (recurringGoals.length > 0) {
            const histories = await Promise.all(
              recurringGoals.map((g) =>
                getCycleHistoryForOutcomeGoal(g.id).catch(() => [] as OutcomeGoalCycleWithAggregation[])
              )
            );
            setCycleHistoryByGoalId(new Map(recurringGoals.map((g, i) => [g.id, histories[i]])));
          }
        }
      } catch (e: any) {
        setMsg(e?.message ?? t("tools.goalsLoadFailed"));
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateGoal() {
    const title = newGoalTitle.trim();
    if (!title || creatingGoal) return;
    setCreatingGoal(true);
    setMsg(null);
    try {
      // Reuses the exact same createOutcomeGoal call Plan Tomorrow's own
      // "new Major Goal" flow uses -- but NOT that flow's form/UI, which
      // requires >=2 Tasks created in the same step and is wired into
      // Tomorrow's own plan/commitment-cap state. Title + type only here;
      // target/recurrence fields stay configurable via the existing Goal
      // Detail edit form afterward (same "Edit may simply navigate there"
      // reuse this phase's own brief calls for). No Task is created --
      // this is deliberately the staging behavior (an active Goal with
      // zero Tasks).
      const created = await createOutcomeGoal(title, null, DEFAULT_PRIORITY, newGoalType);
      setOutcomeGoals((prev) => [created, ...prev]);
      setNewGoalTitle("");
      setNewGoalType("one_time");
      setShowNewGoalForm(false);
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.goalCreateFailed"));
    } finally {
      setCreatingGoal(false);
    }
  }

  async function handleSetStatus(goal: OutcomeGoal, status: OutcomeGoalStatus) {
    if (settingStatusId) return;
    setSettingStatusId(goal.id);
    setOpenMenuGoalId(null);
    setMsg(null);
    try {
      const updated = await setOutcomeGoalStatus(goal.id, status);
      setOutcomeGoals((prev) => prev.map((g) => (g.id === goal.id ? updated : g)));
    } catch (e: any) {
      setMsg(e?.message ?? t("goalDetail.statusChangeFailed"));
    } finally {
      setSettingStatusId(null);
    }
  }

  // Pure display preference -- never touches status/Tasks/cycles/
  // analytics/assignments. Same handler covers both hide (Phase 1) and
  // restore (this phase) since it's one symmetric toggle.
  async function handleToggleQuickAdd(goal: OutcomeGoal) {
    if (togglingQuickAddId) return;
    setTogglingQuickAddId(goal.id);
    setMsg(null);
    try {
      const nextHidden = !goal.hidden_from_quick_add;
      await setOutcomeGoalQuickAddHidden(goal.id, nextHidden);
      setOutcomeGoals((prev) =>
        prev.map((g) => (g.id === goal.id ? { ...g, hidden_from_quick_add: nextHidden } : g))
      );
    } catch (e: any) {
      setMsg(e?.message ?? t("tools.goalsQuickAddToggleFailed"));
    } finally {
      setTogglingQuickAddId(null);
    }
  }

  if (loading) {
    return <div className="text-white/60 text-center py-8">{t("tools.goalsLoading")}</div>;
  }

  const todayISO = toISODate(new Date());

  const counts = {
    all: outcomeGoals.length,
    active: outcomeGoals.filter((g) => g.status === "active").length,
    completed: outcomeGoals.filter((g) => g.status === "completed").length,
    abandoned: outcomeGoals.filter((g) => g.status === "abandoned").length,
  };

  // Split into two steps so the empty-state logic below can tell "the
  // status/type filter itself has nothing" apart from "search is what
  // narrowed it to zero" -- filtered is what actually renders, client-
  // side only, no extra query either step.
  const filteredByStatusType = outcomeGoals.filter((g) => matchesGoalFilters(g, statusFilter, typeFilter));
  const filtered = filteredByStatusType.filter((g) => matchesGoalSearch(g, searchText));

  function tasksForGoal(goalId: string) {
    return conceptualTasks.filter((ct) => (ct.terminal as any).outcome_goal_id === goalId);
  }

  function outcomeStatusLabel(status: OutcomeGoalStatus): string {
    if (status === "active") return t("tools.goalsFilterActive");
    if (status === "completed") return t("tools.goalsFilterCompleted");
    return t("tools.goalsFilterArchived"); // "abandoned" presents as "Archived" -- no new status
  }

  const hasSearchText = searchText.trim().length > 0;

  // A: no Goals exist at all. B: the status/type filter itself has no
  // matches (search irrelevant or also empty). C: status/type DID match
  // something, but the search text narrowed it to zero -- distinct
  // wording so the user knows to adjust their search, not their filter.
  const emptyKey =
    outcomeGoals.length === 0
      ? "tools.goalsEmptyNone"
      : hasSearchText && filteredByStatusType.length > 0 && filtered.length === 0
      ? "tools.goalsEmptySearch"
      : filteredByStatusType.length === 0
      ? statusFilter === "active"
        ? "tools.goalsEmptyActive"
        : statusFilter === "completed"
        ? "tools.goalsEmptyCompleted"
        : statusFilter === "abandoned"
        ? "tools.goalsEmptyArchived"
        : "tools.goalsEmptyNone"
      : "tools.goalsEmptyNone";

  return (
    <div className="card card-highlight">
      {msg && (
        <div className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">{msg}</div>
      )}

      {/* Primary status filters */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {([
          ["all", t("tools.goalsFilterAll"), counts.all],
          ["active", t("tools.goalsFilterActive"), counts.active],
          ["completed", t("tools.goalsFilterCompleted"), counts.completed],
          ["abandoned", t("tools.goalsFilterArchived"), counts.abandoned],
        ] as [StatusFilter, string, number][]).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value)}
            className="btn"
            style={{
              padding: "0.35rem 0.7rem",
              fontSize: "0.78rem",
              background: statusFilter === value ? "rgba(245, 158, 11, 0.25)" : undefined,
              borderColor: statusFilter === value ? "rgba(245, 158, 11, 0.6)" : undefined,
            }}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {/* Secondary Goal-type filters -- wraps onto as many lines as the
          available width needs rather than scrolling horizontally, so
          all five options stay visible at once on any phone width. */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {([
          ["all", t("tools.goalsTypeFilterAll")],
          ["one_time", t("goalType.oneTime.chip")],
          ["ongoing", t("goalType.ongoing.chip")],
          ["recurring", t("goalType.recurring.chip")],
          ["target", t("goalType.target.chip")],
        ] as [TypeFilter, string][]).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTypeFilter(value)}
            className="btn"
            style={{
              padding: "0.3rem 0.6rem",
              fontSize: "0.72rem",
              background: typeFilter === value ? "rgba(244, 114, 182, 0.18)" : undefined,
              borderColor: typeFilter === value ? "rgba(244, 114, 182, 0.5)" : undefined,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search -- client-side only against already-loaded Goal titles,
          no query per keystroke, combined with the status/type filters
          above via matchesGoalSearch (see its own comment). */}
      <div className="relative mb-5">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={t("tools.goalsSearchPlaceholder")}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2 pr-9 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
        />
        {searchText && (
          <button
            type="button"
            onClick={() => setSearchText("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
            aria-label={t("tools.goalsSearchClear")}
            title={t("tools.goalsSearchClear")}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* New Goal -- mb-3 (not mb-5, matching the filter/search rows
          above) so the Goal list below starts noticeably sooner on
          mobile without losing all separation from the creation
          action. */}
      {!showNewGoalForm ? (
        <button
          type="button"
          onClick={() => setShowNewGoalForm(true)}
          className="btn btn-primary inline-flex items-center gap-1.5 mb-3"
        >
          <Plus size={14} /> {t("tools.goalsNewGoal")}
        </button>
      ) : (
        <div className="space-y-3 mb-3 rounded-2xl bg-white/5 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={newGoalTitle}
              onChange={(e) => setNewGoalTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateGoal();
              }}
              placeholder={t("tomorrow.goalTitlePlaceholder")}
              disabled={creatingGoal}
              className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
              autoFocus
            />
            <GoalTypeSelect value={newGoalType} onChange={setNewGoalType} disabled={creatingGoal} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreateGoal}
              disabled={creatingGoal || !newGoalTitle.trim()}
              className="btn btn-primary"
            >
              {creatingGoal ? t("tomorrow.creatingGoal") : t("tools.goalsCreateGoal")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewGoalForm(false);
                setNewGoalTitle("");
                setNewGoalType("one_time");
              }}
              disabled={creatingGoal}
              className="btn"
            >
              {t("tomorrow.neverMind")}
            </button>
          </div>
        </div>
      )}

      {/* Goal rows */}
      {filtered.length === 0 ? (
        <div className="dashboard-goal-empty">
          <div className="text-sm text-white/60">{t(emptyKey)}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((goal) => {
            const tasks = tasksForGoal(goal.id);
            const total = tasks.length;
            const completed = tasks.filter((ct) => ct.lifecycle === "completed").length;
            const broken = tasks.filter((ct) => ct.lifecycle === "broken").length;
            const statusColors = outcomeStatusChipColors(goal.status);
            const quickAddOn = isGoalQuickAddOn(goal);
            const readyToComplete = isGoalReadyToComplete(goal, tasks);

            return (
              <div key={goal.id} className="dashboard-goal-card min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-white/90 truncate" style={{ maxWidth: "100%" }}>
                        {goal.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                      <Chip
                        label={outcomeStatusLabel(goal.status)}
                        bg={statusColors.bg}
                        border={statusColors.border}
                        color={statusColors.color}
                      />
                      <Chip
                        label={t(GOAL_TYPE_CHIP_KEY[goal.goal_type])}
                        bg={GOAL_TYPE_CHIP_COLORS.bg}
                        border={GOAL_TYPE_CHIP_COLORS.border}
                        color={GOAL_TYPE_CHIP_COLORS.color}
                      />
                      {broken > 0 && (
                        <Chip
                          label={t("dashboard.goalTaskNeedsReview")}
                          bg="rgba(245, 158, 11, 0.12)"
                          border="rgba(245, 158, 11, 0.4)"
                          color="#fcd34d"
                          icon={<TriangleAlert size={10} />}
                        />
                      )}
                      {/* Informational only -- see isGoalReadyToComplete's
                          own comment. Never auto-completes; the user still
                          uses ••• -> Complete manually. */}
                      {readyToComplete && (
                        <Chip
                          label={t("tools.goalsReadyToComplete")}
                          bg="rgba(16, 185, 129, 0.12)"
                          border="rgba(16, 185, 129, 0.4)"
                          color="#6ee7b7"
                          icon={<CheckCircle2 size={10} />}
                        />
                      )}
                    </div>

                    {/* Progress -- Target/Recurring reuse their existing
                        helpers exactly as Dashboard/Progress & Insights
                        already do; One-Time/Ongoing derive a simple
                        completed/total line from the same conceptual
                        Tasks already loaded above. */}
                    <div className="text-[11px] text-white/50">
                      {goal.goal_type === "target" ? (
                        (() => {
                          const progress = getTargetProgress({
                            currentValue: goal.current_value,
                            targetValue: goal.target_value,
                          });
                          return progress.configured ? (
                            <>
                              <div className="flex items-center justify-between gap-2">
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
                            <div>{t("goalDetail.targetNotConfigured")}</div>
                          );
                        })()
                      ) : goal.goal_type === "recurring" ? (
                        (() => {
                          const view = getRecurringCurrentCycleView({
                            persistedCycles: cycleHistoryByGoalId.get(goal.id) ?? [],
                            recurrenceFrequency: goal.recurrence_frequency,
                            recurrenceStartDate: goal.recurrence_start_date,
                            recurrenceTargetCount: goal.recurrence_target_count,
                            todayISO,
                          });
                          return view.kind === "unconfigured" ? (
                            <div>{t("recurringProgress.noCurrentCycle")}</div>
                          ) : view.kind === "not_started" ? (
                            <div>
                              {t("recurringProgress.notStartedYet", { date: formatDateDisplay(view.recurrenceStartDate) })}
                            </div>
                          ) : view.cycle.targetCountSnapshot != null ? (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate">
                                  {t("recurringProgress.completedOfTarget", {
                                    completed: view.cycle.completed,
                                    target: view.cycle.targetCountSnapshot,
                                  })}
                                </span>
                                <span className="font-bold text-pink-300/85 flex-shrink-0">
                                  {t(
                                    RECURRING_RESULT_LABEL_KEY[
                                      view.cycle.result as Exclude<CycleResultStatus, "unconfigured"> | "in_progress"
                                    ]
                                  )}
                                </span>
                              </div>
                              <div className="dashboard-goal-progress-track">
                                <div
                                  className="dashboard-goal-progress-fill"
                                  style={{
                                    width: `${Math.max(
                                      0,
                                      Math.min(100, Math.round((view.cycle.completed / view.cycle.targetCountSnapshot) * 100))
                                    )}%`,
                                  }}
                                />
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
                          );
                        })()
                      ) : total === 0 ? (
                        <div>{t("tools.goalsNoTasks")}</div>
                      ) : (
                        <>
                          <div>{t("tools.goalsTaskCount", { completed, total })}</div>
                          <div className="dashboard-goal-progress-track">
                            <div
                              className="dashboard-goal-progress-fill"
                              style={{ width: `${Math.round((completed / total) * 100)}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Quick Add On/Off -- icon-only (title carries the
                        label, same "icon+label collapses to icon-only on
                        a compact control" convention used elsewhere in
                        this app), toggles immediately. */}
                    <button
                      type="button"
                      onClick={() => handleToggleQuickAdd(goal)}
                      disabled={togglingQuickAddId === goal.id}
                      className="btn"
                      style={{ padding: "0.3rem 0.4rem" }}
                      title={quickAddOn ? t("tools.goalsQuickAddOn") : t("tools.goalsQuickAddOff")}
                      aria-label={quickAddOn ? t("tools.goalsQuickAddOn") : t("tools.goalsQuickAddOff")}
                    >
                      {quickAddOn ? <Eye size={13} /> : <EyeOff size={13} className="text-white/40" />}
                    </button>

                    <PortalDropdownMenu
                      open={openMenuGoalId === goal.id}
                      onClose={() => setOpenMenuGoalId(null)}
                      anchorRef={actionsMenuRef}
                      panelClassName="conn-card-menu"
                      panelStyle={{ minWidth: "180px" }}
                      panel={
                        <>
                          <Link
                            href={`/standup/goals/${goal.id}`}
                            className="conn-card-menu-item"
                            onClick={() => setOpenMenuGoalId(null)}
                          >
                            {t("tools.goalsOpenManage")}
                          </Link>
                          {goal.status === "active" && (
                            <>
                              <button
                                type="button"
                                className="conn-card-menu-item"
                                disabled={settingStatusId === goal.id}
                                onClick={() => handleSetStatus(goal, "completed")}
                              >
                                {t("goalDetail.completeGoal")}
                              </button>
                              <button
                                type="button"
                                className="conn-card-menu-item"
                                disabled={settingStatusId === goal.id}
                                onClick={() => handleSetStatus(goal, "abandoned")}
                              >
                                {t("tools.goalsArchiveAction")}
                              </button>
                            </>
                          )}
                          {goal.status !== "active" && (
                            <button
                              type="button"
                              className="conn-card-menu-item"
                              disabled={settingStatusId === goal.id}
                              onClick={() => handleSetStatus(goal, "active")}
                            >
                              {t("goalDetail.reactivateGoal")}
                            </button>
                          )}
                        </>
                      }
                    >
                      <div
                        className="relative"
                        ref={openMenuGoalId === goal.id ? actionsMenuRef : undefined}
                      >
                        <button
                          type="button"
                          onClick={() => setOpenMenuGoalId(openMenuGoalId === goal.id ? null : goal.id)}
                          className="btn"
                          style={{ padding: "0.3rem 0.4rem" }}
                          aria-label={t("tools.goalsOpenManage")}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </PortalDropdownMenu>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

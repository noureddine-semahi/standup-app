"use client";

// Goal Engine Phase 2A: dedicated detail view for one Major Goal
// (outcome_goals row). Architectural reference only is
// /standup/date/[date]/page.tsx (client component, useParams(), its own
// focused fetch) -- deliberately NOT that page's full Task editor. Every
// Task operation here (add/reschedule/checklist/files/link/assignment/
// completion) reuses the exact same db.ts functions and components Today/
// Tomorrow/Dashboard already use; this page adds no second Task system,
// only a Goal-scoped read + a minimal "+Add Task" write.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTaskExecutionDestination } from "@/lib/taskNavigation";
import { getTargetProgress, formatTargetProgress } from "@/lib/goalProgress";
import {
  getOutcomeGoalById,
  getConceptualTasksByOutcomeGoalIds,
  updateOutcomeGoal,
  setOutcomeGoalStatus,
  getMyGoalAssignments,
  resolveBrokenGoal,
  getPlanWithGoals,
  upsertGoals,
  updateGoalTitle,
  updateGoalPriority,
  toISODate,
  addDays,
  formatDateDisplay,
  type OutcomeGoal,
  type OutcomeGoalStatus,
  type OutcomeGoalType,
  type ConceptualTask,
  type ArchivedGoal,
  type GoalAssignment,
  type BrokenGoalResolution,
} from "@/lib/supabase/db";
import PageLoadingState from "@/components/PageLoadingState";
import PortalDropdownMenu from "@/components/PortalDropdownMenu";
import StatusIcon from "@/components/StatusIcon";
import GoalTypeSelect from "@/components/GoalTypeSelect";
import GoalTypeInfoModal from "@/components/GoalTypeInfoModal";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { DEFAULT_PRIORITY } from "@/lib/goalLogic";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { Target, TriangleAlert, Pencil, CheckCircle2, Ban, RotateCcw } from "lucide-react";

type TaskWithChain = ArchivedGoal & { lifecycle: ConceptualTask<ArchivedGoal>["lifecycle"]; chainIds: string[] };

// Mirrors Dashboard Active Goals' own chain-aware assignment lookup
// (src/app/standup/dashboard/page.tsx) -- an assignment's assignerGoalId/
// recipientGoalId never follows a reschedule, so matching only a Task's
// current terminal id can miss an assignment made against an earlier row
// in its chain. Same approach, duplicated locally rather than exported --
// neither page currently exports its page-local helpers for reuse.
function findChainAssignment(map: Map<string, GoalAssignment>, chainIds: string[]): GoalAssignment | undefined {
  for (const id of chainIds) {
    const found = map.get(id);
    if (found) return found;
  }
  return undefined;
}

// OutcomeGoalStatus ("active"/"completed"/"abandoned") is a different
// enum than GoalStatus (Task statuses) -- statusChipColors only accepts
// the latter, so "completed"/"abandoned" borrow its existing completed/
// canceled color tokens (same semantic color, not a new palette entry)
// and "active" reuses the exact pink already used for the Active Goal
// identity marker on Dashboard (Target icon, border-left) rather than
// inventing a new color for the same concept.
function outcomeStatusChip(status: OutcomeGoalStatus): { bg: string; border: string; color: string } {
  if (status === "completed") return statusChipColors("completed");
  if (status === "abandoned") return statusChipColors("canceled");
  return { bg: "rgba(244, 114, 182, 0.12)", border: "rgba(244, 114, 182, 0.4)", color: "#f9a8d4" };
}

// Goal Engine Phase 2B-1: compact chip label per Goal Type -- a plain
// neutral tint (not a status color) since a type is a classification,
// not a lifecycle state.
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

export default function GoalDetailPage() {
  const params = useParams();
  const idParam = params?.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] ?? "" : "";
  const { t } = useLanguage();

  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);

  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState<OutcomeGoal | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tasks, setTasks] = useState<ConceptualTask<ArchivedGoal>[]>([]);
  const [goalAssignments, setGoalAssignments] = useState<GoalAssignment[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [resolvingBrokenGoalId, setResolvingBrokenGoalId] = useState<string | null>(null);
  const [openResolveId, setOpenResolveId] = useState<string | null>(null);
  const resolveMenuRef = useRef<HTMLDivElement | null>(null);

  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState(DEFAULT_PRIORITY);
  // Visible/editable default only -- handleAddTask always schedules onto
  // whatever this holds at submit time, never todayISO independently of
  // it (see that function's own comment).
  const [newTaskDate, setNewTaskDate] = useState(todayISO);
  const [addingTask, setAddingTask] = useState(false);

  const [showEditGoal, setShowEditGoal] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editPriority, setEditPriority] = useState(DEFAULT_PRIORITY);
  const [editGoalType, setEditGoalType] = useState<OutcomeGoalType>("one_time");
  const [goalTypeInfo, setGoalTypeInfo] = useState<OutcomeGoalType | null>(null);
  // Goal Engine Phase 2D-3: Target fields, kept as raw input strings (not
  // pre-parsed numbers) so "blank" is distinguishable from "0" while
  // typing, and so an in-progress invalid entry never gets silently
  // coerced to 0. Always present in the edit form regardless of
  // editGoalType -- only their VISIBILITY is conditional on
  // editGoalType === "target" (see the render below); switching away
  // from Target never clears this state, so switching back shows
  // whatever was there, and saving always persists all three (switching
  // a Goal's type never clears its stored Target fields either).
  const [editTargetValue, setEditTargetValue] = useState("");
  const [editCurrentValue, setEditCurrentValue] = useState("");
  const [editTargetUnit, setEditTargetUnit] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  const [settingStatus, setSettingStatus] = useState(false);

  // Goal Engine Phase 2D-3B: per-Task structural-edit drafts, keyed by
  // TERMINAL task.id -- never by root/chain id, and never by an ancestor
  // row (see this phase's own read-only inspection for why: editing
  // anything but the terminal would corrupt historical snapshots).
  // Initialized fresh from openTasks each time Edit Goal opens
  // (openEditGoal below); tasksWithChain/openTasks themselves are never
  // mutated just because a draft is being typed. "Dirty" is deliberately
  // NOT its own stored bit -- it's derived by comparing a draft against
  // the Task's own current title/priority each render, so a successful
  // save (which reconciles via refreshTasks()) naturally clears it once
  // the Task's live data catches up to match the draft.
  const [taskDrafts, setTaskDrafts] = useState<Record<string, { title: string; priority: number }>>({});
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [taskSaveErrorById, setTaskSaveErrorById] = useState<Record<string, string>>({});

  // Goal Engine Phase 2D-3: a separate, smaller control from the full
  // Edit Goal form -- updates ONLY current_value, for a persisted
  // Target Goal, without opening the whole edit form.
  const [showUpdateProgress, setShowUpdateProgress] = useState(false);
  const [progressValueDraft, setProgressValueDraft] = useState("");
  const [savingProgress, setSavingProgress] = useState(false);

  async function load(goalId: string) {
    setLoading(true);
    setMsg(null);
    try {
      const g = await getOutcomeGoalById(goalId);
      if (!g) {
        setGoal(null);
        setNotFound(true);
        return;
      }
      setNotFound(false);
      setGoal(g);
      const [ct, assignments] = await Promise.all([
        getConceptualTasksByOutcomeGoalIds([goalId]),
        getMyGoalAssignments().catch(() => [] as GoalAssignment[]),
      ]);
      setTasks(ct);
      setGoalAssignments(assignments);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function refreshTasks() {
    if (!id) return;
    const ct = await getConceptualTasksByOutcomeGoalIds([id]);
    setTasks(ct);
  }

  // Same shape Dashboard's own assignedOutByGoalId/receivedByGoalId use --
  // see that file's comment for why "received" is filtered to accepted
  // only (a pending/declined assignment's recipientGoalId is never set).
  const assignedOutByGoalId = useMemo(() => {
    const map = new Map<string, GoalAssignment>();
    for (const a of goalAssignments) {
      if (a.direction === "assigned" && a.status !== "declined" && a.status !== "canceled" && a.assignerGoalId) {
        map.set(a.assignerGoalId, a);
      }
    }
    return map;
  }, [goalAssignments]);

  const receivedByGoalId = useMemo(() => {
    const map = new Map<string, GoalAssignment>();
    for (const a of goalAssignments) {
      if (a.direction === "received" && a.status === "accepted" && a.recipientGoalId) {
        map.set(a.recipientGoalId, a);
      }
    }
    return map;
  }, [goalAssignments]);

  // Identical date/ownership/action rules as Dashboard's taskMetaLine --
  // "Waiting on <name>" and "Overdue" stay deferred here too, same
  // lifecycle-verification reason.
  function taskMetaLine(task: TaskWithChain): string {
    const parts: string[] = [];

    if (task.plan_date === todayISO) {
      parts.push(t("dashboard.goalTaskMetaToday"));
    } else if (task.plan_date === tomorrowISO) {
      parts.push(t("dashboard.goalTaskMetaTomorrow"));
    } else if (task.plan_date) {
      parts.push(formatDateDisplay(task.plan_date));
    }

    const outgoing = findChainAssignment(assignedOutByGoalId, task.chainIds);
    const incoming = outgoing ? undefined : findChainAssignment(receivedByGoalId, task.chainIds);
    const unresolved = task.status !== "completed" && task.status !== "canceled";

    if (outgoing) {
      parts.push(t("dashboard.goalTaskMetaAssignedTo", { name: outgoing.recipientDisplayName ?? "" }));
    } else if (incoming) {
      parts.push(t("dashboard.goalTaskMetaAssignedBy", { name: incoming.assignerDisplayName ?? "" }));
      if (unresolved) parts.push(t("dashboard.goalTaskMetaYourAction"));
    } else {
      parts.push(t("dashboard.goalTaskMetaYou"));
      if (unresolved) parts.push(t("dashboard.goalTaskMetaYourAction"));
    }

    return parts.join(" · ");
  }

  async function handleAddTask() {
    const title = newTaskTitle.trim();
    const date = newTaskDate.trim();
    if (!title || !date || addingTask || !goal) return;
    setAddingTask(true);
    setMsg(null);
    try {
      // "existing Task creation path" per spec: getPlanWithGoals/
      // upsertGoals, the same two functions Tomorrow/Today's own add-Task
      // flows call -- no raw insert, no second Task system. Always the
      // date actually selected in the form (newTaskDate), never todayISO
      // independently of it -- the field defaults to todayISO when the
      // form opens, but submit reads whatever the user left it at.
      const { plan, goals: planGoals } = await getPlanWithGoals(date);
      const nextSortOrder =
        planGoals.length > 0 ? Math.max(...planGoals.map((g) => g.sort_order ?? 0)) + 1 : 0;
      await upsertGoals(plan.id, [
        { title, priority: newTaskPriority, sort_order: nextSortOrder, outcome_goal_id: goal.id },
      ]);
      setNewTaskTitle("");
      setNewTaskPriority(DEFAULT_PRIORITY);
      setNewTaskDate(todayISO);
      setShowAddTask(false);
      await refreshTasks();
    } catch (e: any) {
      setMsg(e?.message ?? t("goalDetail.addTaskFailed"));
    } finally {
      setAddingTask(false);
    }
  }

  function openEditGoal() {
    if (!goal) return;
    setEditTitle(goal.title);
    setEditDetails(goal.details ?? "");
    setEditPriority(goal.priority);
    setEditGoalType(goal.goal_type);
    setEditTargetValue(goal.target_value != null ? String(goal.target_value) : "");
    setEditCurrentValue(goal.current_value != null ? String(goal.current_value) : "");
    setEditTargetUnit(goal.target_unit ?? "");
    // Goal Engine Phase 2D-3B: fresh drafts from the CURRENT openTasks
    // every time Edit Goal opens -- never carries over stale drafts
    // from a previous open/close, and never includes completed/
    // canceled/broken Tasks (they're not in openTasks at all).
    const drafts: Record<string, { title: string; priority: number }> = {};
    for (const task of openTasks) {
      drafts[task.id] = { title: task.title, priority: task.priority ?? DEFAULT_PRIORITY };
    }
    setTaskDrafts(drafts);
    setTaskSaveErrorById({});
    setShowEditGoal(true);
  }

  // Blank -> null; a valid (possibly decimal) number -> that number;
  // anything else -> undefined, meaning "invalid, caller must not save
  // this as-is" (never silently coerced to 0).
  function parseNullableNumber(raw: string): number | null | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }

  const editTargetValueInvalid = parseNullableNumber(editTargetValue) === undefined;
  const editCurrentValueInvalid = parseNullableNumber(editCurrentValue) === undefined;

  async function handleSaveGoal() {
    if (!goal || savingGoal) return;
    const title = editTitle.trim();
    if (!title) return;
    const parsedTargetValue = parseNullableNumber(editTargetValue);
    const parsedCurrentValue = parseNullableNumber(editCurrentValue);
    if (parsedTargetValue === undefined || parsedCurrentValue === undefined) return;
    setSavingGoal(true);
    setMsg(null);
    try {
      const updated = await updateOutcomeGoal(goal.id, {
        title,
        details: editDetails.trim() || null,
        priority: editPriority,
        goal_type: editGoalType,
        // Always saved regardless of the currently-selected editGoalType
        // -- Target fields are independent of goal_type (Phase 2D-2's
        // own design), so switching types in this same edit never
        // clears them; only their visibility in this form is
        // conditional on editGoalType === "target".
        target_value: parsedTargetValue,
        current_value: parsedCurrentValue,
        target_unit: editTargetUnit.trim() || null,
      });
      setGoal(updated);
      setShowEditGoal(false);
    } catch (e: any) {
      setMsg(e?.message ?? t("goalDetail.editGoalFailed"));
    } finally {
      setSavingGoal(false);
    }
  }

  // Goal Engine Phase 2D-3B: structural edit (title/priority) for ONE
  // open, unlocked child Task -- independent of handleSaveGoal (a
  // different table, a different button, never bundled together).
  // Always targets task.id (the chain's current terminal) -- never an
  // ancestor -- so historical rows earlier in the chain are never
  // touched. Only calls the API(s) for fields that actually changed.
  async function handleSaveTask(task: TaskWithChain) {
    const draft = taskDrafts[task.id];
    if (!draft || savingTaskId) return;
    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) return;
    const titleChanged = trimmedTitle !== task.title;
    const priorityChanged = draft.priority !== (task.priority ?? DEFAULT_PRIORITY);
    if (!titleChanged && !priorityChanged) return;

    setSavingTaskId(task.id);
    setTaskSaveErrorById((prev) => {
      const next = { ...prev };
      delete next[task.id];
      return next;
    });
    try {
      if (titleChanged) {
        await updateGoalTitle(task.id, trimmedTitle);
      }
      if (priorityChanged) {
        // May enforce single-P1 on this Task's own plan (see
        // updateGoalPriority's own doc comment) -- reusing it exactly
        // as-is rather than duplicating that logic here.
        await updateGoalPriority(task.id, task.plan_id, draft.priority);
      }
      // Reconcile from source either way -- also picks up any
      // single-P1 side effect on a DIFFERENT Task in the same plan.
      await refreshTasks();
    } catch (e: any) {
      setTaskSaveErrorById((prev) => ({ ...prev, [task.id]: e?.message ?? t("goalDetail.taskSaveFailed") }));
      // Don't pretend both calls succeeded (or both failed) -- reconcile
      // from source so the UI reflects whatever was actually written,
      // even if only one of the two calls above went through.
      await refreshTasks().catch(() => {});
    } finally {
      setSavingTaskId(null);
    }
  }

  const progressValueInvalid = parseNullableNumber(progressValueDraft) === undefined;

  // Goal Engine Phase 2D-3: updates ONLY current_value -- never
  // target_value/target_unit, never Tasks, never Goal status.
  async function handleSaveProgress() {
    if (!goal || savingProgress) return;
    const parsed = parseNullableNumber(progressValueDraft);
    if (parsed === undefined) return;
    setSavingProgress(true);
    setMsg(null);
    try {
      const updated = await updateOutcomeGoal(goal.id, { current_value: parsed });
      setGoal(updated);
      setShowUpdateProgress(false);
    } catch (e: any) {
      setMsg(e?.message ?? t("goalDetail.updateProgressFailed"));
    } finally {
      setSavingProgress(false);
    }
  }

  async function handleSetStatus(status: OutcomeGoalStatus) {
    if (!goal || settingStatus) return;
    setSettingStatus(true);
    setMsg(null);
    try {
      const updated = await setOutcomeGoalStatus(goal.id, status);
      setGoal(updated);
    } catch (e: any) {
      setMsg(e?.message ?? t("goalDetail.statusChangeFailed"));
    } finally {
      setSettingStatus(false);
    }
  }

  async function handleResolveBroken(goalId: string, resolution: BrokenGoalResolution) {
    if (resolvingBrokenGoalId) return;
    setResolvingBrokenGoalId(goalId);
    setOpenResolveId(null);
    try {
      await resolveBrokenGoal(goalId, resolution);
      await refreshTasks();
    } catch (e: any) {
      setMsg(e?.message ?? t("dashboard.goalTaskResolveFailed"));
    } finally {
      setResolvingBrokenGoalId(null);
    }
  }

  if (loading) {
    return <PageLoadingState label={t("goalDetail.loading")} />;
  }

  if (notFound || !goal) {
    return (
      <div className="space-y-6">
        <div className="card card-highlight text-center py-10">
          <h1 className="text-xl font-bold text-white/90">{t("notFound.title")}</h1>
          <p className="mt-2 text-sm text-white/60">{t("goalDetail.notFoundBody")}</p>
          <Link href="/standup/dashboard" className="btn mt-4 inline-block" style={{ fontSize: "0.8rem" }}>
            ← {t("nav.dashboard")}
          </Link>
        </div>
      </div>
    );
  }

  // Purely additive chainIds alongside the untouched terminal/lifecycle
  // fields -- same pattern as Dashboard's activeGoalCards (Phase 1).
  const tasksWithChain: TaskWithChain[] = tasks.map((ct) => ({
    ...ct.terminal,
    lifecycle: ct.lifecycle,
    chainIds: ct.chain.map((g) => g.id),
  }));
  const total = tasksWithChain.length;
  const completed = tasksWithChain.filter((g) => g.status === "completed").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  // Goal Engine Phase 2D-3: Task-ratio progress (above) is untouched and
  // still computed the same way for every type -- only which number
  // becomes the HEADLINE differs. Only meaningful for goal_type ===
  // "target"; unused (but harmless to compute) otherwise.
  const targetProgress = getTargetProgress({ currentValue: goal.current_value, targetValue: goal.target_value });

  const openTasks = tasksWithChain.filter(
    (g) => g.status !== "completed" && g.status !== "canceled" && g.lifecycle !== "broken"
  );
  const completedTasks = tasksWithChain.filter((g) => g.status === "completed");
  const canceledTasks = tasksWithChain.filter((g) => g.status === "canceled" && g.lifecycle !== "broken");
  const brokenTasks = tasksWithChain.filter((g) => g.lifecycle === "broken");

  const chip = outcomeStatusChip(goal.status);
  const statusText =
    goal.status === "completed"
      ? t("status.completed")
      : goal.status === "abandoned"
      ? t("goalDetail.statusAbandoned")
      : t("goalDetail.statusActive");

  // Goal Engine Phase 2C-3: `navigable` defaults to false -- only the Open
  // Tasks call site below opts in. Completed/Canceled rows (a historical
  // record, not something to act on) stay exactly as they were: plain,
  // non-clickable rows. Built entirely from already-loaded TaskWithChain
  // data (chainIds[0] is always the chain's root) -- no new DB request.
  // getTaskExecutionDestination (Phase 2C-2, untouched) returns null when
  // there's no usable plan_date, in which case the row stays a plain div
  // even when navigable is true.
  function renderTaskRow(task: TaskWithChain, opts?: { navigable?: boolean }) {
    const destination =
      opts?.navigable
        ? getTaskExecutionDestination({
            planDate: task.plan_date,
            todayISO,
            tomorrowISO,
            terminalId: task.id,
            rootId: task.chainIds[0],
          })
        : null;

    const rowContent = (
      <>
        <div className="dashboard-goal-task-row">
          {/* The outer span is the flex container (title truncation can't
              live here -- text-overflow:ellipsis does nothing on an
              element with element children, only on the actual text
              node); min-w-0 on both it and the title span is what lets
              the title actually shrink/truncate inside this row instead
              of pushing the status chip off narrow screens. */}
          <span className="flex items-center gap-1.5 min-w-0 flex-1">
            <span
              className="priority-chip-sm flex-shrink-0"
              style={
                {
                  "--p-bg": getPriorityMeta(task.priority ?? DEFAULT_PRIORITY).bg,
                  "--p-border": getPriorityMeta(task.priority ?? DEFAULT_PRIORITY).border,
                  "--p-color": getPriorityMeta(task.priority ?? DEFAULT_PRIORITY).color,
                } as CSSProperties
              }
            >
              P{task.priority ?? DEFAULT_PRIORITY}
            </span>
            <span className="truncate min-w-0">{task.title}</span>
          </span>
          <span
            className="status-chip-sm flex-shrink-0"
            style={
              {
                "--chip-bg": statusChipColors(task.status).bg,
                "--chip-border": statusChipColors(task.status).border,
                "--chip-color": statusChipColors(task.status).color,
              } as CSSProperties
            }
          >
            <span>{statusLabel(task.status, t)}</span>
            <StatusIcon status={task.status} size={11} />
          </span>
        </div>
        <div className="dashboard-goal-task-meta">{taskMetaLine(task)}</div>
      </>
    );

    if (destination) {
      return (
        <Link key={task.id} href={destination} className="dashboard-goal-task-item">
          {rowContent}
        </Link>
      );
    }
    return (
      <div key={task.id} className="dashboard-goal-task-item">
        {rowContent}
      </div>
    );
  }

  function renderBrokenTaskRow(task: TaskWithChain) {
    return (
      <div key={task.id} className="dashboard-goal-task-row-broken">
        <div className="dashboard-goal-task-row">
          <span className="truncate">{task.title}</span>
          <span
            className="status-chip-sm flex-shrink-0"
            style={
              {
                "--chip-bg": "rgba(245, 158, 11, 0.12)",
                "--chip-border": "rgba(245, 158, 11, 0.4)",
                "--chip-color": "#fcd34d",
              } as CSSProperties
            }
          >
            <span>{t("dashboard.goalTaskNeedsReview")}</span>
            <TriangleAlert size={11} />
          </span>
        </div>
        <div className="dashboard-goal-task-broken-footer">
          <span className="text-[10px] text-white/40">{t("dashboard.goalTaskBrokenHint")}</span>
          <PortalDropdownMenu
            open={openResolveId === task.id}
            onClose={() => setOpenResolveId(null)}
            anchorRef={resolveMenuRef}
            panelClassName="conn-card-menu"
            panelStyle={{ minWidth: "180px" }}
            panel={
              <>
                <button
                  type="button"
                  disabled={resolvingBrokenGoalId === task.id}
                  onClick={() => handleResolveBroken(task.id, "completed")}
                  className="conn-card-menu-item"
                >
                  {t("dashboard.goalTaskMarkCompleted")}
                </button>
                <button
                  type="button"
                  disabled={resolvingBrokenGoalId === task.id}
                  onClick={() => handleResolveBroken(task.id, "canceled")}
                  className="conn-card-menu-item"
                >
                  {t("dashboard.goalTaskMarkCanceled")}
                </button>
                <button
                  type="button"
                  disabled={resolvingBrokenGoalId === task.id}
                  onClick={() => handleResolveBroken(task.id, "removed")}
                  className="conn-card-menu-item"
                >
                  {t("dashboard.goalTaskRemoveFromGoal")}
                </button>
              </>
            }
          >
            <div className="relative flex-shrink-0" ref={openResolveId === task.id ? resolveMenuRef : undefined}>
              <button
                type="button"
                onClick={() => setOpenResolveId((prev) => (prev === task.id ? null : task.id))}
                disabled={resolvingBrokenGoalId === task.id}
                className="btn standup-metal-btn standup-metal-btn--accent"
                style={{ padding: "0.1rem 0.45rem", fontSize: "0.65rem" }}
              >
                {resolvingBrokenGoalId === task.id ? t("dashboard.goalTaskResolving") : t("dashboard.goalTaskResolve")}
              </button>
            </div>
          </PortalDropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card card-highlight">
        <Link href="/standup/dashboard" className="btn" style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}>
          ← {t("nav.dashboard")}
        </Link>

        <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-pink-300/70 font-semibold flex items-center gap-1.5">
              <Target size={12} /> {t("goalDetail.eyebrow")}
            </div>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-white/90 break-words">{goal.title}</h1>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <span
              className="status-chip-sm"
              style={{ "--chip-bg": chip.bg, "--chip-border": chip.border, "--chip-color": chip.color } as CSSProperties}
            >
              {statusText}
            </span>
            <span
              className="status-chip-sm"
              style={
                {
                  "--chip-bg": GOAL_TYPE_CHIP_COLORS.bg,
                  "--chip-border": GOAL_TYPE_CHIP_COLORS.border,
                  "--chip-color": GOAL_TYPE_CHIP_COLORS.color,
                } as CSSProperties
              }
            >
              {t(GOAL_TYPE_CHIP_KEY[goal.goal_type])}
            </span>
          </div>
        </div>

        {goal.details && <p className="mt-3 text-sm text-white/70 whitespace-pre-wrap">{goal.details}</p>}

        <div className="mt-4 text-xs text-white/40">
          {t("goalDetail.createdOn", { date: formatDateDisplay(goal.created_at.slice(0, 10)) })}
        </div>

        {goal.goal_type === "target" ? (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wide text-white/35 font-semibold">
              {t("goalDetail.goalProgressLabel")}
            </div>
            {targetProgress.configured ? (
              <>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-white/50">
                  <span className="font-semibold text-white/80">
                    {formatTargetProgress(targetProgress.currentValue, targetProgress.targetValue, goal.target_unit)}
                  </span>
                  <span className="font-bold text-pink-300/85">{targetProgress.roundedPct}%</span>
                </div>
                <div className="dashboard-goal-progress-track">
                  <div className="dashboard-goal-progress-fill" style={{ width: `${targetProgress.barPct}%` }} />
                </div>
              </>
            ) : (
              <div className="mt-1 text-xs text-white/60">{t("goalDetail.targetNotConfigured")}</div>
            )}

            <div className="mt-3 text-[10px] uppercase tracking-wide text-white/35 font-semibold">
              {t("goalDetail.taskProgressLabel")}
            </div>
            <div className="mt-1 text-xs text-white/50">{t("goalDetail.tasksCompletedStat", { completed, total })}</div>

            {/* Goal Engine Phase 2D-3: a separate, smaller control from
                the full Edit Goal form -- updates ONLY current_value. */}
            <div className="mt-3">
              {!showUpdateProgress ? (
                <button
                  type="button"
                  onClick={() => {
                    setProgressValueDraft(goal.current_value != null ? String(goal.current_value) : "");
                    setShowUpdateProgress(true);
                  }}
                  className="btn"
                  style={{ fontSize: "0.72rem", padding: "0.25rem 0.55rem" }}
                >
                  {t("goalDetail.updateProgress")}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={progressValueDraft}
                    disabled={savingProgress}
                    onChange={(e) => setProgressValueDraft(e.target.value)}
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
                    style={{ width: "7rem" }}
                  />
                  <button
                    type="button"
                    onClick={handleSaveProgress}
                    disabled={savingProgress || progressValueInvalid}
                    className="btn btn-primary"
                    style={{ fontSize: "0.72rem" }}
                  >
                    {savingProgress ? t("goalDetail.saving") : t("goalDetail.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUpdateProgress(false)}
                    disabled={savingProgress}
                    className="btn btn-ghost"
                    style={{ fontSize: "0.72rem" }}
                  >
                    {t("today.cancel")}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between gap-2 text-xs text-white/50">
              <span>{t("goalDetail.tasksCompletedStat", { completed, total })}</span>
              <span className="font-bold text-pink-300/85">{pct}%</span>
            </div>
            <div className="dashboard-goal-progress-track">
              <div className="dashboard-goal-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
      </div>

      {msg && (
        <div className="card text-sm text-red-300" role="alert">
          {msg}
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-semibold text-white/80 mb-2">{t("goalDetail.openTasksTitle")}</h2>
        {openTasks.length === 0 ? (
          <div className="text-xs text-white/40 py-1">{t("goalDetail.noOpenTasks")}</div>
        ) : (
          <div className="dashboard-goal-tasks" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
            {openTasks.map((task) => renderTaskRow(task, { navigable: true }))}
          </div>
        )}

        {!showAddTask ? (
          <button
            type="button"
            onClick={() => setShowAddTask(true)}
            className="btn mt-3 inline-flex items-center gap-1.5"
            style={{ fontSize: "0.78rem" }}
          >
            {t("tomorrow.addTaskToGoal")}
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={newTaskTitle}
              disabled={addingTask}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTask();
                }
              }}
              placeholder={t("tomorrow.taskTitlePlaceholder")}
              autoFocus
              className="w-full min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
            />
            <div className="flex gap-2">
              <select
                value={newTaskPriority}
                disabled={addingTask}
                onChange={(e) => setNewTaskPriority(Number(e.target.value))}
                className="appearance-none rounded-xl border border-white/20 bg-white/10 px-2 py-2 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-white/30 flex-shrink-0"
              >
                {[1, 2, 3, 4, 5].map((p) => (
                  <option key={p} value={p}>
                    P{p} — {t(getPriorityMeta(p).label)}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={newTaskDate}
                disabled={addingTask}
                onChange={(e) => setNewTaskDate(e.target.value)}
                aria-label={t("goalDetail.addTaskDateLabel")}
                className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-2 py-2 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddTask}
                disabled={addingTask || !newTaskTitle.trim() || !newTaskDate.trim()}
                className="btn btn-primary"
                style={{ fontSize: "0.78rem" }}
              >
                {addingTask ? t("today.adding") : t("today.add")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddTask(false);
                  setNewTaskTitle("");
                  setNewTaskDate(todayISO);
                }}
                disabled={addingTask}
                className="btn btn-ghost"
                style={{ fontSize: "0.78rem" }}
              >
                {t("today.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      {brokenTasks.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-amber-300/90 mb-2 flex items-center gap-1.5">
            <TriangleAlert size={14} /> {t("goalDetail.needsReviewTitle")}
          </h2>
          <div className="dashboard-goal-tasks" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
            {brokenTasks.map(renderBrokenTaskRow)}
          </div>
        </div>
      )}

      {completedTasks.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-white/80 mb-2">{t("goalDetail.completedTasksTitle")}</h2>
          <div className="dashboard-goal-tasks" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
            {completedTasks.map((task) => renderTaskRow(task))}
          </div>
        </div>
      )}

      {canceledTasks.length > 0 && (
        <div className="card opacity-60">
          <h2 className="text-sm font-semibold text-white/50 mb-2">{t("goalDetail.canceledTasksTitle")}</h2>
          <div className="dashboard-goal-tasks" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
            {canceledTasks.map((task) => renderTaskRow(task))}
          </div>
        </div>
      )}

      <div className="card">
        {!showEditGoal ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openEditGoal}
              className="btn standup-metal-btn inline-flex items-center gap-1.5"
              style={{ fontSize: "0.78rem" }}
            >
              <Pencil size={13} /> {t("goalDetail.editGoal")}
            </button>
            {goal.status === "active" && (
              <>
                <button
                  type="button"
                  onClick={() => handleSetStatus("completed")}
                  disabled={settingStatus}
                  className="btn standup-metal-btn standup-metal-btn--accent inline-flex items-center gap-1.5"
                  style={{ fontSize: "0.78rem" }}
                >
                  <CheckCircle2 size={13} /> {t("goalDetail.completeGoal")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSetStatus("abandoned")}
                  disabled={settingStatus}
                  className="btn inline-flex items-center gap-1.5"
                  style={{ fontSize: "0.78rem" }}
                >
                  <Ban size={13} /> {t("goalDetail.abandonGoal")}
                </button>
              </>
            )}
            {goal.status !== "active" && (
              <button
                type="button"
                onClick={() => handleSetStatus("active")}
                disabled={settingStatus}
                className="btn standup-metal-btn inline-flex items-center gap-1.5"
                style={{ fontSize: "0.78rem" }}
              >
                <RotateCcw size={13} /> {t("goalDetail.reactivateGoal")}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <GoalTypeSelect
              value={editGoalType}
              disabled={savingGoal}
              onChange={(v) => {
                setEditGoalType(v);
                setGoalTypeInfo(v);
              }}
            />
            <label className="block text-[11px] text-white/40">{t("goalDetail.editTitleLabel")}</label>
            <input
              type="text"
              value={editTitle}
              disabled={savingGoal}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />
            <label className="block text-[11px] text-white/40">{t("goalDetail.editDetailsLabel")}</label>
            <textarea
              value={editDetails}
              disabled={savingGoal}
              onChange={(e) => setEditDetails(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40 resize-none"
            />
            <label className="block text-[11px] text-white/40">{t("goalDetail.editPriorityLabel")}</label>
            <select
              value={editPriority}
              disabled={savingGoal}
              onChange={(e) => setEditPriority(Number(e.target.value))}
              className="appearance-none rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-white/30"
            >
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  P{p} — {t(getPriorityMeta(p).label)}
                </option>
              ))}
            </select>

            {/* Goal Engine Phase 2D-3: visibility follows the EDIT FORM's
                own selected type (editGoalType), not the persisted
                goal.goal_type -- switching One-Time -> Target in this
                same form reveals these immediately, without saving
                first. The underlying state is never cleared when
                switching away, so switching back to Target still shows
                whatever was entered. */}
            {editGoalType === "target" && (
              <>
                <label className="block text-[11px] text-white/40">{t("goalDetail.editTargetValueLabel")}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={editTargetValue}
                  disabled={savingGoal}
                  onChange={(e) => setEditTargetValue(e.target.value)}
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
                />
                <label className="block text-[11px] text-white/40">{t("goalDetail.editCurrentValueLabel")}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={editCurrentValue}
                  disabled={savingGoal}
                  onChange={(e) => setEditCurrentValue(e.target.value)}
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
                />
                <label className="block text-[11px] text-white/40">{t("goalDetail.editTargetUnitLabel")}</label>
                <input
                  type="text"
                  value={editTargetUnit}
                  disabled={savingGoal}
                  onChange={(e) => setEditTargetUnit(e.target.value)}
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
                />
              </>
            )}

            {/* Goal Engine Phase 2D-3B: structural editing (title/
                priority only) for OPEN child Tasks -- completed/
                canceled/broken Tasks are never in openTasks, so they
                never appear here; this editor can't reach them. Each
                row saves independently of the Goal-level Save button
                above/below. */}
            {openTasks.length > 0 && (
              <div className="space-y-3 pt-2 mt-2 border-t border-white/10">
                <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold">
                  {t("goalDetail.openTasksTitle")}
                </div>
                {openTasks.map((task) => {
                  const draft = taskDrafts[task.id] ?? {
                    title: task.title,
                    priority: task.priority ?? DEFAULT_PRIORITY,
                  };
                  const assignment = findChainAssignment(assignedOutByGoalId, task.chainIds);
                  const isLocked = assignment?.assignmentType === "exclusive" && assignment.status === "accepted";
                  const trimmedDraftTitle = draft.title.trim();
                  const isDirty =
                    trimmedDraftTitle !== task.title || draft.priority !== (task.priority ?? DEFAULT_PRIORITY);
                  const isSavingThis = savingTaskId === task.id;
                  const saveError = taskSaveErrorById[task.id];

                  return (
                    <div key={task.id} className="space-y-1">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={draft.title}
                          disabled={isLocked || isSavingThis}
                          onChange={(e) =>
                            setTaskDrafts((prev) => ({
                              ...prev,
                              [task.id]: { ...draft, title: e.target.value },
                            }))
                          }
                          className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
                        />
                        <select
                          value={draft.priority}
                          disabled={isLocked || isSavingThis}
                          onChange={(e) =>
                            setTaskDrafts((prev) => ({
                              ...prev,
                              [task.id]: { ...draft, priority: Number(e.target.value) },
                            }))
                          }
                          className="appearance-none rounded-xl border border-white/20 bg-white/10 px-2 py-2 text-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-white/30 disabled:opacity-50 flex-shrink-0"
                        >
                          {[1, 2, 3, 4, 5].map((p) => (
                            <option key={p} value={p}>
                              P{p}
                            </option>
                          ))}
                        </select>
                        {!isLocked && (
                          <button
                            type="button"
                            onClick={() => handleSaveTask(task)}
                            disabled={!isDirty || !trimmedDraftTitle || isSavingThis}
                            className="btn btn-primary flex-shrink-0"
                            style={{ fontSize: "0.7rem", padding: "0.3rem 0.5rem" }}
                          >
                            {isSavingThis ? t("goalDetail.saving") : t("goalDetail.saveTask")}
                          </button>
                        )}
                      </div>
                      {isLocked && (
                        <div className="text-[10px] text-white/35">
                          {t("dashboard.goalTaskMetaAssignedTo", { name: assignment?.recipientDisplayName ?? "" })}
                        </div>
                      )}
                      {saveError && <div className="text-[10px] text-red-400">{saveError}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveGoal}
                disabled={savingGoal || !editTitle.trim() || editTargetValueInvalid || editCurrentValueInvalid}
                className="btn btn-primary"
                style={{ fontSize: "0.78rem" }}
              >
                {savingGoal ? t("goalDetail.saving") : t("goalDetail.save")}
              </button>
              <button
                type="button"
                onClick={() => setShowEditGoal(false)}
                disabled={savingGoal}
                className="btn btn-ghost"
                style={{ fontSize: "0.78rem" }}
              >
                {t("today.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      {goalTypeInfo && (
        <GoalTypeInfoModal goalType={goalTypeInfo} onDismiss={() => setGoalTypeInfo(null)} />
      )}
    </div>
  );
}

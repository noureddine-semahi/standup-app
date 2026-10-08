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
import {
  getOutcomeGoalById,
  getConceptualTasksByOutcomeGoalIds,
  updateOutcomeGoal,
  setOutcomeGoalStatus,
  getMyGoalAssignments,
  resolveBrokenGoal,
  getPlanWithGoals,
  upsertGoals,
  toISODate,
  addDays,
  formatDateDisplay,
  type OutcomeGoal,
  type OutcomeGoalStatus,
  type ConceptualTask,
  type ArchivedGoal,
  type GoalAssignment,
  type BrokenGoalResolution,
} from "@/lib/supabase/db";
import PageLoadingState from "@/components/PageLoadingState";
import PortalDropdownMenu from "@/components/PortalDropdownMenu";
import StatusIcon from "@/components/StatusIcon";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { DEFAULT_PRIORITY } from "@/lib/goalLogic";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
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
  const [savingGoal, setSavingGoal] = useState(false);
  const [settingStatus, setSettingStatus] = useState(false);

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
    setShowEditGoal(true);
  }

  async function handleSaveGoal() {
    if (!goal || savingGoal) return;
    const title = editTitle.trim();
    if (!title) return;
    setSavingGoal(true);
    setMsg(null);
    try {
      const updated = await updateOutcomeGoal(goal.id, {
        title,
        details: editDetails.trim() || null,
        priority: editPriority,
      });
      setGoal(updated);
      setShowEditGoal(false);
    } catch (e: any) {
      setMsg(e?.message ?? t("goalDetail.editGoalFailed"));
    } finally {
      setSavingGoal(false);
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

  function renderTaskRow(task: TaskWithChain) {
    return (
      <div key={task.id} className="dashboard-goal-task-item">
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
          <span
            className="status-chip-sm flex-shrink-0"
            style={{ "--chip-bg": chip.bg, "--chip-border": chip.border, "--chip-color": chip.color } as CSSProperties}
          >
            {statusText}
          </span>
        </div>

        {goal.details && <p className="mt-3 text-sm text-white/70 whitespace-pre-wrap">{goal.details}</p>}

        <div className="mt-4 text-xs text-white/40">
          {t("goalDetail.createdOn", { date: formatDateDisplay(goal.created_at.slice(0, 10)) })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 text-xs text-white/50">
          <span>{t("goalDetail.tasksCompletedStat", { completed, total })}</span>
          <span className="font-bold text-pink-300/85">{pct}%</span>
        </div>
        <div className="dashboard-goal-progress-track">
          <div className="dashboard-goal-progress-fill" style={{ width: `${pct}%` }} />
        </div>
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
            {openTasks.map(renderTaskRow)}
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
            {completedTasks.map(renderTaskRow)}
          </div>
        </div>
      )}

      {canceledTasks.length > 0 && (
        <div className="card opacity-60">
          <h2 className="text-sm font-semibold text-white/50 mb-2">{t("goalDetail.canceledTasksTitle")}</h2>
          <div className="dashboard-goal-tasks" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
            {canceledTasks.map(renderTaskRow)}
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
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveGoal}
                disabled={savingGoal || !editTitle.trim()}
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
    </div>
  );
}

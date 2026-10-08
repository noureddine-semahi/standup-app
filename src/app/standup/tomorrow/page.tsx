"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  addDays,
  addGoalNote,
  awardPlanningPoints,
  getAttachmentsForGoals,
  getChecklistItemsForGoals,
  getNotesForGoals,
  getPlanWithGoals,
  isYesterdayReviewed,
  submitPlan,
  toISODate,
  formatDateDisplay,
  formatDateTimeDisplay,
  upsertGoals,
  deleteGoal,
  getSuggestedTemplatesForDate,
  addGoalFromTemplate,
  ensurePaymentReminderGoals,
  listConnections,
  connectionDisplayName,
  createGoalAssignment,
  getMyGoalAssignments,
  getStreakPassBalance,
  getStreakPassCoveredDates,
  useStreakPass,
  rescheduleGoalToDate,
  getOutcomeGoals,
  createOutcomeGoal,
  findOrphanedContinuationIds,
  type ChecklistItem,
  type GoalAttachment,
  type RecurringGoalTemplate,
  type Connection,
  type GoalAssignment,
  type GoalAssignmentType,
  type Goal,
  type StreakPassBalance,
  type OutcomeGoal,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";
import { notifyPointsUpdated } from "@/lib/pointsBus";
import { notifyNotificationsUpdated } from "@/lib/notificationsBus";
import {
  applyPriorityChange,
  compactForSave,
  compactForUI,
  normalizeGoals,
  sortGoalsForDisplay,
  DEFAULT_PRIORITY,
  MAX_GOALS,
  type DraftGoal,
} from "@/lib/goalLogic";
import { getPriorityMeta } from "@/lib/priorityStyles";
import GoalTimeline from "@/components/GoalTimeline";
import GoalChecklist from "@/components/GoalChecklist";
import GoalAttachments from "@/components/GoalAttachments";
import GoalNumberOrb from "@/components/GoalNumberOrb";
import PageLoadingState from "@/components/PageLoadingState";
import PortalDropdownMenu from "@/components/PortalDropdownMenu";
import { buildGoalTimeline } from "@/lib/goalTimeline";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { statusLabel } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import { Link2, Plus, Sun, X, MessageCircle, NotebookText, Redo2, Lock, Unlock, Ticket, CheckCircle2, Check, ChevronDown, UserPlus, Target, Trash2, ArrowRightLeft, Clock } from "lucide-react";

export default function TomorrowGoalsPage() {
  const { t } = useLanguage();
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);
  const todayISO = useMemo(() => toISODate(new Date()), []);
  // Deep-linking in from Dashboard's tappable goal rows (?goal=<id>) —
  // scrolls to and briefly highlights that goal once loaded, same
  // guarded-ref one-shot pattern as Today's own page/Social's ?post=.
  const searchParams = useSearchParams();
  const highlightGoalId = searchParams.get("goal");
  const scrolledToHighlightRef = useRef(false);
  const [loading, setLoading] = useState(true);
  // Drafting/saving tomorrow's plan is always available. Submitting
  // (finalizing) it is gated separately — only once today has been
  // reviewed — so this no longer blocks the whole page.
  const [submitEligible, setSubmitEligible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Phase 8A.1: gates the mobile action bar's createPortal(document.body)
  // call until after hydration (same pattern RescheduleModal/other modals
  // in this app already use for their own portals) -- document doesn't
  // exist during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [planId, setPlanId] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<string>("draft");
  const [passBalance, setPassBalance] = useState<StreakPassBalance | null>(null);
  const [coveredByPass, setCoveredByPass] = useState(false);
  const [usingPass, setUsingPass] = useState(false);

  const [goals, setGoals] = useState<DraftGoal[]>([
    { title: "", sort_order: 0, priority: DEFAULT_PRIORITY },
    { title: "", sort_order: 1, priority: DEFAULT_PRIORITY },
    { title: "", sort_order: 2, priority: DEFAULT_PRIORITY },
  ]);

  const [msg, setMsg] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [suggestedTemplates, setSuggestedTemplates] = useState<RecurringGoalTemplate[]>([]);
  const [addingTemplateId, setAddingTemplateId] = useState<string | null>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [goalComments, setGoalComments] = useState<Record<string, any[]>>({});
  const [checklistItems, setChecklistItems] = useState<Record<string, ChecklistItem[]>>({});
  const [attachments, setAttachments] = useState<Record<string, GoalAttachment[]>>({});

  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});
  // Per-goal "Add Note" input, toggled from next to the priority/remove controls.
  const [showNoteInput, setShowNoteInput] = useState<Record<string, boolean>>({});
  // Keyed by array index (not goal id) since a link can be set before the
  // goal has been saved at all, unlike checklist/attachments which require
  // a real id.
  const [showLinkInput, setShowLinkInput] = useState<Record<number, boolean>>({});

  const [acceptedConnections, setAcceptedConnections] = useState<Connection[]>([]);
  const [goalAssignments, setGoalAssignments] = useState<GoalAssignment[]>([]);
  const [assigningGoalIds, setAssigningGoalIds] = useState<Set<string>>(new Set());
  const [assignError, setAssignError] = useState<string | null>(null);
  // Which type the "Assign to" picker will use for a row's NEXT assignment
  // — chosen via the Lock/Unlock toggle before a recipient is picked.
  const [assignTypeByGoalId, setAssignTypeByGoalId] = useState<Record<string, GoalAssignmentType>>({});
  // At most one goal's Exclusive/Shared dropdown open at a time -- same
  // single-ref click-outside pattern as Social's connection-card menu.
  const [openPrivacyMenuId, setOpenPrivacyMenuId] = useState<string | null>(null);
  const privacyMenuRef = useRef<HTMLDivElement | null>(null);
  // Assign control, same pattern as Exclusive/Shared above -- replaces the
  // old native <select> (whose own rendered text couldn't be kept from
  // truncating/colliding with its overlaid icon) with a button + dropdown
  // menu listing connections, so the button's own label is just the
  // short, never-truncated word "Assign".
  const [openAssignMenuId, setOpenAssignMenuId] = useState<string | null>(null);
  const assignMenuRef = useRef<HTMLDivElement | null>(null);

  // Goal Engine Phase 3 — optional Task -> Outcome Goal link. Loaded once
  // (all statuses, so an already-linked Task can still show a Goal that's
  // since gone completed/abandoned); the picker's own option list filters
  // to active only, per spec. Same single-ref click-outside pattern as the
  // Exclusive/Shared menu above.
  const [outcomeGoals, setOutcomeGoals] = useState<OutcomeGoal[]>([]);
  const [openGoalPickerId, setOpenGoalPickerId] = useState<string | null>(null);
  const goalPickerMenuRef = useRef<HTMLDivElement | null>(null);

  // Goal Engine Phase 4C — "+ Add" is now a type-first, structured flow:
  // tap it, pick Standalone Task or Major Goal, THEN fill a small
  // validated form (title [+ tasks for a Goal]) before anything gets
  // created. One state machine instead of Phase 4's two booleans, same
  // "plain conditional render, no ref-based floating menu" reasoning as
  // before -- this whole action row still renders twice (desktop inline +
  // mobile portal), and a shared ref would get fought over by both
  // physical mounts.
  type AddFlowStep = "closed" | "choice" | "task" | "goal";
  const [addFlowStep, setAddFlowStep] = useState<AddFlowStep>("closed");

  // Standalone Task form.
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState(DEFAULT_PRIORITY);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);

  // Major Goal form — goal title + >=2 task rows (title + priority each).
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalTasks, setNewGoalTasks] = useState<{ title: string; priority: number }[]>([
    { title: "", priority: DEFAULT_PRIORITY },
    { title: "", priority: DEFAULT_PRIORITY },
  ]);
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [goalCreateError, setGoalCreateError] = useState<string | null>(null);

  function resetAddFlow() {
    setAddFlowStep("closed");
    setNewTaskTitle("");
    setNewTaskPriority(DEFAULT_PRIORITY);
    setTaskCreateError(null);
    setNewGoalTitle("");
    setNewGoalTasks([
      { title: "", priority: DEFAULT_PRIORITY },
      { title: "", priority: DEFAULT_PRIORITY },
    ]);
    setGoalCreateError(null);
  }

  // Appends a new draft row directly via goalsRef (not just setGoals) so
  // the immediate persistGoals(true) call right after actually sees it --
  // persistGoals always reads goalsRef.current, which otherwise only
  // catches up to a same-tick setGoals one render later (see goalsRef's
  // own sync effect below). Returns false (and sets the shared "max
  // goals" message) if it wouldn't fit.
  function appendDraftRow(row: { title: string; priority: number; outcome_goal_id: string | null }): boolean {
    if (goalsRef.current.length >= MAX_GOALS) {
      setMsg(t("tomorrow.maxGoals", { max: MAX_GOALS }));
      return false;
    }
    const next = [...goalsRef.current, { ...row, sort_order: goalsRef.current.length }];
    goalsRef.current = next;
    setGoals(next);
    return true;
  }

  async function handleCreateStandaloneTask() {
    const title = newTaskTitle.trim();
    if (!title || creatingTask) return;
    setCreatingTask(true);
    setTaskCreateError(null);
    try {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (!appendDraftRow({ title, priority: newTaskPriority, outcome_goal_id: null })) return;
      await persistGoals(true);
      resetAddFlow();
    } catch (e: any) {
      setTaskCreateError(e?.message ?? t("tomorrow.taskCreateFailed"));
    } finally {
      setCreatingTask(false);
    }
  }

  const validGoalTaskCount = newGoalTasks.filter((tk) => tk.title.trim().length > 0).length;
  const canCreateMajorGoal = newGoalTitle.trim().length > 0 && validGoalTaskCount >= 2 && !creatingGoal;

  async function handleCreateMajorGoal() {
    const title = newGoalTitle.trim();
    const validTasks = newGoalTasks
      .map((tk) => ({ title: tk.title.trim(), priority: tk.priority }))
      .filter((tk) => tk.title.length > 0);
    if (!title || validTasks.length < 2 || creatingGoal) return;
    setCreatingGoal(true);
    setGoalCreateError(null);
    try {
      if (goalsRef.current.length + validTasks.length > MAX_GOALS) {
        setGoalCreateError(t("tomorrow.maxGoals", { max: MAX_GOALS }));
        return;
      }
      const created = await createOutcomeGoal(title);
      setOutcomeGoals((prev) => [created, ...prev]);

      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      for (const tk of validTasks) {
        appendDraftRow({ title: tk.title, priority: tk.priority, outcome_goal_id: created.id });
      }
      await persistGoals(true);
      resetAddFlow();
    } catch (e: any) {
      setGoalCreateError(e?.message ?? t("tomorrow.goalCreateFailed"));
    } finally {
      setCreatingGoal(false);
    }
  }

  const inputRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);

  const originalIdsRef = useRef<Set<string>>(new Set());
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const lastSavedHashRef = useRef<string>("");
  const skipNextBlurAutosaveRef = useRef(false);
  const priorityChangeInProgressRef = useRef(false);

  // Debounced autosave is triggered from setTimeout callbacks that may have
  // been created several renders ago (stale closures). Reading `goals`
  // directly in persistGoals() would silently save an outdated snapshot —
  // this ref always holds the latest value regardless of which render's
  // closure ends up invoking the save.
  const goalsRef = useRef<DraftGoal[]>(goals);
  useEffect(() => {
    goalsRef.current = goals;
  }, [goals]);

  useEffect(() => {
    listConnections()
      .then((cs) => setAcceptedConnections(cs.filter((c) => c.status === "accepted")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getOutcomeGoals()
      .then(setOutcomeGoals)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scrolledToHighlightRef.current || loading || !highlightGoalId) return;
    const el = document.querySelector(`[data-goal-id="${highlightGoalId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      scrolledToHighlightRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, highlightGoalId]);

  // openPrivacyMenuId's own click-outside/scroll-close handling now lives
  // inside PortalDropdownMenu (its panel is portaled to document.body, no
  // longer a DOM descendant of the trigger wrapper this ref points to, so
  // a plain .contains() check here would immediately close it on every
  // click inside the panel itself).

  useEffect(() => {
    if (!openGoalPickerId) return;
    function handleClickOutside(e: MouseEvent) {
      if (goalPickerMenuRef.current && !goalPickerMenuRef.current.contains(e.target as Node)) {
        setOpenGoalPickerId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openGoalPickerId]);

  useEffect(() => {
    if (!openAssignMenuId) return;
    function handleClickOutside(e: MouseEvent) {
      if (assignMenuRef.current && !assignMenuRef.current.contains(e.target as Node)) {
        setOpenAssignMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openAssignMenuId]);

  function refreshGoalAssignments() {
    return getMyGoalAssignments()
      .then(setGoalAssignments)
      .catch(() => {});
  }

  useEffect(() => {
    refreshGoalAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Goals assigned out to a connection (declined ones excluded -- a
  // decline voids the delegation and the goal reverts to fully normal),
  // keyed by the assigner's own goals.id so a row can look itself up in
  // O(1) and switch to read-only + the recipient's live status.
  const assignedOutByGoalId = useMemo(() => {
    const map = new Map<string, GoalAssignment>();
    for (const a of goalAssignments) {
      if (a.direction === "assigned" && a.status !== "declined" && a.status !== "canceled" && a.assignerGoalId) {
        map.set(a.assignerGoalId, a);
      }
    }
    return map;
  }, [goalAssignments]);

  // Mirror of the map above, for the other side: goals of mine that are
  // themselves the materialized product of an assignment I received and
  // accepted. Locks the Assign-to control on that row -- see the same
  // map in today/page.tsx for the full reasoning.
  const receivedByGoalId = useMemo(() => {
    const map = new Map<string, GoalAssignment>();
    for (const a of goalAssignments) {
      if (a.direction === "received" && a.status === "accepted" && a.recipientGoalId) {
        map.set(a.recipientGoalId, a);
      }
    }
    return map;
  }, [goalAssignments]);

  useEffect(() => {
    if (pendingFocusIndex == null) return;

    const raf = requestAnimationFrame(() => {
      const el = inputRefs.current[pendingFocusIndex];
      if (el) {
        el.focus();
        const v = el.value ?? "";
        el.setSelectionRange(v.length, v.length);
      }
      setPendingFocusIndex(null);
    });

    return () => cancelAnimationFrame(raf);
  }, [goals.length, pendingFocusIndex]);

  // Fires the debounced autosave AFTER a priority change has actually been
  // applied to `goals`. Doing this in an effect (rather than a setTimeout
  // inside the select's onChange) matters: a setTimeout callback created
  // inside the onChange closes over that render's stale `goals`/`persistGoals`,
  // so it would silently save the OLD priority even though the UI shows the
  // new one. An effect keyed on `goals` always runs with a fresh closure.
  useEffect(() => {
    if (!priorityChangeInProgressRef.current) return;
    priorityChangeInProgressRef.current = false;
    scheduleAutoSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals]);

  function computeHashForSave(currentGoals: DraftGoal[]) {
    const normalized = normalizeGoals(currentGoals).map((g) => ({
      id: g.id ?? null,
      sort_order: g.sort_order,
      title: (g.title ?? "").trim(),
      priority:
        typeof g.priority === "number" && Number.isFinite(g.priority)
          ? g.priority
          : DEFAULT_PRIORITY,
      // Left out of this comparison, a time-only edit produced the exact
      // same hash as before it — autosave and the manual Save button both
      // saw "no changes" and silently skipped saving it entirely. is_all_day
      // and link_url are new fields with the exact same failure mode, so
      // both go in here too from the start rather than after hitting it again.
      time_of_day: g.time_of_day || null,
      is_all_day: !!(g as any).is_all_day,
      link_url: (g as any).link_url || null,
    }));
    return JSON.stringify(normalized);
  }

  // Drag-drop handlers for reordering
  function handleDragStart(idx: number) {
    setDraggedIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    
    setGoals(prev => {
      const newGoals = [...prev];
      const [dragged] = newGoals.splice(draggedIdx, 1);
      newGoals.splice(idx, 0, dragged);
      return newGoals.map((g, i) => ({ ...g, sort_order: i }));
    });
    
    setDraggedIdx(idx);
  }

  function handleDragEnd() {
    setDraggedIdx(null);
    scheduleAutoSave();
  }

  // silent: true for refetches after an action (e.g. submitting the plan) —
  // the page already has content on screen, so re-showing the full-page
  // loading state would blank everything out and read as a full reload.
  // Only the initial mount load should show it.
  async function refresh(opts: { silent?: boolean } = {}) {
    const { silent = false } = opts;
    if (!silent) setLoading(true);
    if (!silent) setMsg(null);

    // Independent of each other, so they run together.
    const [eligible, { plan, goals: dbGoals }, balance, coveredDates] = await Promise.all([
      isYesterdayReviewed(),
      getPlanWithGoals(tomorrowISO),
      getStreakPassBalance(),
      getStreakPassCoveredDates(tomorrowISO, tomorrowISO),
    ]);
    setSubmitEligible(eligible);
    setPlanId(plan.id);
    setPlanStatus(plan.status);
    setPassBalance(balance);
    setCoveredByPass(coveredDates.has(tomorrowISO));

    // Fetch reschedule origin data, previous actions/comments, checklist
    // items, and attachments for all goals together — none of these four
    // depend on each other, only on goalIds. Checklist/attachments keep
    // their own error isolation (a missing/misconfigured table there
    // shouldn't take down the whole goals list).
    const goalIds = dbGoals.map(g => g.id).filter(Boolean) as string[];
    let rescheduleOrigins: Record<string, { from_date: string; reason: string | null }> = {};
    let notesMap: Record<string, any[]> = {};
    let orphanIds = new Set<string>();

    if (goalIds.length > 0) {
      const [reschedulesResult, notesResult, checklistResult, attachmentsResult] = await Promise.all([
        supabase
          .from("goal_reschedules")
          .select("from_goal_id, materialized_goal_id, from_date, reason")
          .in("materialized_goal_id", goalIds)
          .eq("materialized", true),
        // Goes through getNotesForGoals (get_goal_notes RPC), not a plain
        // table query, so an assigned-out goal's timeline also includes the
        // recipient's own logged actions on their separate copy.
        getNotesForGoals(goalIds).catch((e) => {
          console.error("Failed to load goal notes", e);
          return {} as Record<string, any[]>;
        }),
        getChecklistItemsForGoals(goalIds).catch((e) => {
          console.error("Failed to load checklist items", e);
          return {} as Record<string, ChecklistItem[]>;
        }),
        getAttachmentsForGoals(goalIds).catch((e) => {
          console.error("Failed to load attachments", e);
          return {} as Record<string, GoalAttachment[]>;
        }),
      ]);

      reschedulesResult.data?.forEach((item) => {
        if (item.materialized_goal_id) {
          rescheduleOrigins[item.materialized_goal_id] = {
            from_date: item.from_date,
            reason: item.reason,
          };
        }
      });

      // A materialized continuation whose own source has since been
      // resolved (completed/canceled) gets auto-canceled by
      // cancelOrphanedReschedules -- it must stay in the database for
      // history, but never show as active, actionable work on the future
      // day it was materialized onto. Re-derives the same structural
      // signal cancelOrphanedReschedules itself used to cancel it
      // (lineage + source status), rather than tracking a separate flag;
      // an ordinary, independently user-canceled Task never matches an
      // edge here and is untouched.
      const canceledIds = new Set(dbGoals.filter((g) => g.status === "canceled").map((g) => g.id));
      const candidateEdges = (reschedulesResult.data ?? []).filter(
        (e) => e.materialized_goal_id && canceledIds.has(e.materialized_goal_id)
      );
      if (candidateEdges.length > 0) {
        const sourceIds = [...new Set(candidateEdges.map((e) => e.from_goal_id))];
        const { data: sourceRows } = await supabase.from("goals").select("id, status").in("id", sourceIds);
        const sourceStatusById = new Map((sourceRows ?? []).map((g) => [g.id, g.status as string]));
        orphanIds = findOrphanedContinuationIds(candidateEdges, sourceStatusById);
      }

      notesMap = notesResult;
      setGoalComments(notesMap);
      setChecklistItems(checklistResult);
      setAttachments(attachmentsResult);
    }

    // Attach reschedule origin to goals -- excluding auto-canceled orphan
    // continuations entirely. They stay in the database (and Calendar/
    // history views) but never render as an active Commitment here, and
    // never count toward totals/validation/submission below, all of
    // which are derived from this `goals` state.
    const goalsWithOrigin = dbGoals
      .filter((g) => !orphanIds.has(g.id))
      .map(g => ({
        ...g,
        rescheduled_from_date: rescheduleOrigins[g.id]?.from_date || null,
        reschedule_reason: rescheduleOrigins[g.id]?.reason || null,
      }));

    // Attach comments to goals using notesMap (not state which is stale)
    const goalsWithData = goalsWithOrigin.map(g => ({
      ...g,
      previous_actions: notesMap[g.id] || [],
    }));

    // Excluded orphans are left out of the tracked id set too, so the
    // next autosave's delete-diff (toDelete in persistGoals) never
    // mistakes their absence from `goals` state for the user having
    // deleted them -- they must never be deleted, only hidden.
    originalIdsRef.current = new Set(goalIds.filter((id) => !orphanIds.has(id)));

    const rows = compactForUI(goalsWithData);
    setGoals(rows);
    lastSavedHashRef.current = computeHashForSave(rows);

    if (!silent) setLoading(false);
  }

  useEffect(() => {
    refresh().catch((e) => {
      setMsg(e?.message ?? t("tomorrow.failedLoad"));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tomorrowISO]);

  useEffect(() => {
    getSuggestedTemplatesForDate(tomorrowISO)
      .then(setSuggestedTemplates)
      .catch(() => {});
    // Payment reminders are auto-created (not a tap-to-add suggestion like
    // templates) -- explicit user call. Silently creates whatever's due,
    // then refreshes so it shows up in the goal list, with a one-line
    // notice so a goal appearing unprompted doesn't look like a bug.
    ensurePaymentReminderGoals(tomorrowISO)
      .then((created) => {
        if (created.length > 0) {
          refresh({ silent: true });
          setMsg(t("tomorrow.paymentGoalsAdded", { names: created.map((a) => a.name).join(", ") }));
        }
      })
      .catch(() => {});
  }, [tomorrowISO]);

  async function handleAddSuggestedTemplate(template: RecurringGoalTemplate) {
    if (addingTemplateId) return;
    setAddingTemplateId(template.id);
    try {
      await addGoalFromTemplate(template, tomorrowISO);
      setSuggestedTemplates((prev) => prev.filter((t2) => t2.id !== template.id));
      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.failedAddSuggestedTask"));
    } finally {
      setAddingTemplateId(null);
    }
  }

  /**
   * "Cover this day in advance" — same use_streak_pass RPC as the past-day
   * flow on /standup/date/[date]. Covering the day means it'll never
   * actually be reviewed, so any content already drafted for it is
   * automatically rescheduled to the day after (via the same
   * rescheduleGoalToDate/goal_reschedules mechanism a manual reschedule
   * uses) before the pass itself is spent — nothing is left silently
   * stranded on a day that'll auto-close with no review.
   */
  async function handleUseStreakPass() {
    if (!planId || usingPass || coveredByPass) return;

    const savedRows = await persistGoals(true);
    const draftGoalsWithContent = savedRows.filter(
      (g): g is DraftGoal & { id: string } => !!g.id && (g.title ?? "").trim().length > 0
    );
    const dayAfterISO = toISODate(addDays(new Date(`${tomorrowISO}T00:00:00`), 1));

    const confirmKey =
      draftGoalsWithContent.length > 0 ? "datePage.confirmUseStreakPassAdvanceWithDrafts" : "datePage.confirmUseStreakPassAdvance";
    if (
      !window.confirm(
        t(confirmKey, {
          count: passBalance?.available ?? 0,
          date: formatDateDisplay(tomorrowISO),
          goalCount: draftGoalsWithContent.length,
          nextDate: formatDateDisplay(dayAfterISO),
        })
      )
    ) {
      return;
    }

    setUsingPass(true);
    setMsg(null);
    try {
      // Sequential, not Promise.all — each call inserts into
      // goal_reschedules and can trigger materialization (see
      // rescheduleGoalToDate), so keeping these one-at-a-time avoids
      // racing that against itself for more than one drafted goal.
      for (const g of draftGoalsWithContent) {
        await rescheduleGoalToDate({
          goal: g as unknown as Goal,
          toDateISO: dayAfterISO,
          reason: t("tomorrow.autoRescheduledForPassReason"),
        });
      }

      await useStreakPass(planId);
      await refresh({ silent: true });
      setMsg(t("datePage.streakPassUsed"));
    } catch (e: any) {
      setMsg(e?.message ?? t("datePage.failedUseStreakPass"));
    } finally {
      setUsingPass(false);
    }
  }

  async function handleAssignGoal(goalId: string, recipientId: string) {
    if (assigningGoalIds.has(goalId)) return;
    setAssigningGoalIds((prev) => new Set(prev).add(goalId));
    setAssignError(null);
    try {
      await createGoalAssignment(goalId, recipientId, assignTypeByGoalId[goalId] ?? "exclusive");
      await refreshGoalAssignments();
      notifyNotificationsUpdated();
    } catch (e: any) {
      setAssignError(e?.message ?? t("goalAssign.failed"));
    } finally {
      setAssigningGoalIds((prev) => {
        const next = new Set(prev);
        next.delete(goalId);
        return next;
      });
    }
  }

  function addMoreGoal() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setGoals((prev) => {
      if (prev.length >= MAX_GOALS) {
        setMsg(t("tomorrow.maxGoals", { max: MAX_GOALS }));
        return prev;
      }
      const nextIndex = prev.length;
      const next = [
        ...prev,
        { title: "", sort_order: nextIndex, priority: DEFAULT_PRIORITY },
      ];
      setPendingFocusIndex(nextIndex);
      return next;
    });
  }

  // Goal Engine Phase 4B — "+ Add Task" nested inside a Goal card. Exact
  // mirror of addMoreGoal() above, the only difference is the new row
  // starts pre-linked to that Goal. inputRefs/pendingFocusIndex are plain
  // index-keyed arrays/state, not tied to DOM position, so the usual
  // focus-the-new-row behavior works identically even though this row
  // renders inside a Goal card instead of the flat list.
  function addTaskLinkedToGoal(outcomeGoalId: string) {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setGoals((prev) => {
      if (prev.length >= MAX_GOALS) {
        setMsg(t("tomorrow.maxGoals", { max: MAX_GOALS }));
        return prev;
      }
      const nextIndex = prev.length;
      const next = [
        ...prev,
        { title: "", sort_order: nextIndex, priority: DEFAULT_PRIORITY, outcome_goal_id: outcomeGoalId },
      ];
      setPendingFocusIndex(nextIndex);
      return next;
    });
  }

  // Goal titles are editable textareas, not inputs, so a long auto-generated
  // title (e.g. a payment reminder's "Pay X — $Y min due Z") wraps instead
  // of silently scrolling off the visible width. Grows to fit its content
  // on every keystroke (onChange) and whenever a title changes from outside
  // typing too, e.g. a goal arriving via refresh() (the effect below).
  function autoResizeTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    inputRefs.current.forEach(autoResizeTextarea);
  }, [goals]);

  function onGoalKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>, idx: number) {
    const isEnter = e.key === "Enter" || e.key === "NumpadEnter";
    if (!isEnter) return;
    if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    if (submitting) return;
    if (planStatus === "locked") return;

    e.preventDefault();
    skipNextBlurAutosaveRef.current = true;

    const isLast = idx === goals.length - 1;
    if (isLast) {
      if (goals.length >= MAX_GOALS) {
        setMsg(t("tomorrow.maxGoals", { max: MAX_GOALS }));
        return;
      }
      addMoreGoal();
    } else {
      setPendingFocusIndex(idx + 1);
    }
  }

  // Returns the authoritative, id-bearing goal rows -- callers that need to
  // know for certain every typed title has a real id (e.g. before deciding
  // whether a whole-day reschedule is needed) should use this return value
  // rather than the `goals` state var, which may still be a render behind
  // regardless of the await above it.
  async function persistGoals(silent?: boolean): Promise<DraftGoal[]> {
    if (!planId) return goalsRef.current;
    if (planStatus === "locked") return goalsRef.current;
    if (autosaveInFlightRef.current) return goalsRef.current;

    const compacted = compactForSave(goalsRef.current);

    const currentHash = computeHashForSave(compacted);
    if (currentHash === lastSavedHashRef.current) {
      if (!silent) setMsg(t("tomorrow.noChanges"));
      return goalsRef.current;
    }

    autosaveInFlightRef.current = true;
    if (!silent) setSubmitting(true);

    try {
      const toSave = compacted
        .map((g) => ({
          ...g,
          title: (g.title ?? "").trim(),
          priority:
            typeof g.priority === "number" && Number.isFinite(g.priority)
              ? g.priority
              : DEFAULT_PRIORITY,
        }))
        .filter((g) => g.title.length > 0);

      const currentIds = new Set(
        toSave.map((g) => g.id).filter(Boolean) as string[]
      );

      const toDelete: string[] = [];
      for (const id of originalIdsRef.current) {
        if (!currentIds.has(id)) toDelete.push(id);
      }

      if (toDelete.length > 0) {
        await Promise.all(
          toDelete.map(async (id) => {
            try {
              await deleteGoal(id);
            } catch {}
          })
        );
      }

      const saved = await upsertGoals(planId, toSave);

      originalIdsRef.current = new Set(
        saved.map((g) => g.id).filter(Boolean) as string[]
      );

      const rows = compactForUI(saved);
      setGoals(rows);
      lastSavedHashRef.current = computeHashForSave(rows);

      if (!silent) {
        setMsg(planStatus === "submitted" ? t("tomorrow.changesSaved") : t("tomorrow.saved"));
      } else {
        const savedCheck = t("tomorrow.savedCheck");
        setMsg(savedCheck);
        window.setTimeout(
          () => setMsg((m) => (m === savedCheck ? null : m)),
          900
        );
      }
      return rows;
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.saveFailed"));
      return goalsRef.current;
    } finally {
      autosaveInFlightRef.current = false;
      if (!silent) setSubmitting(false);
    }
  }

  function scheduleAutoSave() {
    if (!planId) return;
    if (planStatus === "locked") return;
    if (submitting) return;
    if (priorityChangeInProgressRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      persistGoals(true).catch(() => {});
    }, 450);
  }

  async function saveDraftOrChanges() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    await persistGoals(false);
  }

  async function onSubmitPlan() {
    if (!planId) {
      setMsg(t("tomorrow.missingPlanId"));
      return;
    }
    if (planStatus === "locked") return;
    if (planStatus === "submitted") {
      setMsg(t("tomorrow.alreadySubmitted"));
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    autosaveInFlightRef.current = false;

    setMsg(null);

    // compactForSave is position-agnostic now -- its length IS the total
    // non-empty Commitment count, regardless of which slots they sit in.
    const compacted = compactForSave(goals);
    if (compacted.length < 3) {
      setMsg(t("tomorrow.needThreeGoals"));
      return;
    }

    setSubmitting(true);

    try {
      const toSave = compacted
        .map((g) => ({
          ...g,
          title: (g.title ?? "").trim(),
          priority:
            typeof g.priority === "number" && Number.isFinite(g.priority)
              ? g.priority
              : DEFAULT_PRIORITY,
        }))
        .filter((g) => g.title.length > 0);

      await upsertGoals(planId, toSave);
      await submitPlan(planId);

      const planningResult = await awardPlanningPoints(planId, 5);
      if (planningResult?.success) notifyPointsUpdated();

      await refresh({ silent: true });
      setMsg(
        planningResult?.success
          ? t("tomorrow.submittedPoints", { points: 5 })
          : t("tomorrow.submittedMsg")
      );
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeGoal(idx: number) {
    const g = goals[idx];

    // Every position uses the same removal semantics -- no slot is
    // structurally protected. Deletes the row outright (and its DB
    // record, if it has one). If this drops the plan below 3 real
    // Commitments, removal still proceeds; the plan just becomes
    // temporarily unsubmittable until another Commitment is added --
    // canSubmit (count-based) enforces that, not removeGoal.
    setGoals((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((x, i) => ({ ...x, sort_order: i }))
    );

    if (g.id) {
      try {
        await deleteGoal(g.id);
      } catch {}
    }

    scheduleAutoSave();
  }

  async function submitNote(goalId: string, idx: number) {
    const text = (noteDraft[goalId] ?? "").trim();
    if (!text) return;
    setSavingNote((prev) => ({ ...prev, [goalId]: true }));
    try {
      await addGoalNote(goalId, text);
      const byGoal = await getNotesForGoals([goalId]);
      setGoals((prev) =>
        prev.map((g, i) => (i === idx ? { ...g, previous_actions: byGoal[goalId] ?? [] } : g))
      );
      setNoteDraft((prev) => ({ ...prev, [goalId]: "" }));
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.failedAddNote"));
    } finally {
      setSavingNote((prev) => ({ ...prev, [goalId]: false }));
    }
  }

  if (loading) {
    return <PageLoadingState label={t("tomorrow.loading")} />;
  }

  const locked = planStatus === "locked";
  const submitted = planStatus === "submitted";

  const normalized = normalizeGoals(goals);

  // Display order only — P1 always sorts to the top, then P2, etc. No
  // position in the underlying `goals` array is structurally special;
  // every handler below still receives originalIdx, a true index into
  // `goals`, so dragging, priority changes, and removal all keep working
  // exactly as before — only where each row visually renders changes.
  // See goalLogic.test.ts for the sort behavior itself.
  const sortedForDisplay = sortGoalsForDisplay(goals);

  // A Commitment is any non-empty Task, regardless of priority or
  // position — the locked 3-10 model. Priority (P1-P5) is ranking
  // metadata only and never gates submission.
  const totalGoalsFilled = normalized.filter((g) => (g.title ?? "").trim().length > 0).length;

  const canSubmit =
    !!planId && !locked && !submitted && totalGoalsFilled >= 3 && !submitting && submitEligible;

  const canAddMore = !locked && !submitting && goals.length < MAX_GOALS;

  // Mirrors persistGoals()'s own "anything to save?" check so the Save
  // button's state always matches what a click on it would actually do --
  // computed at render time (not a ref) so typing immediately flips it
  // active instead of waiting for the debounced autosave to catch up.
  const isDirty = computeHashForSave(compactForSave(goals)) !== lastSavedHashRef.current;

  const goalsProgressPercent = Math.min(100, Math.round((totalGoalsFilled / MAX_GOALS) * 100));

  // Goal Engine Phase 4B — the per-task card, extracted verbatim out of
  // what used to be a single inline .map() callback so it can be called
  // from three places (the unchanged flat/editMode list, each active
  // Goal's nested task list, and the standalone-tasks list) without a
  // second copy of this markup ever existing. `cardNumber` replaces the
  // old `displayIdx + 1` (now computed per-section instead of globally --
  // a continuous 1..N badge across multiple Goal cards plus a standalone
  // section wouldn't read sensibly once the list is grouped).
  function renderTaskCard(
    { g, originalIdx }: { g: DraftGoal; originalIdx: number },
    cardNumber: number
  ) {
    const idx = originalIdx;
    const p =
      typeof g.priority === "number" && Number.isFinite(g.priority)
        ? g.priority
        : DEFAULT_PRIORITY;
    const opt = getPriorityMeta(p);
    // Set once this goal has been assigned out to a connection
    // (and they haven't declined) — shows the recipient's live
    // status either way. "shared" always stays fully editable.
    // "exclusive" only locks these still-being-drafted fields once
    // the recipient has actually accepted — while pending, nothing
    // has been handed off yet. Locking title/time/priority for
    // exclusive here (unlike Today, which only locks checklist/
    // attachments/link/priority) matters because these fields are
    // still live-editable up until submission -- continuing to
    // edit them after acceptance would silently diverge from the
    // frozen snapshot the recipient already has, since assignment
    // never re-syncs.
    const assignment = g.id ? assignedOutByGoalId.get(g.id) : undefined;
    const received = g.id ? receivedByGoalId.get(g.id) : undefined;
    const isExclusive = assignment?.assignmentType === "exclusive" && assignment.status === "accepted";

    return (
      <div key={g.id ?? `row-${idx}`}>
        {/* Goal row with drag-drop support */}
        <div
          draggable={editMode && !locked && !submitting}
          onDragStart={() => handleDragStart(idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDragEnd={handleDragEnd}
          data-goal-id={g.id}
          className={`goal-row${g.id === highlightGoalId ? " post-card-highlight" : ""}`}
          // Phase 8B: reuses the exact "quiet" edge-weight tier
          // Phase 7B already built for Today's P3 cards (see
          // globals.css) -- P3/amber reads louder than every other
          // priority at the shared border-mix ratio purely because
          // its hue has much higher perceived luminance, not
          // because P3 is meant to outweigh P1/P2. Tomorrow never
          // had this attribute wired in, so its P3 cards had the
          // same un-corrected imbalance Today's did before Phase
          // 7B. No new CSS -- same tier, same class, just applied
          // here too.
          data-edge-weight={p === 3 ? "quiet" : undefined}
          style={{
            "--p-color": (p >= 1 && p <= 3) ? opt.color : "rgba(var(--tint-rgb),0.2)",
            cursor: editMode ? "move" : "default",
            opacity: draggedIdx === idx ? 0.5 : 1,
          } as React.CSSProperties}
        >
          {/* Drag handle */}
          {editMode && (
            <div
              className="absolute left-2 top-1/2 -translate-y-1/2 text-3xl pointer-events-none"
              style={{ color: "rgba(var(--tint-rgb),0.3)" }}
            >
              ⋮⋮
            </div>
          )}

          {/* Number badge — a small corner tag flush with the card's
              own top-left border/radius, instead of a free-floating
              circle competing with the goal title for horizontal space. */}
          <GoalNumberOrb number={cardNumber} />
          {/* Mirrors the number badge on the opposite corner —
              moved here from an inline button next to the priority
              select, same as Today's goal-delete-corner-btn. */}
          {!locked && !isExclusive && (
            <button
              type="button"
              onClick={() => removeGoal(idx)}
              disabled={submitting}
              className="goal-delete-corner-btn"
              title={(p >= 1 && p <= 3) ? t("tomorrow.clearPriorityTask") : t("tomorrow.removeTask")}
            >
              <X size={12} />
            </button>
          )}

          <div className="goal-row-body">
          <div className="goal-row-cols">
            {/* Goal — static, ~45% */}
            <div style={{ flex: "1 1 40%", minWidth: "200px" }}>
              {/* Priority leads the title row as a compact tag directly
                  attached to the task — moved ahead of the (flexible,
                  stretching) title textarea instead of trailing after
                  it, so it reads as "this task's priority" rather than
                  a control stranded at the far edge of a wide row
                  (explicit user call, nested-card layout cleanup). Same
                  select/handler, only its position changed. */}
              <div className="flex items-start gap-2">
                <select
                  value={p}
                  disabled={locked || submitting || isExclusive}
                  onChange={(e) => {
                    priorityChangeInProgressRef.current = true;
                    const v = Number(e.target.value);
                    setGoals((prev) => applyPriorityChange(prev, idx, v));
                  }}
                  className="priority-select"
                  style={{
                    "--p-bg": opt.bg,
                    "--p-border": opt.border,
                    "--p-color": opt.color,
                    flexShrink: 0,
                    marginTop: "2px",
                  } as React.CSSProperties}
                >
                  {[1, 2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>
                      P{v}
                    </option>
                  ))}
                </select>
                <textarea
                  ref={(el) => {
                    inputRefs.current[idx] = el;
                    autoResizeTextarea(el);
                  }}
                  rows={1}
                  value={g.title ?? ""}
                  disabled={locked || submitting || isExclusive}
                  onKeyDown={(e) => onGoalKeyDown(e, idx)}
                  onBlur={() => {
                    if (skipNextBlurAutosaveRef.current) {
                      skipNextBlurAutosaveRef.current = false;
                      return;
                    }
                    if (priorityChangeInProgressRef.current) {
                      return;
                    }
                    scheduleAutoSave();
                  }}
                  onChange={(e) => {
                    setGoals((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, title: e.target.value } : x
                      )
                    );
                    autoResizeTextarea(e.target);
                  }}
                  placeholder={t("tomorrow.taskPlaceholder", { p })}
                  className="goal-title-input flex-1 min-w-0 bg-transparent border-0 text-white text-xl font-medium placeholder:text-white/40 outline-none focus:placeholder:text-white/60 resize-none"
                  style={{ overflow: "hidden", lineHeight: 1.3 }}
                />
              </div>

              {/* Goal toolbar — Checklist/Files/Link/Exclusive-or-
                  Shared/Assign, redesigned into one integrated row
                  (was two separate rows of plain gray buttons).
                  Visual/layout only: every control below still
                  calls the exact same handlers as before. */}
              <div className="goal-toolbar">
                {g.id && (
                  <>
                    <GoalChecklist
                      compact
                      goalId={g.id}
                      items={checklistItems[g.id] ?? []}
                      onItemsChange={(items) =>
                        setChecklistItems((prev) => ({ ...prev, [g.id as string]: items }))
                      }
                      readOnly={locked || isExclusive}
                    />
                    <GoalAttachments
                      compact
                      goalId={g.id}
                      items={attachments[g.id] ?? []}
                      onItemsChange={(items) =>
                        setAttachments((prev) => ({ ...prev, [g.id as string]: items }))
                      }
                      readOnly={locked || isExclusive}
                    />
                  </>
                )}
                {((g as any).link_url || !isExclusive) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isExclusive) {
                        if ((g as any).link_url) window.open((g as any).link_url, "_blank", "noopener,noreferrer");
                        return;
                      }
                      setShowLinkInput((prev) => ({ ...prev, [idx]: !prev[idx] }));
                    }}
                    className="btn btn-tint btn-teal goal-toolbar-btn"
                    title={(g as any).link_url ? (g as any).link_url : t("tomorrow.attachLink")}
                  >
                    {(g as any).link_url ? <Link2 size={13} /> : <Plus size={13} />}
                    <span className="goal-toolbar-label">{t("tomorrow.link")}</span>
                  </button>
                )}

                {/* Goal Engine Phase 3 — optional link to an
                    Outcome Goal. Same conn-card-menu dropdown
                    pattern as the Exclusive/Shared picker below,
                    single-select over active Outcome Goals plus a
                    "No Goal" clear option.
                    4C follow-up: only shown for a standalone Task
                    (no outcome_goal_id) -- once linked, the Task
                    renders inside its Goal card instead (Phase 4B),
                    where re-showing this same picker would be
                    redundant. The underlying link/unlink data path
                    (the "No Goal" menu item's setGoals call below)
                    is untouched, just no longer reachable from here
                    once a Task is already linked. */}
                {g.id && !(g as any).outcome_goal_id && (
                  <div className="relative" ref={openGoalPickerId === g.id ? goalPickerMenuRef : undefined}>
                    <button
                      type="button"
                      disabled={locked || isExclusive}
                      onClick={() => setOpenGoalPickerId((prev) => (prev === g.id ? null : (g.id as string)))}
                      className="btn goal-toolbar-btn"
                      title={t("tomorrow.linkToGoal")}
                    >
                      <Target size={13} />
                      <span
                        className="goal-toolbar-label truncate"
                        style={{ maxWidth: "110px", display: "inline-block" }}
                      >
                        {t("tomorrow.linkToGoal")}
                      </span>
                      <ChevronDown size={12} className="text-white/40" />
                    </button>
                    {openGoalPickerId === g.id && (
                      <div className="conn-card-menu" style={{ minWidth: "200px", maxWidth: "260px" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setGoals((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, outcome_goal_id: null } : x))
                            );
                            setOpenGoalPickerId(null);
                            scheduleAutoSave();
                          }}
                          className="conn-card-menu-item"
                          style={{ flexDirection: "column", alignItems: "flex-start", gap: "1px" }}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {t("tomorrow.goalPickerNoGoal")}
                            {!(g as any).outcome_goal_id && <Check size={12} className="text-emerald-400" />}
                          </span>
                          <span className="text-[10px] text-white/45">{t("tomorrow.goalPickerNoGoalDesc")}</span>
                        </button>
                        {outcomeGoals
                          .filter((o) => o.status === "active")
                          .map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => {
                                setGoals((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, outcome_goal_id: o.id } : x))
                                );
                                setOpenGoalPickerId(null);
                                scheduleAutoSave();
                              }}
                              className="conn-card-menu-item"
                            >
                              <span className="truncate min-w-0 flex-1">{o.title}</span>
                              {(g as any).outcome_goal_id === o.id && (
                                <Check size={12} className="text-emerald-400 flex-shrink-0" />
                              )}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Goal Engine Phase 4E — compact reassignment for a
                    Task already linked (rendered inside its Goal card,
                    Phase 4B). Same conn-card-menu + openGoalPickerId
                    state as the Link to Goal picker above (mutually
                    exclusive with it, never both shown for one Task),
                    just a different trigger and option list: Make
                    Standalone + every OTHER active Goal -- the Task's
                    current Goal is excluded rather than shown
                    disabled, so there's nothing to select that
                    wouldn't actually change anything. Same setGoals +
                    scheduleAutoSave data path as every other
                    link/unlink action here, nothing new. */}
                {g.id && (g as any).outcome_goal_id && (
                  <div className="relative" ref={openGoalPickerId === g.id ? goalPickerMenuRef : undefined}>
                    <button
                      type="button"
                      disabled={locked || isExclusive}
                      onClick={() => setOpenGoalPickerId((prev) => (prev === g.id ? null : (g.id as string)))}
                      className="btn goal-toolbar-btn"
                      title={t("tomorrow.moveTask")}
                    >
                      <ArrowRightLeft size={13} />
                      <span className="goal-toolbar-label goal-toolbar-label-keep">{t("tomorrow.moveTask")}</span>
                      <ChevronDown size={12} className="text-white/40" />
                    </button>
                    {openGoalPickerId === g.id && (
                      <div className="conn-card-menu" style={{ minWidth: "200px", maxWidth: "260px" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setGoals((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, outcome_goal_id: null } : x))
                            );
                            setOpenGoalPickerId(null);
                            scheduleAutoSave();
                          }}
                          className="conn-card-menu-item"
                          style={{ flexDirection: "column", alignItems: "flex-start", gap: "1px" }}
                        >
                          <span>{t("tomorrow.makeStandalone")}</span>
                          <span className="text-[10px] text-white/45">{t("tomorrow.goalPickerNoGoalDesc")}</span>
                        </button>
                        {outcomeGoals
                          .filter((o) => o.status === "active" && o.id !== (g as any).outcome_goal_id)
                          .map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => {
                                setGoals((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, outcome_goal_id: o.id } : x))
                                );
                                setOpenGoalPickerId(null);
                                scheduleAutoSave();
                              }}
                              className="conn-card-menu-item"
                            >
                              <span className="truncate min-w-0 flex-1">{o.title}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Exclusive/Shared — Assign itself now lives in the
                    scheduling row below, alongside Time/All day, instead
                    of here; this control only shows pre-assignment, same
                    as before (assignment/received replace it with the
                    status line underneath). */}
                {!assignment && !received && g.id && acceptedConnections.length > 0 && (
                  <PortalDropdownMenu
                    open={openPrivacyMenuId === g.id}
                    onClose={() => setOpenPrivacyMenuId(null)}
                    anchorRef={privacyMenuRef}
                    panelClassName="conn-card-menu"
                    panelStyle={{ minWidth: "210px" }}
                    panel={
                      <>
                        {(["exclusive", "shared"] as GoalAssignmentType[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setAssignTypeByGoalId((prev) => ({ ...prev, [g.id as string]: option }));
                              setOpenPrivacyMenuId(null);
                            }}
                            className="conn-card-menu-item"
                            style={{ flexDirection: "column", alignItems: "flex-start", gap: "1px" }}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              {option === "exclusive" ? <Lock size={12} /> : <Unlock size={12} />}
                              {option === "exclusive" ? t("goalAssign.exclusiveShort") : t("goalAssign.sharedShort")}
                              {(assignTypeByGoalId[g.id as string] ?? "exclusive") === option && (
                                <Check size={12} className="text-emerald-400" />
                              )}
                            </span>
                            <span className="text-[10px] text-white/45">
                              {option === "exclusive" ? t("goalAssign.exclusiveDesc") : t("goalAssign.sharedDesc")}
                            </span>
                          </button>
                        ))}
                      </>
                    }
                  >
                    <div className="relative" ref={openPrivacyMenuId === g.id ? privacyMenuRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setOpenPrivacyMenuId((prev) => (prev === g.id ? null : (g.id as string)))}
                        className="btn goal-toolbar-btn"
                      >
                        {(assignTypeByGoalId[g.id as string] ?? "exclusive") === "exclusive" ? (
                          <Lock size={13} />
                        ) : (
                          <Unlock size={13} />
                        )}
                        <span className="goal-toolbar-label">
                          {(assignTypeByGoalId[g.id as string] ?? "exclusive") === "exclusive"
                            ? t("goalAssign.exclusiveShort")
                            : t("goalAssign.sharedShort")}
                        </span>
                        <ChevronDown size={12} className="text-white/40" />
                      </button>
                    </div>
                  </PortalDropdownMenu>
                )}
              </div>

              {/* Assignment status — once assigned (either
                  direction), replaces the Exclusive/Shared control
                  above with a read-only status line. */}
              {(assignment || received) && (
                <div className="mt-1.5 flex items-center gap-1" style={{ flexWrap: "nowrap", overflowX: "auto" }}>
                  {assignment ? (
                    <span className="text-[11px] text-white/50 whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1">
                      {assignment.assignmentType === "exclusive" ? <Lock size={11} /> : <Unlock size={11} />}
                      {t("goalAssign.assignedToLabel", {
                        name: assignment.recipientDisplayName ?? t("social.anonymousUser"),
                      })}
                      {assignment.status === "pending" && <span>· {t("social.assignmentPending")}</span>}
                      {assignment.status === "accepted" && assignment.recipientGoalStatus && (
                        <span className="inline-flex items-center gap-1">
                          · <StatusIcon status={assignment.recipientGoalStatus} size={12} />{" "}
                          {statusLabel(assignment.recipientGoalStatus, t)}
                        </span>
                      )}
                    </span>
                  ) : (
                    // A goal that's itself the product of an
                    // assignment I received -- locked from being
                    // re-assigned onward (see receivedByGoalId above).
                    <span className="text-[11px] text-white/50 whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1">
                      <Lock size={11} />
                      {t("social.assignedByLabel", {
                        name: received!.assignerDisplayName ?? t("social.anonymousUser"),
                      })}
                    </span>
                  )}
                </div>
              )}
              {assignError && <div className="mt-1 text-[11px] text-red-400">{assignError}</div>}

              {!isExclusive && showLinkInput[idx] && (
                <input
                  type="url"
                  value={(g as any).link_url ?? ""}
                  disabled={locked || submitting}
                  onChange={(e) =>
                    setGoals((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, link_url: e.target.value || null } : x))
                    )
                  }
                  onBlur={() => {
                    if (skipNextBlurAutosaveRef.current) {
                      skipNextBlurAutosaveRef.current = false;
                      return;
                    }
                    scheduleAutoSave();
                  }}
                  placeholder={t("tomorrow.urlPlaceholder")}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                />
              )}

              {/* Scheduling/control row — Assign (moved down from the
                  toolbar above) + a compact clock-icon time trigger +
                  All day, all three on one row so they read as a single
                  group instead of Assign competing with
                  Checklist/Files/Link/Exclusive-Shared up top. */}
              <div className="mt-2 flex items-center flex-wrap gap-1.5">
                {!assignment && !received && g.id && acceptedConnections.length > 0 && (
                  <div
                    className="relative inline-flex items-center"
                    ref={openAssignMenuId === g.id ? assignMenuRef : undefined}
                  >
                    <button
                      type="button"
                      disabled={assigningGoalIds.has(g.id as string) || locked}
                      onClick={() => setOpenAssignMenuId((prev) => (prev === g.id ? null : (g.id as string)))}
                      className="btn btn-tint btn-amber-tint goal-toolbar-btn goal-toolbar-btn-assign"
                    >
                      <UserPlus size={13} className="flex-shrink-0" />
                      <span className="goal-toolbar-label goal-toolbar-label-keep">{t("goalAssign.assignShort")}</span>
                      <ChevronDown size={12} className="text-white/40 flex-shrink-0" />
                    </button>
                    {openAssignMenuId === g.id && (
                      <div
                        className="conn-card-menu"
                        style={{ left: 0, right: "auto", minWidth: "180px", maxWidth: "min(240px, calc(100vw - 4rem))" }}
                      >
                        {acceptedConnections.map((c) => (
                          <button
                            key={c.otherUserId}
                            type="button"
                            onClick={() => {
                              handleAssignGoal(g.id as string, c.otherUserId);
                              setOpenAssignMenuId(null);
                            }}
                            className="conn-card-menu-item"
                            title={connectionDisplayName(c, t)}
                          >
                            <span className="truncate min-w-0 flex-1">{connectionDisplayName(c, t)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Time — a compact clock-icon trigger instead of the
                    wide native "--:--" box. The real <input type="time">
                    is still here with its exact original value/onChange/
                    onBlur/autosave; it's just layered invisibly
                    (opacity:0, absolutely filling this wrapper) over the
                    icon, so tapping anywhere on it opens the browser's
                    native time picker exactly as before -- no new
                    trigger logic, same element, same handlers. Hidden
                    when all-day, same condition as before. */}
                {!(g as any).is_all_day && (
                  <div
                    className={`btn goal-toolbar-btn relative${g.time_of_day ? " btn-tint btn-amber-tint" : ""}`}
                    style={{
                      opacity: locked || submitting || isExclusive ? 0.5 : 1,
                    }}
                  >
                    <Clock size={13} className="flex-shrink-0" />
                    <input
                      type="time"
                      value={g.time_of_day?.slice(0, 5) ?? ""}
                      disabled={locked || submitting || isExclusive}
                      onBlur={() => {
                        if (skipNextBlurAutosaveRef.current) {
                          skipNextBlurAutosaveRef.current = false;
                          return;
                        }
                        if (priorityChangeInProgressRef.current) {
                          return;
                        }
                        scheduleAutoSave();
                      }}
                      onChange={(e) =>
                        setGoals((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, time_of_day: e.target.value || null } : x
                          )
                        )
                      }
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0 }}
                      title={t("tomorrow.optionalTimeTitle")}
                    />
                  </div>
                )}

                <button
                  type="button"
                  disabled={locked || submitting || isExclusive}
                  onClick={() => {
                    setGoals((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, is_all_day: !(x as any).is_all_day, time_of_day: null } : x
                      )
                    );
                    scheduleAutoSave();
                  }}
                  // Phase 8B: was a plain .btn with an inline
                  // background/borderColor override for the
                  // selected state -- the exact "bypasses the
                  // shared system" pattern found and fixed on
                  // Today's buttons in earlier phases. Reuses the
                  // existing .btn-tint/.btn-amber-tint combo (the
                  // same amber accent the Assign control already
                  // uses) instead of a one-off inline color, so
                  // Time + All Day read as the same family of
                  // scheduling control.
                  className={`btn goal-toolbar-btn${(g as any).is_all_day ? " btn-tint btn-amber-tint" : ""}`}
                  title={t("tomorrow.allDayTitleTask")}
                >
                  {(g as any).is_all_day && <Sun size={12} className="flex-shrink-0" />} {t("tomorrow.allDay")}
                </button>
              </div>

              {g.rescheduled_from_date && (
                <div className="mt-2 flex items-start gap-2">
                  <Redo2 className="text-yellow-400 mt-0.5" size={13} />
                  <div>
                    <div className="text-xs text-yellow-300/90 font-medium">
                      {t("tomorrow.rescheduledFrom", { date: formatDateDisplay(g.rescheduled_from_date) })}
                    </div>
                    {g.reschedule_reason && (
                      <div className="text-xs text-white/60 italic mt-0.5">
                        "{g.reschedule_reason}"
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* History & notes — merged chronological timeline, same
                component as Review Today and the Calendar archive
                view, instead of separate Notes/History tabs. The
                comment/note toggle now renders as GoalTimeline's own
                `trailing` content (sharing its "Actions & notes" row)
                instead of a separate stacked column -- on mobile,
                .goal-row-cols wraps each column onto its own line, so
                that extra column was previously an almost-empty row of
                its own (just one small icon, full width, pushed to the
                end) plus another inter-column gap above it. */}
            <div style={{ flex: "1 1 40%", minWidth: "220px" }} className="tomorrow-task-notes-col">
              {!g.id ? (
                <div className="text-xs text-white/30 italic">{t("tomorrow.saveToAddNotes")}</div>
              ) : (
                <>
                  <GoalTimeline
                    entries={buildGoalTimeline(g, g.previous_actions ?? [], t)}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowNoteInput((prev) => ({ ...prev, [g.id as string]: !prev[g.id as string] }))}
                        className="actions-toggle"
                        data-open={!!showNoteInput[g.id]}
                        title={t("tomorrow.addNoteTitle")}
                      >
                        <MessageCircle size={14} />
                      </button>
                    }
                  />
                  {showNoteInput[g.id] && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        value={noteDraft[g.id] ?? ""}
                        onChange={(e) => setNoteDraft((prev) => ({ ...prev, [g.id as string]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitNote(g.id as string, idx);
                        }}
                        placeholder={t("tomorrow.addNotePlaceholder")}
                        disabled={!!savingNote[g.id]}
                        autoFocus
                        className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => submitNote(g.id as string, idx)}
                        disabled={!!savingNote[g.id] || !(noteDraft[g.id] ?? "").trim()}
                        className="btn"
                        style={{ padding: "0.375rem 1rem" }}
                      >
                        {savingNote[g.id] ? t("tomorrow.adding") : t("tomorrow.add")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card card-highlight tomorrow-page-card"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">{t("tomorrow.title")}</h1>
            <p className="text-white/70 mb-2">
              {t("tomorrow.commitmentRuleSummary", { min: 3, max: MAX_GOALS })}
            </p>

            {/* Planning progress — moved up here from a plain text line at
                the very bottom of the page, so it's visible without
                scrolling. Total non-empty Commitments, any priority --
                see totalGoalsFilled/canSubmit above. */}
            <div className="mt-3" style={{ maxWidth: "260px" }}>
              <div className="flex items-center justify-between text-xs text-white/50 mb-1">
                <span>{t("tomorrow.goalsProgressLabel", { count: totalGoalsFilled, max: MAX_GOALS })}</span>
                <span>{goalsProgressPercent}%</span>
              </div>
              <div className="goal-progress-track">
                <div className="goal-progress-fill" style={{ "--progress": goalsProgressPercent / 100 } as React.CSSProperties} />
              </div>
            </div>

            {coveredByPass && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-400">
                <Ticket size={13} /> {t("datePage.streakPassCoveredAdvance")}
              </p>
            )}
          </div>

          <div className="tomorrow-toolbar" style={{ maxWidth: "340px" }}>
            {!coveredByPass && (
              <button
                className="btn tomorrow-toolbar-btn"
                onClick={handleUseStreakPass}
                disabled={usingPass || (passBalance?.available ?? 0) <= 0}
                title={(passBalance?.available ?? 0) <= 0 ? t("datePage.noStreakPasses") : undefined}
              >
                <Ticket size={13} />
                {usingPass ? t("datePage.usingPass") : t("datePage.useStreakPassAdvance", { count: passBalance?.available ?? 0 })}
              </button>
            )}
            {!locked && (
              <button
                onClick={() => setEditMode(!editMode)}
                disabled={submitting}
                // Phase 8C: was a plain .btn with an inline background/
                // borderColor override for the selected (editMode) state --
                // the same bypass-the-shared-system pattern Phase 8B found
                // and fixed on the All Day button. Same fix: the existing
                // .btn-tint/.btn-amber-tint combo instead of a one-off
                // inline color.
                className={`btn tomorrow-toolbar-btn${editMode ? " btn-tint btn-amber-tint" : ""}`}
              >
                {editMode ? t("tomorrow.done") : t("tomorrow.reorder")}
              </button>
            )}
          </div>
        </div>

        {suggestedTemplates.length > 0 && (
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wide text-white/40 font-semibold mb-2">
              {t("tomorrow.suggestedTitle")}
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleAddSuggestedTemplate(template)}
                  disabled={addingTemplateId === template.id}
                  className="btn"
                  style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
                >
                  {addingTemplateId === template.id ? t("tomorrow.addingSuggested") : `+ ${template.title}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {editMode ? (
          // Reorder mode — unchanged flat list. handleDragOver splices the
          // real `goals` array by raw index and has no concept of Goal
          // grouping, so reordering stays on the simple view it already
          // works correctly against rather than inventing cross-card drag
          // semantics Phase 4B never asked for.
          <div className="space-y-4">
            {sortedForDisplay.map(({ g, originalIdx }, displayIdx) =>
              renderTaskCard({ g, originalIdx }, displayIdx + 1)
            )}
          </div>
        ) : (() => {
          // Goal Engine — placement adjustment: a Goal only earns a full
          // card in the plan once it has >=1 Task actually committed to
          // tomorrow. An active Goal with zero tomorrow Tasks moves to
          // the compact Quick Add from Goals row instead (below), so an
          // empty container never eats space in the main plan. This is
          // the SAME activeGoals/items split Phase 4B already computed
          // per-goal, just partitioned once up front instead of
          // rendering every active Goal unconditionally.
          const activeGoals = outcomeGoals.filter((goal) => goal.status === "active");
          const goalsWithItems: { goal: OutcomeGoal; items: typeof sortedForDisplay }[] = [];
          const goalsWithoutItems: OutcomeGoal[] = [];
          for (const goal of activeGoals) {
            const items = sortedForDisplay.filter(({ g }) => (g as any).outcome_goal_id === goal.id);
            if (items.length > 0) goalsWithItems.push({ goal, items });
            else goalsWithoutItems.push(goal);
          }

          return (
            <>
              <div className="space-y-4">
                {/* Goal Engine Phase 4B — every Goal with >=1 tomorrow
                    Task gets its own minimal card: title + its linked
                    Tasks (reusing renderTaskCard exactly, same as the
                    standalone list below) + a Goal-scoped "+ Add Task"
                    that creates a normal Task pre-linked to this Goal
                    (addTaskLinkedToGoal). */}
                {goalsWithItems.map(({ goal, items }) => (
                  <div
                    key={goal.id}
                    className="rounded-2xl"
                    style={{
                      background: "rgba(var(--tint-rgb), 0.03)",
                      border: "1px solid rgba(var(--tint-rgb), 0.08)",
                      padding: "1rem",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Target size={16} className="text-pink-400 flex-shrink-0" />
                      <h3 className="text-base font-semibold text-white truncate">{goal.title}</h3>
                    </div>
                    <div className="space-y-4 mb-3">
                      {items.map(({ g, originalIdx }, i) => renderTaskCard({ g, originalIdx }, i + 1))}
                    </div>
                    <button
                      type="button"
                      className="btn hover-scale inline-flex items-center gap-1.5"
                      style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}
                      onClick={() => addTaskLinkedToGoal(goal.id)}
                      disabled={!canAddMore}
                      title={goals.length >= MAX_GOALS ? t("tomorrow.maxCommitmentsReached", { max: MAX_GOALS }) : ""}
                    >
                      {t("tomorrow.addTaskToGoal")}
                    </button>
                  </div>
                ))}

                {/* Standalone tasks — the exact same flat list/behavior as
                    before, filtered to whatever isn't linked to a Goal card
                    above. */}
                {(() => {
                  const standalone = sortedForDisplay.filter(({ g }) => !(g as any).outcome_goal_id);
                  return standalone.map(({ g, originalIdx }, i) => renderTaskCard({ g, originalIdx }, i + 1));
                })()}
              </div>

              {/* Quick Add from Goals — active Goals with no tomorrow
                  Task yet. Shortcuts only: no goals row exists for these
                  yet, so they already don't touch totalGoalsFilled/
                  MAX_GOALS/canSubmit (all derived from `goals`, never from
                  outcomeGoals) -- nothing extra needed to keep them out of
                  commitment counts, limits, progress, validation, or
                  submission. Clicking
                  one calls the exact same addTaskLinkedToGoal() the full
                  Goal card's own "+ Add Task" uses -- once that Task
                  lands in sortedForDisplay, this same goal naturally has
                  items.length > 0 next render and moves itself into the
                  real Goal-card list above; no separate state to sync. */}
              {goalsWithoutItems.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold mb-2">
                    {t("tomorrow.quickAddFromGoalsLabel")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {goalsWithoutItems.map((goal) => (
                      <button
                        key={goal.id}
                        type="button"
                        onClick={() => addTaskLinkedToGoal(goal.id)}
                        disabled={!canAddMore}
                        className="btn hover-scale inline-flex items-center gap-1.5"
                        style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem" }}
                        title={
                          goals.length >= MAX_GOALS
                            ? t("tomorrow.maxCommitmentsReached", { max: MAX_GOALS })
                            : t("tomorrow.quickAddFromGoalHint", { goal: goal.title })
                        }
                      >
                        <Target size={12} className="text-pink-400 flex-shrink-0" />
                        <span className="truncate" style={{ maxWidth: "140px" }}>
                          {goal.title}
                        </span>
                        <Plus size={12} className="flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {!locked && (() => {
          // Phase 8A.1: the mobile bar used to be a `position: fixed`
          // DESCENDANT of this card -- but .card carries `backdrop-filter`
          // (confirmed via computed-style walk: it's the only ancestor
          // between here and <body> with a containing-block-triggering
          // property), which per spec makes any `position: fixed`
          // descendant behave like `position: absolute` relative to the
          // card instead of the viewport. Verified empirically pre-fix:
          // the bar's getBoundingClientRect().top moved 1:1 with
          // window.scrollTo(), which true fixed positioning never does.
          //
          // Fix: render the SAME content twice from one inner function
          // (not a shared element reference -- each call produces its own
          // element tree, so there's no React key collision) -- once
          // inline here for desktop (unchanged from Phase 8A, still fully
          // contained in the card's normal flow), and once through a
          // portal straight to document.body for mobile, which escapes
          // the card's containing block entirely so `position: fixed`
          // finally anchors to the real viewport. Only one of the two
          // ever displays at a given width (globals.css media query),
          // the other is `display: none` -- same "render both, let CSS
          // pick one" pattern this app already uses for mobile/desktop
          // nav variants, and the portal itself reuses the exact
          // `createPortal(..., document.body)` + `mounted` SSR-guard
          // convention already established by this app's modals (e.g.
          // RescheduleModal) -- not a new pattern.
          const content = (
            <>
              {/* Secondary tier — Add Goal is a real action; Save only
                  renders as a button while there's something TO save
                  (isDirty). Once saved, it becomes passive status text
                  instead of a disabled-but-still-button-shaped control,
                  so it stops visually competing with Submit Plan. This
                  doesn't change when a save actually happens (autosave/
                  saveDraftOrChanges are untouched) -- only whether an
                  already-inert control renders as a button at all. */}
              <div className="tomorrow-action-secondary">
                {addFlowStep === "closed" && (
                  <button
                    className="btn hover-scale"
                    onClick={() => setAddFlowStep("choice")}
                    disabled={!canAddMore}
                    title={
                      goals.length >= MAX_GOALS ? t("tomorrow.maxCommitmentsReached", { max: MAX_GOALS }) : ""
                    }
                  >
                    {t("tomorrow.addGoal")}
                  </button>
                )}

                {addFlowStep === "choice" && (
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      className="btn hover-scale"
                      style={{ padding: "0.45rem 0.7rem", fontSize: "0.8rem" }}
                      onClick={() => setAddFlowStep("task")}
                    >
                      {t("tomorrow.addChoiceTask")}
                    </button>
                    <button
                      type="button"
                      className="btn hover-scale"
                      style={{ padding: "0.45rem 0.7rem", fontSize: "0.8rem" }}
                      onClick={() => setAddFlowStep("goal")}
                    >
                      <Target size={13} className="inline -mt-0.5 mr-1" />
                      {t("tomorrow.addChoiceGoal")}
                    </button>
                    <button
                      type="button"
                      className="btn hover-scale"
                      style={{ padding: "0.45rem 0.55rem" }}
                      onClick={resetAddFlow}
                      title={t("tomorrow.neverMind")}
                      aria-label={t("tomorrow.neverMind")}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}

                {isDirty ? (
                  <button
                    className="btn hover-scale"
                    onClick={saveDraftOrChanges}
                    disabled={submitting}
                    title={t("tomorrow.manualSaveTitle")}
                  >
                    {submitting ? t("tomorrow.saving") : submitted ? t("tomorrow.saveChanges") : t("tomorrow.saveDraft")}
                  </button>
                ) : (
                  <span className="tomorrow-save-status" role="status">
                    <Check size={14} />
                    {t("tomorrow.savedCheck")}
                  </span>
                )}
              </div>

              {/* Goal Engine Phase 4C — Standalone Task structured form:
                  title (required) + the same priority-select control/
                  pattern every task card already uses. Saved through the
                  normal draft-row + persistGoals/upsertGoals path, not a
                  separate insert -- no new save logic. */}
              {addFlowStep === "task" && (
                <div className="mt-2 space-y-2 tomorrow-task-composer">
                  {/* Priority leads the title, same as every saved Task
                      card's own header row (see the identical pattern
                      above) -- a compact 34px tag attached to the task
                      instead of a control stranded at the far edge of a
                      wide row. Same select/handler, only its position
                      changed, so the composer reads as a pre-save version
                      of the real card rather than a separate layout. */}
                  <div className="flex items-start gap-2">
                    <select
                      value={newTaskPriority}
                      disabled={creatingTask}
                      onChange={(e) => setNewTaskPriority(Number(e.target.value))}
                      className="priority-select"
                      style={{
                        "--p-bg": getPriorityMeta(newTaskPriority).bg,
                        "--p-border": getPriorityMeta(newTaskPriority).border,
                        "--p-color": getPriorityMeta(newTaskPriority).color,
                        flexShrink: 0,
                      } as React.CSSProperties}
                    >
                      {[1, 2, 3, 4, 5].map((v) => (
                        <option key={v} value={v}>
                          P{v}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newTaskTitle}
                      disabled={creatingTask}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateStandaloneTask();
                        }
                      }}
                      placeholder={t("tomorrow.taskTitlePlaceholder")}
                      autoFocus
                      className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary hover-scale"
                      style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}
                      disabled={creatingTask || !newTaskTitle.trim()}
                      onClick={handleCreateStandaloneTask}
                    >
                      {creatingTask ? t("tomorrow.creatingTask") : t("tomorrow.createTaskButton")}
                    </button>
                    <button
                      type="button"
                      className="btn hover-scale"
                      style={{ padding: "0.4rem 0.55rem" }}
                      disabled={creatingTask}
                      onClick={resetAddFlow}
                      title={t("tomorrow.neverMind")}
                      aria-label={t("tomorrow.neverMind")}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {taskCreateError && <div className="text-[11px] text-red-400">{taskCreateError}</div>}
                </div>
              )}

              {/* Goal Engine Phase 4C — Major Goal structured form: Goal
                  title + at least 2 valid Tasks (each title + priority,
                  same pattern as above). createOutcomeGoal() first, then
                  each valid task is appended as a normal draft row with
                  outcome_goal_id already set to the new Goal, saved
                  through the same persistGoals/upsertGoals path. Once
                  outcomeGoals/goals update, Phase 4B's existing Goal-card
                  grouping renders it with its Tasks nested automatically
                  -- no separate render path needed here. */}
              {addFlowStep === "goal" && (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={newGoalTitle}
                    disabled={creatingGoal}
                    onChange={(e) => setNewGoalTitle(e.target.value)}
                    placeholder={t("tomorrow.goalTitlePlaceholder")}
                    autoFocus
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                  />

                  <div className="text-[11px] uppercase tracking-wide text-white/40 font-semibold">
                    {t("tomorrow.goalTasksLabel")}
                  </div>
                  <div className="space-y-2">
                    {newGoalTasks.map((tk, i) => (
                      <div key={i} className="flex items-center gap-2">
                        {/* Priority leads the title, same as every saved
                            Task card and the Standalone Task composer
                            (see their identical pattern). Same select/
                            handler, only its position changed. */}
                        <select
                          value={tk.priority}
                          disabled={creatingGoal}
                          onChange={(e) =>
                            setNewGoalTasks((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, priority: Number(e.target.value) } : x))
                            )
                          }
                          className="priority-select"
                          style={{
                            "--p-bg": getPriorityMeta(tk.priority).bg,
                            "--p-border": getPriorityMeta(tk.priority).border,
                            "--p-color": getPriorityMeta(tk.priority).color,
                            flexShrink: 0,
                          } as React.CSSProperties}
                        >
                          {[1, 2, 3, 4, 5].map((v) => (
                            <option key={v} value={v}>
                              P{v}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={tk.title}
                          disabled={creatingGoal}
                          onChange={(e) =>
                            setNewGoalTasks((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                            )
                          }
                          placeholder={t("tomorrow.goalTaskPlaceholder", { n: i + 1 })}
                          className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                        />
                        {newGoalTasks.length > 2 && (
                          <button
                            type="button"
                            disabled={creatingGoal}
                            onClick={() => setNewGoalTasks((prev) => prev.filter((_, j) => j !== i))}
                            className="btn flex-shrink-0"
                            style={{ padding: "0.35rem" }}
                            title={t("tomorrow.removeGoalTask")}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={creatingGoal}
                    onClick={() => setNewGoalTasks((prev) => [...prev, { title: "", priority: DEFAULT_PRIORITY }])}
                    className="btn hover-scale inline-flex items-center gap-1.5"
                    style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                  >
                    {t("tomorrow.addAnotherGoalTask")}
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary hover-scale"
                      style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}
                      disabled={!canCreateMajorGoal}
                      onClick={handleCreateMajorGoal}
                      title={
                        !newGoalTitle.trim()
                          ? t("tomorrow.goalNeedsTitle")
                          : validGoalTaskCount < 2
                          ? t("tomorrow.goalNeedsTwoTasks")
                          : ""
                      }
                    >
                      {creatingGoal ? t("tomorrow.creatingGoal") : t("tomorrow.createGoalButton")}
                    </button>
                    <button
                      type="button"
                      className="btn hover-scale"
                      style={{ padding: "0.4rem 0.55rem" }}
                      disabled={creatingGoal}
                      onClick={resetAddFlow}
                      title={t("tomorrow.neverMind")}
                      aria-label={t("tomorrow.neverMind")}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {goalCreateError && <div className="text-[11px] text-red-400">{goalCreateError}</div>}
                </div>
              )}

              {/* Primary tier — Submit Plan (or the submitted card) always
                  gets its own full-width row on mobile, so it's never the
                  thing a user has to scroll sideways to find. */}
              <div className="tomorrow-action-primary">
                {submitted ? (
                  <div className="plan-submitted-card">
                    <CheckCircle2 size={16} />
                    <div>
                      <div className="plan-submitted-title">{t("tomorrow.planSubmittedTitle")}</div>
                      <div className="plan-submitted-sub">{t("tomorrow.planSubmittedSub", { count: totalGoalsFilled })}</div>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary hover-scale tomorrow-submit-btn"
                    onClick={onSubmitPlan}
                    disabled={!canSubmit}
                    aria-busy={submitting}
                    title={
                      !submitEligible
                        ? t("tomorrow.submitUnlocksOnce", { date: formatDateDisplay(todayISO) })
                        : totalGoalsFilled < 3
                        ? t("tomorrow.fillInMore", { count: 3 - totalGoalsFilled, filled: totalGoalsFilled })
                        : ""
                    }
                  >
                    {submitting ? (
                      t("tomorrow.submitting")
                    ) : !submitEligible ? (
                      <>
                        <Lock size={14} />
                        {t("tomorrow.submitPlan")}
                      </>
                    ) : (
                      t("tomorrow.submitPlan")
                    )}
                  </button>
                )}
              </div>
            </>
          );

          return (
            <>
              <div className="tomorrow-action-row tomorrow-action-row-desktop mt-8">{content}</div>
              {mounted &&
                createPortal(
                  <div className="tomorrow-action-row tomorrow-action-row-mobile">{content}</div>,
                  document.body
                )}
            </>
          );
        })()}

        {!locked && !submitted && !submitEligible && (
          <div className="mt-3 text-xs text-white/50">
            {t("tomorrow.lockedSubmitMsg", { date: formatDateDisplay(todayISO) })}
          </div>
        )}

        {!locked && !submitted && submitEligible && totalGoalsFilled < 3 && (
          <div className="mt-3 text-xs text-white/50">
            {t("tomorrow.lockedNeedMore", { count: 3 - totalGoalsFilled, filled: totalGoalsFilled })}
          </div>
        )}

        {locked && (
          <div className="mt-6 text-white/70">
            {t("tomorrow.planIsPart1")}<b>{planStatus}</b>{t("tomorrow.planIsPart2")}
          </div>
        )}

        <div className="tomorrow-bottom-nav-links mt-6 flex items-center gap-2 sm:gap-3">
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/calendar">← {t("nav.calendar")}</Link>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/tools" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}><NotebookText size={14} /> {t("nav.tools")}</Link>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/dashboard">{t("nav.dashboard")} →</Link>
        </div>

        {msg && (
          <div className="mt-6 px-4 py-3 rounded-xl text-sm text-white animate-fadeIn" style={{ background: "rgba(var(--tint-rgb),0.1)", backdropFilter: "blur(10px)", border: "1px solid rgba(var(--tint-rgb),0.2)" }}>
            {msg}
          </div>
        )}
      </div>
  );
}
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
  listConnections,
  connectionDisplayName,
  createGoalAssignment,
  getMyGoalAssignments,
  type ChecklistItem,
  type GoalAttachment,
  type RecurringGoalTemplate,
  type Connection,
  type GoalAssignment,
  type GoalAssignmentType,
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
import { buildGoalTimeline } from "@/lib/goalTimeline";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { statusLabel } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import { Link2, Plus, Sun, X, MessageCircle, NotebookText, Redo2, Lock, Unlock } from "lucide-react";

export default function TomorrowGoalsPage() {
  const { t } = useLanguage();
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const [loading, setLoading] = useState(true);
  // Drafting/saving tomorrow's plan is always available. Submitting
  // (finalizing) it is gated separately — only once today has been
  // reviewed — so this no longer blocks the whole page.
  const [submitEligible, setSubmitEligible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [planId, setPlanId] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<string>("draft");

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

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
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
      if (a.direction === "assigned" && a.status !== "declined" && a.assignerGoalId) {
        map.set(a.assignerGoalId, a);
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
    const [eligible, { plan, goals: dbGoals }] = await Promise.all([
      isYesterdayReviewed(),
      getPlanWithGoals(tomorrowISO),
    ]);
    setSubmitEligible(eligible);
    setPlanId(plan.id);
    setPlanStatus(plan.status);

    // Fetch reschedule origin data, previous actions/comments, checklist
    // items, and attachments for all goals together — none of these four
    // depend on each other, only on goalIds. Checklist/attachments keep
    // their own error isolation (a missing/misconfigured table there
    // shouldn't take down the whole goals list).
    const goalIds = dbGoals.map(g => g.id).filter(Boolean) as string[];
    let rescheduleOrigins: Record<string, { from_date: string; reason: string | null }> = {};
    let notesMap: Record<string, any[]> = {};

    if (goalIds.length > 0) {
      const [reschedulesResult, notesResult, checklistResult, attachmentsResult] = await Promise.all([
        supabase
          .from("goal_reschedules")
          .select("materialized_goal_id, from_date, reason")
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

      notesMap = notesResult;
      setGoalComments(notesMap);
      setChecklistItems(checklistResult);
      setAttachments(attachmentsResult);
    }

    // Attach reschedule origin to goals
    const goalsWithOrigin = dbGoals.map(g => ({
      ...g,
      rescheduled_from_date: rescheduleOrigins[g.id]?.from_date || null,
      reschedule_reason: rescheduleOrigins[g.id]?.reason || null,
    }));

    // Attach comments to goals using notesMap (not state which is stale)
    const goalsWithData = goalsWithOrigin.map(g => ({
      ...g,
      previous_actions: notesMap[g.id] || [],
    }));
    
    originalIdsRef.current = new Set(goalIds);

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
  }, [tomorrowISO]);

  async function handleAddSuggestedTemplate(template: RecurringGoalTemplate) {
    if (addingTemplateId) return;
    setAddingTemplateId(template.id);
    try {
      await addGoalFromTemplate(template, tomorrowISO);
      setSuggestedTemplates((prev) => prev.filter((t2) => t2.id !== template.id));
      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.failedAddSuggested"));
    } finally {
      setAddingTemplateId(null);
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

  function onGoalKeyDown(e: ReactKeyboardEvent<HTMLInputElement>, idx: number) {
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

  async function persistGoals(silent?: boolean) {
    if (!planId) return;
    if (planStatus === "locked") return;
    if (autosaveInFlightRef.current) return;

    const compacted = compactForSave(goalsRef.current);

    const currentHash = computeHashForSave(compacted);
    if (currentHash === lastSavedHashRef.current) {
      if (!silent) setMsg(t("tomorrow.noChanges"));
      return;
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
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.saveFailed"));
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

    const compacted = compactForSave(goals);
    const firstThree = compacted.slice(0, 3).map((g) => (g.title ?? "").trim());
    if (firstThree.some((title) => title.length === 0)) {
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

    if (idx < 3) {
      // Just blank the title — don't delete the row here. If the user
      // retypes into this slot before the debounced autosave fires, the
      // existing goal (and its notes) gets updated in place instead of
      // being destroyed and recreated as an empty-history duplicate.
      // persistGoals() already deletes rows that end up with no title.
      setGoals((prev) =>
        prev.map((x, i) => (i === idx ? { ...x, title: "" } : x))
      );

      scheduleAutoSave();
      return;
    }

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
    return <div className="card">{t("tomorrow.loading")}</div>;
  }

  const locked = planStatus === "locked";
  const submitted = planStatus === "submitted";

  const normalized = normalizeGoals(goals);

  // Display order only — P1 always sorts to the top, then P2, etc. The
  // underlying `goals` array (and its actual positions 0/1/2, which
  // compactForSave/removeGoal treat as structurally required) is never
  // reordered by this; every handler below still receives originalIdx, a
  // true index into `goals`, so dragging, priority changes, and removal all
  // keep working exactly as before — only where each row visually renders
  // changes. See goalLogic.test.ts for the sort behavior itself.
  const sortedForDisplay = sortGoalsForDisplay(goals);

  // Count goals with priority 1-3 that have content
  const priorityGoalsFilled = normalized
    .filter((g) => {
      const priority = typeof g.priority === "number" ? g.priority : DEFAULT_PRIORITY;
      return priority >= 1 && priority <= 3;
    })
    .filter((g) => (g.title ?? "").trim().length > 0)
    .length;

  const canSubmit =
    !!planId && !locked && !submitted && priorityGoalsFilled >= 3 && !submitting && submitEligible;

  const canAddMore = !locked && !submitting && goals.length < MAX_GOALS;

  return (
    <div
      className="card card-highlight"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">{t("tomorrow.title")}</h1>
            <p className="text-white/70 mb-2">
              {t("tomorrow.minRequiredPart1")}<b>3</b>{t("tomorrow.minRequiredPart2")}
            </p>
            <p className="text-sm text-white/50">
              {t("tomorrow.currentPriorityGoals")}<b className={priorityGoalsFilled >= 3 ? "text-emerald-400" : "text-amber-400"}>{priorityGoalsFilled}/3</b>
              {priorityGoalsFilled > 3 && <span className="text-emerald-400">{t("tomorrow.extra", { count: priorityGoalsFilled - 3 })}</span>}
            </p>
          </div>
          
          <div className="flex flex-row items-center gap-3">
            {!locked && (
              <button
                onClick={() => setEditMode(!editMode)}
                disabled={submitting}
                className="btn"
                style={{
                  background: editMode ? "rgba(245, 158, 11, 0.3)" : undefined,
                  borderColor: editMode ? "rgba(245, 158, 11, 0.6)" : undefined,
                }}
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

        <div className="space-y-4">
          {sortedForDisplay.map(({ g, originalIdx }, displayIdx) => {
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
            const isExclusive = assignment?.assignmentType === "exclusive" && assignment.status === "accepted";

            return (
              <div key={g.id ?? `row-${idx}`}>
                {displayIdx === 3 && (
                  <div className="my-6 flex items-center gap-4">
                    <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(var(--tint-rgb),0.2), transparent)" }} />
                    <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
                      {t("tomorrow.optionalGoals")}
                    </div>
                    <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(var(--tint-rgb),0.2), transparent)" }} />
                  </div>
                )}

                {/* Goal row with drag-drop support */}
                <div
                  draggable={editMode && !locked && !submitting}
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  className="goal-row"
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
                  <div className="goal-number-badge">{displayIdx + 1}</div>

                  <div className="goal-row-body">
                  <div className="goal-row-cols">
                    {/* Goal — static, ~45% */}
                    <div style={{ flex: "1 1 40%", minWidth: "200px" }}>
                      <input
                        ref={(el) => {
                          inputRefs.current[idx] = el;
                        }}
                        type="text"
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
                        onChange={(e) =>
                          setGoals((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, title: e.target.value } : x
                            )
                          )
                        }
                        placeholder={(p >= 1 && p <= 3) ? t("tomorrow.priorityGoalPlaceholder", { p }) : t("tomorrow.optionalGoalPlaceholder")}
                        className="w-full bg-transparent border-0 text-white text-xl font-medium placeholder:text-white/40 outline-none focus:placeholder:text-white/60"
                      />

                      {/* Compact quick-add row — checklist, files, and an
                          optional link, right under the goal title. */}
                      <div
                        className="mt-2 flex items-center gap-1"
                        style={{ flexWrap: "nowrap", overflowX: "auto" }}
                      >
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
                            className="btn"
                            style={{ padding: "0.15rem 0.4rem", fontSize: "0.65rem", whiteSpace: "nowrap", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
                            title={(g as any).link_url ? (g as any).link_url : t("tomorrow.attachLink")}
                          >
                            {(g as any).link_url ? <Link2 size={11} /> : <Plus size={11} />} {t("tomorrow.link")}
                          </button>
                        )}
                      </div>

                      {/* Assign to — own row right below Checklist/Files/Link
                          rather than sharing their row, so it doesn't compete
                          with those for space or get lost among them. */}
                      {(assignment || (g.id && acceptedConnections.length > 0)) && (
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
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setAssignTypeByGoalId((prev) => ({
                                    ...prev,
                                    [g.id as string]: (prev[g.id as string] ?? "exclusive") === "exclusive" ? "shared" : "exclusive",
                                  }))
                                }
                                className="btn"
                                style={{ padding: "0.15rem 0.35rem", flexShrink: 0 }}
                                title={
                                  (assignTypeByGoalId[g.id as string] ?? "exclusive") === "exclusive"
                                    ? t("goalAssign.exclusiveHint")
                                    : t("goalAssign.sharedHint")
                                }
                              >
                                {(assignTypeByGoalId[g.id as string] ?? "exclusive") === "exclusive" ? (
                                  <Lock size={11} />
                                ) : (
                                  <Unlock size={11} />
                                )}
                              </button>
                              <select
                                value=""
                                disabled={assigningGoalIds.has(g.id as string) || locked}
                                onChange={(e) => {
                                  const recipientId = e.target.value;
                                  if (recipientId) handleAssignGoal(g.id as string, recipientId);
                                }}
                                className="btn"
                                style={{ padding: "0.15rem 0.4rem", fontSize: "0.65rem", flexShrink: 0 }}
                              >
                                <option value="" disabled>
                                  {t("goalAssign.placeholder")}
                                </option>
                                {acceptedConnections.map((c) => (
                                  <option key={c.otherUserId} value={c.otherUserId}>
                                    {connectionDisplayName(c, t)}
                                  </option>
                                ))}
                              </select>
                            </>
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

                      <div className="mt-2 flex items-center gap-2">
                        {!(g as any).is_all_day && (
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
                            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 outline-none focus:border-white/25 disabled:opacity-50"
                            title={t("tomorrow.optionalTimeTitle")}
                          />
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
                          className="btn"
                          style={{
                            padding: "0.2rem 0.55rem",
                            fontSize: "0.7rem",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            background: (g as any).is_all_day ? "rgba(245, 158, 11, 0.25)" : undefined,
                            borderColor: (g as any).is_all_day ? "rgba(245, 158, 11, 0.6)" : undefined,
                          }}
                          title={t("tomorrow.allDayTitle")}
                        >
                          {(g as any).is_all_day && <Sun size={12} />} {t("tomorrow.allDay")}
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
                        view, instead of separate Notes/History tabs. */}
                    <div style={{ flex: "1 1 40%", minWidth: "220px" }}>
                      {!g.id ? (
                        <div className="text-xs text-white/30 italic">{t("tomorrow.saveToAddNotes")}</div>
                      ) : (
                        <>
                          <GoalTimeline entries={buildGoalTimeline(g, g.previous_actions ?? [], t)} />
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

                    {/* Priority + Remove — grouped together instead of two separate cramped columns.
                        The select always renders regardless of the current priority value —
                        it previously hid itself for P4/P5, trapping the goal at that priority
                        with no way to see or change it. */}
                    <div className="flex items-center gap-3 flex-shrink-0">
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
                        } as React.CSSProperties}
                      >
                        {[1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>
                            P{v}
                          </option>
                        ))}
                      </select>

                      {/* Clear/Remove button - same size/shape as the priority select */}
                      {!locked && !isExclusive && (
                        <button
                          onClick={() => removeGoal(idx)}
                          disabled={submitting}
                          style={{
                            width: "44px",
                            height: "32px",
                            borderRadius: "8px",
                            background: "rgba(var(--tint-rgb), 0.06)",
                            border: "1px solid rgba(var(--tint-rgb), 0.15)",
                          }}
                          className="flex-shrink-0 flex items-center justify-center hover:bg-black/40 text-white/80 hover:text-white text-xs font-bold transition-all hover:border-white/40 hover:scale-105"
                          title={(p >= 1 && p <= 3) ? t("tomorrow.clearPriorityGoal") : t("tomorrow.removeGoal")}
                        >
                          <X size={15} strokeWidth={2.5} />
                        </button>
                      )}

                      {g.id && (
                        <button
                          type="button"
                          onClick={() => setShowNoteInput((prev) => ({ ...prev, [g.id as string]: !prev[g.id as string] }))}
                          className="actions-toggle"
                          data-open={!!showNoteInput[g.id]}
                          title={t("tomorrow.addNoteTitle")}
                        >
                          <MessageCircle size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!locked && (
          <div className="mt-8 flex flex-wrap gap-4 items-center">
            <button
              className="btn hover-scale"
              onClick={addMoreGoal}
              disabled={!canAddMore}
              title={
                goals.length >= MAX_GOALS ? t("tomorrow.maxGoalsReached", { max: MAX_GOALS }) : ""
              }
            >
              {t("tomorrow.addGoal")}
            </button>

            <button
              className="btn hover-scale"
              onClick={saveDraftOrChanges}
              disabled={submitting}
              title={t("tomorrow.manualSaveTitle")}
            >
              {submitting ? t("tomorrow.saving") : submitted ? t("tomorrow.saveChanges") : t("tomorrow.saveDraft")}
            </button>

            <button
              className="btn btn-primary hover-scale"
              onClick={onSubmitPlan}
              disabled={!canSubmit || submitted}
              title={
                submitted
                  ? ""
                  : !submitEligible
                  ? t("tomorrow.submitUnlocksOnce", { date: formatDateDisplay(todayISO) })
                  : priorityGoalsFilled < 3
                  ? t("tomorrow.fillInMore", { count: 3 - priorityGoalsFilled, filled: priorityGoalsFilled })
                  : ""
              }
            >
              {submitting
                ? t("tomorrow.submitting")
                : submitted
                ? t("tomorrow.plansSubmitted")
                : t("tomorrow.submitPlan")}
            </button>

            <div className="text-sm text-white/60">
              {t("tomorrow.goalsCountFooter", { count: goals.length, max: MAX_GOALS })}
            </div>
          </div>
        )}

        {!locked && !submitted && !submitEligible && (
          <div className="mt-3 text-xs text-white/50">
            {t("tomorrow.lockedSubmitMsg", { date: formatDateDisplay(todayISO) })}
          </div>
        )}

        {!locked && !submitted && submitEligible && priorityGoalsFilled < 3 && (
          <div className="mt-3 text-xs text-white/50">
            {t("tomorrow.lockedNeedMore", { count: 3 - priorityGoalsFilled, filled: priorityGoalsFilled })}
          </div>
        )}

        {locked && (
          <div className="mt-6 text-white/70">
            {t("tomorrow.planIsPart1")}<b>{planStatus}</b>{t("tomorrow.planIsPart2")}
          </div>
        )}

        <div className="mt-6 flex items-center gap-2 sm:gap-3">
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/calendar">← {t("nav.calendar")}</Link>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/backlog" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}><NotebookText size={14} /> {t("nav.backlog")}</Link>
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
"use client";

// Plan/edit goals for any date reached from the Calendar (past, future, or
// "tomorrow" viewed ahead of time). Today itself redirects to /standup/today,
// which has the review-specific UI this page doesn't need.

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  awardPlanningPoints,
  getAttachmentsForGoals,
  getChecklistItemsForGoals,
  getPlanWithGoals,
  isPrevDayReviewedForPlan,
  markDayCleared,
  submitPlan,
  toISODate,
  addDays,
  formatDateDisplay,
  formatTimeOfDay,
  formatDateTimeDisplay,
  upsertGoals,
  deleteGoal,
  getSuggestedTemplatesForDate,
  addGoalFromTemplate,
  ensurePaymentReminderGoals,
  getStreakPassBalance,
  getStreakPassCoveredDates,
  useStreakPass,
  rescheduleGoalToDate,
  getOutcomeGoals,
  findOrphanedContinuationIds,
  type ChecklistItem,
  type Goal,
  type GoalAttachment,
  type RecurringGoalTemplate,
  type StreakPassBalance,
  type OutcomeGoal,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";
import { notifyPointsUpdated } from "@/lib/pointsBus";
import {
  applyPriorityChange,
  compactForSave,
  compactForUI,
  normalizeGoals,
  DEFAULT_PRIORITY,
  MAX_GOALS,
  type DraftGoal,
} from "@/lib/goalLogic";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusLabel, statusChipColors } from "@/lib/goalStatus";
import StatusIcon from "@/components/StatusIcon";
import RescheduleModal from "@/components/RescheduleModal";
import GoalTimeline from "@/components/GoalTimeline";
import GoalChecklist from "@/components/GoalChecklist";
import GoalAttachments from "@/components/GoalAttachments";
import PageLoadingState from "@/components/PageLoadingState";
import GoalNumberOrb from "@/components/GoalNumberOrb";
import { buildGoalTimeline } from "@/lib/goalTimeline";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { Clock, Link2, Plus, Sun, Redo2, X, Ticket, Target } from "lucide-react";

export default function DynamicDatePage() {
  const { t } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const dateISO = params.date as string; // e.g., "2026-02-15"
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);
  const prevDateISO = useMemo(() => toISODate(addDays(new Date(`${dateISO}T00:00:00`), -1)), [dateISO]);
  // A day that's already happened is view-only — nothing to add or edit,
  // the only thing you can do is re-attempt a goal on a future date.
  const isPastDate = dateISO < todayISO;

  const [loading, setLoading] = useState(true);
  const [rescheduleGoal, setRescheduleGoal] = useState<Goal | null>(null);
  const [reschedulingWholeDay, setReschedulingWholeDay] = useState(false);
  // Submitting (finalizing) a plan is only ever allowed the day before that
  // plan's date, and only once today's own plan has been reviewed — this
  // mirrors the Plan Tomorrow page's discipline loop. Drafting/saving is
  // always available regardless, on any date past, present, or future.
  const [submitEligible, setSubmitEligible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [planId, setPlanId] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<string>("draft");
  const [planReviewedAt, setPlanReviewedAt] = useState<string | null>(null);
  const [planClearedAt, setPlanClearedAt] = useState<string | null>(null);
  const [clearingDay, setClearingDay] = useState(false);
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
  // Parent Major Goal titles -- resolves the (already-present on each row)
  // outcome_goal_id to its Goal's title, same id->title lookup pattern as
  // Today/Tomorrow. All statuses, not just active, so a Goal that's since
  // gone completed/abandoned still shows its real title on an old linked
  // Task instead of silently losing its label (same reasoning those pages
  // use). This page intentionally does NOT group by Goal -- see the flat
  // `goals` array / raw-index numbering below -- so this label is the only
  // place that context is shown.
  const [outcomeGoals, setOutcomeGoals] = useState<OutcomeGoal[]>([]);
  const outcomeGoalTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of outcomeGoals) map.set(o.id, o.title);
    return map;
  }, [outcomeGoals]);
  const [showLinkInput, setShowLinkInput] = useState<Record<number, boolean>>({});

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
    // Today has its own dedicated review UI — send today's date there instead.
    if (dateISO === todayISO) {
      router.replace("/standup/today");
    }
  }, [dateISO, todayISO, router]);

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
      // and link_url are new fields with the exact same failure mode.
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

    setGoals((prev) => {
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

  // silent: true for refetches after an action — the page already has
  // content on screen, so re-showing the full-page loading state would
  // blank everything out and read as a full reload. Only the initial mount
  // load should show it.
  async function refresh(opts: { silent?: boolean } = {}) {
    const { silent = false } = opts;
    if (!silent) setLoading(true);
    if (!silent) setMsg(null);

    // Draft access is always open, on any date. Submit eligibility is
    // separate and stricter: only true the day before this date, and only
    // once today's plan is actually reviewed — never satisfiable in advance
    // for dates further out, so those just stay draft-only indefinitely
    // until their eve arrives. Independent of the plan fetch, so they run
    // together.
    // Pass balance/coverage is fetched for both past AND future dates now
    // -- a streak pass can cover a future day in advance (before it's ever
    // missed), not just retroactively fix an already-missed past one. Only
    // "today" itself has no use for this (and is unreachable here anyway --
    // see the redirect above), so there's no third case to exclude.
    const [eligible, { plan, goals: dbGoals }, balance, coveredDates] = await Promise.all([
      dateISO === tomorrowISO ? isPrevDayReviewedForPlan(dateISO) : Promise.resolve(false),
      getPlanWithGoals(dateISO),
      getStreakPassBalance(),
      getStreakPassCoveredDates(dateISO, dateISO),
    ]);
    setSubmitEligible(eligible);
    setPlanId(plan.id);
    setPlanStatus(plan.status);
    setPlanReviewedAt(plan.reviewed_at);
    setPlanClearedAt(plan.cleared_at ?? null);
    setPassBalance(balance);
    setCoveredByPass(coveredDates.has(dateISO));

    // Fetch reschedule origin data, previous actions/comments, checklist
    // items, and attachments for all goals together — none of these four
    // depend on each other, only on goalIds. Checklist/attachments keep
    // their own error isolation (a missing/misconfigured table there
    // shouldn't take down the whole goals list).
    const goalIds = dbGoals.map((g) => g.id).filter(Boolean) as string[];
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
        supabase
          .from("goal_notes")
          .select("goal_id, note, created_at, kind")
          .in("goal_id", goalIds)
          .order("created_at", { ascending: false }),
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
      // date it was materialized onto. Re-derives the same structural
      // signal cancelOrphanedReschedules itself used to cancel it
      // (lineage + source status) via the same shared helper Plan
      // Tomorrow uses, rather than a second definition; an ordinary,
      // independently user-canceled Task never matches an edge here and
      // is untouched.
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

      notesResult.data?.forEach((note) => {
        if (!notesMap[note.goal_id]) notesMap[note.goal_id] = [];
        notesMap[note.goal_id].push(note);
      });
      setGoalComments(notesMap);
      setChecklistItems(checklistResult);
      setAttachments(attachmentsResult);
    }

    // Excludes auto-canceled orphan continuations entirely -- they stay
    // in the database (and Calendar/history views) but never render as an
    // active commitment here, and never count toward totals/validation/
    // submission below, all of which are derived from this `goals` state.
    const goalsWithOrigin = dbGoals
      .filter((g) => !orphanIds.has(g.id))
      .map((g) => ({
        ...g,
        rescheduled_from_date: rescheduleOrigins[g.id]?.from_date || null,
        reschedule_reason: rescheduleOrigins[g.id]?.reason || null,
      }));

    const goalsWithData = goalsWithOrigin.map((g) => ({
      ...g,
      previous_actions: notesMap[g.id] || [],
    }));

    // Excluded orphans are left out of the tracked id set too, so the
    // next autosave's delete-diff never mistakes their absence from
    // `goals` state for the user having deleted them -- they must never
    // be deleted, only hidden.
    originalIdsRef.current = new Set(goalIds.filter((id) => !orphanIds.has(id)));

    const rows = compactForUI(goalsWithData);
    setGoals(rows);
    lastSavedHashRef.current = computeHashForSave(rows);

    // Best-effort, non-blocking -- only resolves the parent-Goal label on
    // already-loaded rows (point 3 above), doesn't gate the page's own
    // load/save/submit critical path. Same "all statuses" fetch Today/
    // Tomorrow already use for this exact id->title resolution.
    getOutcomeGoals()
      .then(setOutcomeGoals)
      .catch(() => {});

    if (!silent) setLoading(false);
  }

  useEffect(() => {
    if (dateISO === todayISO) return; // redirecting away, don't bother loading
    refresh().catch((e) => {
      setMsg(e?.message ?? t("today.failedLoad"));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO]);

  useEffect(() => {
    if (isPastDate) return; // read-only view — no suggestions/reminders to add
    getSuggestedTemplatesForDate(dateISO)
      .then(setSuggestedTemplates)
      .catch(() => {});
    // Payment reminders are auto-created (not a tap-to-add suggestion like
    // templates) -- explicit user call. See Tomorrow page's identical effect.
    ensurePaymentReminderGoals(dateISO)
      .then((created) => {
        if (created.length > 0) {
          refresh({ silent: true });
          setMsg(t("tomorrow.paymentGoalsAdded", { names: created.map((a) => a.name).join(", ") }));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO, isPastDate]);

  async function handleAddSuggestedTemplate(template: RecurringGoalTemplate) {
    if (addingTemplateId) return;
    setAddingTemplateId(template.id);
    try {
      await addGoalFromTemplate(template, dateISO);
      setSuggestedTemplates((prev) => prev.filter((t2) => t2.id !== template.id));
      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.failedAddSuggested"));
    } finally {
      setAddingTemplateId(null);
    }
  }

  function addMoreGoal() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setGoals((prev) => {
      if (prev.length >= MAX_GOALS) {
        setMsg(t("datePage.maxGoalsFocused", { max: MAX_GOALS }));
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
        setMsg(t("datePage.maxGoalsFocused", { max: MAX_GOALS }));
        return;
      }
      addMoreGoal();
    } else {
      setPendingFocusIndex(idx + 1);
    }
  }

  // Returns the authoritative, id-bearing goal rows -- see Tomorrow page's
  // identical persistGoals for why callers that need real ids (e.g. before
  // auto-rescheduling draft content) should use this return value rather
  // than the `goals` state var.
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
      setMsg(t("datePage.needThreeGoalsForDate", { date: formatDateDisplay(dateISO) }));
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
          ? t("datePage.submittedForDatePoints", { date: formatDateDisplay(dateISO), points: 5 })
          : t("datePage.submittedForDate", { date: formatDateDisplay(dateISO) })
      );
    } catch (e: any) {
      setMsg(e?.message ?? t("tomorrow.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClearDay() {
    if (!planId || clearingDay) return;
    if (
      !window.confirm(
        t("datePage.confirmClearDay", { date: formatDateDisplay(dateISO) })
      )
    ) {
      return;
    }

    setClearingDay(true);
    setMsg(null);
    try {
      await markDayCleared(planId);
      await refresh({ silent: true });
      setMsg(t("datePage.clearedMarked", { date: formatDateDisplay(dateISO) }));
    } catch (e: any) {
      setMsg(e?.message ?? t("datePage.failedClearDay"));
    } finally {
      setClearingDay(false);
    }
  }

  async function handleUseStreakPass() {
    if (!planId || usingPass || coveredByPass) return;

    // Only a FUTURE day can still have untouched draft content worth
    // moving -- a past day's goals are already done one way or another,
    // and already have their own dedicated "Re-attempt whole day" flow
    // for exactly that case, unrelated to streak passes.
    let draftGoalsWithContent: (DraftGoal & { id: string })[] = [];
    let dayAfterISO = "";
    if (!isPastDate) {
      const savedRows = await persistGoals(true);
      draftGoalsWithContent = savedRows.filter(
        (g): g is DraftGoal & { id: string } => !!g.id && (g.title ?? "").trim().length > 0
      );
      dayAfterISO = toISODate(addDays(new Date(`${dateISO}T00:00:00`), 1));
    }

    // Same RPC either way (use_streak_pass no longer restricts plan_date to
    // the past) -- only the confirm copy differs, since covering a future
    // day is a proactive choice rather than fixing an already-missed one.
    const confirmKey =
      isPastDate
        ? "datePage.confirmUseStreakPass"
        : draftGoalsWithContent.length > 0
        ? "datePage.confirmUseStreakPassAdvanceWithDrafts"
        : "datePage.confirmUseStreakPassAdvance";
    if (
      !window.confirm(
        t(confirmKey, {
          count: passBalance?.available ?? 0,
          date: formatDateDisplay(dateISO),
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

  if (dateISO === todayISO || loading) {
    return <PageLoadingState label={t("tomorrow.loading")} />;
  }

  if (isPastDate) {
    const pastGoals = goals.filter((g) => (g.title ?? "").trim().length > 0);
    const isMissed = planStatus === "submitted" && !planReviewedAt && !planClearedAt && !coveredByPass;
    // Matches use_streak_pass's own eligibility exactly (see that RPC):
    // a past day, never reviewed, not already covered. Deliberately NOT
    // gated on planStatus/isMissed/cleared like the UI copy above is --
    // a day whose goals were all individually rescheduled away (instead
    // of being formally submitted/reviewed/cleared) still has
    // reviewed_at = null and is still fully eligible server-side, but
    // was previously hidden here since planStatus never reached
    // "submitted" in that case.
    const canUseStreakPass = !planReviewedAt && !coveredByPass;
    // Whole-day re-attempt only offered when nothing on this day has been
    // touched at all — if even one goal was already completed or
    // individually rescheduled, a blanket "move everything" would carry
    // that one along too, which isn't what re-attempting a missed day means.
    const allUntouched =
      pastGoals.length > 0 && pastGoals.every((g) => (g.status ?? "not_started") === "not_started");

    return (
      <div className="card card-highlight">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">{t("datePage.goalsFor", { date: formatDateDisplay(dateISO) })}</h1>
            <p className="text-sm text-white/60">
              {t("datePage.pastDayViewOnly")}
            </p>
            {isMissed && (
              <p className="mt-2 text-xs text-red-400">
                {t("datePage.neverReviewedMissed")}
              </p>
            )}
            {!!planClearedAt && !coveredByPass && (
              <p className="mt-2 text-xs text-emerald-400">
                {t("datePage.clearedOn", { date: formatDateTimeDisplay(planClearedAt) })}
              </p>
            )}
            {coveredByPass && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-400">
                <Ticket size={13} /> {t("datePage.streakPassCovered")}
              </p>
            )}
          </div>
          <div className="flex flex-row flex-wrap gap-2">
            {isMissed && allUntouched && (
              <button className="btn" onClick={() => setReschedulingWholeDay(true)}>
                {t("datePage.reattemptWholeDay")}
              </button>
            )}
            {isMissed && (
              <button className="btn" onClick={handleClearDay} disabled={clearingDay}>
                {clearingDay ? t("datePage.clearing") : t("datePage.clearThisDay")}
              </button>
            )}
            {canUseStreakPass && (
              <button
                className="btn inline-flex items-center gap-1.5"
                onClick={handleUseStreakPass}
                disabled={usingPass || (passBalance?.available ?? 0) <= 0}
                title={(passBalance?.available ?? 0) <= 0 ? t("datePage.noStreakPasses") : undefined}
              >
                <Ticket size={14} />
                {usingPass ? t("datePage.usingPass") : t("datePage.useStreakPass", { count: passBalance?.available ?? 0 })}
              </button>
            )}
            <button className="btn" onClick={() => router.push("/standup/calendar")}>
              ← {t("nav.calendar")}
            </button>
          </div>
        </div>

        {pastGoals.length === 0 ? (
          <div className="text-white/60 text-sm py-12 text-center">
            {t("datePage.noGoalsPlanned")}
          </div>
        ) : (
          <div className="space-y-3">
            {pastGoals.map((g) => {
              const p = typeof g.priority === "number" ? g.priority : DEFAULT_PRIORITY;
              const status = g.status ?? "not_started";

              return (
                <div
                  key={g.id}
                  className="goal-row"
                  style={{ "--p-color": getPriorityMeta(p).color } as React.CSSProperties}
                >
                  {/* No number badge on past (view-only) days, so this
                      doesn't need the top clearance .goal-row-body normally
                      reserves for it. */}
                  <div className="goal-row-body" style={{ paddingTop: "1.25rem" }}>
                  <div className="flex items-start flex-wrap gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-lg font-semibold text-white">
                        {g.title}
                        {g.time_of_day && (
                          <span className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-white/50">
                            <Clock size={13} />
                            {formatTimeOfDay(g.time_of_day)}
                          </span>
                        )}
                      </div>
                      {g.details && <div className="mt-1 text-sm text-white/60">{g.details}</div>}

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
                              onItemsChange={() => {}}
                              readOnly
                            />
                            <GoalAttachments
                              compact
                              goalId={g.id}
                              items={attachments[g.id] ?? []}
                              onItemsChange={() => {}}
                              readOnly
                            />
                          </>
                        )}
                        {g.link_url && (
                          <button
                            type="button"
                            onClick={() => window.open(g.link_url as string, "_blank", "noopener,noreferrer")}
                            className="btn"
                            style={{ padding: "0.15rem 0.4rem", fontSize: "0.65rem", whiteSpace: "nowrap", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
                            title={g.link_url}
                          >
                            <Link2 size={11} /> {t("tomorrow.link")}
                          </button>
                        )}
                      </div>

                      {g.rescheduled_from_date && (
                        <div className="mt-2 inline-flex items-start gap-1 text-xs text-white/50">
                          <Redo2 size={12} className="mt-0.5 flex-shrink-0" />
                          <span>
                            {t("tomorrow.rescheduledFrom", { date: formatDateDisplay(g.rescheduled_from_date) })}
                            {g.reschedule_reason && <span className="italic"> — "{g.reschedule_reason}"</span>}
                          </span>
                        </div>
                      )}

                      <GoalTimeline entries={buildGoalTimeline(g, g.previous_actions ?? [], t)} />
                    </div>

                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
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

                      <button
                        type="button"
                        className="btn"
                        onClick={() => setRescheduleGoal(g as Goal)}
                        style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}
                      >
                        {t("datePage.reattempt")}
                      </button>
                    </div>
                  </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(rescheduleGoal || reschedulingWholeDay) && (
          <RescheduleModal
            goals={reschedulingWholeDay ? (pastGoals as Goal[]) : rescheduleGoal ? [rescheduleGoal] : []}
            onClose={() => {
              setRescheduleGoal(null);
              setReschedulingWholeDay(false);
            }}
            onSuccess={(kind) => {
              setMsg(kind === "backlog" ? t("today.movedToBacklog") : t("datePage.goalRescheduledPlain"));
              setRescheduleGoal(null);
              setReschedulingWholeDay(false);
              refresh({ silent: true });
            }}
          />
        )}

        {msg && <div className="mt-4 text-sm text-amber-400">{msg}</div>}
      </div>
    );
  }

  const locked = planStatus === "locked";
  const submitted = planStatus === "submitted";

  const normalized = normalizeGoals(goals);

  // A Commitment is any non-empty Task, regardless of priority or
  // position — the locked 3-10 model. Priority (P1-P5) is ranking
  // metadata only and never gates submission.
  const totalGoalsFilled = normalized.filter((g) => (g.title ?? "").trim().length > 0).length;

  const canSubmit =
    !!planId && !locked && !submitted && totalGoalsFilled >= 3 && !submitting && submitEligible;

  const canAddMore = !locked && !submitting && goals.length < MAX_GOALS;

  // The one existing Task card, extracted verbatim from the old flat
  // .map() so it can be called both from the unchanged flat/editMode list
  // below AND from the new grouped-by-Goal view -- same JSX, same
  // handlers, same `idx` (the row's real position in the flat `goals`
  // array), nothing duplicated. `showParentLabel` only controls whether
  // the small inline "◎ Goal title" line renders on THIS card -- false
  // when the card is already inside a group wrapper that shows the same
  // title once as its own header, so it isn't repeated.
  function renderGoalRow(g: DraftGoal, idx: number, opts?: { showParentLabel?: boolean }) {
    const showParentLabel = opts?.showParentLabel !== false;
    const p =
      typeof g.priority === "number" && Number.isFinite(g.priority)
        ? g.priority
        : DEFAULT_PRIORITY;
    const opt = getPriorityMeta(p);

    return (
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
            own top-left border/radius. */}
        <GoalNumberOrb number={idx + 1} />
        {/* Mirrors the number badge on the opposite corner — moved
            here from an inline button next to the priority select,
            same as Today's goal-delete-corner-btn. */}
        {!locked && (
          <button
            type="button"
            onClick={() => removeGoal(idx)}
            disabled={submitting}
            className="goal-delete-corner-btn"
            title={(p >= 1 && p <= 3) ? t("tomorrow.clearPriorityGoal") : t("tomorrow.removeGoal")}
          >
            <X size={12} />
          </button>
        )}

        <div className="goal-row-body">
        <div className="goal-row-cols">
          {/* Single content column -- this page has no second (notes)
              column like Plan Tomorrow's, so every section below is a
              normal block-flow child of ONE flex item instead of each
              being its own flexBasis:100% child of .goal-row-cols. That
              used to mean .goal-row-cols' own `gap` (1.5rem desktop,
              0.6rem mobile) applied BETWEEN every one of ~7 sections,
              compounding with their individual mt-2/mb-3 margins into
              the large dead space between them -- same structural fix
              Plan Tomorrow's own card already uses.

              `width`/`maxWidth`/`boxSizing` added here (not present
              before): .goal-row-cols sets `align-items: flex-start` and
              switches to `flex-direction: column` at <=640px (see the
              "Regression fix" comment on .goal-row-cols below, which
              documents this exact class hitting this exact bug once
              already, for a different pair of columns). Under a
              column-direction flex container, `align-items` governs the
              CROSS axis, which is now the horizontal one -- "flex-start"
              (not "stretch") sizes this item via fit-content/shrink-to-
              fit instead of stretching it to the container's full
              width. Fit-content still won't itself exceed the available
              width, but it also won't reliably floor out at exactly
              that width either once the column stacks, which left this
              item's own effective width ambiguous for anything inside
              it that depends on a definite 100% to wrap text against
              (the reschedule-reason line below). An explicit `width:
              100%` removes that ambiguity outright, independent of
              align-items/flex-direction. */}
          <div style={{ flex: "1 1 100%", minWidth: "200px", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
            {/* Parent Major Goal context -- only for a linked Task
                (outcome_goal_id non-null) when NOT already shown once as
                a group header above (showParentLabel). Presentation only:
                does not affect ordering, numbering, or which column this
                Task sits in -- the card below is untouched otherwise. */}
            {showParentLabel && (g as any).outcome_goal_id && outcomeGoalTitleById.get((g as any).outcome_goal_id) && (
              <div className="goal-task-label mb-1">
                <Target size={12} className="flex-shrink-0" />
                <span className="goal-task-label-text truncate">
                  {outcomeGoalTitleById.get((g as any).outcome_goal_id)}
                </span>
              </div>
            )}

            {/* Header — priority leads the title on one row, same
                position/geometry as Plan Tomorrow's card (explicit user
                call: priority must never read as detached/orphaned at
                the bottom of the card). Same select/handler, textarea,
                and placeholder as before, only moved up next to it. */}
            <div className="flex items-start gap-2">
              <select
                value={p}
                disabled={locked || submitting}
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
                disabled={locked || submitting}
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
                style={{ overflow: "hidden", lineHeight: 1.3 }}
                className="goal-title-input flex-1 min-w-0 bg-transparent border-0 text-white text-xl font-medium placeholder:text-white/40 outline-none focus:placeholder:text-white/60 resize-none"
              />
            </div>

            {/* Toolbar — Checklist/Files/Link, normalized to Plan
                Tomorrow's shared .goal-toolbar/.goal-toolbar-btn system
                (consistent height/padding/icon size/gaps there) instead
                of this page's own ad-hoc inline-styled button + a
                flexWrap:"nowrap"/overflowX:"auto" row that could only
                ever scroll sideways, never wrap cleanly. */}
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
                    readOnly={locked}
                  />
                  <GoalAttachments
                    compact
                    goalId={g.id}
                    items={attachments[g.id] ?? []}
                    onItemsChange={(items) =>
                      setAttachments((prev) => ({ ...prev, [g.id as string]: items }))
                    }
                    readOnly={locked}
                  />
                </>
              )}
              <button
                type="button"
                onClick={() => setShowLinkInput((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                className="btn btn-tint btn-teal goal-toolbar-btn"
                title={(g as any).link_url ? (g as any).link_url : t("tomorrow.attachLink")}
              >
                {(g as any).link_url ? <Link2 size={13} /> : <Plus size={13} />}
                <span className="goal-toolbar-label">{t("tomorrow.link")}</span>
              </button>
            </div>

            {showLinkInput[idx] && (
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

            {/* Scheduling — compact clock-icon trigger + All day, same
                treatment as Plan Tomorrow instead of the old wide native
                "--:--" box always visible inline. The real
                <input type="time"> keeps its exact original value/
                onChange/onBlur/autosave; it's just layered invisibly
                over the icon so tapping it still opens the native time
                picker. All day also drops its old inline
                background/borderColor override for the shared
                .btn-tint/.btn-amber-tint treatment. */}
            <div className="mt-2 flex items-center flex-wrap gap-1.5">
              {!(g as any).is_all_day && (
                <div
                  className={`btn goal-toolbar-btn relative${g.time_of_day ? " btn-tint btn-amber-tint" : ""}`}
                  style={{ opacity: locked || submitting ? 0.5 : 1 }}
                >
                  <Clock size={13} className="flex-shrink-0" />
                  <input
                    type="time"
                    value={g.time_of_day?.slice(0, 5) ?? ""}
                    disabled={locked || submitting}
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
                disabled={locked || submitting}
                onClick={() => {
                  setGoals((prev) =>
                    prev.map((x, i) =>
                      i === idx ? { ...x, is_all_day: !(x as any).is_all_day, time_of_day: null } : x
                    )
                  );
                  scheduleAutoSave();
                }}
                className={`btn goal-toolbar-btn${(g as any).is_all_day ? " btn-tint btn-amber-tint" : ""}`}
                title={t("tomorrow.allDayTitle")}
              >
                {(g as any).is_all_day && <Sun size={12} className="flex-shrink-0" />} {t("tomorrow.allDay")}
              </button>
            </div>

            {/* Rescheduled-from metadata — compact secondary line (Plan
                Tomorrow's exact treatment) instead of this page's old
                bordered/backgrounded "panel" with an 18px icon; still
                visibly amber, still carries the full reason text
                (wrapping naturally, no truncation), just subordinate to
                the title instead of competing with it. */}
            {g.id && g.rescheduled_from_date && (
              <div className="mt-2 flex items-start gap-2">
                <Redo2 className="text-yellow-400 mt-0.5 flex-shrink-0" size={13} />
                {/* flex-1 (not just min-w-0) -- without flex-grow this
                    item sized itself to its own max-content (the reason
                    line's full unwrapped length) instead of claiming
                    the row's actual remaining width, so min-w-0 alone
                    let it shrink but never gave it a reason to. Together
                    they make this box always equal "icon width minus
                    the row's real available space", which is what the
                    text then wraps against. break-words is a second,
                    independent safety net for a reason string that's
                    one long unbroken token (no spaces to wrap at). */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-yellow-300/90 font-medium break-words">
                    {t("tomorrow.rescheduledFrom", { date: formatDateDisplay(g.rescheduled_from_date) })}
                  </div>
                  {g.reschedule_reason && (
                    <div className="text-xs text-white/60 italic mt-0.5 break-words">
                      "{g.reschedule_reason}"
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Previous actions/comments — same <details> disclosure and
                data as before (unchanged functionality), just given the
                same compact mt-2 rhythm as everything else above instead
                of its own mt-2/mb-3 pairing, and positioned directly
                under the reschedule metadata rather than floating with
                extra trailing space before the priority row (which no
                longer exists below it -- priority moved into the header
                above). */}
            {g.id && g.previous_actions && g.previous_actions.length > 0 && (
              <div className="mt-2">
                <details className="text-xs">
                  <summary className="text-emerald-400 cursor-pointer hover:text-emerald-300">
                    {t(g.previous_actions.length === 1 ? "datePage.previousActions.one" : "datePage.previousActions.other", { count: g.previous_actions.length })}
                  </summary>
                  <div className="mt-2 space-y-1 pl-4">
                    {g.previous_actions.map((action, i) => (
                      <div key={i} className="text-white/60 border-l-2 border-white/10 pl-2">
                        {action.note}
                        <div className="text-white/40 text-[10px]">{new Date(action.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    );
  }

  // Groups the full (Task, real-array-index) list by outcome_goal_id, for
  // the read-only (!editMode) view only -- see the call site below. A
  // Goal's Tasks are pulled together into one wrapper card at the
  // position of the FIRST member encountered (e.g. Task #5 renders next
  // to #1/#2 instead of in its own later slot); a standalone Task (no
  // outcome_goal_id, or a Goal whose title hasn't resolved yet) renders
  // individually in its own natural position, unchanged. Never reorders
  // `goals` itself. Called once across every Task now -- there is no
  // priority/optional boundary left to split the call in two.
  function renderGroupedSection(items: { g: DraftGoal; idx: number }[]) {
    const seen = new Set<string>();
    const nodes: React.ReactNode[] = [];

    for (const item of items) {
      const gid = (item.g as any).outcome_goal_id as string | null | undefined;
      const title = gid ? outcomeGoalTitleById.get(gid) : undefined;

      if (!gid || !title) {
        nodes.push(
          <div key={item.g.id ?? `row-${item.idx}`}>{renderGoalRow(item.g, item.idx)}</div>
        );
        continue;
      }
      if (seen.has(gid)) continue; // already rendered as part of an earlier cluster
      seen.add(gid);

      const clusterItems = items.filter(
        (x) => (x.g as any).outcome_goal_id === gid && outcomeGoalTitleById.get(gid)
      );

      nodes.push(
        // Reuses Review Today's own .goal-group-card treatment (header +
        // children tray) rather than a separate ad-hoc design -- no
        // .goal-group-card-summary/-stats here, since this page doesn't
        // duplicate Goal progress/counting (unchanged, intentional).
        <div key={`group-${gid}-${item.idx}`} className="goal-group-card">
          <div className="goal-group-card-header">
            <div className="goal-group-card-title">
              <Target size={16} className="flex-shrink-0" style={{ color: "#f472b6" }} />
              <h3 className="text-base font-semibold text-white truncate">{title}</h3>
            </div>
          </div>
          <div className="goal-group-card-children space-y-4">
            {clusterItems.map(({ g, idx }) => (
              <div key={g.id ?? `row-${idx}`}>{renderGoalRow(g, idx, { showParentLabel: false })}</div>
            ))}
          </div>
        </div>
      );
    }

    return nodes;
  }

  return (
    <div
      className="card card-highlight"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div className="flex-1">
          <h1 className="text-3xl font-bold mb-2">{t("datePage.goalsFor", { date: formatDateDisplay(dateISO) })}</h1>
          <p className="text-white/70 mb-2">
            {t("tomorrow.commitmentRuleSummary", { min: 3, max: MAX_GOALS })}
          </p>
          {coveredByPass && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-400">
              <Ticket size={13} /> {t("datePage.streakPassCoveredAdvance")}
            </p>
          )}
        </div>

        <div className="date-metal-actions date-metal-actions--top">
          <button className="btn date-metal-btn" onClick={() => router.push("/standup/calendar")}>
            ← {t("nav.calendar")}
          </button>
          {!coveredByPass && (
            <button
              className="btn date-metal-btn date-metal-btn--accent"
              onClick={handleUseStreakPass}
              disabled={usingPass || (passBalance?.available ?? 0) <= 0}
              title={(passBalance?.available ?? 0) <= 0 ? t("datePage.noStreakPasses") : undefined}
            >
              <Ticket size={14} className="flex-shrink-0" />
              {usingPass ? t("datePage.usingPass") : t("datePage.useStreakPassAdvance", { count: passBalance?.available ?? 0 })}
            </button>
          )}
          {!locked && (
          <button
            onClick={() => setEditMode(!editMode)}
            disabled={submitting}
            className={`btn date-metal-btn${editMode ? " date-metal-btn--accent" : ""}`}
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
        {editMode ? (
          // Reorder mode — unchanged flat list, exact same markup/order as
          // before grouping existed. Dragging only reads/writes raw array
          // indices (handleDragStart/handleDragOver both splice `goals` by
          // idx), so it only ever runs against this ungrouped view; the
          // grouped view below is always non-draggable (draggable is
          // gated on editMode), so there's no index-vs-visual-position
          // conflict to reconcile.
          goals.map((g, idx) => (
            <div key={g.id ?? `row-${idx}`}>{renderGoalRow(g, idx)}</div>
          ))
        ) : (
          // Grouped-by-Goal view -- one pass across every Task, no
          // priority/optional boundary to split across anymore.
          renderGroupedSection(goals.map((g, idx) => ({ g, idx })))
        )}
      </div>


      {!locked && (
        <div className="mt-8">
          <div className="date-metal-actions date-metal-actions--bottom">
            <button
              className="btn date-metal-btn"
              onClick={addMoreGoal}
              disabled={!canAddMore}
              title={
                goals.length >= MAX_GOALS ? t("tomorrow.maxCommitmentsReached", { max: MAX_GOALS }) : ""
              }
            >
              {t("tomorrow.addGoal")}
            </button>

            <button
              className="btn date-metal-btn date-metal-btn--accent"
              onClick={saveDraftOrChanges}
              disabled={submitting}
              title={t("tomorrow.manualSaveTitle")}
            >
              {submitting ? t("tomorrow.saving") : submitted ? t("tomorrow.saveChanges") : t("tomorrow.saveDraft")}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 items-center">
            <button
              className="btn btn-primary hover-scale"
              onClick={onSubmitPlan}
              disabled={!canSubmit || submitted}
              title={
                !submitted && !submitEligible
                  ? dateISO === tomorrowISO
                    ? t("tomorrow.submitUnlocksOnce", { date: formatDateDisplay(todayISO) })
                    : t("datePage.submitUnlocksEvening", { date: formatDateDisplay(prevDateISO) })
                  : ""
              }
            >
              {submitting
                ? t("tomorrow.submitting")
                : submitted
                ? t("datePage.planSubmittedBtn")
                : t("datePage.submitPlanBtn")}
            </button>

            <div className="text-sm text-white/60">
              {t("tomorrow.goalsCountFooter", { count: goals.length, max: MAX_GOALS })}
            </div>
          </div>
        </div>
      )}

      {!locked && !submitted && !submitEligible && (
        <div className="mt-3 text-xs text-white/50">
          {dateISO === tomorrowISO
            ? t("tomorrow.lockedSubmitMsg", { date: formatDateDisplay(todayISO) })
            : t("datePage.lockedSubmitMsgFuture", { date: formatDateDisplay(prevDateISO) })}
        </div>
      )}

      {locked && (
        <div className="mt-6 text-white/70">
          {t("tomorrow.planIsPart1")}<b>{planStatus}</b>{t("tomorrow.planIsPart2")}
        </div>
      )}

      {msg && (
        <div className="mt-6 px-4 py-3 rounded-xl text-sm text-white animate-fadeIn" style={{ background: "rgba(var(--tint-rgb),0.1)", backdropFilter: "blur(10px)", border: "1px solid rgba(var(--tint-rgb),0.2)" }}>
          {msg}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import RescheduleModal from "@/components/RescheduleModal";
import BlockedReasonModal from "@/components/BlockedReasonModal";
import GoalTimeline from "@/components/GoalTimeline";
import GoalChecklist from "@/components/GoalChecklist";
import GoalAttachments from "@/components/GoalAttachments";
import { buildGoalTimeline } from "@/lib/goalTimeline";
import {
  addDays,
  addGoalNote,
  awardAwarenessPoints,
  awardClosurePoints,
  computeClosurePoints,
  enforceSingleP1,
  getAttachmentsForGoals,
  getChecklistItemsForGoals,
  getPlanWithGoals,
  getStreak,
  hoursUntilMidnight,
  markGoalReviewed,
  markPlanReviewed,
  updateGoalPriority,
  updateGoalStatus,
  updateGoalLink,
  toISODate,
  formatDateDisplay,
  formatTimeOfDay,
  formatDateTimeDisplay,
  upsertGoals,
  type ChecklistItem,
  type DailyPlan,
  type Goal,
  type GoalAttachment,
  type GoalStatus,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusLabel, statusIcon, statusChipColors } from "@/lib/goalStatus";
import { notifyPointsUpdated } from "@/lib/pointsBus";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

// Priority options matching Tomorrow page
const PRIORITY_OPTIONS = [
  { 
    v: 1, 
    label: "Highest Priority", 
    icon: "🔴",
    bgGradient: "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(225, 29, 72, 0.15))",
    borderColor: "rgba(239, 68, 68, 0.3)",
    buttonBg: "linear-gradient(135deg, #dc2626, #b91c1c)",
    buttonBorder: "#991b1b",
    buttonShadow: "0 4px 16px rgba(220, 38, 38, 0.4)"
  },
  { 
    v: 2, 
    label: "High Priority", 
    icon: "🟠",
    bgGradient: "linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(251, 146, 60, 0.15))",
    borderColor: "rgba(249, 115, 22, 0.3)",
    buttonBg: "linear-gradient(135deg, #ea580c, #c2410c)",
    buttonBorder: "#9a3412",
    buttonShadow: "0 4px 16px rgba(234, 88, 12, 0.4)"
  },
  { 
    v: 3, 
    label: "Medium Priority", 
    icon: "🟡",
    bgGradient: "linear-gradient(135deg, rgba(250, 204, 21, 0.15), rgba(253, 224, 71, 0.15))",
    borderColor: "rgba(250, 204, 21, 0.3)",
    buttonBg: "linear-gradient(135deg, #ca8a04, #a16207)",
    buttonBorder: "#854d0e",
    buttonShadow: "0 4px 16px rgba(202, 138, 4, 0.4)"
  },
  { 
    v: 4, 
    label: "Low Priority", 
    icon: "⚪",
    bgGradient: "linear-gradient(135deg, rgba(148, 163, 184, 0.12), rgba(203, 213, 225, 0.12))",
    borderColor: "rgba(148, 163, 184, 0.25)",
    buttonBg: "linear-gradient(135deg, rgba(100, 116, 139, 0.8), rgba(71, 85, 105, 0.8))",
    buttonBorder: "rgba(100, 116, 139, 0.9)",
    buttonShadow: "0 4px 16px rgba(100, 116, 139, 0.3)"
  },
  { 
    v: 5, 
    label: "Lowest Priority", 
    icon: "⚫",
    bgGradient: "linear-gradient(135deg, rgba(71, 85, 105, 0.12), rgba(51, 65, 85, 0.12))",
    borderColor: "rgba(71, 85, 105, 0.25)",
    buttonBg: "linear-gradient(135deg, rgba(71, 85, 105, 0.7), rgba(51, 65, 85, 0.7))",
    buttonBorder: "rgba(71, 85, 105, 0.8)",
    buttonShadow: "0 4px 16px rgba(71, 85, 105, 0.3)"
  },
];


const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "attempted", label: "Attempted" },
  { value: "blocked", label: "Blocked" },
  { value: "postponed", label: "Postponed" },
];

export default function TodayPage() {
  const { t } = useLanguage();
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  // Per-goal busy tracking (a Set, not a single id) — goals are reviewed
  // independently, so marking goal A busy must not block a click on goal B
  // while A's request is still in flight.
  const [busyGoalIds, setBusyGoalIds] = useState<Set<string>>(new Set());
  // Goal ids currently showing the "just completed" celebration animation —
  // transient, cleared automatically after the animation finishes.
  const [celebratingGoalIds, setCelebratingGoalIds] = useState<Set<string>>(new Set());
  // Completed/canceled goals collapse under a status banner by default to
  // keep a reviewed list scannable — this tracks which ones have been
  // manually expanded back open (e.g. to re-read notes or change status).
  const [expandedDoneIds, setExpandedDoneIds] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState(false);
  const [rescheduleGoal, setRescheduleGoal] = useState<Goal | null>(null);
  // Blocked requires a reason before it's applied — see confirmBlocked().
  // The prompt intercepts selectQuickAction before anything else happens,
  // so canceling it leaves the goal completely untouched.
  const [blockingGoal, setBlockingGoal] = useState<Goal | null>(null);
  const [blockingSaving, setBlockingSaving] = useState(false);
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  
  // Notes + the derived history facts render as one merged timeline below
  // the goal now (see the entries computation in the render below) instead
  // of behind Notes/History tabs — both are preloaded up front regardless.
  const [goalNotes, setGoalNotes] = useState<Record<string, any[]>>({});
  const [notesFetched, setNotesFetched] = useState<Record<string, boolean>>({});
  const [checklistItems, setChecklistItems] = useState<Record<string, ChecklistItem[]>>({});
  const [attachments, setAttachments] = useState<Record<string, GoalAttachment[]>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});

  // Per-goal action menu (collapsed behind the gear icon until clicked)
  const [showActions, setShowActions] = useState<Record<string, boolean>>({});
  // Per-goal "Add Note" input, toggled from next to the action controls.
  const [showNoteInput, setShowNoteInput] = useState<Record<string, boolean>>({});
  // Per-goal "Attach a link" input, toggled from the compact Checklist/Files/Link row.
  const [showLinkInput, setShowLinkInput] = useState<Record<string, boolean>>({});
  
  // Quick Add state
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddGoals, setQuickAddGoals] = useState([
    { title: "", priority: 1, time_of_day: "" },
    { title: "", priority: 2, time_of_day: "" },
    { title: "", priority: 3, time_of_day: "" },
  ]);
  const [addingGoals, setAddingGoals] = useState(false);

  // Transient (not permanent) in-flight guard: the awareness-award trigger
  // reads plan.awareness_awarded from React state, which only updates after
  // refresh() resolves — so reviewing two goals in quick succession could
  // otherwise fire the award request twice before either result lands. This
  // resets in a finally block either way, so a failed attempt can still be
  // retried on the next goal reviewed.
  const awarenessInFlightRef = useRef(false);

  // refresh() has no natural request ordering — two overlapping calls (e.g.
  // triggered by reviewing two goals in quick succession) can resolve out of
  // order. Without this, a slower-but-earlier-started refresh can land AFTER
  // a faster-but-later one and clobber its more current goal state. Only the
  // response matching the latest-issued sequence number is applied.
  const refreshSeqRef = useRef(0);

  function markGoalBusy(id: string) {
    setBusyGoalIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function clearGoalBusy(id: string) {
    setBusyGoalIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleExpandedDone(id: string) {
    setExpandedDoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const locked = plan?.status === "locked";
  const dayClosed = !!plan?.reviewed_at;

  const sortedGoals = useMemo(() => {
    const list = [...goals];
    list.sort((a, b) => {
      const ap = typeof a.priority === "number" ? a.priority : 999;
      const bp = typeof b.priority === "number" ? b.priority : 999;
      if (ap !== bp) return ap - bp;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    return list;
  }, [goals]);

  const reviewedCount = useMemo(
    () => sortedGoals.filter((g) => !!g.reviewed_at).length,
    [sortedGoals]
  );

  const totalCount = sortedGoals.length;
  const pendingGoals = useMemo(() => sortedGoals.filter((g) => !g.reviewed_at), [sortedGoals]);
  const allReviewed = totalCount === 0 || (totalCount > 0 && reviewedCount === totalCount);

  // "In Progress" is a real, logged action (reviewed_at gets set same as
  // any other quick action), but it isn't a settled outcome the way
  // Completed/Blocked/Canceled/Rescheduled are — it means "still working on
  // this," which conflicts with closing the day out. Reviewed alone isn't
  // enough to close; nothing can still be actively in progress either.
  const inProgressGoals = useMemo(() => sortedGoals.filter((g) => g.status === "in_progress"), [sortedGoals]);
  const canCloseDay = allReviewed && inProgressGoals.length === 0;

  // No push/email in this app — the only "reminder" is this banner, shown
  // while the user has the page open, once 6 or fewer hours remain today.
  const hoursLeftToday = hoursUntilMidnight();
  const showEndOfDayReminder = !dayClosed && totalCount > 0 && !canCloseDay && hoursLeftToday <= 6;

  // silent: true for refetches after an action (reviewing a goal, closing
  // the day, etc.) — the page already has content on screen, so re-showing
  // the full-page loading state would blank everything out and read as a
  // full page reload. Only the very first load (and the manual Refresh
  // button) should show it. Silent refreshes also leave `msg` alone, since
  // the action that triggered them usually just set its own status text.
  async function refresh(opts: { silent?: boolean } = {}) {
    const { silent = false } = opts;
    const mySeq = ++refreshSeqRef.current;
    if (!silent) setLoading(true);
    if (!silent) setMsg(null);

    try {
      const { plan: p, goals: gs } = await getPlanWithGoals(todayISO);

      // A newer refresh() was issued after this one — its result is more
      // current, so drop this stale response instead of overwriting state.
      if (mySeq !== refreshSeqRef.current) return;

      setPlan(p);

      // Fetch reschedule info, notes, checklist items, and attachments for
      // all goals together — none of these four depend on each other, only
      // on goalIds, so they run as one batch instead of four sequential
      // round-trips. Checklist/attachments keep their own error isolation
      // (a missing/misconfigured table there shouldn't take down the rest).
      const goalIds = gs.map(g => g.id);
      let rescheduleMap: Record<string, { to_date: string; reason: string | null }> = {};

      if (goalIds.length > 0) {
        const [reschedulesResult, notesResult, checklistResult, attachmentsResult] = await Promise.all([
          supabase
            .from("goal_reschedules")
            .select("from_goal_id, to_date, reason")
            .in("from_goal_id", goalIds)
            .eq("materialized", false)
            .order("created_at", { ascending: false }),
          // Preload notes for every goal up front — the Notes tab defaults
          // to showing them, so without this a goal with real note history
          // would still read "No notes yet" until the tab was clicked once.
          supabase
            .from("goal_notes")
            .select("*")
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
          if (!rescheduleMap[item.from_goal_id]) {
            rescheduleMap[item.from_goal_id] = {
              to_date: item.to_date,
              reason: item.reason,
            };
          }
        });

        const notesByGoal: Record<string, any[]> = {};
        (notesResult.data ?? []).forEach((n) => {
          (notesByGoal[n.goal_id] ??= []).push(n);
        });

        if (mySeq !== refreshSeqRef.current) return;

        setGoalNotes(notesByGoal);
        setNotesFetched((prev) => {
          const next = { ...prev };
          goalIds.forEach((id) => (next[id] = true));
          return next;
        });
        setChecklistItems(checklistResult);
        setAttachments(attachmentsResult);
      }

      if (mySeq !== refreshSeqRef.current) return;

      // Attach reschedule info to goals
      const goalsWithReschedule = gs.map(g => ({
        ...g,
        rescheduled_to: rescheduleMap[g.id]?.to_date || null,
        reschedule_reason: rescheduleMap[g.id]?.reason || null,
      }));

      setGoals(goalsWithReschedule);
    } catch (e: any) {
      if (mySeq !== refreshSeqRef.current) return;
      if (!silent) setMsg(e?.message ?? t("today.failedLoad"));
    } finally {
      if (mySeq === refreshSeqRef.current && !silent) setLoading(false);
    }
  }

  // Fetch goal notes/history
  async function fetchGoalNotes(goalId: string) {
    const { data, error } = await supabase
      .from("goal_notes")
      .select("*")
      .eq("goal_id", goalId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function submitNote(goalId: string) {
    const text = (noteDraft[goalId] ?? "").trim();
    if (!text) return;
    setSavingNote((prev) => ({ ...prev, [goalId]: true }));
    try {
      await addGoalNote(goalId, text);
      // The note is saved at this point regardless of what happens below —
      // clear the draft now so a re-fetch failure can't be mistaken for the
      // add itself having failed (which would tempt a duplicate re-submit).
      setNoteDraft((prev) => ({ ...prev, [goalId]: "" }));
      try {
        const notes = await fetchGoalNotes(goalId);
        setGoalNotes((prev) => ({ ...prev, [goalId]: notes }));
        setNotesFetched((prev) => ({ ...prev, [goalId]: true }));
      } catch (e: any) {
        setMsg(e?.message ?? t("today.noteSavedRefreshFailed"));
      }
    } catch (e: any) {
      setMsg(e?.message ?? t("today.failedAddNote"));
    } finally {
      setSavingNote((prev) => ({ ...prev, [goalId]: false }));
    }
  }

  useEffect(() => {
    refresh();
  }, [todayISO]);

  // One click from the quick-action dropdown does three things at once:
  // marks the goal reviewed (if it wasn't already), applies the chosen
  // status (or opens the reschedule modal instead, for "reschedule" — that
  // one doesn't set a status, rescheduling is tracked separately), and
  // closes the dropdown. Replaces the old two-step "review, then pick a
  // status" flow.
  async function selectQuickAction(goal: Goal, action: GoalStatus | "reschedule") {
    if (locked || busyGoalIds.has(goal.id) || dayClosed) return;

    // Blocked needs a reason first — hand off to confirmBlocked() instead of
    // applying anything here. Nothing about the goal changes until the
    // prompt is actually confirmed.
    if (action === "blocked") {
      setShowActions((prev) => ({ ...prev, [goal.id]: false }));
      setBlockingError(null);
      setBlockingGoal(goal);
      return;
    }

    markGoalBusy(goal.id);
    setMsg(null);
    setShowActions((prev) => ({ ...prev, [goal.id]: false }));

    try {
      const wasReviewed = !!goal.reviewed_at;

      setGoals((prev) =>
        prev.map((g) =>
          g.id === goal.id
            ? {
                ...g,
                reviewed_at: g.reviewed_at ?? new Date().toISOString(),
                status: action === "reschedule" ? g.status : action,
              }
            : g
        )
      );

      if (!wasReviewed) {
        await markGoalReviewed(goal.id);

        // Same one-time awareness bonus as the old manual review toggle.
        if (plan?.id && !plan.reviewed_at && !plan.awareness_awarded && !awarenessInFlightRef.current) {
          awarenessInFlightRef.current = true;
          try {
            const result = await awardAwarenessPoints(plan.id, 5);
            if (result?.success) notifyPointsUpdated();
          } catch {
            // Non-fatal — retried automatically on the next review action.
          } finally {
            awarenessInFlightRef.current = false;
          }
        }
      }

      if (action === "reschedule") {
        setRescheduleGoal(goal);
      } else {
        await updateGoalStatus(goal.id, action);
        const markedMsg = t("today.markedStatus", { status: statusLabel(action, t) });
        setMsg(markedMsg);
        window.setTimeout(() => setMsg((cur) => (cur === markedMsg ? null : cur)), 1500);

        if (action === "completed") {
          setCelebratingGoalIds((prev) => new Set(prev).add(goal.id));
          window.setTimeout(() => {
            setCelebratingGoalIds((prev) => {
              if (!prev.has(goal.id)) return prev;
              const next = new Set(prev);
              next.delete(goal.id);
              return next;
            });
          }, 900);
        }
      }

      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(e?.message ?? t("today.updateFailed"));
      await refresh({ silent: true });
    } finally {
      clearGoalBusy(goal.id);
    }
  }

  // Mirrors the non-reschedule branch of selectQuickAction above (mark
  // reviewed + award awareness if needed, then apply the status), plus
  // saving the required reason as a real note so a blocked goal always
  // explains itself later in its timeline.
  async function confirmBlocked(reason: string) {
    const goal = blockingGoal;
    const trimmed = reason.trim();
    if (!goal || !trimmed || blockingSaving) return;

    setBlockingSaving(true);
    setBlockingError(null);
    markGoalBusy(goal.id);

    try {
      const wasReviewed = !!goal.reviewed_at;

      setGoals((prev) =>
        prev.map((g) =>
          g.id === goal.id
            ? { ...g, reviewed_at: g.reviewed_at ?? new Date().toISOString(), status: "blocked" }
            : g
        )
      );

      if (!wasReviewed) {
        await markGoalReviewed(goal.id);

        if (plan?.id && !plan.reviewed_at && !plan.awareness_awarded && !awarenessInFlightRef.current) {
          awarenessInFlightRef.current = true;
          try {
            const result = await awardAwarenessPoints(plan.id, 5);
            if (result?.success) notifyPointsUpdated();
          } catch {
            // Non-fatal — retried automatically on the next review action.
          } finally {
            awarenessInFlightRef.current = false;
          }
        }
      }

      await updateGoalStatus(goal.id, "blocked");
      await addGoalNote(goal.id, trimmed);

      const markedMsg = t("today.markedStatus", { status: statusLabel("blocked", t) });
      setMsg(markedMsg);
      window.setTimeout(() => setMsg((cur) => (cur === markedMsg ? null : cur)), 1500);

      setBlockingGoal(null);
      await refresh({ silent: true });
    } catch (e: any) {
      setBlockingError(e?.message ?? t("today.failedMarkBlocked"));
      await refresh({ silent: true });
    } finally {
      setBlockingSaving(false);
      clearGoalBusy(goal.id);
    }
  }

  function cancelBlocked() {
    if (blockingSaving) return;
    setBlockingGoal(null);
    setBlockingError(null);
  }

  async function closeOutDay() {
    if (!plan?.id || locked || closing || dayClosed) return;

    if (totalCount > 0 && !canCloseDay) {
      setMsg(
        pendingGoals.length > 0
          ? t("today.reviewAllFirst")
          : t("today.finishInProgress")
      );
      return;
    }

    setClosing(true);
    setMsg(t("today.closingDay"));

    try {
      // getStreak() runs before markPlanReviewed(), so it reflects the unbroken
      // streak going into today (not counting today) — that's what sizes today's bonus.
      const streakBeforeToday = await getStreak();
      const closurePoints = computeClosurePoints(streakBeforeToday);

      const result = await awardClosurePoints(plan.id, closurePoints);
      // The RPC awards points but doesn't set reviewed_at itself — do that explicitly
      // so the day actually shows as closed and Tomorrow unlocks.
      await markPlanReviewed(plan.id);
      notifyPointsUpdated();
      // result.success is false when this day already earned closure points before
      // (e.g. reopened then re-closed) — the RPC is a one-time-per-day award, so no
      // extra points were actually added even though the day is closing again.
      setMsg(
        result?.success
          ? t("today.dayClosedPoints", { points: closurePoints })
          : t("today.dayClosedNoPoints")
      );

      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(t("today.errorPrefix", { message: e?.message ?? t("today.couldNotClose") }));
      await refresh({ silent: true });
    } finally {
      setClosing(false);
    }
  }

  // Reopen a closed day
  async function reopenDay() {
    if (!plan?.id || reopening || !dayClosed) return;

    setReopening(true);
    setMsg(t("today.reopeningDay"));

    try {
      const { error: planErr } = await supabase
        .from("daily_plans")
        .update({ reviewed_at: null })
        .eq("id", plan.id);
      if (planErr) throw planErr;

      // Also clear every goal's reviewed_at, so reopening the day means
      // actually re-reviewing it rather than leaving every goal already
      // marked reviewed (which would make "Close Day" immediately available
      // again with nothing left to reconsider).
      const { error: goalsErr } = await supabase
        .from("goals")
        .update({ reviewed_at: null })
        .eq("plan_id", plan.id);
      if (goalsErr) throw goalsErr;

      setMsg(t("today.dayReopened"));
      await refresh({ silent: true });
    } catch (e: any) {
      console.error("Reopen error:", e);
      setMsg(t("today.errorPrefix", { message: e?.message ?? t("today.couldNotReopen") }));
    } finally {
      setReopening(false);
    }
  }

  // Quick Add Goals function
  async function handleQuickAdd() {
    if (!plan?.id || addingGoals) return;

    const filledGoals = quickAddGoals.filter(g => g.title.trim().length > 0);
    
    if (filledGoals.length === 0) {
      setMsg(t("today.addAtLeastOne"));
      return;
    }

    setAddingGoals(true);
    setMsg(t("today.addingGoalsMsg"));

    try {
      // Keep at most one P1 in this batch — later entries win.
      let seenP1 = false;
      const dedupedGoals = [...filledGoals].reverse().map((g) => {
        if (g.priority === 1) {
          if (seenP1) return { ...g, priority: 2 };
          seenP1 = true;
        }
        return g;
      }).reverse();

      const goalsToAdd = dedupedGoals.map((g, idx) => ({
        title: g.title.trim(),
        priority: g.priority,
        sort_order: goals.length + idx,
        status: "not_started" as GoalStatus,
        time_of_day: g.time_of_day || null,
      }));

      const existingIds = new Set(goals.map((g) => g.id));
      const saved = await upsertGoals(plan.id, goalsToAdd);
      const newP1 = saved.find((g) => g.priority === 1 && !existingIds.has(g.id));
      if (newP1) {
        await enforceSingleP1(plan.id, newP1.id);
      }

      setMsg(t("today.addedGoals", { count: filledGoals.length }));
      setShowQuickAdd(false);
      setQuickAddGoals([
        { title: "", priority: 1, time_of_day: "" },
        { title: "", priority: 2, time_of_day: "" },
        { title: "", priority: 3, time_of_day: "" },
      ]);

      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(e?.message ?? t("today.failedAddGoals"));
    } finally {
      setAddingGoals(false);
    }
  }

  if (loading) {
    return <div className="card">{t("today.loading")}</div>;
  }

  return (
    <>
      <div
        className="card card-highlight"
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t("today.title")}</h1>
            <p className="text-white/70">
              {dayClosed
                ? t("today.dayClosedDesc")
                : t("today.reviewFirstDesc")}
            </p>
            {plan?.status && (
              <div className="mt-2 text-sm text-white/60">
                {t("today.datePrefix")}<b>{formatDateDisplay(todayISO)}</b>
              </div>
            )}
            {dayClosed && plan?.reviewed_at && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 inline-flex">
                <span className="text-emerald-400 text-lg">✅</span>
                <div className="text-sm text-emerald-300">
                  {t("today.dayClosedAt", { time: new Date(plan.reviewed_at).toLocaleTimeString() })}
                </div>
              </div>
            )}
            {dayClosed && (
              <p className="mt-3 text-xs text-white/50">
                {t("today.reopenPrompt")}
              </p>
            )}
            {showEndOfDayReminder && (
              <div
                className="mt-3 rounded-lg px-3 py-2 inline-flex items-center gap-2"
                style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.35)" }}
              >
                <span className="text-lg">⏰</span>
                <div className="text-sm text-amber-300">
                  {hoursLeftToday < 1 ? t("today.lessThanHour") : t("today.hoursLeft", { hours: Math.round(hoursLeftToday) })}{t("today.endOfDaySuffix")}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-start sm:items-end gap-3">
            <div className="text-sm text-white/70">
              {t("today.reviewedCount")}<b>{reviewedCount}/{totalCount}</b>
            </div>
            {dayClosed && (
              <div className="flex flex-row gap-2">
                <button
                  onClick={reopenDay}
                  disabled={reopening}
                  className="btn bottom-nav-btn"
                  style={{
                    background: "rgba(245, 158, 11, 0.3)",
                    border: "2px solid rgba(245, 158, 11, 0.5)",
                    fontWeight: "bold",
                    whiteSpace: "nowrap"
                  }}
                >
                  {reopening ? t("today.reopening") : t("today.reopenDay")}
                </button>
                <Link
                  className="btn btn-primary whitespace-nowrap bottom-nav-btn"
                  href="/standup/tomorrow"
                  style={{ textAlign: "center" }}
                >
                  {t("today.planTomorrowArrow")}
                </Link>
              </div>
            )}
            {!dayClosed && totalCount > 0 && (
              <div className="flex flex-row gap-2">
                <button
                  type="button"
                  onClick={closeOutDay}
                  disabled={!canCloseDay || closing}
                  title={
                    !canCloseDay
                      ? pendingGoals.length > 0
                        ? t("today.reviewAllGoalsFirstShort")
                        : t("today.finishInProgressShort")
                      : t("today.closeOutDayTitle")
                  }
                  className="btn bottom-nav-btn"
                  style={{
                    background: "rgba(245, 158, 11, 0.2)",
                    border: "2px solid rgba(245, 158, 11, 0.4)",
                    opacity: !canCloseDay || closing ? 0.5 : 1,
                    cursor: !canCloseDay || closing ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {closing ? t("today.closing") : t("today.closeOutDayBtn")}
                </button>
                <Link
                  className="btn btn-primary whitespace-nowrap bottom-nav-btn"
                  href="/standup/tomorrow"
                  style={{ textAlign: "center" }}
                >
                  {t("today.planTomorrowArrow")}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Quick Add Section — only relevant while the day is still open;
            once closed, the equivalent actions (Reopen Day / Plan Tomorrow)
            live in the header above instead of repeating themselves here. */}
        {!dayClosed && (
        <div
          className="mb-6 rounded-2xl p-6"
          style={{
            background: "rgba(245, 158, 11, 0.06)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            boxShadow: "0 8px 20px -8px rgba(0, 0, 0, 0.45)",
          }}
        >
          {totalCount === 0 ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-amber-300 mb-1">{t("today.noGoalsToday")}</h3>
                  <p className="text-sm text-white/70">
                    {t("today.forgotYesterday")}
                  </p>
                </div>
                {!showQuickAdd && (
                  <button
                    onClick={() => setShowQuickAdd(true)}
                    className="btn btn-primary"
                    style={{
                      background: "linear-gradient(135deg, #f59e0b, #d97706)",
                      border: "2px solid #b45309",
                      padding: "0.75rem 1.5rem",
                      fontSize: "1rem",
                      fontWeight: "bold"
                    }}
                  >
                    {t("today.quickAddGoals")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-amber-300">{t("today.needMoreGoals")}</h3>
              </div>
              {!showQuickAdd && (
                <button
                  onClick={() => setShowQuickAdd(true)}
                  className="btn day-action-btn-sm"
                  style={{
                    background: "rgba(245, 158, 11, 0.2)",
                    border: "2px solid rgba(245, 158, 11, 0.4)",
                    padding: "0.5rem 1rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("today.addGoalsBtn")}
                </button>
              )}
            </div>
          )}

          {showQuickAdd && !dayClosed && (
              <div className="space-y-3 mt-4">
                {quickAddGoals.map((g, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center gap-4">
                      <select
                        value={g.priority}
                        onChange={(e) => {
                          const newGoals = [...quickAddGoals];
                          newGoals[idx].priority = Number(e.target.value);
                          setQuickAddGoals(newGoals);
                        }}
                        className="appearance-none rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-white/30"
                      >
                        {PRIORITY_OPTIONS.map((opt) => (
                          <option key={opt.v} value={opt.v}>
                            {opt.icon} P{opt.v}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={g.title}
                        onChange={(e) => {
                          const newGoals = [...quickAddGoals];
                          newGoals[idx].title = e.target.value;
                          setQuickAddGoals(newGoals);
                        }}
                        placeholder={t("today.goalPlaceholder", { n: idx + 1 })}
                        className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40"
                      />
                    </div>
                    {/* Stacked below rather than sharing the row above — a
                        native time input has a minimum width it won't
                        shrink past, which left the title almost no room on
                        narrow phones when all three shared one flex row. */}
                    <input
                      type="time"
                      value={g.time_of_day}
                      onChange={(e) => {
                        const newGoals = [...quickAddGoals];
                        newGoals[idx].time_of_day = e.target.value;
                        setQuickAddGoals(newGoals);
                      }}
                      className="rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-white text-xs outline-none focus:border-white/40"
                      title={t("today.optionalTimeTitle")}
                    />
                  </div>
                ))}

                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleQuickAdd}
                    disabled={addingGoals}
                    className="btn btn-primary"
                  >
                    {addingGoals ? t("today.adding") : t("today.addGoalsAction")}
                  </button>
                  <button
                    onClick={() => setShowQuickAdd(false)}
                    className="btn btn-ghost"
                  >
                    {t("today.cancel")}
                  </button>
                </div>
              </div>
            )}
        </div>
        )}

        {/* Close Out Day Section */}
        {!dayClosed && totalCount > 0 && (
          <div
            className="mb-6 rounded-2xl bg-white/5 p-4"
            style={{
              border: "1px solid rgba(var(--tint-rgb),0.08)",
              borderLeftWidth: "3px",
              borderLeftColor: "rgba(245, 158, 11, 0.5)",
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              {pendingGoals.length > 0 ? (
                <>
                  <div className="text-sm text-white/70">{t("today.pendingLabel")}<b>{pendingGoals.length}</b></div>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="text-sm text-white/70">{t("today.reviewToUnlock")}</div>
                </>
              ) : inProgressGoals.length > 0 ? (
                <>
                  <div className="text-sm text-white/70">{t("today.inProgressLabel")}<b>{inProgressGoals.length}</b></div>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="text-sm text-white/70">{t("today.finishBeforeClosing")}</div>
                </>
              ) : (
                <div className="text-sm text-white/70">{t("today.allReviewed")}</div>
              )}
            </div>

            {canCloseDay && (
              <div className="mt-3 text-sm text-white/60">
                {t("today.closeToUnlockTomorrow")}
              </div>
            )}
          </div>
        )}

        {/* Goals List with Beautiful Cards */}
        <div className="space-y-4">
          {sortedGoals.length === 0 && !showQuickAdd && (
            <div className="text-white/70 text-center py-12">
              <div className="text-4xl mb-4">📝</div>
              <p className="text-lg mb-2">{t("today.noGoalsTodayEmpty")}</p>
              <p className="text-sm text-white/50">
                {t("today.useQuickAdd")}
              </p>
            </div>
          )}

          {sortedGoals.map((g, idx) => {
            const reviewed = !!g.reviewed_at;
            const p = typeof g.priority === "number" ? g.priority : 3;
            const isBusy = busyGoalIds.has(g.id);
            const isCelebrating = celebratingGoalIds.has(g.id);
            // "postponed" always means rescheduled — rescheduleGoalToDate()
            // is the only path that ever sets it, and it unconditionally
            // overwrites whatever status was there before (so a goal that
            // was blocked, then rescheduled, shows up as "postponed" here,
            // not "blocked" — where it's going next matters more than why
            // it stalled). statusLabel/statusIcon/statusChipColors already
            // render "postponed" as "📅 Rescheduled", so g.status alone is
            // enough — no separate rescheduled_to check needed for display.
            // The full target date and reason are one tap away in the
            // expanded card's timeline either way.
            const isCollapsible =
              g.status === "completed" ||
              g.status === "canceled" ||
              g.status === "blocked" ||
              g.status === "in_progress" ||
              g.status === "postponed";
            const isCollapsed = isCollapsible && !expandedDoneIds.has(g.id);
            const doneColors = statusChipColors(g.status);
            const bannerText = `${statusIcon(g.status)} ${statusLabel(g.status, t)}`;

            if (isCollapsed) {
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleExpandedDone(g.id)}
                  className="goal-row goal-row-done-collapsed"
                  style={
                    {
                      "--p-color": getPriorityMeta(p).color,
                      "--done-color": doneColors.color,
                      "--done-border": doneColors.border,
                      "--done-bg": doneColors.bg,
                      position: "relative",
                    } as React.CSSProperties
                  }
                  title={t("today.clickToExpand")}
                >
                  <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                    <div
                      className="flex-shrink-0 rounded-full flex items-center justify-center font-semibold text-white/80 text-sm"
                      style={{
                        width: "32px",
                        height: "32px",
                        background: "rgba(var(--tint-rgb), 0.06)",
                        border: "1px solid rgba(var(--tint-rgb), 0.14)",
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 text-left text-white/50 text-base truncate" style={{ minWidth: 0 }}>
                      {g.title}
                    </div>
                  </div>
                  <div className="goal-done-banner">{bannerText}</div>
                </button>
              );
            }

            return (
              <div
                key={g.id}
                className={isCelebrating ? "goal-row goal-row-celebrate" : "goal-row"}
                data-pending={!reviewed}
                style={{ "--p-color": getPriorityMeta(p).color, position: "relative" } as React.CSSProperties}
              >
                {isCelebrating && <div className="goal-complete-badge">✓</div>}
                {isCollapsible && (
                  <button
                    type="button"
                    onClick={() => toggleExpandedDone(g.id)}
                    className="goal-done-collapse-btn"
                    title={t("today.collapseTitle")}
                  >
                    {t("today.collapse")}
                  </button>
                )}
                {/* Number badge — a small corner tag flush with the card's
                    own top-left border/radius. */}
                <div className="goal-number-badge">{idx + 1}</div>

                <div className="goal-row-body">
                <div className="goal-row-cols">
                  {/* Goal content */}
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {!reviewed && <span className="text-xs text-amber-400 font-semibold">{t("today.pendingReview")}</span>}
                    </div>

                    <div className="text-white text-lg sm:text-xl font-medium mb-2">
                      {g.title}
                      {g.time_of_day && (
                        <span className="ml-2 text-sm font-normal text-white/50">
                          🕐 {formatTimeOfDay(g.time_of_day)}
                        </span>
                      )}
                    </div>
                    {g.details && <div className="text-sm text-white/60 mb-2">{g.details}</div>}

                    {/* Compact quick-add row — checklist, files, and an
                        optional link, right under the goal title. */}
                    <div
                      className="mt-2 flex items-center gap-1"
                      style={{ flexWrap: "nowrap", overflowX: "auto" }}
                    >
                      <GoalChecklist
                        compact
                        goalId={g.id}
                        items={checklistItems[g.id] ?? []}
                        onItemsChange={(items) =>
                          setChecklistItems((prev) => ({ ...prev, [g.id]: items }))
                        }
                        readOnly={dayClosed}
                      />
                      <GoalAttachments
                        compact
                        goalId={g.id}
                        items={attachments[g.id] ?? []}
                        onItemsChange={(items) =>
                          setAttachments((prev) => ({ ...prev, [g.id]: items }))
                        }
                        readOnly={dayClosed}
                      />
                      {(g.link_url || !dayClosed) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (dayClosed) {
                              if (g.link_url) window.open(g.link_url, "_blank", "noopener,noreferrer");
                              return;
                            }
                            setShowLinkInput((prev) => ({ ...prev, [g.id]: !prev[g.id] }));
                          }}
                          className="btn"
                          style={{ padding: "0.15rem 0.4rem", fontSize: "0.65rem", whiteSpace: "nowrap", flexShrink: 0 }}
                          title={g.link_url || t("today.attachLink")}
                        >
                          {g.link_url ? `🔗 ${t("today.link")}` : `+ ${t("today.link")}`}
                        </button>
                      )}
                    </div>

                    {!dayClosed && showLinkInput[g.id] && (
                      <input
                        type="url"
                        value={g.link_url ?? ""}
                        onChange={(e) =>
                          setGoals((prev) =>
                            prev.map((x) => (x.id === g.id ? { ...x, link_url: e.target.value || null } : x))
                          )
                        }
                        onBlur={() => {
                          updateGoalLink(g.id, g.link_url || null).catch((err) =>
                            setMsg(err?.message ?? t("today.failedSaveLink"))
                          );
                        }}
                        placeholder={t("today.urlPlaceholder")}
                        className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
                      />
                    )}

                    <GoalTimeline entries={buildGoalTimeline(g, goalNotes[g.id] ?? [], t)} />

                    {showNoteInput[g.id] && (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={noteDraft[g.id] ?? ""}
                          onChange={(e) => setNoteDraft((prev) => ({ ...prev, [g.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitNote(g.id);
                          }}
                          placeholder={t("today.addNotePlaceholder")}
                          disabled={!!savingNote[g.id]}
                          autoFocus
                          className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => submitNote(g.id)}
                          disabled={!!savingNote[g.id] || !(noteDraft[g.id] ?? "").trim()}
                          className="btn"
                          style={{ padding: "0.375rem 1rem" }}
                        >
                          {savingNote[g.id] ? t("today.addingNote") : t("today.add")}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Priority + Actions — grouped together instead of two separate columns.
                      Priority + status label stay visible even once the day is closed;
                      only the editable controls (review/status/reschedule) hide then. */}
                  <div className="flex flex-col gap-3" style={{ minWidth: "160px" }}>
                    {/* Priority sits right next to the review toggle */}
                    <div className="flex items-center gap-3">
                      <select
                        value={p}
                        disabled={locked || dayClosed}
                        onChange={async (e) => {
                          const newPriority = Number(e.target.value);
                          if (!plan?.id) return;
                          markGoalBusy(g.id);
                          try {
                            await updateGoalPriority(g.id, plan.id, newPriority);
                            await refresh({ silent: true });
                          } catch (e: any) {
                            setMsg(e?.message ?? t("today.failedUpdatePriority"));
                          } finally {
                            clearGoalBusy(g.id);
                          }
                        }}
                        className="priority-select"
                        style={{
                          "--p-bg": getPriorityMeta(p).bg,
                          "--p-border": getPriorityMeta(p).border,
                          "--p-color": getPriorityMeta(p).color,
                        } as React.CSSProperties}
                        title={t("today.priorityTitle", { p })}
                      >
                        {[1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>
                            P{v}
                          </option>
                        ))}
                      </select>

                      {/* Status chip - same fashion as the priority select, distinct color per status */}
                      <div
                        className="status-chip"
                        style={{
                          "--chip-bg": statusChipColors(g.status).bg,
                          "--chip-border": statusChipColors(g.status).border,
                          "--chip-color": statusChipColors(g.status).color,
                        } as React.CSSProperties}
                      >
                        <span>{statusIcon(g.status)}</span>
                        <span>{statusLabel(g.status, t)}</span>
                      </div>

                      {/* Actions checkbox — unchecked until the goal has
                          been reviewed; opens the same 5-action dropdown
                          either way, so you can also use it to change an
                          already-picked action later. */}
                      {!dayClosed && (
                        <button
                          type="button"
                          onClick={() => setShowActions((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                          disabled={locked}
                          className="actions-toggle"
                          data-open={!!showActions[g.id]}
                          title={reviewed ? t("today.changeAction") : t("today.chooseAction")}
                        >
                          {reviewed ? "☑" : "☐"}
                        </button>
                      )}

                      {/* Add Note — lives next to the action controls now;
                          entries render in the merged timeline below the
                          goal instead of behind a separate Notes tab. */}
                      <button
                        type="button"
                        onClick={() => setShowNoteInput((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                        className="actions-toggle"
                        data-open={!!showNoteInput[g.id]}
                        title={t("today.addNoteTitle")}
                      >
                        💬
                      </button>
                    </div>

                    {/* Quick-action dropdown — picking any of these reviews
                        the goal, applies the action, and closes itself in
                        one click (see selectQuickAction). */}
                    {!dayClosed && showActions[g.id] && (
                      <div className="flex flex-col gap-2" style={{ minWidth: "180px" }}>
                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "completed")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.status === "completed" ? "var(--status-completed-bg-active)" : "var(--status-completed-bg)",
                            "--btn-border": g.status === "completed" ? "var(--status-completed-border-active)" : "var(--status-completed-border)",
                            "--btn-color": "var(--status-completed)",
                          } as React.CSSProperties}
                        >
                          <span>✅</span>
                          <span>{t("status.completed")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "in_progress")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.status === "in_progress" ? "var(--status-in-progress-bg-active)" : "var(--status-in-progress-bg)",
                            "--btn-border": g.status === "in_progress" ? "var(--status-in-progress-border-active)" : "var(--status-in-progress-border)",
                            "--btn-color": "var(--status-in-progress)",
                          } as React.CSSProperties}
                        >
                          <span>⚙️</span>
                          <span>{t("today.inProgressAction")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "blocked")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.status === "blocked" ? "var(--status-blocked-bg-active)" : "var(--status-blocked-bg)",
                            "--btn-border": g.status === "blocked" ? "var(--status-blocked-border-active)" : "var(--status-blocked-border)",
                            "--btn-color": "var(--status-blocked)",
                          } as React.CSSProperties}
                        >
                          <span>🚫</span>
                          <span>{t("status.blocked")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "canceled")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.status === "canceled" ? "var(--status-canceled-bg-active)" : "var(--status-canceled-bg)",
                            "--btn-border": g.status === "canceled" ? "var(--status-canceled-border-active)" : "var(--status-canceled-border)",
                            "--btn-color": "var(--status-canceled)",
                          } as React.CSSProperties}
                        >
                          <span>❌</span>
                          <span>{t("status.canceled")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "reschedule")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.rescheduled_to ? "var(--status-postponed-bg-active)" : "var(--status-postponed-bg)",
                            "--btn-border": g.rescheduled_to ? "var(--status-postponed-border-active)" : "var(--status-postponed-border)",
                            "--btn-color": "var(--status-postponed)",
                          } as React.CSSProperties}
                        >
                          <span>📅</span>
                          <span>{g.rescheduled_to ? t("today.rescheduledTo", { date: formatDateDisplay(g.rescheduled_to) }) : t("status.rescheduled")}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center gap-2 sm:gap-3">
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/calendar">← {t("nav.calendar")}</Link>
          <button type="button" className="btn btn-ghost bottom-nav-btn" onClick={() => refresh()}>{t("today.refresh")}</button>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/dashboard">{t("nav.dashboard")} →</Link>
        </div>

        {msg && <div className="mt-4 px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white animate-fadeIn">{msg}</div>}
      </div>

      {rescheduleGoal && (
        <RescheduleModal
          goals={[rescheduleGoal]}
          onClose={() => setRescheduleGoal(null)}
          onSuccess={(kind) => {
            setMsg(kind === "backlog" ? t("today.movedToBacklog") : t("today.goalRescheduled"));
            refresh({ silent: true });
          }}
        />
      )}

      {blockingGoal && (
        <BlockedReasonModal
          goalTitle={blockingGoal.title}
          saving={blockingSaving}
          error={blockingError}
          onCancel={cancelBlocked}
          onConfirm={confirmBlocked}
        />
      )}
    </>
  );
}
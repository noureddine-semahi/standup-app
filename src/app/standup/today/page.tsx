"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import RescheduleModal from "@/components/RescheduleModal";
import {
  addDays,
  addGoalNote,
  awardAwarenessPoints,
  awardClosurePoints,
  computeClosurePoints,
  enforceSingleP1,
  getPlanWithGoals,
  getStreak,
  hoursUntilMidnight,
  markGoalReviewed,
  markPlanReviewed,
  updateGoalStatus,
  toISODate,
  formatDateDisplay,
  formatDateTimeDisplay,
  upsertGoals,
  type DailyPlan,
  type Goal,
  type GoalStatus,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";
import { getPriorityMeta } from "@/lib/priorityStyles";
import { statusLabel, statusIcon, statusChipColors } from "@/lib/goalStatus";
import { notifyPointsUpdated } from "@/lib/pointsBus";

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
  const [closing, setClosing] = useState(false);
  const [rescheduleGoal, setRescheduleGoal] = useState<Goal | null>(null);
  const [reopening, setReopening] = useState(false);
  
  // Goal content is static; only the side panel (Notes / History) is tabbed (defaults to "notes")
  const [activeTab, setActiveTab] = useState<Record<string, "notes" | "history">>({});
  const [goalNotes, setGoalNotes] = useState<Record<string, any[]>>({});
  const [notesFetched, setNotesFetched] = useState<Record<string, boolean>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});

  // Per-goal action menu (collapsed behind the gear icon until clicked)
  const [showActions, setShowActions] = useState<Record<string, boolean>>({});
  
  // Quick Add state
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddGoals, setQuickAddGoals] = useState([
    { title: "", priority: 1 },
    { title: "", priority: 2 },
    { title: "", priority: 3 },
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

  // No push/email in this app — the only "reminder" is this banner, shown
  // while the user has the page open, once 6 or fewer hours remain today.
  const hoursLeftToday = hoursUntilMidnight();
  const showEndOfDayReminder = !dayClosed && totalCount > 0 && !allReviewed && hoursLeftToday <= 6;

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

      // Fetch reschedule info for all goals
      const goalIds = gs.map(g => g.id);
      let rescheduleMap: Record<string, { to_date: string; reason: string | null }> = {};

      if (goalIds.length > 0) {
        const { data: reschedules } = await supabase
          .from("goal_reschedules")
          .select("from_goal_id, to_date, reason")
          .in("from_goal_id", goalIds)
          .eq("materialized", false)
          .order("created_at", { ascending: false });

        reschedules?.forEach((item) => {
          if (!rescheduleMap[item.from_goal_id]) {
            rescheduleMap[item.from_goal_id] = {
              to_date: item.to_date,
              reason: item.reason,
            };
          }
        });
      }

      // Preload notes for every goal up front — the Notes tab defaults to
      // showing them, so without this a goal with real note history would
      // still read "No notes yet" until the tab was clicked once.
      if (goalIds.length > 0) {
        const { data: allNotes } = await supabase
          .from("goal_notes")
          .select("*")
          .in("goal_id", goalIds)
          .order("created_at", { ascending: false });

        const notesByGoal: Record<string, any[]> = {};
        (allNotes ?? []).forEach((n) => {
          (notesByGoal[n.goal_id] ??= []).push(n);
        });

        if (mySeq !== refreshSeqRef.current) return;

        setGoalNotes(notesByGoal);
        setNotesFetched((prev) => {
          const next = { ...prev };
          goalIds.forEach((id) => (next[id] = true));
          return next;
        });
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
      if (!silent) setMsg(e?.message ?? "Failed to load");
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

  async function selectTab(goalId: string, tab: "notes" | "history") {
    setActiveTab((prev) => ({ ...prev, [goalId]: tab }));
    if (tab === "notes" && !notesFetched[goalId]) {
      try {
        const notes = await fetchGoalNotes(goalId);
        setGoalNotes((prev) => ({ ...prev, [goalId]: notes }));
        setNotesFetched((prev) => ({ ...prev, [goalId]: true }));
      } catch (e: any) {
        // Deliberately don't set notesFetched here — a failed fetch should
        // be retried next time the tab is opened, not cached as "done".
        setMsg(e?.message ?? "Failed to load notes");
      }
    }
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
        setMsg(e?.message ?? "Note saved, but couldn't refresh the list — reopen the tab to see it.");
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to add note");
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
        setMsg(`Marked "${statusLabel(action)}" ✓`);
        window.setTimeout(() => setMsg((cur) => (cur?.startsWith("Marked") ? null : cur)), 1500);

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
      setMsg(e?.message ?? "Update failed");
      await refresh({ silent: true });
    } finally {
      clearGoalBusy(goal.id);
    }
  }

  async function closeOutDay() {
    if (!plan?.id || locked || closing || dayClosed) return;

    if (totalCount > 0 && !allReviewed) {
      setMsg("Review all goals first to close the day.");
      return;
    }

    setClosing(true);
    setMsg("Closing day...");

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
          ? `Day closed ✅ +${closurePoints} pts. Tomorrow unlocked.`
          : `Day closed ✅ Tomorrow unlocked. (No extra points — this day already earned its closure bonus.)`
      );

      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(`Error: ${e?.message ?? "Could not close the day."}`);
      await refresh({ silent: true });
    } finally {
      setClosing(false);
    }
  }

  // Reopen a closed day
  async function reopenDay() {
    if (!plan?.id || reopening || !dayClosed) return;

    setReopening(true);
    setMsg("Reopening day...");

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

      setMsg("Day reopened ✅ Review your goals again before closing.");
      await refresh({ silent: true });
    } catch (e: any) {
      console.error("Reopen error:", e);
      setMsg(`Error: ${e?.message ?? "Could not reopen the day."}`);
    } finally {
      setReopening(false);
    }
  }

  // Quick Add Goals function
  async function handleQuickAdd() {
    if (!plan?.id || addingGoals) return;

    const filledGoals = quickAddGoals.filter(g => g.title.trim().length > 0);
    
    if (filledGoals.length === 0) {
      setMsg("Add at least one goal to continue.");
      return;
    }

    setAddingGoals(true);
    setMsg("Adding goals...");

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
      }));

      const existingIds = new Set(goals.map((g) => g.id));
      const saved = await upsertGoals(plan.id, goalsToAdd);
      const newP1 = saved.find((g) => g.priority === 1 && !existingIds.has(g.id));
      if (newP1) {
        await enforceSingleP1(plan.id, newP1.id);
      }

      setMsg(`Added ${filledGoals.length} goal(s) ✅`);
      setShowQuickAdd(false);
      setQuickAddGoals([
        { title: "", priority: 1 },
        { title: "", priority: 2 },
        { title: "", priority: 3 },
      ]);
      
      await refresh({ silent: true });
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to add goals");
    } finally {
      setAddingGoals(false);
    }
  }

  if (loading) {
    return <div className="card">Loading…</div>;
  }

  return (
    <>
      <div
        className="card card-highlight"
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Today</h1>
            <p className="text-white/70">
              {dayClosed
                ? "This day has been closed. You can't add or edit goals on a closed day."
                : "Review each goal first. Pending goals stay dim until reviewed."}
            </p>
            {plan?.status && (
              <div className="mt-2 text-sm text-white/60">
                Date: <b>{formatDateDisplay(todayISO)}</b>
              </div>
            )}
            {dayClosed && plan?.reviewed_at && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 inline-flex">
                <span className="text-emerald-400 text-lg">✅</span>
                <div className="text-sm text-emerald-300">
                  Day closed at {new Date(plan.reviewed_at).toLocaleTimeString()}
                </div>
              </div>
            )}
            {dayClosed && (
              <p className="mt-3 text-xs text-white/50">
                Need to make changes? Reopen this day to add goals or make edits — remember to
                close it again when you're done.
              </p>
            )}
            {showEndOfDayReminder && (
              <div
                className="mt-3 rounded-lg px-3 py-2 inline-flex items-center gap-2"
                style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.35)" }}
              >
                <span className="text-lg">⏰</span>
                <div className="text-sm text-amber-300">
                  {hoursLeftToday < 1 ? "Less than an hour" : `${Math.round(hoursLeftToday)} hours`} left —
                  close out today before midnight or it can't be reviewed retroactively.
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-start sm:items-end gap-3">
            <div className="text-sm text-white/70">
              Reviewed: <b>{reviewedCount}/{totalCount}</b>
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
                  {reopening ? "Reopening..." : "🔓 Reopen Day"}
                </button>
                <Link
                  className="btn btn-primary whitespace-nowrap bottom-nav-btn"
                  href="/standup/tomorrow"
                  style={{ textAlign: "center" }}
                >
                  Plan Tomorrow →
                </Link>
              </div>
            )}
            {!dayClosed && totalCount > 0 && (
              <div className="flex flex-row gap-2">
                <button
                  type="button"
                  onClick={closeOutDay}
                  disabled={!allReviewed || closing}
                  title={!allReviewed ? "Review all goals first" : "Close out the day"}
                  className="btn bottom-nav-btn"
                  style={{
                    background: "rgba(245, 158, 11, 0.2)",
                    border: "2px solid rgba(245, 158, 11, 0.4)",
                    opacity: !allReviewed || closing ? 0.5 : 1,
                    cursor: !allReviewed || closing ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {closing ? "Closing…" : "✅ Close out day"}
                </button>
                <Link
                  className="btn btn-primary whitespace-nowrap bottom-nav-btn"
                  href="/standup/tomorrow"
                  style={{ textAlign: "center" }}
                >
                  Plan Tomorrow →
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
                  <h3 className="text-lg font-bold text-amber-300 mb-1">No goals for today?</h3>
                  <p className="text-sm text-white/70">
                    Forgot to plan yesterday? No problem! Quickly add today's goals here.
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
                    ⚡ Quick Add Goals
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-amber-300">Need to add more goals?</h3>
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
                  ➕ Add Goals
                </button>
              )}
            </div>
          )}

          {showQuickAdd && !dayClosed && (
              <div className="space-y-3 mt-4">
                {quickAddGoals.map((g, idx) => (
                  <div key={idx} className="flex items-center gap-4">
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
                      placeholder={`Goal ${idx + 1}...`}
                      className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40"
                    />
                  </div>
                ))}
                
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleQuickAdd}
                    disabled={addingGoals}
                    className="btn btn-primary"
                  >
                    {addingGoals ? "Adding..." : "Add Goals"}
                  </button>
                  <button
                    onClick={() => setShowQuickAdd(false)}
                    className="btn btn-ghost"
                  >
                    Cancel
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
              border: "1px solid rgba(255,255,255,0.08)",
              borderLeftWidth: "3px",
              borderLeftColor: "rgba(245, 158, 11, 0.5)",
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              {pendingGoals.length > 0 ? (
                <>
                  <div className="text-sm text-white/70">Pending: <b>{pendingGoals.length}</b></div>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="text-sm text-white/70">Review goals to unlock close out.</div>
                </>
              ) : (
                <div className="text-sm text-white/70">All reviewed — ready to close out!</div>
              )}
            </div>

            {allReviewed && (
              <div className="mt-3 text-sm text-white/60">
                Close out to unlock Tomorrow planning.
              </div>
            )}
          </div>
        )}

        {/* Goals List with Beautiful Cards */}
        <div className="space-y-4">
          {sortedGoals.length === 0 && !showQuickAdd && (
            <div className="text-white/70 text-center py-12">
              <div className="text-4xl mb-4">📝</div>
              <p className="text-lg mb-2">No goals for today</p>
              <p className="text-sm text-white/50">
                Use Quick Add above to create goals for today
              </p>
            </div>
          )}

          {sortedGoals.map((g, idx) => {
            const reviewed = !!g.reviewed_at;
            const p = typeof g.priority === "number" ? g.priority : 3;
            const isBusy = busyGoalIds.has(g.id);
            const isCelebrating = celebratingGoalIds.has(g.id);

            return (
              <div
                key={g.id}
                className={isCelebrating ? "goal-row goal-row-celebrate" : "goal-row"}
                data-pending={!reviewed}
                style={{ "--p-color": getPriorityMeta(p).color, position: "relative" } as React.CSSProperties}
              >
                {isCelebrating && <div className="goal-complete-badge">✓</div>}
                <div className="flex items-start flex-wrap" style={{ gap: "1.5rem" }}>
                  {/* Number badge */}
                  <div
                    className="flex-shrink-0 rounded-full flex items-center justify-center font-semibold text-white/80 text-sm"
                    style={{
                      width: "32px",
                      height: "32px",
                      background: "rgba(255, 255, 255, 0.06)",
                      border: "1px solid rgba(255, 255, 255, 0.14)",
                    }}
                  >
                    {idx + 1}
                  </div>

                  {/* Goal content */}
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {!reviewed && <span className="text-xs text-amber-400 font-semibold">⏳ Pending review</span>}
                    </div>

                    {(() => {
                      const tab = activeTab[g.id] ?? "notes";
                      const notes = goalNotes[g.id] ?? [];
                      return (
                        <div className="flex flex-wrap gap-6">
                          {/* Goal — static, always visible, ~50% */}
                          <div style={{ flex: "1 1 45%", minWidth: "200px" }}>
                            <div className="text-white text-lg sm:text-xl font-medium mb-2">{g.title}</div>
                            {g.details && (
                              <div className="text-sm text-white/60">{g.details}</div>
                            )}
                            {g.rescheduled_to && (
                              <div className="mt-2 flex items-start gap-2">
                                <span className="text-yellow-400 text-xs mt-0.5">↷</span>
                                <div>
                                  <div className="text-xs text-yellow-300/90 font-medium">
                                    Rescheduled to {formatDateDisplay(g.rescheduled_to)}
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

                          {/* Notes / History — tabbed, ~50% */}
                          <div className="goal-notes-col" style={{ flex: "1 1 45%", minWidth: "200px" }}>
                            <div className="goal-tabs mb-3">
                              <button type="button" className="goal-tab" data-active={tab === "notes"} onClick={() => selectTab(g.id, "notes")}>
                                Notes{notesFetched[g.id] && notes.length > 0 ? ` (${notes.length})` : ""}
                              </button>
                              <button type="button" className="goal-tab" data-active={tab === "history"} onClick={() => selectTab(g.id, "history")}>
                                History
                              </button>
                            </div>

                            {tab === "notes" && (
                              <div>
                                {notes.length > 0 ? (
                                  <div className="space-y-3 mb-3">
                                    {notes.map((note, i) => (
                                      <div key={note.id ?? i} className="flex items-start gap-3">
                                        <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 flex-shrink-0"></div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm text-white/80">💬 {note.note}</div>
                                          <div className="text-[10px] text-white/40 mt-0.5">
                                            {formatDateTimeDisplay(note.created_at)}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs text-white/40 italic mb-3">No notes yet</div>
                                )}

                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={noteDraft[g.id] ?? ""}
                                    onChange={(e) => setNoteDraft((prev) => ({ ...prev, [g.id]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") submitNote(g.id);
                                    }}
                                    placeholder="Add a note..."
                                    disabled={!!savingNote[g.id]}
                                    className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => submitNote(g.id)}
                                    disabled={!!savingNote[g.id] || !(noteDraft[g.id] ?? "").trim()}
                                    className="btn"
                                    style={{ padding: "0.375rem 1rem" }}
                                  >
                                    {savingNote[g.id] ? "Adding…" : "Add"}
                                  </button>
                                </div>
                              </div>
                            )}

                            {tab === "history" && (
                              <div className="space-y-3">
                                {g.created_at && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-purple-400 mt-1.5 flex-shrink-0"></div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-white/80 font-medium">Goal created</div>
                                      <div className="text-[10px] text-white/40 mt-0.5">
                                        {formatDateTimeDisplay(g.created_at)}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {p && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-white/80 font-medium">
                                        Priority: P{p} - {getPriorityMeta(p).label}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {g.reviewed_at && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0"></div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-white/80 font-medium">Marked as reviewed</div>
                                      <div className="text-[10px] text-white/40 mt-0.5">
                                        {formatDateTimeDisplay(g.reviewed_at)}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {g.status !== "not_started" && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-sky-400 mt-1.5 flex-shrink-0"></div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-white/80 font-medium">
                                        Status: {statusLabel(g.status)}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {g.rescheduled_to && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0"></div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-white/80 font-medium">
                                        Rescheduled to {formatDateDisplay(g.rescheduled_to)}
                                      </div>
                                      {g.reschedule_reason && (
                                        <div className="text-xs text-white/60 italic mt-1">
                                          "{g.reschedule_reason}"
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {!g.reviewed_at && g.status === "not_started" && !g.rescheduled_to && (
                                  <div className="text-xs text-white/40 italic">
                                    Nothing else recorded yet.
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
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
                          markGoalBusy(g.id);
                          try {
                            await supabase
                              .from("goals")
                              .update({ priority: newPriority })
                              .eq("id", g.id);
                            if (newPriority === 1 && plan?.id) {
                              await enforceSingleP1(plan.id, g.id);
                            }
                            await refresh({ silent: true });
                          } catch (e: any) {
                            setMsg(e?.message ?? "Failed to update priority");
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
                        title={`Priority ${p}`}
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
                        <span>{statusLabel(g.status)}</span>
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
                          title={reviewed ? "Change action" : "Choose action"}
                        >
                          {reviewed ? "☑" : "☐"}
                        </button>
                      )}
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
                            "--btn-bg": g.status === "completed" ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.08)",
                            "--btn-border": g.status === "completed" ? "rgba(16, 185, 129, 0.7)" : "rgba(16, 185, 129, 0.25)",
                            "--btn-color": "#6ee7b7",
                          } as React.CSSProperties}
                        >
                          <span>✅</span>
                          <span>Completed</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "in_progress")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.status === "in_progress" ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.08)",
                            "--btn-border": g.status === "in_progress" ? "rgba(59, 130, 246, 0.7)" : "rgba(59, 130, 246, 0.25)",
                            "--btn-color": "#93c5fd",
                          } as React.CSSProperties}
                        >
                          <span>⚙️</span>
                          <span>In Progress</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "blocked")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.status === "blocked" ? "rgba(239, 68, 68, 0.2)" : "rgba(239, 68, 68, 0.08)",
                            "--btn-border": g.status === "blocked" ? "rgba(239, 68, 68, 0.7)" : "rgba(239, 68, 68, 0.25)",
                            "--btn-color": "#fca5a5",
                          } as React.CSSProperties}
                        >
                          <span>🚫</span>
                          <span>Blocked</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "canceled")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.status === "canceled" ? "rgba(100, 116, 139, 0.25)" : "rgba(100, 116, 139, 0.1)",
                            "--btn-border": g.status === "canceled" ? "rgba(100, 116, 139, 0.7)" : "rgba(100, 116, 139, 0.3)",
                            "--btn-color": "#cbd5e1",
                          } as React.CSSProperties}
                        >
                          <span>❌</span>
                          <span>Canceled</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => selectQuickAction(g, "reschedule")}
                          disabled={locked || isBusy}
                          className="action-btn"
                          style={{
                            "--btn-bg": g.rescheduled_to ? "rgba(168, 85, 247, 0.2)" : "rgba(168, 85, 247, 0.08)",
                            "--btn-border": g.rescheduled_to ? "rgba(168, 85, 247, 0.7)" : "rgba(168, 85, 247, 0.25)",
                            "--btn-color": "#d8b4fe",
                          } as React.CSSProperties}
                        >
                          <span>📅</span>
                          <span>{g.rescheduled_to ? `Rescheduled to ${formatDateDisplay(g.rescheduled_to)}` : "Rescheduled"}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center gap-2 sm:gap-3">
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/calendar">← Calendar</Link>
          <button type="button" className="btn btn-ghost bottom-nav-btn" onClick={() => refresh()}>Refresh</button>
          <Link className="btn btn-ghost bottom-nav-btn" href="/standup/dashboard">Dashboard →</Link>
        </div>

        {msg && <div className="mt-4 px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white animate-fadeIn">{msg}</div>}
      </div>

      {rescheduleGoal && (
        <RescheduleModal
          goal={rescheduleGoal}
          onClose={() => setRescheduleGoal(null)}
          onSuccess={() => {
            setMsg("Goal rescheduled successfully ✓");
            refresh({ silent: true });
          }}
        />
      )}
    </>
  );
}
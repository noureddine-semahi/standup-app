"use client";

// Plan/edit goals for any date reached from the Calendar (past, future, or
// "tomorrow" viewed ahead of time). Today itself redirects to /standup/today,
// which has the review-specific UI this page doesn't need.

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  awardPlanningPoints,
  getPlanWithGoals,
  isPrevDayReviewedForPlan,
  markDayCleared,
  submitPlan,
  toISODate,
  addDays,
  formatDateDisplay,
  formatDateTimeDisplay,
  upsertGoals,
  deleteGoal,
  type Goal,
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
import { statusLabel, statusIcon, statusChipColors } from "@/lib/goalStatus";
import RescheduleModal from "@/components/RescheduleModal";

export default function DynamicDatePage() {
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

  const [goals, setGoals] = useState<DraftGoal[]>([
    { title: "", sort_order: 0, priority: DEFAULT_PRIORITY },
    { title: "", sort_order: 1, priority: DEFAULT_PRIORITY },
    { title: "", sort_order: 2, priority: DEFAULT_PRIORITY },
  ]);

  const [msg, setMsg] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [goalComments, setGoalComments] = useState<Record<string, any[]>>({});

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
    // until their eve arrives.
    const eligible = dateISO === tomorrowISO ? await isPrevDayReviewedForPlan(dateISO) : false;
    setSubmitEligible(eligible);

    const { plan, goals: dbGoals } = await getPlanWithGoals(dateISO);
    setPlanId(plan.id);
    setPlanStatus(plan.status);
    setPlanReviewedAt(plan.reviewed_at);
    setPlanClearedAt(plan.cleared_at ?? null);

    // Fetch reschedule origin data for goals on this date
    const goalIds = dbGoals.map((g) => g.id).filter(Boolean) as string[];
    let rescheduleOrigins: Record<string, { from_date: string; reason: string | null }> = {};

    if (goalIds.length > 0) {
      const { data: reschedules } = await supabase
        .from("goal_reschedules")
        .select("materialized_goal_id, from_date, reason")
        .in("materialized_goal_id", goalIds)
        .eq("materialized", true);

      reschedules?.forEach((item) => {
        if (item.materialized_goal_id) {
          rescheduleOrigins[item.materialized_goal_id] = {
            from_date: item.from_date,
            reason: item.reason,
          };
        }
      });
    }

    const goalsWithOrigin = dbGoals.map((g) => ({
      ...g,
      rescheduled_from_date: rescheduleOrigins[g.id]?.from_date || null,
      reschedule_reason: rescheduleOrigins[g.id]?.reason || null,
    }));

    // Fetch previous actions/comments for all goals
    let notesMap: Record<string, any[]> = {};
    if (goalIds.length > 0) {
      const { data: notes } = await supabase
        .from("goal_notes")
        .select("goal_id, note, created_at")
        .in("goal_id", goalIds)
        .order("created_at", { ascending: false });

      notes?.forEach((note) => {
        if (!notesMap[note.goal_id]) notesMap[note.goal_id] = [];
        notesMap[note.goal_id].push(note);
      });
      setGoalComments(notesMap);
    }

    const goalsWithData = goalsWithOrigin.map((g) => ({
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
    if (dateISO === todayISO) return; // redirecting away, don't bother loading
    refresh().catch((e) => {
      setMsg(e?.message ?? "Failed to load");
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO]);

  function addMoreGoal() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setGoals((prev) => {
      if (prev.length >= MAX_GOALS) {
        setMsg(`Max ${MAX_GOALS} goals — keep this day focused.`);
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
        setMsg(`Max ${MAX_GOALS} goals — keep this day focused.`);
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
      if (!silent) setMsg("No changes to save.");
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
        setMsg(planStatus === "submitted" ? "Changes saved ✅" : "Saved ✅");
      } else {
        setMsg("Saved ✓");
        window.setTimeout(
          () => setMsg((m) => (m === "Saved ✓" ? null : m)),
          900
        );
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed");
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
      setMsg("Missing plan id — refresh and try again.");
      return;
    }
    if (planStatus === "locked") return;
    if (planStatus === "submitted") {
      setMsg("This plan is already submitted.");
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
    if (firstThree.some((t) => t.length === 0)) {
      setMsg(
        `${formatDateDisplay(dateISO)} requires at least 3 goals. Fill in the first 3 goals before submitting.`
      );
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
          ? `Plan for ${formatDateDisplay(dateISO)} submitted ✅ +5 pts`
          : `Plan for ${formatDateDisplay(dateISO)} submitted ✅`
      );
    } catch (e: any) {
      setMsg(e?.message ?? "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClearDay() {
    if (!planId || clearingDay) return;
    if (
      !window.confirm(
        `Mark ${formatDateDisplay(dateISO)} as cleared? This day can't be reviewed retroactively — this just dismisses it from the "Missed" list on your Calendar.`
      )
    ) {
      return;
    }

    setClearingDay(true);
    setMsg(null);
    try {
      await markDayCleared(planId);
      await refresh({ silent: true });
      setMsg(`${formatDateDisplay(dateISO)} marked as cleared.`);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to clear this day.");
    } finally {
      setClearingDay(false);
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

  if (dateISO === todayISO || loading) {
    return <div className="card">Loading…</div>;
  }

  if (isPastDate) {
    const pastGoals = goals.filter((g) => (g.title ?? "").trim().length > 0);
    const isMissed = planStatus === "submitted" && !planReviewedAt && !planClearedAt;

    return (
      <div className="card card-highlight">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Goals for {formatDateDisplay(dateISO)}</h1>
            <p className="text-sm text-white/60">
              This day has passed — view only. Re-attempt a goal to bring it forward to a future date.
            </p>
            {isMissed && (
              <p className="mt-2 text-xs text-red-400">
                ⚠️ This day was never reviewed — it shows as "Missed" on your Calendar.
              </p>
            )}
            {!!planClearedAt && (
              <p className="mt-2 text-xs text-emerald-400">
                ✅ Cleared on {formatDateTimeDisplay(planClearedAt)}.
              </p>
            )}
          </div>
          <div className="flex flex-row gap-2">
            {isMissed && (
              <button className="btn" onClick={handleClearDay} disabled={clearingDay}>
                {clearingDay ? "Clearing…" : "Clear this day"}
              </button>
            )}
            <button className="btn" onClick={() => router.push("/standup/calendar")}>
              ← Calendar
            </button>
          </div>
        </div>

        {pastGoals.length === 0 ? (
          <div className="text-white/60 text-sm py-12 text-center">
            No goals were planned for this day.
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
                  <div className="flex items-start flex-wrap gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-lg font-semibold text-white">{g.title}</div>
                      {g.details && <div className="mt-1 text-sm text-white/60">{g.details}</div>}

                      {g.rescheduled_from_date && (
                        <div className="mt-2 text-xs text-white/50">
                          ↩ Rescheduled from {formatDateDisplay(g.rescheduled_from_date)}
                          {g.reschedule_reason && <span className="italic"> — "{g.reschedule_reason}"</span>}
                        </div>
                      )}

                      {g.previous_actions && g.previous_actions.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {g.previous_actions.map((note: any, i: number) => (
                            <div key={note.id ?? i} className="text-xs text-white/60">
                              💬 {note.note}
                              <span className="ml-2 text-white/40">
                                {formatDateTimeDisplay(note.created_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
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
                        <span>{statusIcon(status)}</span>
                        <span>{statusLabel(status)}</span>
                      </div>

                      <button
                        type="button"
                        className="btn"
                        onClick={() => setRescheduleGoal(g as Goal)}
                        style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}
                      >
                        🔁 Re-attempt
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rescheduleGoal && (
          <RescheduleModal
            goal={rescheduleGoal}
            onClose={() => setRescheduleGoal(null)}
            onSuccess={() => {
              setRescheduleGoal(null);
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
          <h1 className="text-3xl font-bold mb-2">Goals for {formatDateDisplay(dateISO)}</h1>
          <p className="text-white/70 mb-2">
            Minimum <b>3</b> priority goals required (P1, P2, or P3).
          </p>
          <p className="text-sm text-white/50">
            Current priority goals: <b className={priorityGoalsFilled >= 3 ? "text-emerald-400" : "text-amber-400"}>{priorityGoalsFilled}/3</b>
            {priorityGoalsFilled > 3 && <span className="text-emerald-400"> (+{priorityGoalsFilled - 3} extra)</span>}
          </p>
        </div>

        <div className="flex flex-row items-center gap-3">
          <button className="btn" onClick={() => router.push("/standup/calendar")}>
            ← Calendar
          </button>
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
            {editMode ? "✓ Done" : "✏️ Reorder"}
          </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {goals.map((g, idx) => {
          const p =
            typeof g.priority === "number" && Number.isFinite(g.priority)
              ? g.priority
              : DEFAULT_PRIORITY;
          const opt = getPriorityMeta(p);

          return (
            <div key={g.id ?? `row-${idx}`}>
              {idx === 3 && (
                <div className="my-6 flex items-center gap-4">
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.2), transparent)" }} />
                  <div className="text-xs uppercase tracking-wider text-white/50 font-semibold">
                    Optional Goals
                  </div>
                  <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(255,255,255,0.2), transparent)" }} />
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
                  "--p-color": (p >= 1 && p <= 3) ? opt.color : "rgba(255,255,255,0.2)",
                  cursor: editMode ? "move" : "default",
                  opacity: draggedIdx === idx ? 0.5 : 1,
                } as React.CSSProperties}
              >
                {/* Drag handle */}
                {editMode && (
                  <div
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-3xl pointer-events-none"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                  >
                    ⋮⋮
                  </div>
                )}

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

                  {/* Goal input - takes up most space */}
                  <input
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    type="text"
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
                    onChange={(e) =>
                      setGoals((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, title: e.target.value } : x
                        )
                      )
                    }
                    placeholder={(p >= 1 && p <= 3) ? `Priority ${p} goal...` : "Optional goal..."}
                    style={{ padding: "0 1.5rem" }}
                    className="flex-1 min-w-0 bg-transparent border-0 text-white text-xl font-medium placeholder:text-white/40 outline-none focus:placeholder:text-white/60"
                  />

                  {/* Show if this goal was rescheduled FROM another date */}
                  {g.id && g.rescheduled_from_date && (
                    <div className="mt-2 mb-3" style={{ padding: "0 1.5rem" }}>
                      <div className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5">
                        <span className="text-lg">↩️</span>
                        <div>
                          <div className="text-xs font-semibold text-amber-300">
                            Rescheduled from {formatDateDisplay(g.rescheduled_from_date)}
                          </div>
                          {g.reschedule_reason && (
                            <div className="text-xs text-amber-300/70 italic mt-0.5">
                              "{g.reschedule_reason}"
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Previous actions/comments */}
                  {g.id && g.previous_actions && g.previous_actions.length > 0 && (
                    <div className="mt-2 mb-3" style={{ padding: "0 1.5rem" }}>
                      <details className="text-xs">
                        <summary className="text-emerald-400 cursor-pointer hover:text-emerald-300">
                          💬 {g.previous_actions.length} previous action{g.previous_actions.length > 1 ? 's' : ''}
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

                  {/* Priority + Remove — grouped together, same fashion, always visible
                      regardless of priority value (P4/P5 must stay changeable/visible). */}
                  <div className="flex items-center gap-3 flex-shrink-0">
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
                      } as React.CSSProperties}
                    >
                      {[1, 2, 3, 4, 5].map((v) => (
                        <option key={v} value={v}>
                          P{v}
                        </option>
                      ))}
                    </select>

                    {/* Clear/Remove button - same size/shape as the priority select */}
                    {!locked && (
                      <button
                        onClick={() => removeGoal(idx)}
                        disabled={submitting}
                        style={{
                          width: "44px",
                          height: "32px",
                          borderRadius: "8px",
                          background: "rgba(255, 255, 255, 0.06)",
                          border: "1px solid rgba(255, 255, 255, 0.15)",
                        }}
                        className="flex-shrink-0 flex items-center justify-center hover:bg-black/40 text-white/80 hover:text-white text-xs font-bold transition-all hover:border-white/40 hover:scale-105"
                        title={(p >= 1 && p <= 3) ? "Clear priority goal" : "Remove goal"}
                      >
                        ✕
                      </button>
                    )}
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
              goals.length >= MAX_GOALS ? `Max ${MAX_GOALS} goals reached` : ""
            }
          >
            + Add goal
          </button>

          <button
            className="btn hover-scale"
            onClick={saveDraftOrChanges}
            disabled={submitting}
            title="Manual save (auto-saves too)"
          >
            {submitting ? "Saving…" : submitted ? "Save changes" : "Save draft"}
          </button>

          <button
            className="btn btn-primary hover-scale"
            onClick={onSubmitPlan}
            disabled={!canSubmit || submitted}
            title={
              !submitted && !submitEligible
                ? dateISO === tomorrowISO
                  ? `Submit unlocks once ${formatDateDisplay(todayISO)} has been reviewed`
                  : `Submit unlocks the evening before this date (${formatDateDisplay(prevDateISO)}) — draft and save freely until then`
                : ""
            }
          >
            {submitting
              ? "Submitting…"
              : submitted
              ? "✅ Plan submitted"
              : "Submit plan"}
          </button>

          <div className="text-sm text-white/60">
            {goals.length}/{MAX_GOALS} goals
          </div>
        </div>
      )}

      {!locked && !submitted && !submitEligible && (
        <div className="mt-3 text-xs text-white/50">
          {dateISO === tomorrowISO
            ? `🔒 Submitting is locked until ${formatDateDisplay(todayISO)} is reviewed. You can still save this as a draft.`
            : `🔒 Submitting opens the evening before this date (${formatDateDisplay(prevDateISO)}). You can still save this as a draft any time before then.`}
        </div>
      )}

      {locked && (
        <div className="mt-6 text-white/70">
          This plan is <b>{planStatus}</b>.
        </div>
      )}

      {msg && (
        <div className="mt-6 px-4 py-3 rounded-xl text-sm text-white animate-fadeIn" style={{ background: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.2)" }}>
          {msg}
        </div>
      )}
    </div>
  );
}

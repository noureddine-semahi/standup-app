"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  addDays,
  addGoalNote,
  getPlanWithGoals,
  isYesterdayReviewed,
  submitPlan,
  toISODate,
  formatDateDisplay,
  formatDateTimeDisplay,
  upsertGoals,
  deleteGoal,
} from "@/lib/supabase/db";
import { supabase } from "@/lib/supabase/client";
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


export default function TomorrowGoalsPage() {
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
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [goalComments, setGoalComments] = useState<Record<string, any[]>>({});

  // Notes / History tabs (same as Today page) — defaults to "notes"
  const [activeTab, setActiveTab] = useState<Record<string, "notes" | "history">>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});

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

  async function refresh() {
    setLoading(true);
    setMsg(null);

    setSubmitEligible(await isYesterdayReviewed());

    const { plan, goals: dbGoals } = await getPlanWithGoals(tomorrowISO);
    setPlanId(plan.id);
    setPlanStatus(plan.status);
    
    // Fetch reschedule origin data for goals on this date
    const goalIds = dbGoals.map(g => g.id).filter(Boolean) as string[];
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
    
    // Attach reschedule origin to goals
    const goalsWithOrigin = dbGoals.map(g => ({
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
      
      notes?.forEach(note => {
        if (!notesMap[note.goal_id]) notesMap[note.goal_id] = [];
        notesMap[note.goal_id].push(note);
      });
      setGoalComments(notesMap);
    }
    
    // Attach comments to goals using notesMap (not state which is stale)
    const goalsWithData = goalsWithOrigin.map(g => ({
      ...g,
      previous_actions: notesMap[g.id] || [],
    }));
    
    originalIdsRef.current = new Set(goalIds);

    const rows = compactForUI(goalsWithData);
    setGoals(rows);
    lastSavedHashRef.current = computeHashForSave(rows);

    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((e) => {
      setMsg(e?.message ?? "Failed to load");
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tomorrowISO]);

  function addMoreGoal() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setGoals((prev) => {
      if (prev.length >= MAX_GOALS) {
        setMsg(`Max ${MAX_GOALS} goals — keep tomorrow focused.`);
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
        setMsg(`Max ${MAX_GOALS} goals — keep tomorrow focused.`);
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
        "Tomorrow requires at least 3 goals. Fill in the first 3 goals before submitting."
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

      await refresh();
      setMsg("Tomorrow plan submitted ✅");
    } catch (e: any) {
      setMsg(e?.message ?? "Submit failed");
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
      const { data: notes } = await supabase
        .from("goal_notes")
        .select("*")
        .eq("goal_id", goalId)
        .order("created_at", { ascending: false });
      setGoals((prev) =>
        prev.map((g, i) => (i === idx ? { ...g, previous_actions: notes || [] } : g))
      );
      setNoteDraft((prev) => ({ ...prev, [goalId]: "" }));
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to add note");
    } finally {
      setSavingNote((prev) => ({ ...prev, [goalId]: false }));
    }
  }

  if (loading) {
    return <div className="card">Loading…</div>;
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
      <div className="flex items-start justify-between mb-8">
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">Tomorrow Goals</h1>
            <p className="text-white/70 mb-2">
              Minimum <b>3</b> priority goals required (P1, P2, or P3).
            </p>
            <p className="text-sm text-white/50">
              Current priority goals: <b className={priorityGoalsFilled >= 3 ? "text-emerald-400" : "text-amber-400"}>{priorityGoalsFilled}/3</b>
              {priorityGoalsFilled > 3 && <span className="text-blue-400"> (+{priorityGoalsFilled - 3} extra)</span>}
            </p>
          </div>
          
          <div className="flex flex-row items-center gap-3">
            <Link className="btn" href="/standup/calendar">
              ← Calendar
            </Link>
            {!locked && (
              <button
                onClick={() => setEditMode(!editMode)}
                disabled={submitting}
                className="btn"
                style={{
                  background: editMode ? "rgba(168, 85, 247, 0.3)" : undefined,
                  borderColor: editMode ? "rgba(168, 85, 247, 0.6)" : undefined,
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

                    {/* Goal — static, ~45% */}
                    <div style={{ flex: "1 1 40%", minWidth: "200px" }}>
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
                        className="w-full bg-transparent border-0 text-white text-xl font-medium placeholder:text-white/40 outline-none focus:placeholder:text-white/60"
                      />
                      {g.rescheduled_from_date && (
                        <div className="mt-2 flex items-start gap-2">
                          <span className="text-yellow-400 text-xs mt-0.5">↷</span>
                          <div>
                            <div className="text-xs text-yellow-300/90 font-medium">
                              Rescheduled from {formatDateDisplay(g.rescheduled_from_date)}
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

                    {/* Notes / History — tabbed, ~45%, same as Today page */}
                    <div style={{ flex: "1 1 40%", minWidth: "220px" }}>
                      {(() => {
                        const tab = activeTab[g.id ?? ""] ?? "notes";
                        const notes = g.previous_actions ?? [];
                        return (
                          <>
                            <div className="goal-tabs mb-3">
                              <button
                                type="button"
                                className="goal-tab"
                                data-active={tab === "notes"}
                                onClick={() => g.id && setActiveTab((prev) => ({ ...prev, [g.id as string]: "notes" }))}
                              >
                                Notes{notes.length > 0 ? ` (${notes.length})` : ""}
                              </button>
                              <button
                                type="button"
                                className="goal-tab"
                                data-active={tab === "history"}
                                onClick={() => g.id && setActiveTab((prev) => ({ ...prev, [g.id as string]: "history" }))}
                              >
                                History
                              </button>
                            </div>

                            {!g.id ? (
                              <div className="text-xs text-white/30 italic">Save this goal to add notes</div>
                            ) : tab === "notes" ? (
                              <div>
                                {notes.length > 0 ? (
                                  <div className="space-y-3 mb-3">
                                    {notes.map((note: any, i: number) => (
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
                                    onChange={(e) => setNoteDraft((prev) => ({ ...prev, [g.id as string]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") submitNote(g.id as string, idx);
                                    }}
                                    placeholder="Add a note..."
                                    disabled={!!savingNote[g.id]}
                                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => submitNote(g.id as string, idx)}
                                    disabled={!!savingNote[g.id] || !(noteDraft[g.id] ?? "").trim()}
                                    className="btn"
                                    style={{ padding: "0.375rem 1rem" }}
                                  >
                                    {savingNote[g.id] ? "Adding…" : "Add"}
                                  </button>
                                </div>
                              </div>
                            ) : (
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

                                {p >= 1 && p <= 3 && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-white/80 font-medium">
                                        Priority: P{p} - {opt.label}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {g.rescheduled_from_date && (
                                  <div className="flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0"></div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-white/80 font-medium">
                                        Rescheduled from {formatDateDisplay(g.rescheduled_from_date)}
                                      </div>
                                      {g.reschedule_reason && (
                                        <div className="text-xs text-white/60 italic mt-1">
                                          "{g.reschedule_reason}"
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {!g.created_at && !g.rescheduled_from_date && (
                                  <div className="text-xs text-white/40 italic">Nothing recorded yet.</div>
                                )}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {/* Priority + Remove — grouped together instead of two separate cramped columns.
                        The select always renders regardless of the current priority value —
                        it previously hid itself for P4/P5, trapping the goal at that priority
                        with no way to see or change it. */}
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
                submitted
                  ? ""
                  : !submitEligible
                  ? `Submit unlocks once ${formatDateDisplay(todayISO)} has been reviewed`
                  : priorityGoalsFilled < 3
                  ? `Fill in ${3 - priorityGoalsFilled} more P1/P2/P3 goal(s) — currently ${priorityGoalsFilled}/3`
                  : ""
              }
            >
              {submitting
                ? "Submitting…"
                : submitted
                ? "✅ Plans have been submitted"
                : "Submit tomorrow plan"}
            </button>

            <div className="text-sm text-white/60">
              {goals.length}/{MAX_GOALS} goals
            </div>
          </div>
        )}

        {!locked && !submitted && !submitEligible && (
          <div className="mt-3 text-xs text-white/50">
            🔒 Submitting is locked until {formatDateDisplay(todayISO)} is reviewed. You can still save this as a draft.
          </div>
        )}

        {!locked && !submitted && submitEligible && priorityGoalsFilled < 3 && (
          <div className="mt-3 text-xs text-white/50">
            🔒 Submitting needs {3 - priorityGoalsFilled} more goal(s) set to P1, P2, or P3 (currently {priorityGoalsFilled}/3). Goals at P4/P5 don't count toward this minimum.
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
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import AuthGate from "@/components/AuthGate";
import {
  addDays,
  getPlanWithGoals,
  isYesterdayReviewed,
  submitPlan,
  toISODate,
  upsertGoals,
  deleteGoal,
  type Goal,
} from "@/lib/supabase/db";
import { useRouter } from "next/navigation";

type DraftGoal = Partial<Goal> & {
  title: string;
  sort_order: number;
  priority?: number;
};

const MAX_GOALS = 10;
const DEFAULT_PRIORITY = 3;
const DEMOTED_PRIORITY = 2;

// ✨ Priority options with refined colors
const PRIORITY_OPTIONS = [
  { 
    v: 1, 
    label: "Highest Priority", 
    icon: "🔴",
    // Lighter, more visible red card background
    bgGradient: "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(225, 29, 72, 0.15))",
    borderColor: "rgba(239, 68, 68, 0.3)",
    // Vibrant red button
    buttonBg: "linear-gradient(135deg, #dc2626, #b91c1c)",
    buttonBorder: "#991b1b",
    buttonShadow: "0 4px 16px rgba(220, 38, 38, 0.4)"
  },
  { 
    v: 2, 
    label: "High Priority", 
    icon: "🟠",
    // Lighter orange card background
    bgGradient: "linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(251, 146, 60, 0.15))",
    borderColor: "rgba(249, 115, 22, 0.3)",
    // Vibrant orange button
    buttonBg: "linear-gradient(135deg, #ea580c, #c2410c)",
    buttonBorder: "#9a3412",
    buttonShadow: "0 4px 16px rgba(234, 88, 12, 0.4)"
  },
  { 
    v: 3, 
    label: "Medium Priority", 
    icon: "🟡",
    // Lighter yellow card background
    bgGradient: "linear-gradient(135deg, rgba(250, 204, 21, 0.15), rgba(253, 224, 71, 0.15))",
    borderColor: "rgba(250, 204, 21, 0.3)",
    // Vibrant yellow button
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

function getPriorityOption(priority: number) {
  return PRIORITY_OPTIONS.find(p => p.v === priority) || PRIORITY_OPTIONS[2];
}

function normalizeGoals(goals: DraftGoal[]) {
  return goals.map((g, idx) => ({
    ...g,
    sort_order: idx,
    title: (g.title ?? "").trim(),
    priority:
      typeof g.priority === "number" && Number.isFinite(g.priority)
        ? g.priority
        : DEFAULT_PRIORITY,
  }));
}

function compactForUI(dbGoals: Goal[]) {
  const sorted = [...dbGoals]
    .map((g) => ({
      ...g,
      title: (g.title ?? "").toString(),
      sort_order: Number.isFinite(g.sort_order as any)
        ? (g.sort_order as number)
        : 0,
      priority:
        typeof (g as any).priority === "number" &&
        Number.isFinite((g as any).priority)
          ? ((g as any).priority as number)
          : DEFAULT_PRIORITY,
    }))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const nonEmpty = sorted.filter((g) => (g.title ?? "").trim().length > 0);

  const compacted: DraftGoal[] = nonEmpty.map((g, idx) => ({
    ...g,
    title: (g.title ?? "").toString(),
    sort_order: idx,
    priority:
      typeof g.priority === "number" && Number.isFinite(g.priority)
        ? g.priority
        : DEFAULT_PRIORITY,
  }));

  while (compacted.length < 3) {
    compacted.push({
      title: "",
      sort_order: compacted.length,
      priority: DEFAULT_PRIORITY,
    });
  }

  for (let i = 0; i < Math.min(3, compacted.length); i++) {
    if (
      typeof compacted[i].priority !== "number" ||
      !Number.isFinite(compacted[i].priority)
    ) {
      compacted[i].priority = DEFAULT_PRIORITY;
    }
  }

  return compacted.slice(0, Math.max(3, MAX_GOALS));
}

function compactForSave(current: DraftGoal[]) {
  const normalized = normalizeGoals(current);

  const first3 = normalized.slice(0, 3).map((g) => ({
    ...g,
    title: (g.title ?? "").trim(),
    priority:
      typeof g.priority === "number" && Number.isFinite(g.priority)
        ? g.priority
        : DEFAULT_PRIORITY,
  }));

  const optionalNonEmpty = normalized
    .slice(3)
    .map((g) => ({ ...g, title: (g.title ?? "").trim() }))
    .filter((g) => g.title.length > 0);

  const combined: DraftGoal[] = [...first3, ...optionalNonEmpty]
    .slice(0, MAX_GOALS)
    .map((g, idx) => ({
      ...g,
      sort_order: idx,
      priority:
        typeof g.priority === "number" && Number.isFinite(g.priority)
          ? g.priority
          : DEFAULT_PRIORITY,
    }));

  while (combined.length < 3) {
    combined.push({
      title: "",
      sort_order: combined.length,
      priority: DEFAULT_PRIORITY,
    });
  }

  for (let i = 0; i < 3; i++) {
    combined[i] = {
      ...combined[i],
      priority:
        typeof combined[i].priority === "number" &&
        Number.isFinite(combined[i].priority)
          ? combined[i].priority
          : DEFAULT_PRIORITY,
    };
  }

  return combined;
}

function applyPriorityChange(prev: DraftGoal[], idx: number, newP: number) {
  const next = prev.map((g) => ({ ...g }));
  next[idx].priority = newP;

  if (idx < 3 && newP === 1) {
    for (let i = 0; i < 3; i++) {
      if (i !== idx && (next[i].priority ?? DEFAULT_PRIORITY) === 1) {
        next[i].priority = DEMOTED_PRIORITY;
      }
    }
  }

  return next;
}

export default function TomorrowGoalsPage() {
  const router = useRouter();

  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);
  const [loading, setLoading] = useState(true);
  const [blocking, setBlocking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [planId, setPlanId] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<string>("draft");

  const [goals, setGoals] = useState<DraftGoal[]>([
    { title: "", sort_order: 0, priority: DEFAULT_PRIORITY },
    { title: "", sort_order: 1, priority: DEFAULT_PRIORITY },
    { title: "", sort_order: 2, priority: DEFAULT_PRIORITY },
  ]);

  const [msg, setMsg] = useState<string | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);

  const originalIdsRef = useRef<Set<string>>(new Set());
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const lastSavedHashRef = useRef<string>("");
  const skipNextBlurAutosaveRef = useRef(false);
  const priorityChangeInProgressRef = useRef(false);

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

  async function refresh() {
    setLoading(true);
    setMsg(null);

    const ok = await isYesterdayReviewed();
    if (!ok) {
      setBlocking(true);
      setLoading(false);
      return;
    }

    setBlocking(false);

    const { plan, goals: dbGoals } = await getPlanWithGoals(tomorrowISO);
    setPlanId(plan.id);
    setPlanStatus(plan.status);

    originalIdsRef.current = new Set(
      dbGoals.map((g) => g.id).filter(Boolean) as string[]
    );

    const rows = compactForUI(dbGoals);
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

    const compacted = compactForSave(goals);

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

      const saved = await upsertGoals(planId, toSave as any);

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

      await upsertGoals(planId, toSave as any);
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
      setGoals((prev) =>
        prev.map((x, i) => (i === idx ? { ...x, title: "" } : x))
      );

      if (g.id) {
        try {
          await deleteGoal(g.id);
        } catch {}
      }

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

  if (loading) {
    return (
      <AuthGate>
        <div className="card">Loading…</div>
      </AuthGate>
    );
  }

  if (blocking) {
    return (
      <AuthGate>
        <div className="card">
          <h1 className="text-3xl font-bold">Tomorrow Goals</h1>
          <p className="mt-2 text-white/70">
            Before you set tomorrow's goals, you must review yesterday.
          </p>
          <div className="mt-6">
            <button
              className="btn btn-primary"
              onClick={() => router.push("/standup/today")}
            >
              Go review yesterday
            </button>
          </div>
        </div>
      </AuthGate>
    );
  }

  const locked = planStatus === "locked";
  const submitted = planStatus === "submitted";

  const normalized = normalizeGoals(goals);
  const firstThreeFilled = normalized
    .slice(0, 3)
    .every((g) => (g.title ?? "").trim().length > 0);

  const canSubmit =
    !!planId && !locked && !submitted && firstThreeFilled && !submitting;

  const canAddMore = !locked && !submitting && goals.length < MAX_GOALS;

  return (
    <AuthGate>
      <div className="card">
        <h1 className="text-3xl font-bold mb-2">Tomorrow Goals</h1>
        <p className="text-white/70 mb-8">
          Minimum <b>3</b> goals required. Set priority for the first 3.
        </p>

        <div className="space-y-4">
          {goals.map((g, idx) => {
            const p =
              typeof g.priority === "number" && Number.isFinite(g.priority)
                ? g.priority
                : DEFAULT_PRIORITY;
            const opt = getPriorityOption(p);

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

                {/* ✨ Gradient card with reorganized layout */}
                <div 
                  className="relative rounded-2xl overflow-hidden transition-all duration-300 hover:scale-[1.005]"
                  style={{
                    background: idx < 3 ? opt.bgGradient : "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.06))",
                    border: `2px solid ${idx < 3 ? opt.borderColor : "rgba(255,255,255,0.08)"}`,
                    padding: "2rem 2.5rem"
                  }}
                >
                  <div className="flex items-center" style={{ gap: "2rem" }}>
                    {/* Number badge - circular */}
                    <div 
                      className="flex-shrink-0 rounded-full flex items-center justify-center font-bold text-white text-xl"
                      style={{
                        width: "56px",
                        height: "56px",
                        background: "linear-gradient(135deg, rgba(168, 85, 247, 0.5), rgba(59, 130, 246, 0.5))",
                        border: "2px solid rgba(255, 255, 255, 0.25)",
                        boxShadow: "0 4px 12px rgba(168, 85, 247, 0.3)"
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
                      placeholder={idx < 3 ? `Enter goal ${idx + 1}...` : "Optional goal..."}
                      style={{ padding: "0 1.5rem" }}
                      className="flex-1 bg-transparent border-0 text-white text-xl font-medium placeholder:text-white/40 outline-none focus:placeholder:text-white/60"
                    />

                    {/* Priority button - circular, next to Clear */}
                    {idx < 3 && (
                      <div className="flex-shrink-0 relative">
                        <select
                          value={p}
                          disabled={locked || submitting}
                          onChange={(e) => {
                            priorityChangeInProgressRef.current = true;
                            const v = Number(e.target.value);
                            setGoals((prev) => applyPriorityChange(prev, idx, v));
                            setTimeout(() => {
                              scheduleAutoSave();
                              priorityChangeInProgressRef.current = false;
                            }, 100);
                          }}
                          style={{
                            background: opt.buttonBg,
                            border: `3px solid ${opt.buttonBorder}`,
                            width: "56px",
                            height: "56px",
                            color: "transparent",
                            boxShadow: opt.buttonShadow,
                            borderRadius: "50%"
                          }}
                          className="appearance-none cursor-pointer font-bold hover:scale-110 hover:brightness-110 transition-all focus:outline-none focus:ring-2 focus:ring-white/50"
                        >
                          {PRIORITY_OPTIONS.map((option) => (
                            <option key={option.v} value={option.v} style={{ color: "black" }}>
                              {option.icon} P{option.v} - {option.label}
                            </option>
                          ))}
                        </select>
                        {/* Icon */}
                        <div 
                          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                          style={{ 
                            fontSize: "1.5rem",
                            marginTop: "-2px"
                          }}
                        >
                          {opt.icon}
                        </div>
                        {/* P# text below icon */}
                        <div 
                          className="absolute left-1/2 -translate-x-1/2 pointer-events-none" 
                          style={{ 
                            bottom: "8px",
                            fontSize: "0.65rem",
                            fontWeight: "900",
                            color: "#1a1a1a",
                            textShadow: "0 1px 2px rgba(255,255,255,0.4)",
                            letterSpacing: "0.05em"
                          }}
                        >
                          P{p}
                        </div>
                      </div>
                    )}

                    {/* Clear/Remove button - circular, same size */}
                    {!locked && (
                      <button
                        onClick={() => removeGoal(idx)}
                        disabled={submitting}
                        style={{
                          width: "56px",
                          height: "56px",
                          background: "rgba(0,0,0,0.35)",
                          backdropFilter: "blur(10px)",
                          border: "2px solid rgba(255,255,255,0.2)",
                          borderRadius: "50%"
                        }}
                        className="flex-shrink-0 flex items-center justify-center hover:bg-black/50 text-white/80 hover:text-white text-xs font-bold transition-all hover:border-white/40 hover:scale-110"
                        title={idx < 3 ? "Clear goal" : "Remove goal"}
                      >
                        {idx < 3 ? "✕" : "✕"}
                      </button>
                    )}
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

            {!submitted && (
              <button
                className="btn btn-primary hover-scale"
                onClick={onSubmitPlan}
                disabled={!canSubmit}
              >
                {submitting ? "Submitting…" : "Submit tomorrow plan"}
              </button>
            )}

            <div className="text-sm text-white/60">
              {goals.length}/{MAX_GOALS} goals
            </div>

            {submitted && (
              <div className="ml-auto text-sm text-emerald-400 font-semibold">
                ✅ Plan submitted
              </div>
            )}
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
    </AuthGate>
  );
}
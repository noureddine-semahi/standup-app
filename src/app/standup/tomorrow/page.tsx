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

const PRIORITY_OPTIONS = [
  { v: 1, label: "1 (Highest)" },
  { v: 2, label: "2" },
  { v: 3, label: "3" },
  { v: 4, label: "4" },
  { v: 5, label: "5 (Lowest)" },
];

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

function priorityBadgeClass(p: number) {
  switch (p) {
    case 1:
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case 2:
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case 3:
      return "bg-white/10 text-white/70 border-white/20";
    case 4:
      return "bg-white/5 text-white/50 border-white/10";
    case 5:
      return "bg-white/5 text-white/40 border-white/10";
    default:
      return "bg-white/10 text-white/60 border-white/20";
  }
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
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(
    null
  );

  const originalIdsRef = useRef<Set<string>>(new Set());
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const lastSavedHashRef = useRef<string>("");

  const skipNextBlurAutosaveRef = useRef(false);

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

    // ✅ Kill autosave timer + in-flight autosave blocking
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

      // ✅ ensure saved before submit
      await upsertGoals(planId, toSave as any);

      // ✅ submit the plan
      await submitPlan(planId);

      // ✅ refresh to pick up server truth
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
            Before you set tomorrow’s goals, you must review yesterday.
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

  // ✅ Show the actual reason if Submit is disabled
  const submitWhy = !planId
    ? "planId is missing"
    : locked
    ? "plan is locked"
    : submitted
    ? "plan already submitted"
    : !firstThreeFilled
    ? "first 3 goals not filled"
    : submitting
    ? "submitting is true"
    : null;

  return (
    <AuthGate>
      <div className="card">
        <h1 className="text-3xl font-bold">Tomorrow Goals</h1>
        <p className="mt-2 text-white/70">
          Minimum <b>3</b> goals required. Set priority for the first 3.
        </p>

        {/* ✅ Debug line (remove later) */}
        <div className="mt-2 text-xs text-white/50">
          Debug: planStatus=<b>{planStatus}</b> • planId=
          <b>{planId ? planId.slice(0, 8) + "…" : "null"}</b>
        </div>

        <div className="mt-6 space-y-3">
          {goals.map((g, idx) => {
            const p =
              typeof g.priority === "number" && Number.isFinite(g.priority)
                ? g.priority
                : DEFAULT_PRIORITY;

            return (
              <div key={g.id ?? `row-${idx}`}>
                {idx === 3 && (
                  <div className="my-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-white/10" />
                    <div className="text-xs uppercase tracking-wider text-white/50">
                      Optional goals
                    </div>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                )}

                <div className="flex gap-3 items-center">
                  <div className="w-8 text-white/60">{idx + 1}.</div>

                  {idx < 3 && (
                    <span
                      className={[
                        "rounded-full border px-2.5 py-1 text-xs font-semibold",
                        priorityBadgeClass(p),
                      ].join(" ")}
                      title="Priority badge"
                    >
                      P{p}
                    </span>
                  )}

                  {idx < 3 && (
                    <select
                      value={p}
                      disabled={locked || submitting}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setGoals((prev) => applyPriorityChange(prev, idx, v));
                        scheduleAutoSave();
                      }}
                      className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-white outline-none focus:border-white/25"
                      title="Priority (1 = highest)"
                    >
                      {PRIORITY_OPTIONS.map((opt) => (
                        <option key={opt.v} value={opt.v}>
                          P{opt.v}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    type="text"
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    value={g.title ?? ""}
                    disabled={locked || submitting}
                    onKeyDown={(e) => onGoalKeyDown(e, idx)}
                    onBlur={() => {
                      if (skipNextBlurAutosaveRef.current) {
                        skipNextBlurAutosaveRef.current = false;
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
                    placeholder={idx < 3 ? "Required goal" : "Optional goal"}
                    className={[
                      "w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-white/25",
                      idx >= 3 ? "placeholder:text-white/30" : "",
                    ].join(" ")}
                  />

                  {!locked && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => removeGoal(idx)}
                      disabled={submitting}
                    >
                      {idx < 3 ? "Clear" : "Remove"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!locked && (
          <div className="mt-6 flex flex-wrap gap-3 items-center">
            <button
              className="btn"
              onClick={addMoreGoal}
              disabled={!canAddMore}
              title={
                goals.length >= MAX_GOALS ? `Max ${MAX_GOALS} goals reached` : ""
              }
            >
              + Add goal
            </button>

            <button
              className="btn"
              onClick={saveDraftOrChanges}
              disabled={submitting}
              title="Manual save (auto-saves too)"
            >
              {submitting ? "Saving…" : submitted ? "Save changes" : "Save draft"}
            </button>

            {!submitted && (
              <button
                className="btn btn-primary"
                onClick={onSubmitPlan}
                disabled={!canSubmit}
                title={submitWhy ?? ""}
              >
                {submitting ? "Submitting…" : "Submit tomorrow plan"}
              </button>
            )}

            <div className="text-sm text-white/60">
              {goals.length}/{MAX_GOALS}
            </div>

            {!canSubmit && submitWhy && !submitted && (
              <div className="text-sm text-white/70">
                Submit disabled because: <b>{submitWhy}</b>
              </div>
            )}

            {submitted && (
              <div className="text-sm text-white/70">
                This plan is <b>submitted</b> — optional blanks are removed and
                goals re-number on save.
              </div>
            )}
          </div>
        )}

        {locked && (
          <div className="mt-6 text-white/70">
            This plan is <b>{planStatus}</b>.
          </div>
        )}

        {msg && <div className="mt-4 text-sm text-white/80">{msg}</div>}
      </div>
    </AuthGate>
  );
}

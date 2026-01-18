"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import {
  getPlanWithGoals,
  toISODate,
  addDays,
  type Goal,
  type GoalStatus,
  awardAwarenessPoints,
  awardClosurePoints,
  getPoints,
  updateGoalStatus,
  addGoalNote,
  rescheduleGoalToDate,
  markGoalReviewed,
  unmarkGoalReviewed,
} from "@/lib/supabase/db";
import { useRouter } from "next/navigation";

const AWARENESS_POINTS = 5;
const CLOSURE_POINTS = 5;

const STATUS_OPTIONS: Array<{ v: GoalStatus; label: string }> = [
  { v: "not_started", label: "Not started" },
  { v: "in_progress", label: "In progress" },
  { v: "completed", label: "Completed" },
  { v: "attempted", label: "Attempted" },
  { v: "blocked", label: "Blocked" },
  { v: "postponed", label: "Postponed" },
];

function getGoalUIState(goal: Goal) {
  if (goal.reviewed_at) return "reviewed";
  if (goal.status !== "not_started") return "engaged";
  return "pending";
}

// closure rule: ALL engaged must be reviewed
function allEngagedReviewed(goals: Goal[]) {
  return goals.every((g) => g.status === "not_started" || !!g.reviewed_at);
}

export default function TodayPage() {
  const router = useRouter();
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [planId, setPlanId] = useState<string | null>(null);
  const [planFlags, setPlanFlags] = useState<{
    awareness_awarded: boolean;
    closure_awarded: boolean;
  }>({ awareness_awarded: false, closure_awarded: false });

  const [goals, setGoals] = useState<Goal[]>([]);
  const [points, setPoints] = useState(0);

  const [working, setWorking] = useState<string | null>(null); // goalId or "awareness"/"closure"
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [reschedDate, setReschedDate] = useState<Record<string, string>>({});
  const [reschedReason, setReschedReason] = useState<Record<string, string>>({});

  async function refresh() {
    setLoading(true);
    setMsg(null);

    const { plan, goals: dbGoals } = await getPlanWithGoals(todayISO);

    setPlanId(plan.id);
    setPlanFlags({
      awareness_awarded: !!(plan as any).awareness_awarded,
      closure_awarded: !!(plan as any).closure_awarded,
    });

    setGoals(dbGoals ?? []);

    const p = await getPoints();
    setPoints(p);

    // ✅ Phase 1: Awareness points on open (only if pending goals exist)
    const pendingExists = (dbGoals ?? []).some(
      (g) => g.status === "not_started" && !g.reviewed_at
    );

    if (pendingExists && !(plan as any).awareness_awarded) {
      setWorking("awareness");
      try {
        const res = await awardAwarenessPoints(plan.id, AWARENESS_POINTS);
        if (res.awarded) {
          setMsg(`Awareness earned +${AWARENESS_POINTS} ✅`);
          setPoints(res.new_points);
          setPlanFlags((f) => ({ ...f, awareness_awarded: true }));
        }
      } catch {
        // silent
      } finally {
        setWorking(null);
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((e: any) => {
      setMsg(e?.message ?? "Failed to load");
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO]);

  async function maybeAwardClosure(updatedGoals: Goal[]) {
    if (!planId) return;
    if (planFlags.closure_awarded) return;

    if (allEngagedReviewed(updatedGoals)) {
      setWorking("closure");
      try {
        const res = await awardClosurePoints(planId, CLOSURE_POINTS);
        if (res.awarded) {
          setMsg(`Closure earned +${CLOSURE_POINTS} ✅`);
          setPoints(res.new_points);
          setPlanFlags((f) => ({ ...f, closure_awarded: true }));

          // ✅ Refresh so UI reflects that plan is now reviewed_at (tomorrow gate relies on it)
          await refresh();
        }
      } catch (e: any) {
        setMsg(e?.message ?? "Closure award failed");
      } finally {
        setWorking(null);
      }
    }
  }

  async function changeStatus(goalId: string, status: GoalStatus) {
    setMsg(null);
    setWorking(goalId);
    try {
      await updateGoalStatus(goalId, status);

      const updated = goals.map((g) => (g.id === goalId ? { ...g, status } : g));
      setGoals(updated);

      await maybeAwardClosure(updated);
      setMsg("Updated ✅");
    } catch (e: any) {
      setMsg(e?.message ?? "Status update failed");
    } finally {
      setWorking(null);
    }
  }

  async function toggleReviewed(goal: Goal) {
    setMsg(null);
    setWorking(goal.id);

    try {
      let updated: Goal[];

      if (goal.reviewed_at) {
        await unmarkGoalReviewed(goal.id);
        updated = goals.map((g) =>
          g.id === goal.id ? { ...g, reviewed_at: null } : g
        );
        setGoals(updated);
        setMsg("Marked unreviewed");
      } else {
        // ✅ enforce: cannot review unless action taken
        if (goal.status === "not_started") {
          setMsg("Take action first, then review.");
          return;
        }

        const now = new Date().toISOString();
        await markGoalReviewed(goal.id);
        updated = goals.map((g) =>
          g.id === goal.id ? { ...g, reviewed_at: now } : g
        );
        setGoals(updated);
        setMsg("Reviewed ✅");
      }

      await maybeAwardClosure(updated!);
    } catch (e: any) {
      setMsg(e?.message ?? "Review update failed");
    } finally {
      setWorking(null);
    }
  }

  async function addNote(goalId: string) {
    const note = (noteDraft[goalId] ?? "").trim();
    if (!note) return;

    setMsg(null);
    setWorking(goalId);
    try {
      await addGoalNote(goalId, note);
      setNoteDraft((p) => ({ ...p, [goalId]: "" }));
      setMsg("Note added ✅");
    } catch (e: any) {
      setMsg(e?.message ?? "Note failed");
    } finally {
      setWorking(null);
    }
  }

  async function reschedule(goal: Goal) {
    const d = (reschedDate[goal.id] ?? "").trim();
    if (!d) {
      setMsg("Pick a date to reschedule.");
      return;
    }

    setMsg(null);
    setWorking(goal.id);
    try {
      await rescheduleGoalToDate({
        goal,
        toDateISO: d,
        reason: reschedReason[goal.id] ?? "",
      });

      const updated = goals.map((g) =>
        g.id === goal.id ? { ...g, status: "postponed" as GoalStatus } : g
      );
      setGoals(updated);

      setReschedDate((p) => ({ ...p, [goal.id]: "" }));
      setReschedReason((p) => ({ ...p, [goal.id]: "" }));

      await maybeAwardClosure(updated);

      setMsg(`Rescheduled to ${d} ✅`);
    } catch (e: any) {
      setMsg(e?.message ?? "Reschedule failed");
    } finally {
      setWorking(null);
    }
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="card">Loading…</div>
      </AuthGate>
    );
  }

  const pendingCount = goals.filter(
    (g) => g.status === "not_started" && !g.reviewed_at
  ).length;

  const engagedNeedsReviewCount = goals.filter(
    (g) => g.status !== "not_started" && !g.reviewed_at
  ).length;

  return (
    <AuthGate>
      <div className="space-y-4">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">Today</h1>
              <p className="mt-2 text-white/70">
                {todayISO} • Points: <b>{points}</b>
              </p>

              <div className="mt-2 text-sm text-white/60">
                Pending: <b>{pendingCount}</b> • Needs review:{" "}
                <b>{engagedNeedsReviewCount}</b>
              </div>

              <div className="mt-2 text-sm text-white/60">
                Awareness: <b>{planFlags.awareness_awarded ? "✅" : "—"}</b> •
                Closure: <b>{planFlags.closure_awarded ? "✅" : "—"}</b>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button className="btn" onClick={() => router.push("/standup")}>
                Dashboard
              </button>
              <button
                className="btn"
                onClick={() => router.push("/standup/tomorrow")}
              >
                Tomorrow ({tomorrowISO})
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-bold">Goals</h2>
          <p className="mt-2 text-white/70">
            Pending goals stay neutral. Once you take action, they become “Engaged”
            until you review them.
          </p>

          {goals.length === 0 ? (
            <div className="mt-4 text-white/70">No goals yet.</div>
          ) : (
            <div className="mt-4 space-y-3">
              {goals.map((g, idx) => {
                const uiState = getGoalUIState(g);
                const p =
                  typeof (g as any).priority === "number"
                    ? ((g as any).priority as number)
                    : 3;

                return (
                  <div
                    key={g.id}
                    className={[
                      "rounded-2xl border p-4 transition-all",
                      uiState === "pending" &&
                        "border-white/10 bg-white/5 opacity-90",
                      uiState === "engaged" &&
                        "border-amber-500/40 bg-amber-500/10",
                      uiState === "reviewed" &&
                        "border-emerald-500/40 bg-emerald-500/10",
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-white/60">
                          {idx + 1} • P{p}
                        </div>
                        <div className="mt-1 text-lg font-semibold">{g.title}</div>

                        <div className="mt-1 text-xs uppercase tracking-wide">
                          {uiState === "pending" && (
                            <span className="text-white/50">Pending</span>
                          )}
                          {uiState === "engaged" && (
                            <span className="text-amber-300">Needs review</span>
                          )}
                          {uiState === "reviewed" && (
                            <span className="text-emerald-300">Reviewed</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <select
                          value={g.status}
                          disabled={working === g.id || working === "closure"}
                          onChange={(e) =>
                            changeStatus(g.id, e.target.value as GoalStatus)
                          }
                          className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-white/25"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s.v} value={s.v}>
                              {s.label}
                            </option>
                          ))}
                        </select>

                        <button
                          className={[
                            "btn",
                            g.reviewed_at ? "btn-ghost" : "btn-primary",
                          ].join(" ")}
                          disabled={
                            working === g.id ||
                            working === "closure" ||
                            g.status === "not_started"
                          }
                          onClick={() => toggleReviewed(g)}
                          title={
                            g.status === "not_started"
                              ? "Take action before reviewing"
                              : "Mark goal as reviewed"
                          }
                        >
                          {g.reviewed_at ? "Reviewed ✓" : "Review"}
                        </button>
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="mt-4">
                      <div className="text-xs uppercase tracking-wider text-white/50">
                        Follow-up note
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3">
                        <input
                          value={noteDraft[g.id] ?? ""}
                          disabled={working === g.id || working === "closure"}
                          onChange={(e) =>
                            setNoteDraft((p) => ({ ...p, [g.id]: e.target.value }))
                          }
                          placeholder="Add a note (next steps, blockers, reminder...)"
                          className="w-full flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-white/25"
                        />
                        <button
                          className="btn"
                          disabled={
                            working === g.id ||
                            working === "closure" ||
                            !(noteDraft[g.id] ?? "").trim()
                          }
                          onClick={() => addNote(g.id)}
                        >
                          Add note
                        </button>
                      </div>
                    </div>

                    {/* Reschedule */}
                    <div className="mt-4">
                      <div className="text-xs uppercase tracking-wider text-white/50">
                        Postpone / Reschedule
                      </div>

                      <div className="mt-2 flex flex-wrap gap-3 items-center">
                        <input
                          type="date"
                          value={reschedDate[g.id] ?? ""}
                          disabled={working === g.id || working === "closure"}
                          onChange={(e) =>
                            setReschedDate((p) => ({ ...p, [g.id]: e.target.value }))
                          }
                          className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-white/25"
                        />

                        <input
                          value={reschedReason[g.id] ?? ""}
                          disabled={working === g.id || working === "closure"}
                          onChange={(e) =>
                            setReschedReason((p) => ({ ...p, [g.id]: e.target.value }))
                          }
                          placeholder="Reason (optional)"
                          className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-white/25"
                        />

                        <button
                          className="btn btn-primary"
                          disabled={
                            working === g.id ||
                            working === "closure" ||
                            !(reschedDate[g.id] ?? "").trim()
                          }
                          onClick={() => reschedule(g)}
                        >
                          {working === g.id ? "Rescheduling…" : "Reschedule"}
                        </button>
                      </div>

                      <div className="mt-2 text-sm text-white/60">
                        Tip: Pick <b>{tomorrowISO}</b> to push it to tomorrow and it
                        will appear immediately.
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {msg && <div className="mt-4 text-sm text-white/80">{msg}</div>}
        </div>
      </div>
    </AuthGate>
  );
}

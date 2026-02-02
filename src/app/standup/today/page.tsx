"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import RescheduleModal from "@/components/RescheduleModal";
import {
  addDays,
  awardAwarenessPoints,
  awardClosurePoints,
  getPlanWithGoals,
  markGoalReviewed,
  unmarkGoalReviewed,
  updateGoalStatus,
  toISODate,
  type DailyPlan,
  type Goal,
  type GoalStatus,
} from "@/lib/supabase/db";

function statusLabel(status: Goal["status"]) {
  switch (status) {
    case "not_started": return "Not started";
    case "in_progress": return "In progress";
    case "completed": return "Completed";
    case "attempted": return "Attempted";
    case "postponed": return "Postponed";
    case "blocked": return "Blocked";
    default: return status;
  }
}

function statusPillClass(status: Goal["status"]) {
  switch (status) {
    case "completed": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "in_progress": return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    case "blocked": return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "postponed": return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "attempted": return "bg-purple-500/15 text-purple-300 border-purple-500/30";
    case "not_started":
    default: return "bg-white/10 text-white/70 border-white/20";
  }
}

function priorityBadgeClass(p: number) {
  switch (p) {
    case 1: return "bg-red-500/15 text-red-300 border-red-500/30";
    case 2: return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case 3: return "bg-white/10 text-white/70 border-white/20";
    case 4: return "bg-white/5 text-white/50 border-white/10";
    case 5: return "bg-white/5 text-white/40 border-white/10";
    default: return "bg-white/10 text-white/60 border-white/20";
  }
}

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
  const [busyGoalId, setBusyGoalId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [rescheduleGoal, setRescheduleGoal] = useState<Goal | null>(null);

  const awarenessAttemptedRef = useRef(false);
  const closureAttemptedRef = useRef(false);

  const locked = plan?.status === "locked";
  const dayClosed = !!plan?.reviewed_at;

  const sortedGoals = useMemo(() => {
    const list = [...goals];
    list.sort((a, b) => {
      const ap = typeof (a as any).priority === "number" ? (a as any).priority : 999;
      const bp = typeof (b as any).priority === "number" ? (b as any).priority : 999;
      if (ap !== bp) return ap - bp;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    return list;
  }, [goals]);

  const reviewedCount = useMemo(
    () => sortedGoals.filter((g) => !!(g as any).reviewed_at).length,
    [sortedGoals]
  );

  const totalCount = sortedGoals.length;
  const pendingGoals = useMemo(() => sortedGoals.filter((g) => !(g as any).reviewed_at), [sortedGoals]);
  const allReviewed = totalCount === 0 || (totalCount > 0 && reviewedCount === totalCount);

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      const { plan: p, goals: gs } = await getPlanWithGoals(todayISO);
      setPlan(p);
      setGoals(gs);

      if (!awarenessAttemptedRef.current && !p.reviewed_at) {
        awarenessAttemptedRef.current = true;
        const hasPending = (gs ?? []).some((g) => !(g as any).reviewed_at);
        if (hasPending) {
          try {
            await awardAwarenessPoints(p.id, 5);
            setMsg("Awareness earned ✓");
            window.setTimeout(() => setMsg((cur) => (cur === "Awareness earned ✓" ? null : cur)), 1200);
          } catch {}
        }
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [todayISO]);

  async function toggleReviewed(goal: Goal) {
    if (locked || busyGoalId || dayClosed) return;

    setBusyGoalId(goal.id);
    setMsg(null);

    try {
      const isReviewed = !!(goal as any).reviewed_at;
      setGoals((prev) =>
        prev.map((g) =>
          g.id === goal.id ? ({ ...g, reviewed_at: isReviewed ? null : new Date().toISOString() } as any) : g
        )
      );

      if (!isReviewed) {
        await markGoalReviewed(goal.id);
      } else {
        await unmarkGoalReviewed(goal.id);
      }

      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Update failed");
      await refresh();
    } finally {
      setBusyGoalId(null);
    }
  }

  async function handleStatusChange(goal: Goal, newStatus: GoalStatus) {
    if (locked || busyGoalId || dayClosed) return;

    const isReviewed = !!(goal as any).reviewed_at;
    if (!isReviewed) {
      setMsg("Review the goal first before changing its status.");
      return;
    }

    setBusyGoalId(goal.id);
    setMsg(null);

    try {
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, status: newStatus } : g)));
      await updateGoalStatus(goal.id, newStatus);
      setMsg(`Status updated to "${statusLabel(newStatus)}" ✓`);
      window.setTimeout(() => setMsg((cur) => (cur?.includes("Status updated") ? null : cur)), 1500);
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Status update failed");
      await refresh();
    } finally {
      setBusyGoalId(null);
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
      const res = await awardClosurePoints(plan.id, 5);
      
      if (res?.awarded) {
        setMsg("Day closed ✅ Tomorrow unlocked.");
      } else {
        setMsg("Day already closed ✓");
      }
      
      await refresh();
    } catch (e: any) {
      console.error("Closure error:", e);
      setMsg(`Error: ${e?.message ?? "Could not close the day."}`);
      await refresh();
    } finally {
      setClosing(false);
    }
  }

  useEffect(() => {
    if (!plan?.id || locked || dayClosed || !allReviewed || closureAttemptedRef.current) return;
    closureAttemptedRef.current = true;
    closeOutDay().catch(() => {});
  }, [plan?.id, locked, dayClosed, allReviewed]);

  if (loading) {
    return (
      <AuthGate>
        <div className="card">Loading…</div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Today</h1>
            <p className="mt-2 text-white/70">
              {dayClosed 
                ? "This day has been closed. Review your goals below." 
                : "Review each goal first. Pending goals stay dim until reviewed."}
            </p>
            {plan?.status && (
              <div className="mt-2 text-sm text-white/60">
                Plan status: <b>{plan.status}</b> • Date: <b>{todayISO}</b>
              </div>
            )}
            {dayClosed && plan?.reviewed_at && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                <span className="text-emerald-400 text-lg">✅</span>
                <div className="text-sm text-emerald-300">
                  Day closed at {new Date(plan.reviewed_at).toLocaleTimeString()}
                  <div className="text-xs text-emerald-400/70 mt-0.5">Tomorrow planning is unlocked</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-sm text-white/70">
              Reviewed: <b>{reviewedCount}/{totalCount}</b>
            </div>
            <Link className="btn btn-primary" href="/standup/tomorrow">
              {dayClosed ? "Plan Tomorrow →" : "Go to Tomorrow →"}
            </Link>
            <div className="text-xs text-white/50">Tomorrow: {tomorrowISO}</div>
          </div>
        </div>

        {!dayClosed && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-center gap-3">
              {totalCount > 0 ? (
                <>
                  <div className="text-sm text-white/70">Pending: <b>{pendingGoals.length}</b></div>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="text-sm text-white/70">Tip: Pending goals have a <b>dashed</b> border.</div>
                </>
              ) : (
                <div className="text-sm text-white/70">No goals for today. You can close out and plan tomorrow.</div>
              )}
              {locked && (
                <>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="text-sm text-white/70">This plan is <b>locked</b> (read-only).</div>
                </>
              )}
            </div>

            {!locked && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn"
                  onClick={closeOutDay}
                  disabled={!allReviewed || closing}
                  title={!allReviewed ? "Review all goals first" : "Close out the day"}
                >
                  {closing ? "Closing…" : "Close out day"}
                </button>
                {totalCount > 0 && !allReviewed && (
                  <div className="text-sm text-white/60">Close out unlocks Tomorrow planning (sets today as reviewed).</div>
                )}
                {allReviewed && (
                  <div className="text-sm text-white/60">
                    {totalCount === 0 ? "Close out to unlock Tomorrow planning." : "All reviewed — you can close out now."}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 space-y-3">
          {sortedGoals.length === 0 && (
            <div className="text-white/70">
              No goals for today yet. (This usually means you didn't set yesterday's plan.)
              {!dayClosed && (
                <div className="mt-2 text-sm text-white/60">
                  Close out this day to start planning tomorrow!
                </div>
              )}
            </div>
          )}

          {sortedGoals.map((g, idx) => {
            const reviewed = !!(g as any).reviewed_at;
            const p = typeof (g as any).priority === "number" && Number.isFinite((g as any).priority) ? ((g as any).priority as number) : null;
            const rowClass = reviewed ? "border-white/15 bg-white/5" : "border-white/10 bg-white/3 border-dashed opacity-90";
            const isBusy = busyGoalId === g.id;

            return (
              <div key={g.id} className={["rounded-2xl border px-4 py-4 transition", rowClass].join(" ")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-white/60 w-8">{idx + 1}.</div>
                      {p != null && (
                        <span className={["rounded-full border px-2.5 py-1 text-xs font-semibold", priorityBadgeClass(p)].join(" ")} title="Priority">
                          P{p}
                        </span>
                      )}
                      <span className={["rounded-full border px-2.5 py-1 text-xs font-semibold", statusPillClass(g.status)].join(" ")} title="Status">
                        {statusLabel(g.status)}
                      </span>
                      {!reviewed && <span className="text-xs text-white/50">Pending review</span>}
                      {reviewed && <span className="text-xs text-white/60">Reviewed ✓</span>}
                    </div>

                    <div className="mt-2 text-white">{g.title}</div>
                    {g.details && <div className="mt-1 text-sm text-white/60">{g.details}</div>}

                    {g.created_at && (
                      <div className="mt-2 text-xs text-white/50">
                        Created: {new Date(g.created_at).toLocaleString()}
                      </div>
                    )}

                    {reviewed && !locked && !dayClosed && (
                      <div className="mt-3 flex items-center gap-2">
                        <label className="text-xs text-white/60">Change status:</label>
                        <select
                          value={g.status}
                          disabled={isBusy}
                          onChange={(e) => handleStatusChange(g, e.target.value as GoalStatus)}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-white/25 disabled:opacity-50"
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {!dayClosed && (
                      <button
                        type="button"
                        className="btn"
                        disabled={locked || isBusy}
                        onClick={() => toggleReviewed(g)}
                        title={reviewed ? "Mark as pending" : "Mark as reviewed"}
                      >
                        {isBusy ? "Saving…" : reviewed ? "Undo review" : "Mark reviewed"}
                      </button>
                    )}
                    
                    {reviewed && !locked && !dayClosed && g.status !== "completed" && (
                      <button
                        type="button"
                        className="btn btn-ghost text-sm"
                        disabled={isBusy}
                        onClick={() => setRescheduleGoal(g)}
                        title="Reschedule to another day"
                      >
                        📅 Reschedule
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ghost" onClick={() => refresh()}>Refresh</button>
          <Link className="btn btn-ghost" href="/standup/tomorrow">Tomorrow goals →</Link>
          <Link className="btn btn-ghost" href="/standup/dashboard">Dashboard →</Link>
        </div>

        {msg && <div className="mt-4 text-sm text-white/80">{msg}</div>}
      </div>

      {rescheduleGoal && (
        <RescheduleModal
          goal={rescheduleGoal}
          onClose={() => setRescheduleGoal(null)}
          onSuccess={() => {
            setMsg("Goal rescheduled successfully ✓");
            refresh();
          }}
        />
      )}
    </AuthGate>
  );
}
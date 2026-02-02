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
  upsertGoals,
  type DailyPlan,
  type Goal,
  type GoalStatus,
} from "@/lib/supabase/db";

// Priority options matching Tomorrow page
const PRIORITY_OPTIONS = [
  { v: 1, icon: "🔴", label: "Highest Priority" },
  { v: 2, icon: "🟠", label: "High Priority" },
  { v: 3, icon: "🟡", label: "Medium Priority" },
  { v: 4, icon: "⚪", label: "Low Priority" },
  { v: 5, icon: "⚫", label: "Lowest Priority" },
];

function getPriorityIcon(priority: number) {
  const opt = PRIORITY_OPTIONS.find(p => p.v === priority);
  return opt?.icon || "⚪";
}

// Card gradient based on priority
function getPriorityGradient(priority: number) {
  switch (priority) {
    case 1: return "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(225, 29, 72, 0.15))";
    case 2: return "linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(251, 146, 60, 0.15))";
    case 3: return "linear-gradient(135deg, rgba(250, 204, 21, 0.15), rgba(253, 224, 71, 0.15))";
    case 4: return "linear-gradient(135deg, rgba(148, 163, 184, 0.12), rgba(203, 213, 225, 0.12))";
    case 5: return "linear-gradient(135deg, rgba(71, 85, 105, 0.12), rgba(51, 65, 85, 0.12))";
    default: return "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.06))";
  }
}

function getPriorityBorder(priority: number) {
  switch (priority) {
    case 1: return "rgba(239, 68, 68, 0.3)";
    case 2: return "rgba(249, 115, 22, 0.3)";
    case 3: return "rgba(250, 204, 21, 0.3)";
    case 4: return "rgba(148, 163, 184, 0.25)";
    case 5: return "rgba(71, 85, 105, 0.25)";
    default: return "rgba(255,255,255,0.08)";
  }
}

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
  
  // Quick Add state
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddGoals, setQuickAddGoals] = useState([
    { title: "", priority: 1 },
    { title: "", priority: 2 },
    { title: "", priority: 3 },
  ]);
  const [addingGoals, setAddingGoals] = useState(false);

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
      const goalsToAdd = filledGoals.map((g, idx) => ({
        title: g.title.trim(),
        priority: g.priority,
        sort_order: goals.length + idx,
        status: "not_started" as GoalStatus,
      }));

      await upsertGoals(plan.id, goalsToAdd as any);
      
      setMsg(`Added ${filledGoals.length} goal(s) ✅`);
      setShowQuickAdd(false);
      setQuickAddGoals([
        { title: "", priority: 1 },
        { title: "", priority: 2 },
        { title: "", priority: 3 },
      ]);
      
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to add goals");
    } finally {
      setAddingGoals(false);
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
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Today</h1>
            <p className="text-white/70">
              {dayClosed 
                ? "This day has been closed. Review your goals below." 
                : "Review each goal first. Pending goals stay dim until reviewed."}
            </p>
            {plan?.status && (
              <div className="mt-2 text-sm text-white/60">
                Date: <b>{todayISO}</b>
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
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-sm text-white/70">
              Reviewed: <b>{reviewedCount}/{totalCount}</b>
            </div>
            <Link className="btn btn-primary" href="/standup/tomorrow">
              {dayClosed ? "Plan Tomorrow →" : "Go to Tomorrow →"}
            </Link>
          </div>
        </div>

        {/* Quick Add Section */}
        {!dayClosed && totalCount === 0 && (
          <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
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
                >
                  ⚡ Quick Add Goals
                </button>
              )}
            </div>

            {showQuickAdd && (
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
                      className="flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40"
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
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
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
              {allReviewed && (
                <div className="text-sm text-white/60">
                  Close out to unlock Tomorrow planning.
                </div>
              )}
            </div>
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
            const reviewed = !!(g as any).reviewed_at;
            const p = typeof (g as any).priority === "number" ? (g as any).priority : 3;
            const isBusy = busyGoalId === g.id;

            return (
              <div
                key={g.id}
                className="relative rounded-2xl overflow-hidden transition-all duration-300 hover:scale-[1.005]"
                style={{
                  background: getPriorityGradient(p),
                  border: `2px solid ${getPriorityBorder(p)}`,
                  padding: "2rem 2.5rem",
                  opacity: reviewed ? 1 : 0.7
                }}
              >
                <div className="flex items-center" style={{ gap: "2rem" }}>
                  {/* Number badge */}
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

                  {/* Goal content */}
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className={["rounded-full border px-2.5 py-1 text-xs font-semibold", statusPillClass(g.status)].join(" ")}>
                        {statusLabel(g.status)}
                      </span>
                      {!reviewed && <span className="text-xs text-white/50">Pending review</span>}
                      {reviewed && <span className="text-xs text-emerald-400">Reviewed ✓</span>}
                    </div>

                    <div className="text-white text-xl font-medium mb-2">{g.title}</div>
                    {g.details && <div className="text-sm text-white/60">{g.details}</div>}

                    {reviewed && !locked && !dayClosed && (
                      <div className="mt-3 flex items-center gap-2">
                        <label className="text-xs text-white/60">Status:</label>
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

                  {/* Priority indicator - circular */}
                  <div 
                    className="flex-shrink-0 rounded-full flex items-center justify-center"
                    style={{
                      width: "56px",
                      height: "56px",
                      background: "rgba(0,0,0,0.3)",
                      backdropFilter: "blur(10px)",
                      border: "2px solid rgba(255,255,255,0.2)"
                    }}
                    title={`Priority ${p}`}
                  >
                    <div className="text-center">
                      <div className="text-2xl">{getPriorityIcon(p)}</div>
                      <div className="text-xs font-bold text-white/80 mt-1">P{p}</div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {!dayClosed && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="btn"
                        disabled={locked || isBusy}
                        onClick={() => toggleReviewed(g)}
                        title={reviewed ? "Mark as pending" : "Mark as reviewed"}
                      >
                        {isBusy ? "..." : reviewed ? "Undo" : "Review"}
                      </button>
                      
                      {reviewed && !locked && g.status !== "completed" && (
                        <button
                          type="button"
                          className="btn btn-ghost text-sm"
                          disabled={isBusy}
                          onClick={() => setRescheduleGoal(g)}
                          title="Reschedule to another day"
                        >
                          📅
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ghost" onClick={() => refresh()}>Refresh</button>
          <Link className="btn btn-ghost" href="/standup/dashboard">Dashboard →</Link>
        </div>

        {msg && <div className="mt-4 px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white animate-fadeIn">{msg}</div>}
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
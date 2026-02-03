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
import { supabase } from "@/lib/supabase/client";

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

function getPriorityIcon(priority: number) {
  const opt = PRIORITY_OPTIONS.find(p => p.v === priority);
  return opt?.icon || "⚪";
}

function getPriorityData(priority: number) {
  return PRIORITY_OPTIONS.find(p => p.v === priority) || PRIORITY_OPTIONS[2];
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
  const [reopening, setReopening] = useState(false);
  
  // History & notes tracking
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({});
  const [goalNotes, setGoalNotes] = useState<Record<string, any[]>>({});
  
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
      
      // Attach reschedule info to goals
      const goalsWithReschedule = gs.map(g => ({
        ...g,
        rescheduled_to: rescheduleMap[g.id]?.to_date || null,
        reschedule_reason: rescheduleMap[g.id]?.reason || null,
      }));
      
      setGoals(goalsWithReschedule);

      if (!awarenessAttemptedRef.current && !p.reviewed_at) {
        awarenessAttemptedRef.current = true;
        const hasPending = goalsWithReschedule.some((g) => !(g as any).reviewed_at);
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

  // Fetch goal notes/history
  async function fetchGoalNotes(goalId: string) {
    const { data } = await supabase
      .from("goal_notes")
      .select("*")
      .eq("goal_id", goalId)
      .order("created_at", { ascending: false });
    
    return data || [];
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
    console.log("🔍 closeOutDay called");
    console.log("  plan?.id:", plan?.id);
    console.log("  locked:", locked);
    console.log("  closing:", closing);
    console.log("  dayClosed:", dayClosed);
    console.log("  totalCount:", totalCount);
    console.log("  allReviewed:", allReviewed);
    
    if (!plan?.id || locked || closing || dayClosed) {
      console.log("❌ Blocked by guard clause");
      return;
    }
    
    if (totalCount > 0 && !allReviewed) {
      console.log("❌ Not all goals reviewed");
      setMsg("Review all goals first to close the day.");
      return;
    }

    setClosing(true);
    setMsg("Closing day...");
    console.log("📤 Calling awardClosurePoints with plan.id:", plan.id);

    try {
      const res = await awardClosurePoints(plan.id, 5);
      console.log("📥 awardClosurePoints response:", res);
      
      if (res?.awarded) {
        setMsg("Day closed ✅ Tomorrow unlocked.");
        console.log("✅ Day closed successfully");
      } else {
        setMsg("Day already closed ✓");
        console.log("⚠️ Day was already closed");
      }
      
      await refresh();
    } catch (e: any) {
      console.error("❌ Closure error:", e);
      setMsg(`Error: ${e?.message ?? "Could not close the day."}`);
      await refresh();
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
      const { error } = await supabase
        .from("daily_plans")
        .update({ reviewed_at: null })
        .eq("id", plan.id);

      if (error) throw error;

      setMsg("Day reopened ✅ You can now edit goals.");
      await refresh();
    } catch (e: any) {
      console.error("Reopen error:", e);
      setMsg(`Error: ${e?.message ?? "Could not reopen the day."}`);
    } finally {
      setReopening(false);
    }
  }

  // Manual close function (if RPC fails)
  async function manualCloseDay() {
    if (!plan?.id || closing) return;
    
    console.log("🔧 Using manual close method");
    setClosing(true);
    setMsg("Manually closing day...");

    try {
      // Directly update the plan
      const { error: updateError } = await supabase
        .from("daily_plans")
        .update({ reviewed_at: new Date().toISOString() })
        .eq("id", plan.id);

      if (updateError) throw updateError;

      // Award points manually
      const { error: pointsError } = await supabase.rpc("award_points", {
        p_points: 5,
      });

      if (pointsError) console.warn("Points award failed:", pointsError);

      setMsg("Day closed ✅ (manual method)");
      await refresh();
    } catch (e: any) {
      console.error("Manual close error:", e);
      setMsg(`Error: ${e?.message ?? "Could not close the day."}`);
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

          <div className="flex flex-col items-end gap-3">
            <div className="text-sm text-white/70">
              Reviewed: <b>{reviewedCount}/{totalCount}</b>
            </div>
            <Link 
              className="btn btn-primary whitespace-nowrap" 
              href="/standup/tomorrow"
              style={{ minWidth: "150px", textAlign: "center" }}
            >
              Plan Tomorrow →
            </Link>
          </div>
        </div>

        {/* Quick Add Section - ALWAYS AVAILABLE */}
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
          {dayClosed ? (
            <div>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-amber-300 mb-2">Day Already Closed</h3>
                  <p className="text-sm text-white/70 mb-2">
                    This day has been closed. You can't add or edit goals on a closed day.
                  </p>
                  <p className="text-xs text-white/50">
                    Need to make changes? Reopen this day to add goals or make edits.
                  </p>
                </div>
                <button
                  onClick={reopenDay}
                  disabled={reopening}
                  className="btn"
                  style={{
                    background: "rgba(245, 158, 11, 0.3)",
                    border: "2px solid rgba(245, 158, 11, 0.5)",
                    padding: "0.75rem 1.5rem",
                    fontWeight: "bold",
                    whiteSpace: "nowrap"
                  }}
                >
                  {reopening ? "Reopening..." : "🔓 Reopen Day"}
                </button>
              </div>
              
              <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs text-white/60">
                  <b>Note:</b> Reopening will allow you to add new goals or modify existing ones. 
                  Remember to close the day again when you're done.
                </p>
              </div>
            </div>
          ) : totalCount === 0 ? (
            <>
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
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-amber-300">Need to add more goals?</h3>
              </div>
              {!showQuickAdd && (
                <button
                  onClick={() => setShowQuickAdd(true)}
                  className="btn"
                  style={{
                    background: "rgba(245, 158, 11, 0.2)",
                    border: "2px solid rgba(245, 158, 11, 0.4)",
                    padding: "0.5rem 1rem"
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
              
              {/* Manual close button for debugging */}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={manualCloseDay}
                disabled={closing}
                title="Manual close (debugging)"
                style={{ fontSize: "0.75rem" }}
              >
                🔧 Manual Close
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
                  opacity: reviewed ? 1 : 0.6
                }}
              >
                <div className="flex items-center" style={{ gap: "2rem" }}>
                  {/* Number badge - circular like Tomorrow */}
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
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {!reviewed && <span className="text-xs text-amber-400 font-semibold">⏳ Pending review</span>}
                      {reviewed && <span className="text-xs text-emerald-400 font-semibold">✓ Reviewed</span>}
                    </div>

                    <div className="text-white text-xl font-medium mb-2" style={{ padding: "0 1rem" }}>
                      {g.title}
                    </div>
                    
                    {/* Reschedule info - directly under title */}
                    {(g as any).rescheduled_to && (
                      <div className="mb-3" style={{ padding: "0 1rem" }}>
                        <div className="inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5">
                          <span className="text-lg">📅</span>
                          <div>
                            <div className="text-xs font-semibold text-blue-300">
                              Rescheduled to {(g as any).rescheduled_to}
                            </div>
                            {(g as any).reschedule_reason && (
                              <div className="text-xs text-blue-300/70 italic mt-0.5">
                                "{(g as any).reschedule_reason}"
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Goal details */}
                    {g.details && (
                      <div className="text-sm text-white/60 mb-3" style={{ padding: "0 1rem" }}>
                        {g.details}
                      </div>
                    )}
                    
                    {/* Activity History & Metadata */}
                    {g.id && (
                      <div className="mt-4 pt-4 border-t border-white/10" style={{ padding: "0 1rem" }}>
                        <div className="flex flex-wrap gap-4 text-xs text-white/40 mb-2">
                          {(g as any).created_at && (
                            <div>📅 Created {new Date((g as any).created_at).toLocaleString()}</div>
                          )}
                          {(g as any).reviewed_at && (
                            <div className="text-emerald-400/70">✓ Reviewed {new Date((g as any).reviewed_at).toLocaleTimeString()}</div>
                          )}
                        </div>
                        
                        <button
                          onClick={async () => {
                            if (!showHistory[g.id]) {
                              const notes = await fetchGoalNotes(g.id);
                              setGoalNotes(prev => ({ ...prev, [g.id]: notes }));
                            }
                            setShowHistory(prev => ({ ...prev, [g.id]: !prev[g.id] }));
                          }}
                          className="text-xs text-blue-400 hover:text-blue-300 underline transition-colors"
                        >
                          {showHistory[g.id] ? "▼ Hide activity log" : "▶ Show activity log"}
                        </button>
                        
                        {showHistory[g.id] && (
                          <div className="mt-3 p-4 rounded-lg bg-black/30 border border-white/10">
                            <div className="text-xs font-semibold text-white/70 mb-3 flex items-center gap-2">
                              <span>📋</span>
                              Activity Timeline
                            </div>
                            
                            <div className="space-y-3">
                              {(g as any).created_at && (
                                <div className="flex items-start gap-3">
                                  <div className="w-2 h-2 rounded-full bg-purple-400 mt-1.5 flex-shrink-0"></div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-white/80 font-medium">Goal created</div>
                                    <div className="text-[10px] text-white/40 mt-0.5">
                                      {new Date((g as any).created_at).toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                              )}
                              
                              {p && (
                                <div className="flex items-start gap-3">
                                  <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0"></div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-white/80 font-medium">
                                      Priority: {getPriorityIcon(p)} P{p} - {PRIORITY_OPTIONS.find(o => o.v === p)?.label}
                                    </div>
                                  </div>
                                </div>
                              )}
                              
                              {(g as any).reviewed_at && (
                                <div className="flex items-start gap-3">
                                  <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0"></div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-white/80 font-medium">Marked as reviewed</div>
                                    <div className="text-[10px] text-white/40 mt-0.5">
                                      {new Date((g as any).reviewed_at).toLocaleString()}
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
                              
                              {(g as any).rescheduled_to && (
                                <div className="flex items-start gap-3">
                                  <div className="w-2 h-2 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0"></div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-white/80 font-medium">
                                      Rescheduled to {(g as any).rescheduled_to}
                                    </div>
                                    {(g as any).reschedule_reason && (
                                      <div className="text-xs text-white/60 italic mt-1">
                                        "{(g as any).reschedule_reason}"
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                              
                              {goalNotes[g.id]?.map((note, i) => (
                                <div key={i} className="flex items-start gap-3">
                                  <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 flex-shrink-0"></div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-white/80 font-medium">💬 {note.note}</div>
                                    <div className="text-[10px] text-white/40 mt-0.5">
                                      {new Date(note.created_at).toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                              ))}
                              
                              {!goalNotes[g.id]?.length && g.status === "not_started" && !(g as any).reviewed_at && (
                                <div className="text-xs text-white/40 italic text-center py-2">
                                  No activity recorded yet
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Priority button - EXACTLY like Tomorrow page */}
                  <div className="flex-shrink-0 relative" style={{ width: "56px" }}>
                    <select
                      value={p}
                      disabled={locked || dayClosed}
                      onChange={async (e) => {
                        const newPriority = Number(e.target.value);
                        setBusyGoalId(g.id);
                        try {
                          await supabase
                            .from("goals")
                            .update({ priority: newPriority })
                            .eq("id", g.id);
                          await refresh();
                        } catch (e: any) {
                          setMsg(e?.message ?? "Failed to update priority");
                        } finally {
                          setBusyGoalId(null);
                        }
                      }}
                      style={{
                        width: "56px",
                        height: "56px",
                        background: getPriorityData(p).buttonBg,
                        border: `3px solid ${getPriorityData(p).buttonBorder}`,
                        borderRadius: "50%",
                        color: "transparent",
                        boxShadow: getPriorityData(p).buttonShadow,
                        cursor: locked || dayClosed ? "default" : "pointer"
                      }}
                      className="appearance-none cursor-pointer hover:scale-110 hover:brightness-110 transition-all focus:outline-none focus:ring-2 focus:ring-white/30"
                      title={`Priority ${p}`}
                    >
                      {PRIORITY_OPTIONS.map((opt) => (
                        <option key={opt.v} value={opt.v}>
                          {opt.icon} P{opt.v}
                        </option>
                      ))}
                    </select>
                    {/* Icon overlay */}
                    <div className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 pointer-events-none text-xl">
                      {getPriorityIcon(p)}
                    </div>
                    {/* P# text overlay */}
                    <div className="absolute left-1/2 bottom-2 -translate-x-1/2 pointer-events-none text-xs font-black text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                      P{p}
                    </div>
                  </div>

                  {/* Action section - compact horizontal layout */}
                  {!dayClosed && (
                    <div className="flex flex-col gap-3 items-center">
                      {/* Review/Undo button */}
                      <button
                        type="button"
                        onClick={() => toggleReviewed(g)}
                        disabled={locked || isBusy}
                        style={{
                          width: "56px",
                          height: "56px",
                          background: reviewed ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)",
                          border: `3px solid ${reviewed ? "rgba(16, 185, 129, 0.6)" : "rgba(245, 158, 11, 0.6)"}`,
                          borderRadius: "50%"
                        }}
                        className="flex items-center justify-center hover:scale-110 transition-all text-2xl font-bold"
                        title={reviewed ? "Mark as pending" : "Mark as reviewed"}
                      >
                        {isBusy ? "..." : reviewed ? "↶" : "✓"}
                      </button>
                      
                      {/* Horizontal status buttons row - only when reviewed */}
                      {reviewed && !locked && (
                        <div className="flex gap-2">
                          {/* Completed */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(g, "completed")}
                            disabled={isBusy}
                            style={{
                              width: "40px",
                              height: "40px",
                              background: g.status === "completed" ? "rgba(16, 185, 129, 0.5)" : "rgba(16, 185, 129, 0.1)",
                              border: `2px solid ${g.status === "completed" ? "rgba(16, 185, 129, 1)" : "rgba(16, 185, 129, 0.3)"}`,
                              borderRadius: "50%",
                              transform: g.status === "completed" ? "scale(1.1)" : "scale(1)",
                              boxShadow: g.status === "completed" ? "0 0 12px rgba(16, 185, 129, 0.6)" : "none"
                            }}
                            className="flex items-center justify-center hover:scale-110 transition-all text-lg"
                            title="Completed"
                          >
                            ✅
                          </button>
                          
                          {/* In Progress */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(g, "in_progress")}
                            disabled={isBusy}
                            style={{
                              width: "40px",
                              height: "40px",
                              background: g.status === "in_progress" ? "rgba(59, 130, 246, 0.5)" : "rgba(59, 130, 246, 0.1)",
                              border: `2px solid ${g.status === "in_progress" ? "rgba(59, 130, 246, 1)" : "rgba(59, 130, 246, 0.3)"}`,
                              borderRadius: "50%",
                              transform: g.status === "in_progress" ? "scale(1.1)" : "scale(1)",
                              boxShadow: g.status === "in_progress" ? "0 0 12px rgba(59, 130, 246, 0.6)" : "none"
                            }}
                            className="flex items-center justify-center hover:scale-110 transition-all text-lg"
                            title="In Progress"
                          >
                            ⚙️
                          </button>
                          
                          {/* Blocked */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(g, "blocked")}
                            disabled={isBusy}
                            style={{
                              width: "40px",
                              height: "40px",
                              background: g.status === "blocked" ? "rgba(239, 68, 68, 0.5)" : "rgba(239, 68, 68, 0.1)",
                              border: `2px solid ${g.status === "blocked" ? "rgba(239, 68, 68, 1)" : "rgba(239, 68, 68, 0.3)"}`,
                              borderRadius: "50%",
                              transform: g.status === "blocked" ? "scale(1.1)" : "scale(1)",
                              boxShadow: g.status === "blocked" ? "0 0 12px rgba(239, 68, 68, 0.6)" : "none"
                            }}
                            className="flex items-center justify-center hover:scale-110 transition-all text-lg"
                            title="Blocked"
                          >
                            🚫
                          </button>
                          
                          {/* Postponed */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(g, "postponed")}
                            disabled={isBusy}
                            style={{
                              width: "40px",
                              height: "40px",
                              background: g.status === "postponed" ? "rgba(245, 158, 11, 0.5)" : "rgba(245, 158, 11, 0.1)",
                              border: `2px solid ${g.status === "postponed" ? "rgba(245, 158, 11, 1)" : "rgba(245, 158, 11, 0.3)"}`,
                              borderRadius: "50%",
                              transform: g.status === "postponed" ? "scale(1.1)" : "scale(1)",
                              boxShadow: g.status === "postponed" ? "0 0 12px rgba(245, 158, 11, 0.6)" : "none"
                            }}
                            className="flex items-center justify-center hover:scale-110 transition-all text-lg"
                            title="Postponed"
                          >
                            ⏸️
                          </button>
                        </div>
                      )}
                      
                      {/* Reschedule button - separate row, only if not completed */}
                      {reviewed && !locked && g.status !== "completed" && (
                        <button
                          type="button"
                          onClick={() => setRescheduleGoal(g)}
                          disabled={isBusy}
                          style={{
                            width: "56px",
                            height: "40px",
                            background: (g as any).rescheduled_to ? "rgba(168, 85, 247, 0.4)" : "rgba(168, 85, 247, 0.15)",
                            border: `2px solid ${(g as any).rescheduled_to ? "rgba(168, 85, 247, 0.8)" : "rgba(168, 85, 247, 0.3)"}`,
                            borderRadius: "20px",
                            position: "relative"
                          }}
                          className="flex items-center justify-center hover:scale-105 transition-all text-lg"
                          title={(g as any).rescheduled_to ? `Rescheduled to ${(g as any).rescheduled_to}` : "Reschedule"}
                        >
                          📅
                          {(g as any).rescheduled_to && (
                            <div 
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-500 border-2 border-white flex items-center justify-center text-xs font-bold"
                            >
                              ✓
                            </div>
                          )}
                        </button>
                      )}
                      
                      {/* Current status label */}
                      <div className="text-center">
                        <div 
                          className={["text-xs font-bold px-2 py-1 rounded-full border", statusPillClass(g.status)].join(" ")}
                          style={{ whiteSpace: "nowrap", fontSize: "0.65rem" }}
                        >
                          {statusLabel(g.status)}
                        </div>
                      </div>
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
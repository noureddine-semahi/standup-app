"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import {
  addDays,
  awardAwarenessPoints,
  awardClosurePoints,
  getPlanWithGoals,
  markGoalReviewed,
  unmarkGoalReviewed,
  toISODate,
  type DailyPlan,
  type Goal,
} from "@/lib/supabase/db";

function statusLabel(status: Goal["status"]) {
  switch (status) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "attempted":
      return "Attempted";
    case "postponed":
      return "Postponed";
    case "blocked":
      return "Blocked";
    default:
      return status;
  }
}

function statusPillClass(status: Goal["status"]) {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "in_progress":
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    case "blocked":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "postponed":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "attempted":
      return "bg-purple-500/15 text-purple-300 border-purple-500/30";
    case "not_started":
    default:
      return "bg-white/10 text-white/70 border-white/20";
  }
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

export default function TodayPage() {
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const tomorrowISO = useMemo(() => toISODate(addDays(new Date(), 1)), []);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyGoalId, setBusyGoalId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // prevent double-award from React strict mode/dev refreshes
  const awarenessAttemptedRef = useRef(false);
  const closureAttemptedRef = useRef(false);

  const locked = plan?.status === "locked";

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

  const pendingGoals = useMemo(
    () => sortedGoals.filter((g) => !(g as any).reviewed_at),
    [sortedGoals]
  );

  const allReviewed = totalCount > 0 && reviewedCount === totalCount;

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      const { plan: p, goals: gs } = await getPlanWithGoals(todayISO);
      setPlan(p);
      setGoals(gs);

      // ✅ Phase 1: Awareness points (once) if there are pending goals
      if (!awarenessAttemptedRef.current) {
        awarenessAttemptedRef.current = true;

        const hasPending = (gs ?? []).some((g) => !(g as any).reviewed_at);
        if (hasPending) {
          try {
            await awardAwarenessPoints(p.id, 5);
            setMsg((m) => m ?? "Awareness earned ✓");
            window.setTimeout(() => {
              setMsg((cur) => (cur === "Awareness earned ✓" ? null : cur));
            }, 1200);
          } catch {
            // ignore
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO]);

  async function toggleReviewed(goal: Goal) {
    if (locked) return;
    if (busyGoalId) return;

    setBusyGoalId(goal.id);
    setMsg(null);

    try {
      const isReviewed = !!(goal as any).reviewed_at;

      // optimistic UI
      setGoals((prev) =>
        prev.map((g) =>
          g.id === goal.id
            ? ({ ...g, reviewed_at: isReviewed ? null : new Date().toISOString() } as any)
            : g
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

  /**
   * ✅ Phase 2: Closure points + mark daily plan reviewed_at (via RPC)
   * This is the key that unlocks Tomorrow planning.
   */
  async function closeOutDay() {
    if (!plan?.id) return;
    if (locked) return;
    if (!allReviewed) {
      setMsg("Review all goals first to close the day.");
      return;
    }
    if (closing) return;

    setClosing(true);
    setMsg(null);

    try {
      const res = await awardClosurePoints(plan.id, 5);
      if (res?.awarded) {
        setMsg("Day closed ✅ Tomorrow unlocked.");
      } else {
        // already awarded or not eligible
        setMsg("Day already closed ✓");
      }
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Could not close the day.");
      await refresh();
    } finally {
      setClosing(false);
    }
  }

  // Optional: auto-attempt closure once when all reviewed (safe + non-blocking)
  useEffect(() => {
    if (!plan?.id) return;
    if (locked) return;
    if (!allReviewed) return;
    if (closureAttemptedRef.current) return;

    closureAttemptedRef.current = true;
    closeOutDay().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, locked, allReviewed]);

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
              Review each goal first. Pending goals stay dim until reviewed.
            </p>
            {plan?.status && (
              <div className="mt-2 text-sm text-white/60">
                Plan status: <b>{plan.status}</b> • Date: <b>{todayISO}</b>
              </div>
            )}
            {plan?.reviewed_at && (
              <div className="mt-1 text-sm text-white/60">
                Day closed at: <b>{new Date(plan.reviewed_at).toLocaleTimeString()}</b>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-sm text-white/70">
              Reviewed:{" "}
              <b>
                {reviewedCount}/{totalCount}
              </b>
            </div>

            <Link className="btn btn-primary" href="/standup/tomorrow">
              Go to Tomorrow →
            </Link>

            <div className="text-xs text-white/50">Tomorrow: {tomorrowISO}</div>
          </div>
        </div>

        {/* Summary */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-white/70">
              Pending: <b>{pendingGoals.length}</b>
            </div>
            <div className="h-4 w-px bg-white/10" />
            <div className="text-sm text-white/70">
              Tip: Pending goals have a <b>dashed</b> border.
            </div>
            {locked && (
              <>
                <div className="h-4 w-px bg-white/10" />
                <div className="text-sm text-white/70">
                  This plan is <b>locked</b> (read-only).
                </div>
              </>
            )}
          </div>

          {/* Close-out control */}
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

              {!allReviewed && (
                <div className="text-sm text-white/60">
                  Close out unlocks Tomorrow planning (sets today as reviewed).
                </div>
              )}

              {allReviewed && (
                <div className="text-sm text-white/60">
                  All reviewed — you can close out now.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Goals list */}
        <div className="mt-6 space-y-3">
          {sortedGoals.length === 0 && (
            <div className="text-white/70">
              No goals for today yet. (This usually means you didn’t set yesterday’s plan.)
            </div>
          )}

          {sortedGoals.map((g, idx) => {
            const reviewed = !!(g as any).reviewed_at;
            const p =
              typeof (g as any).priority === "number" && Number.isFinite((g as any).priority)
                ? ((g as any).priority as number)
                : null;

            const rowClass = reviewed
              ? "border-white/15 bg-white/5"
              : "border-white/10 bg-white/3 border-dashed opacity-90";

            return (
              <div
                key={g.id}
                className={["rounded-2xl border px-4 py-4 transition", rowClass].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-white/60 w-8">{idx + 1}.</div>

                      {p != null && (
                        <span
                          className={[
                            "rounded-full border px-2.5 py-1 text-xs font-semibold",
                            priorityBadgeClass(p),
                          ].join(" ")}
                          title="Priority"
                        >
                          P{p}
                        </span>
                      )}

                      <span
                        className={[
                          "rounded-full border px-2.5 py-1 text-xs font-semibold",
                          statusPillClass(g.status),
                        ].join(" ")}
                        title="Status"
                      >
                        {statusLabel(g.status)}
                      </span>

                      {!reviewed && <span className="text-xs text-white/50">Pending review</span>}
                      {reviewed && <span className="text-xs text-white/60">Reviewed ✓</span>}
                    </div>

                    <div className="mt-2 truncate text-white">{g.title}</div>

                    {g.details && <div className="mt-1 text-sm text-white/60">{g.details}</div>}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn"
                      disabled={locked || busyGoalId === g.id}
                      onClick={() => toggleReviewed(g)}
                      title={reviewed ? "Mark as pending" : "Mark as reviewed"}
                    >
                      {busyGoalId === g.id
                        ? "Saving…"
                        : reviewed
                        ? "Undo review"
                        : "Mark reviewed"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ghost" onClick={() => refresh()}>
            Refresh
          </button>

          <Link className="btn btn-ghost" href="/standup/tomorrow">
            Tomorrow goals →
          </Link>
        </div>

        {msg && <div className="mt-4 text-sm text-white/80">{msg}</div>}
      </div>
    </AuthGate>
  );
}

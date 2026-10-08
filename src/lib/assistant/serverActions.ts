import type { SupabaseClient } from "@supabase/supabase-js";
import {
  walkMaterializedChain,
  filterUnresolvedDescendants,
  findGoalDeleteBlockReason,
  GoalDeleteBlockedError,
} from "@/lib/supabase/db";

// Server-side mirrors of a handful of src/lib/supabase/db.ts functions, for
// the assistant's API route (src/app/api/assistant/route.ts) to call against
// a per-request, user-token-scoped Supabase client instead of the browser
// singleton every other function in db.ts is hard-wired to. Deliberately
// NOT a refactor of db.ts itself — that would touch ~80 functions used
// everywhere else in the app for one new caller. Each function here takes
// its client explicitly and reimplements just enough of the matching
// client-side behavior to stay consistent (same tables, same status/event
// logging), skipping the reschedule-materialization side effect that
// getOrCreatePlan normally triggers — that's idempotent and re-runs the
// next time the user actually opens that day's page, so deferring it here
// doesn't lose anything, just delays a call the real page load already makes.
//
// walkMaterializedChain/filterUnresolvedDescendants ARE imported directly
// from db.ts (not reimplemented here) -- they're pure functions with no
// Supabase client reference at all, so unlike every status/table query in
// this file they carry no client-context risk. Reusing them is how the
// reschedule-reconciliation DECISION logic stays in exactly one place
// (db.ts's own cancelOrphanedReschedules) while the I/O around it is still
// done against this file's own per-request client, same as everything else
// here.

type GoalStatus = "not_started" | "in_progress" | "completed" | "attempted" | "postponed" | "blocked" | "canceled";

const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  attempted: "Attempted",
  postponed: "Rescheduled",
  blocked: "Blocked",
  canceled: "Canceled",
};

async function logGoalEvent(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
  kind: "status_change" | "reviewed" | "rescheduled",
  label: string
) {
  try {
    await supabase.from("goal_notes").insert({ user_id: userId, goal_id: goalId, note: label, kind });
  } catch {
    // non-fatal, same as the client-side version
  }
}

async function getOrCreatePlanServer(supabase: SupabaseClient, userId: string, planDateISO: string) {
  const { data: existing, error: selErr } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("plan_date", planDateISO)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing;

  const { data: created, error: insErr } = await supabase
    .from("daily_plans")
    .insert({ user_id: userId, plan_date: planDateISO, status: "draft" })
    .select("*")
    .single();
  if (insErr) throw insErr;
  return created;
}

export type AddGoalParams = {
  title: string;
  details?: string | null;
  priority?: number;
  dateISO?: string | null; // omitted -> Backlog
};

export async function addGoalAction(supabase: SupabaseClient, userId: string, params: AddGoalParams) {
  const title = params.title.trim();
  if (!title) throw new Error("A goal needs a title.");
  const priority = typeof params.priority === "number" && params.priority >= 1 && params.priority <= 5 ? params.priority : 3;

  if (!params.dateISO) {
    const { data, error } = await supabase
      .from("goal_backlog")
      .insert({ user_id: userId, title, details: params.details?.trim() || null, priority })
      .select()
      .single();
    if (error) throw error;
    return { kind: "backlog" as const, goal: data };
  }

  const plan = await getOrCreatePlanServer(supabase, userId, params.dateISO);

  const { data: existingGoals, error: existingErr } = await supabase
    .from("goals")
    .select("sort_order")
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (existingErr) throw existingErr;
  const nextSortOrder = existingGoals && existingGoals.length > 0 ? existingGoals[0].sort_order + 1 : 0;

  const { data: created, error: insertErr } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      title,
      details: params.details?.trim() || null,
      status: "not_started",
      sort_order: nextSortOrder,
      priority,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;

  if (priority === 1) {
    await supabase.from("goals").update({ priority: 2 }).eq("plan_id", plan.id).eq("priority", 1).neq("id", created.id);
  }

  return { kind: "scheduled" as const, goal: created, dateISO: params.dateISO };
}

/**
 * Server-side mirror of db.ts's cancelOrphanedReschedules() -- same two
 * queries, same decision logic (reused directly via the two pure
 * imports, not reimplemented), just run against this file's own
 * per-request client instead of the browser singleton db.ts is
 * hard-wired to. See updateGoalStatusAction below for why this matters:
 * without it, an Assistant-triggered Completed/Canceled on a previously-
 * rescheduled Task would leave its materialized future continuation(s)
 * active forever, the same bug the canonical db.ts path now closes for
 * every other caller.
 */
async function cancelOrphanedReschedulesAction(supabase: SupabaseClient, userId: string, sourceGoalId: string) {
  const { data: rows, error: lineageErr } = await supabase
    .from("goal_reschedules")
    .select("from_goal_id, materialized_goal_id, materialized_at")
    .eq("materialized", true)
    .not("materialized_goal_id", "is", null)
    .order("materialized_at", { ascending: true });
  if (lineageErr) throw lineageErr;

  const descendantIds = walkMaterializedChain(rows ?? [], sourceGoalId);
  if (descendantIds.length === 0) return;

  const { data: descendantRows, error: statusErr } = await supabase
    .from("goals")
    .select("id, status")
    .in("id", descendantIds);
  if (statusErr) throw statusErr;

  const stillUnresolved = filterUnresolvedDescendants(descendantRows ?? []);

  for (const d of stillUnresolved) {
    const { error: cancelErr } = await supabase.from("goals").update({ status: "canceled" }).eq("id", d.id);
    if (cancelErr) throw cancelErr;
    await logGoalEvent(
      supabase,
      userId,
      d.id,
      "status_change",
      "Automatically canceled — the rescheduled Task it continues was resolved"
    );
  }
}

export async function updateGoalStatusAction(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
  status: GoalStatus,
  blockedReason?: string
) {
  if (status === "blocked" && !(blockedReason ?? "").trim()) {
    throw new Error("Marking a goal Blocked needs a reason.");
  }

  const { data: goal, error: goalErr } = await supabase
    .from("goals")
    .select("id, plan_id, reviewed_at, title")
    .eq("id", goalId)
    .single();
  if (goalErr) throw goalErr;

  // Mirrors selectQuickAction's review side effect in Today's page: the
  // first status-setting action of the day also marks the goal reviewed
  // and (once, per plan) awards the awareness bonus — skipping this would
  // leave the goal stuck "pending review" and block closing the day even
  // though the assistant just handled it.
  if (!goal.reviewed_at) {
    const { error: reviewErr } = await supabase
      .from("goals")
      .update({ reviewed_at: new Date().toISOString() })
      .eq("id", goalId);
    if (reviewErr) throw reviewErr;
    await logGoalEvent(supabase, userId, goalId, "reviewed", "Marked as reviewed");

    const { data: plan } = await supabase
      .from("daily_plans")
      .select("id, reviewed_at, awareness_awarded")
      .eq("id", goal.plan_id)
      .maybeSingle();
    if (plan && !plan.reviewed_at && !plan.awareness_awarded) {
      try {
        await supabase.rpc("award_awareness_points", { p_plan_id: plan.id, p_points: 5 });
      } catch {
        // Non-fatal — same as the client-side flow, retried on the next review action.
      }
    }
  }

  const { error: statusErr } = await supabase.from("goals").update({ status }).eq("id", goalId);
  if (statusErr) throw statusErr;
  await logGoalEvent(supabase, userId, goalId, "status_change", `Status changed to ${GOAL_STATUS_LABELS[status] ?? status}`);

  if (status === "blocked") {
    const trimmed = (blockedReason ?? "").trim();
    await supabase.from("goal_notes").insert({ user_id: userId, goal_id: goalId, note: trimmed, kind: "note" });
  }

  // Same canonical reconciliation db.ts's updateGoalStatus() now runs for
  // every other caller -- see cancelOrphanedReschedulesAction above. Wrapped
  // so a reconciliation failure can never change this action's existing
  // success/error behavior or response shape; the primary status update
  // above has already committed by this point regardless.
  if (status === "completed" || status === "canceled") {
    try {
      await cancelOrphanedReschedulesAction(supabase, userId, goalId);
    } catch (e) {
      console.error("Failed to reconcile rescheduled continuations", e);
    }
  }

  return { goalId, title: goal.title as string, status };
}

export async function rescheduleGoalAction(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
  toDateISO: string,
  fromDateISO: string,
  reason?: string
) {
  const { data: goal, error: goalErr } = await supabase
    .from("goals")
    .select("id, title, details, priority")
    .eq("id", goalId)
    .single();
  if (goalErr) throw goalErr;

  const { error: statusErr } = await supabase.from("goals").update({ status: "postponed" }).eq("id", goalId);
  if (statusErr) throw statusErr;

  const trimmedReason = (reason ?? "").trim();

  const { error: logErr } = await supabase.from("goal_reschedules").insert({
    user_id: userId,
    from_goal_id: goalId,
    to_goal_id: goalId, // legacy keep, matches rescheduleGoalToDate
    from_date: fromDateISO,
    to_date: toDateISO,
    reason: trimmedReason || null,
    materialized: false,
    materialized_goal_id: null,
    snapshot_title: goal.title,
    snapshot_details: goal.details ?? null,
    snapshot_priority: typeof goal.priority === "number" ? goal.priority : 3,
  });
  if (logErr) throw logErr;

  await logGoalEvent(
    supabase,
    userId,
    goalId,
    "rescheduled",
    `Rescheduled to ${toDateISO}${trimmedReason ? ` — "${trimmedReason}"` : ""}`
  );

  return { goalId, title: goal.title as string, toDateISO };
}

/**
 * Server-side mirror of db.ts's deleteGoal() own pre-delete guard --
 * same findGoalDeleteBlockReason decision function (imported, not
 * reimplemented, same reasoning as walkMaterializedChain/
 * filterUnresolvedDescendants above), just run against this file's own
 * per-request client. Both of this file's hard-delete actions
 * (moveGoalToBacklogAction, removeGoalAction) call this before their
 * `.delete()` -- without it, either would bypass db.ts's protection
 * entirely, since neither goes through deleteGoal() itself.
 */
async function assertGoalDeletable(supabase: SupabaseClient, goalId: string) {
  const [
    { data: rescheduleAsSource, error: rsErr },
    { data: rescheduleAsTarget, error: rtErr },
    { data: assignmentAsSource, error: asErr },
    { data: assignmentAsRecipient, error: arErr },
  ] = await Promise.all([
    supabase.from("goal_reschedules").select("id").eq("from_goal_id", goalId).limit(1),
    supabase.from("goal_reschedules").select("id").eq("materialized_goal_id", goalId).limit(1),
    supabase.from("goal_assignments").select("id").eq("assigner_goal_id", goalId).limit(1),
    supabase.from("goal_assignments").select("id").eq("recipient_goal_id", goalId).limit(1),
  ]);
  if (rsErr) throw rsErr;
  if (rtErr) throw rtErr;
  if (asErr) throw asErr;
  if (arErr) throw arErr;

  const reason = findGoalDeleteBlockReason({
    isRescheduleSource: (rescheduleAsSource ?? []).length > 0,
    isRescheduleTarget: (rescheduleAsTarget ?? []).length > 0,
    isAssignmentSource: (assignmentAsSource ?? []).length > 0,
    isAssignmentRecipient: (assignmentAsRecipient ?? []).length > 0,
  });
  if (reason) throw new GoalDeleteBlockedError(reason);
}

export async function moveGoalToBacklogAction(supabase: SupabaseClient, userId: string, goalId: string) {
  const { data: goal, error: goalErr } = await supabase
    .from("goals")
    .select("id, title, details, priority")
    .eq("id", goalId)
    .single();
  if (goalErr) throw goalErr;

  await assertGoalDeletable(supabase, goalId);

  const { data: created, error: insertErr } = await supabase
    .from("goal_backlog")
    .insert({
      user_id: userId,
      title: goal.title,
      details: goal.details ?? null,
      priority: typeof goal.priority === "number" ? goal.priority : 3,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;

  const { error: deleteErr } = await supabase.from("goals").delete().eq("id", goalId);
  if (deleteErr) throw deleteErr;

  return { title: goal.title as string, backlogGoal: created };
}

/**
 * Mirrors deleteGoal() in db.ts exactly — a plain row delete, now
 * guarded by the same assertGoalDeletable() check above. Tomorrow's own
 * removeGoal() uses this same uniform delete-outright semantics for
 * every position now too (no slot is structurally protected under the
 * locked 3-10 commitment model), so this was never a special case to
 * begin with. If this leaves a plan under 3 goals, the next time that
 * plan's page loads, compactForUI() pads it with blank entry rows (a
 * display/entry convenience only); submission still requires 3+ real
 * Commitments. Notes/checklist/attachment rows cascade-delete with the
 * goal; any attachment's underlying storage file is not cleaned up here,
 * same known limitation as deleteGoal() itself.
 */
export async function removeGoalAction(supabase: SupabaseClient, _userId: string, goalId: string) {
  const { data: goal, error: goalErr } = await supabase.from("goals").select("id, title").eq("id", goalId).single();
  if (goalErr) throw goalErr;

  await assertGoalDeletable(supabase, goalId);

  const { error: deleteErr } = await supabase.from("goals").delete().eq("id", goalId);
  if (deleteErr) throw deleteErr;

  return { title: goal.title as string };
}

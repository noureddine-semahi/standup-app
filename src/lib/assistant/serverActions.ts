import type { SupabaseClient } from "@supabase/supabase-js";

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

export async function moveGoalToBacklogAction(supabase: SupabaseClient, userId: string, goalId: string) {
  const { data: goal, error: goalErr } = await supabase
    .from("goals")
    .select("id, title, details, priority")
    .eq("id", goalId)
    .single();
  if (goalErr) throw goalErr;

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
 * Mirrors deleteGoal() in db.ts exactly — a plain row delete, no special
 * handling for a goal in one of Plan Tomorrow's first-3 "always kept" slots
 * (that blank-instead-of-delete behavior in Tomorrow's own removeGoal() is
 * purely a live-typing safeguard so retyping into the same slot doesn't
 * lose the old goal's notes — it doesn't apply here, there's no "retyping"
 * happening). If this leaves a plan under 3 goals, the next time that
 * plan's page loads, compactForUI() pads it back to 3 automatically.
 * Notes/checklist/attachment rows cascade-delete with the goal; any
 * attachment's underlying storage file is not cleaned up here, same
 * known limitation as deleteGoal() itself.
 */
export async function removeGoalAction(supabase: SupabaseClient, _userId: string, goalId: string) {
  const { data: goal, error: goalErr } = await supabase.from("goals").select("id, title").eq("id", goalId).single();
  if (goalErr) throw goalErr;

  const { error: deleteErr } = await supabase.from("goals").delete().eq("id", goalId);
  if (deleteErr) throw deleteErr;

  return { title: goal.title as string };
}

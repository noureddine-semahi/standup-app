import { supabase } from "@/lib/supabase/client";

export type PlanStatus = "draft" | "submitted" | "locked";
export type GoalStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "attempted"
  | "postponed"
  | "blocked";

export type DailyPlan = {
  id: string;
  user_id: string;
  plan_date: string; // YYYY-MM-DD
  status: PlanStatus;
  submitted_at: string | null;
  reviewed_at: string | null;

  // ✅ two-phase scoring flags
  awareness_awarded?: boolean;
  closure_awarded?: boolean;
  awareness_points?: number;
  closure_points?: number;
};

export type Profile = {
  id: string;
  display_name: string | null;
  points: number;
};

export type Goal = {
  id: string;
  user_id: string;
  plan_id: string;
  title: string;
  details: string | null;
  status: GoalStatus;
  sort_order: number;

  priority?: number;

  // ✅ per-goal review state
  reviewed_at?: string | null;
};

export function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

export async function getOrCreateProfile() {
  const userId = await getCurrentUserId();

  const { data: p, error: selErr } = await supabase
    .from("profiles")
    .select("id, display_name, points")
    .eq("id", userId)
    .maybeSingle();

  if (selErr) throw selErr;
  if (p) return p as Profile;

  const { data: created, error: insErr } = await supabase
    .from("profiles")
    .insert({ id: userId, display_name: null, points: 0 })
    .select("id, display_name, points")
    .single();

  if (insErr) throw insErr;
  return created as Profile;
}

/**
 * ✅ Materialize rescheduled goals for this plan date
 * Server-side RPC ensures no duplicates and no missing future inserts.
 */
async function materializeReschedules(planId: string, planDateISO: string) {
  const { data, error } = await supabase.rpc("materialize_reschedules", {
    p_plan_id: planId,
    p_plan_date: planDateISO,
  });
  if (error) throw error;
  return data as number; // count inserted
}

export async function getOrCreatePlan(planDateISO: string) {
  const userId = await getCurrentUserId();

  const { data: existing, error: selErr } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("plan_date", planDateISO)
    .maybeSingle();

  if (selErr) throw selErr;

  if (existing) {
    // ✅ When a plan is opened, materialize any reschedules targeting this date
    await materializeReschedules(existing.id, planDateISO);
    return existing as DailyPlan;
  }

  const { data: created, error: insErr } = await supabase
    .from("daily_plans")
    .insert({ user_id: userId, plan_date: planDateISO, status: "draft" })
    .select("*")
    .single();

  if (insErr) throw insErr;

  // ✅ Materialize reschedules for brand new plan too
  await materializeReschedules(created.id, planDateISO);

  return created as DailyPlan;
}

export async function getPlanWithGoals(planDateISO: string) {
  const plan = await getOrCreatePlan(planDateISO);

  const { data: goals, error } = await supabase
    .from("goals")
    .select("*")
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return { plan, goals: (goals ?? []) as Goal[] };
}

export async function upsertGoals(
  planId: string,
  goals: Array<Partial<Goal> & { title: string; sort_order: number }>
) {
  const userId = await getCurrentUserId();

  const normalized = goals
    .map((g, idx) => ({
      ...g,
      sort_order: Number.isFinite(g.sort_order) ? g.sort_order : idx,
      title: (g.title ?? "").trim(),
    }))
    .filter((g) => g.title.length > 0);

  const toUpdate = normalized.filter((g) => !!g.id);
  const toInsert = normalized.filter((g) => !g.id);

  if (toUpdate.length > 0) {
    const updateRows = toUpdate.map((g) => {
      const row: any = {
        id: g.id,
        user_id: userId,
        plan_id: planId,
        title: g.title!,
        details: g.details ?? null,
        status: g.status ?? "not_started",
        sort_order: Number.isFinite(g.sort_order) ? g.sort_order : 0,
      };
      if (typeof (g as any).priority === "number")
        row.priority = (g as any).priority;
      return row;
    });

    const { error: updateErr } = await supabase
      .from("goals")
      .upsert(updateRows, { onConflict: "id" });

    if (updateErr) throw updateErr;
  }

  if (toInsert.length > 0) {
    const insertRows = toInsert.map((g) => {
      const row: any = {
        user_id: userId,
        plan_id: planId,
        title: g.title!,
        details: g.details ?? null,
        status: g.status ?? "not_started",
        sort_order: Number.isFinite(g.sort_order) ? g.sort_order : 0,
      };
      if (typeof (g as any).priority === "number")
        row.priority = (g as any).priority;
      return row;
    });

    const { error: insertErr } = await supabase.from("goals").insert(insertRows);
    if (insertErr) throw insertErr;
  }

  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Goal[];
}

export async function deleteGoal(goalId: string) {
  const { error } = await supabase.from("goals").delete().eq("id", goalId);
  if (error) throw error;
}

export async function submitPlan(planId: string) {
  const { data: goals, error: gErr } = await supabase
    .from("goals")
    .select("id")
    .eq("plan_id", planId);

  if (gErr) throw gErr;
  const count = (goals ?? []).length;
  if (count < 3)
    throw new Error("You must set at least 3 goals before submitting.");

  const { data, error } = await supabase
    .from("daily_plans")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", planId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DailyPlan;
}

export async function markPlanReviewed(planId: string) {
  const { data, error } = await supabase
    .from("daily_plans")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", planId)
    .select("*")
    .single();

  if (error) throw error;
  return data as DailyPlan;
}

export async function addGoalNote(goalId: string, note: string) {
  const userId = await getCurrentUserId();
  const trimmed = note.trim();
  if (!trimmed) return;

  const { error } = await supabase.from("goal_notes").insert({
    user_id: userId,
    goal_id: goalId,
    note: trimmed,
  });

  if (error) throw error;
}

export async function updateGoalStatus(goalId: string, status: GoalStatus) {
  const { error } = await supabase
    .from("goals")
    .update({ status })
    .eq("id", goalId);
  if (error) throw error;
}

export async function markGoalReviewed(goalId: string) {
  const { error } = await supabase
    .from("goals")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", goalId);
  if (error) throw error;
}

export async function unmarkGoalReviewed(goalId: string) {
  const { error } = await supabase
    .from("goals")
    .update({ reviewed_at: null })
    .eq("id", goalId);
  if (error) throw error;
}

/**
 * ✅ Phase 1 points: awareness (open today + pending exists)
 */
export async function awardAwarenessPoints(planId: string, points = 5) {
  await getOrCreateProfile();
  const { data, error } = await supabase.rpc("award_awareness_points", {
    p_plan_id: planId,
    p_points: points,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { awarded: boolean; new_points: number };
}

/**
 * ✅ Phase 2 points: closure (all engaged are reviewed)
 * NOTE: Supabase function now also sets daily_plans.reviewed_at = now()
 */
export async function awardClosurePoints(planId: string, points = 5) {
  await getOrCreateProfile();
  const { data, error } = await supabase.rpc("award_closure_points", {
    p_plan_id: planId,
    p_points: points,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { awarded: boolean; new_points: number };
}

export async function getPoints() {
  const p = await getOrCreateProfile();
  return p.points ?? 0;
}

/**
 * ✅ NEW: check a specific day’s plan reviewed_at
 */
export async function isDayReviewed(planDateISO: string) {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("daily_plans")
    .select("id, reviewed_at")
    .eq("user_id", userId)
    .eq("plan_date", planDateISO)
    .maybeSingle();

  if (error) throw error;

  // If no plan existed that day, allow (no gating)
  if (!data) return true;

  return !!data.reviewed_at;
}

/**
 * ✅ UPDATED Gate helper:
 * - If referenceDateISO is provided (e.g. tomorrowISO), checks the day BEFORE that date.
 *   Example: referenceDateISO = tomorrowISO => checks TODAY (correct for Tomorrow page gate)
 * - If omitted, behaves like before: checks yesterday relative to now.
 */
export async function isYesterdayReviewed(referenceDateISO?: string) {
  const ref = referenceDateISO
    ? new Date(referenceDateISO + "T00:00:00")
    : new Date();

  const prevDayISO = toISODate(addDays(ref, -1));
  return isDayReviewed(prevDayISO);
}

/**
 * ✅ RESCHEDULE:
 * Store reschedule intent now; materialize later (or immediately if tomorrow)
 */
export async function rescheduleGoalToDate(params: {
  goal: Goal;
  toDateISO: string;
  reason?: string;
}) {
  const userId = await getCurrentUserId();

  // 1) mark old goal postponed
  await updateGoalStatus(params.goal.id, "postponed");

  // 2) store intent (snapshot)
  const { error: logErr } = await supabase.from("goal_reschedules").insert({
    user_id: userId,
    from_goal_id: params.goal.id,
    to_goal_id: params.goal.id, // legacy field; keep populated
    from_date: toISODate(new Date()),
    to_date: params.toDateISO,
    reason: (params.reason ?? "").trim() || null,

    materialized: false,
    materialized_goal_id: null,
    snapshot_title: params.goal.title,
    snapshot_details: params.goal.details ?? null,
    snapshot_priority:
      typeof (params.goal as any).priority === "number"
        ? (params.goal as any).priority
        : 3,
  });

  if (logErr) throw logErr;

  // 3) If rescheduled to TOMORROW, ensure it appears immediately by opening tomorrow plan
  const tomorrowISO = toISODate(addDays(new Date(), 1));
  if (params.toDateISO === tomorrowISO) {
    await getOrCreatePlan(tomorrowISO); // will materialize via RPC
  }
}

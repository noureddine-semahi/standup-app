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

  // Optional personal info — never required, kept for possible future
  // personalization (e.g. goal suggestions tuned to age/location).
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null; // YYYY-MM-DD
  address?: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
};

export type GoalNote = {
  id: string;
  goal_id: string;
  user_id: string;
  note: string;
  created_at: string;
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
  reviewed_at?: string | null;

  // ✅ NEW: Timestamps
  created_at: string;
  updated_at: string;

  // Reschedule metadata attached client-side (not raw DB columns)
  rescheduled_to?: string | null;
  rescheduled_from_date?: string | null;
  reschedule_reason?: string | null;
  previous_actions?: GoalNote[];
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

// Display-only: "YYYY-MM-DD" -> "MM/DD/YYYY". Pure string manipulation
// (no Date parsing) so it can't shift a day across timezones. The
// underlying ISO string is still what's used for routing/keys/comparisons.
export function formatDateDisplay(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-");
  if (!yyyy || !mm || !dd) return isoDate;
  return `${mm}/${dd}/${yyyy}`;
}

// Display-only: full timestamp as "MM/DD/YYYY, h:mm AM/PM" regardless of
// system locale, so activity-log timestamps stay consistent across machines.
export function formatDateTimeDisplay(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

export async function getOrCreateProfile() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!userData.user) throw new Error("Not authenticated");
  const userId = userData.user.id;

  const { data: p, error: selErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (selErr) throw selErr;
  if (p) return p as Profile;

  // Seed display_name from the signup-time auth metadata (options.data.display_name)
  // the first time a profile row is created for this user — signup itself has no
  // session to write to `profiles` with when email confirmation is required, so
  // this is where that value actually lands.
  const metaDisplayName =
    typeof userData.user.user_metadata?.display_name === "string"
      ? userData.user.user_metadata.display_name
      : null;

  const { data: created, error: insErr } = await supabase
    .from("profiles")
    .insert({ id: userId, display_name: metaDisplayName, points: 0 })
    .select("*")
    .single();

  if (insErr) throw insErr;
  return created as Profile;
}

/**
 * Wipes the current user's data and signs them out. This is NOT a true auth
 * account deletion — the client only has the public/anon key, and removing
 * the actual login requires the service-role key (server-side only), which
 * this app doesn't have configured. What this does instead:
 *  1) Deletes every goal (the only table the client has DELETE rights on per
 *     RLS) — cascades to goal_notes and goal_reschedules.from_goal_id rows.
 *  2) Best-effort deletes any leftover goal_reschedules rows (some can
 *     survive step 1 via "on delete set null" on materialized_goal_id rather
 *     than cascade) — not fatal if RLS denies it, since there's no
 *     client-facing delete policy for that table.
 *  3) Resets every daily_plan back to a blank draft, since rows can't be
 *     deleted outright (no delete policy) — zeroes out everything that makes
 *     a plan meaningful instead.
 *  4) Resets the profile (points, display name).
 *  5) Signs out.
 */
export async function deleteAccount() {
  const userId = await getCurrentUserId();

  const { error: goalsErr } = await supabase.from("goals").delete().eq("user_id", userId);
  if (goalsErr) throw goalsErr;

  try {
    await supabase.from("goal_reschedules").delete().eq("user_id", userId);
  } catch {
    // No client-facing delete policy is expected for this table — ignore.
  }

  const { error: plansErr } = await supabase
    .from("daily_plans")
    .update({
      status: "draft",
      submitted_at: null,
      reviewed_at: null,
      awareness_awarded: false,
      closure_awarded: false,
      awareness_points: 0,
      closure_points: 0,
    })
    .eq("user_id", userId);
  if (plansErr) throw plansErr;

  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ points: 0, display_name: null })
    .eq("id", userId);
  if (profileErr) throw profileErr;

  await supabase.auth.signOut();
}

// Same-tab guard against React Strict Mode's dev double-invocation (and any
// other accidental re-entrant call) racing to materialize the same plan's
// reschedules at once. Set synchronously before the first await, so the
// second of two near-simultaneous calls always sees it.
const materializeInFlight = new Set<string>();

/**
 * Materialize rescheduled goals for this plan date: finds every
 * goal_reschedules row targeting this date that hasn't been materialized
 * yet, inserts the corresponding goal into this plan, and records a new
 * "materialized" goal_reschedules row pointing at it.
 *
 * Implemented directly against the `goals`/`goal_reschedules` tables
 * (rather than the `materialize_reschedules` RPC) because the live RPC was
 * confirmed via direct DB inspection to be a no-op: the reschedule row and
 * the target day's plan both existed, but no goal was ever inserted and
 * `materialized` stayed false.
 *
 * The original pending row is never updated or deleted — both were tried
 * and confirmed broken live: UPDATE fails on every call because of a DB
 * trigger that references a column this table doesn't have ("record
 * \"new\" has no field \"updated_at\""), and DELETE is silently a no-op
 * (0 rows affected, no error), which looks like an RLS policy that permits
 * SELECT/INSERT but not DELETE. So instead of flagging the original row,
 * each pending reschedule is checked against a fresh INSERT-only
 * "materialized" counterpart before a goal is created for it, and a new
 * counterpart row is inserted once it is. This can't be made fully atomic
 * against true cross-tab/cross-session concurrency without DB-side support,
 * but combined with the in-flight guard above it covers the realistic case
 * (a single tab's duplicate effect invocation).
 */
async function materializeReschedules(planId: string, planDateISO: string) {
  const lockKey = `${planId}:${planDateISO}`;
  if (materializeInFlight.has(lockKey)) return 0;
  materializeInFlight.add(lockKey);

  try {
    const userId = await getCurrentUserId();

    const { data: pending, error: selErr } = await supabase
      .from("goal_reschedules")
      .select("*")
      .eq("user_id", userId)
      .eq("to_date", planDateISO)
      .eq("materialized", false);

    if (selErr) throw selErr;
    if (!pending || pending.length === 0) return 0;

    const { data: existingGoals, error: existingErr } = await supabase
      .from("goals")
      .select("sort_order")
      .eq("plan_id", planId)
      .order("sort_order", { ascending: false })
      .limit(1);

    if (existingErr) throw existingErr;
    let nextSortOrder = existingGoals && existingGoals.length > 0 ? existingGoals[0].sort_order + 1 : 0;

    let materializedCount = 0;
    for (const item of pending) {
      const { data: already, error: alreadyErr } = await supabase
        .from("goal_reschedules")
        .select("id")
        .eq("from_goal_id", item.from_goal_id)
        .eq("to_date", planDateISO)
        .eq("materialized", true)
        .limit(1);

      if (alreadyErr) throw alreadyErr;
      if (already && already.length > 0) continue; // already materialized by an earlier call

      const { data: inserted, error: insErr } = await supabase
        .from("goals")
        .insert({
          user_id: userId,
          plan_id: planId,
          title: item.snapshot_title,
          details: item.snapshot_details,
          status: "not_started",
          sort_order: nextSortOrder++,
          priority: typeof item.snapshot_priority === "number" ? item.snapshot_priority : 3,
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      // Carry the original goal's notes forward onto the new row — the goal
      // gets a new id on each reschedule, so without this every note written
      // before a reschedule would become permanently orphaned/invisible.
      const { data: priorNotes, error: notesSelErr } = await supabase
        .from("goal_notes")
        .select("note, created_at")
        .eq("goal_id", item.from_goal_id);

      if (notesSelErr) throw notesSelErr;

      if (priorNotes && priorNotes.length > 0) {
        const { error: notesInsErr } = await supabase.from("goal_notes").insert(
          priorNotes.map((n) => ({
            user_id: userId,
            goal_id: inserted.id,
            note: n.note,
            created_at: n.created_at,
          }))
        );
        if (notesInsErr) throw notesInsErr;
      }

      // Insert (never update/delete) a "materialized" counterpart row so the
      // target day's goal can show its "Rescheduled from ..." origin — the
      // UI looks this up by materialized_goal_id — and so the check above
      // recognizes this reschedule as done on the next call.
      const { error: markErr } = await supabase.from("goal_reschedules").insert({
        user_id: item.user_id,
        from_goal_id: item.from_goal_id,
        to_goal_id: item.to_goal_id,
        from_date: item.from_date,
        to_date: item.to_date,
        reason: item.reason,
        materialized: true,
        materialized_goal_id: inserted.id,
        materialized_at: new Date().toISOString(),
        snapshot_title: item.snapshot_title,
        snapshot_details: item.snapshot_details,
        snapshot_priority: item.snapshot_priority,
      });

      if (markErr) throw markErr;

      materializedCount++;
    }

    return materializedCount;
  } finally {
    materializeInFlight.delete(lockKey);
  }
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
    await materializeReschedules(existing.id, planDateISO);
    return existing as DailyPlan;
  }

  const { data: created, error: insErr } = await supabase
    .from("daily_plans")
    .insert({ user_id: userId, plan_date: planDateISO, status: "draft" })
    .select("*")
    .single();

  if (insErr) {
    // Another concurrent call (e.g. a duplicate effect run) already created this
    // plan between our SELECT and INSERT — fetch the row it created instead of failing.
    if (insErr.code === "23505") {
      const { data: winner, error: refetchErr } = await supabase
        .from("daily_plans")
        .select("*")
        .eq("user_id", userId)
        .eq("plan_date", planDateISO)
        .single();
      if (refetchErr) throw refetchErr;
      await materializeReschedules(winner.id, planDateISO);
      return winner as DailyPlan;
    }
    throw insErr;
  }

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

/**
 * ✅ Upsert goals with priority support
 */
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
  const { error } = await supabase.from("goals").update({ status }).eq("id", goalId);
  if (error) throw error;
}

/**
 * Demotes every other priority-1 goal in the plan to priority 2, so at most
 * one goal in a plan is ever P1.
 */
export async function enforceSingleP1(planId: string, keepGoalId: string) {
  const { error } = await supabase
    .from("goals")
    .update({ priority: 2 })
    .eq("plan_id", planId)
    .eq("priority", 1)
    .neq("id", keepGoalId);
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
 * ✅ Phase 1 points: awareness
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
 * ✅ Phase 2 points: closure (sets daily_plans.reviewed_at)
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

export type PointsHistoryEntry = {
  planDate: string;
  awarenessAwarded: boolean;
  awarenessPoints: number;
  closureAwarded: boolean;
  closurePoints: number;
  reviewedAt: string | null;
};

/**
 * Recent days that earned at least one points bonus (awareness and/or
 * closure), newest first. The per-day amounts already live on daily_plans —
 * they're just never read back anywhere else in the app.
 */
export async function getPointsHistory(limit = 30): Promise<PointsHistoryEntry[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("daily_plans")
    .select("plan_date, awareness_awarded, awareness_points, closure_awarded, closure_points, reviewed_at")
    .eq("user_id", userId)
    .or("awareness_awarded.eq.true,closure_awarded.eq.true")
    .order("plan_date", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    planDate: row.plan_date as string,
    awarenessAwarded: !!row.awareness_awarded,
    awarenessPoints: row.awareness_points ?? 0,
    closureAwarded: !!row.closure_awarded,
    closurePoints: row.closure_points ?? 0,
    reviewedAt: row.reviewed_at as string | null,
  }));
}

export type DayActivity = {
  date: string; // YYYY-MM-DD
  hasPlan: boolean;
  checkedIn: boolean; // day was reviewed/closed
  goalsTotal: number;
  goalsCompleted: number;
};

/**
 * Every day in [startISO, endISO] (inclusive), including days with no plan
 * at all — a "missed" day is just as meaningful as a "checked in" one here.
 */
export async function getDailyActivity(startISO: string, endISO: string): Promise<DayActivity[]> {
  const userId = await getCurrentUserId();

  const { data: plans, error: plansErr } = await supabase
    .from("daily_plans")
    .select("id, plan_date, reviewed_at")
    .eq("user_id", userId)
    .gte("plan_date", startISO)
    .lte("plan_date", endISO);

  if (plansErr) throw plansErr;

  const planIds = (plans ?? []).map((p) => p.id);
  const goalsByPlan: Record<string, { total: number; completed: number }> = {};

  if (planIds.length > 0) {
    const { data: goals, error: goalsErr } = await supabase
      .from("goals")
      .select("plan_id, status")
      .in("plan_id", planIds);

    if (goalsErr) throw goalsErr;

    (goals ?? []).forEach((g) => {
      const entry = goalsByPlan[g.plan_id] ?? { total: 0, completed: 0 };
      entry.total += 1;
      if (g.status === "completed") entry.completed += 1;
      goalsByPlan[g.plan_id] = entry;
    });
  }

  const byDate: Record<string, DayActivity> = {};
  (plans ?? []).forEach((p) => {
    const g = goalsByPlan[p.id] ?? { total: 0, completed: 0 };
    byDate[p.plan_date] = {
      date: p.plan_date,
      hasPlan: true,
      checkedIn: !!p.reviewed_at,
      goalsTotal: g.total,
      goalsCompleted: g.completed,
    };
  });

  const result: DayActivity[] = [];
  let cursor = new Date(`${startISO}T00:00:00`);
  const end = new Date(`${endISO}T00:00:00`);
  while (cursor <= end) {
    const iso = toISODate(cursor);
    result.push(
      byDate[iso] ?? { date: iso, hasPlan: false, checkedIn: false, goalsTotal: 0, goalsCompleted: 0 }
    );
    cursor = addDays(cursor, 1);
  }

  return result;
}

export async function updateDisplayName(name: string) {
  const userId = await getCurrentUserId();
  const trimmed = name.trim();

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: trimmed || null })
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data as Profile;
}

export type PersonalInfo = {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD, or "" to clear
  address: string;
  phoneNumber: string;
};

/**
 * All fields optional — an empty string clears that field to null rather
 * than being rejected, since nothing here is required.
 */
export async function updatePersonalInfo(info: PersonalInfo) {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("profiles")
    .update({
      first_name: info.firstName.trim() || null,
      last_name: info.lastName.trim() || null,
      date_of_birth: info.dateOfBirth || null,
      address: info.address.trim() || null,
      phone_number: info.phoneNumber.trim() || null,
    })
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data as Profile;
}

const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Uploads to the "avatars" storage bucket under "<user_id>/<filename>" (the
 * bucket's RLS policies key off that path shape — see
 * supabase/migrations/20260102000100_profile_personal_info.sql) and saves
 * the resulting public URL onto the profile.
 */
export async function uploadAvatar(file: File) {
  const userId = await getCurrentUserId();

  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error("Image must be under 5MB.");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadErr) throw uploadErr;

  const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path);

  const { data, error: updateErr } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrlData.publicUrl })
    .eq("id", userId)
    .select("*")
    .single();

  if (updateErr) throw updateErr;
  return data as Profile;
}

/**
 * Pure: given the set of plan_date strings (YYYY-MM-DD) that are "closed"
 * (reviewed_at is set) and today's date, counts consecutive closed days
 * walking backward. Today itself doesn't break the streak if it isn't
 * closed yet (the day may simply still be in progress) — it's just not
 * counted until it is.
 */
export function computeStreak(reviewedDates: Set<string>, todayISO: string): number {
  let streak = 0;
  let cursor = new Date(`${todayISO}T00:00:00`);

  if (reviewedDates.has(toISODate(cursor))) {
    streak += 1;
  }
  cursor = addDays(cursor, -1);

  while (reviewedDates.has(toISODate(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

const CLOSURE_BASE_POINTS = 5;
const CLOSURE_STREAK_BONUS_CAP = 10;

/**
 * Pure: today's closure bonus, given the unbroken streak going into today
 * (i.e. not counting today itself — see getStreak's timing note below).
 * Always at least the base amount, so losing a streak never drops you to
 * zero; the bonus just ramps back down with it.
 */
export function computeClosurePoints(streakBeforeToday: number): number {
  const bonus = Math.min(Math.max(streakBeforeToday, 0), CLOSURE_STREAK_BONUS_CAP);
  return CLOSURE_BASE_POINTS + bonus;
}

/**
 * Looks back up to 400 days for closed daily_plans and computes the current
 * streak. 400 days is a documented limit, not a real cap — a streak longer
 * than that will undercount rather than fail.
 */
export async function getStreak(): Promise<number> {
  const userId = await getCurrentUserId();
  const todayISO = toISODate(new Date());
  const windowStartISO = toISODate(addDays(new Date(), -400));

  const { data, error } = await supabase
    .from("daily_plans")
    .select("plan_date, reviewed_at")
    .eq("user_id", userId)
    .gte("plan_date", windowStartISO)
    .lte("plan_date", todayISO);

  if (error) throw error;

  const reviewedDates = new Set(
    (data ?? []).filter((row) => !!row.reviewed_at).map((row) => row.plan_date as string)
  );

  return computeStreak(reviewedDates, todayISO);
}

/**
 * ✅ UPDATED GATING LOGIC:
 * Allow planning if:
 * 1. No plan exists for prev day (first time use), OR
 * 2. Prev day plan has no goals (nothing to review), OR
 * 3. Prev day plan is reviewed (reviewed_at is set)
 */
export async function isPrevDayReviewedForPlan(planDateISO: string) {
  const userId = await getCurrentUserId();

  const planDate = new Date(`${planDateISO}T00:00:00`);
  const prevDateISO = toISODate(addDays(planDate, -1));

  const { data: plan, error } = await supabase
    .from("daily_plans")
    .select("id, reviewed_at")
    .eq("user_id", userId)
    .eq("plan_date", prevDateISO)
    .maybeSingle();

  if (error) throw error;

  // If no plan existed on prev day, allow (no gating)
  if (!plan) return true;

  // Check if prev day has any goals
  const { data: goals, error: goalsErr } = await supabase
    .from("goals")
    .select("id")
    .eq("plan_id", plan.id)
    .limit(1);

  if (goalsErr) throw goalsErr;

  // If no goals exist for prev day, allow (nothing to review)
  if (!goals || goals.length === 0) return true;

  // If goals exist, require reviewed_at to be set
  return !!plan.reviewed_at;
}

/**
 * ✅ COMPAT EXPORT:
 * Your Tomorrow pages import `isYesterdayReviewed()` with no args.
 * We map that to "is the previous day reviewed for TOMORROW's plan?"
 */
export async function isYesterdayReviewed() {
  const tomorrowISO = toISODate(addDays(new Date(), 1));
  return isPrevDayReviewedForPlan(tomorrowISO);
}

/**
 * ✅ RESCHEDULE (store intent; materialize on target day open)
 */
export async function rescheduleGoalToDate(params: {
  goal: Goal;
  toDateISO: string;
  reason?: string;
}) {
  const userId = await getCurrentUserId();

  // 1) mark old goal postponed
  await updateGoalStatus(params.goal.id, "postponed");

  // 2) store intent + snapshot
  const { error: logErr } = await supabase.from("goal_reschedules").insert({
    user_id: userId,
    from_goal_id: params.goal.id,
    to_goal_id: params.goal.id, // legacy keep
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

  // 3) If rescheduled to tomorrow, ensure it appears quickly by opening tomorrow plan
  const tomorrowISO = toISODate(addDays(new Date(), 1));
  if (params.toDateISO === tomorrowISO) {
    await getOrCreatePlan(tomorrowISO); // materializes via RPC
  }
}
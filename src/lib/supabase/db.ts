import { supabase } from "@/lib/supabase/client";
import type { Theme } from "@/lib/theme";

export type PlanStatus = "draft" | "submitted" | "locked";
export type GoalStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "attempted"
  | "postponed"
  | "blocked"
  | "canceled";

export type DailyPlan = {
  id: string;
  user_id: string;
  plan_date: string; // YYYY-MM-DD
  status: PlanStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  // Manually dismissed via the "Clear this day" button on a past day's
  // view-only page — distinct from reviewed_at, which past days can never
  // get (no retroactive review). Just clears the Calendar's "Missed" flag.
  cleared_at?: string | null;

  // ✅ two-phase scoring flags
  awareness_awarded?: boolean;
  closure_awarded?: boolean;
  awareness_points?: number;
  closure_points?: number;

  // One-time bonus for actually submitting this day's plan (not just
  // drafting it) — separate from awareness/closure, which are earned on
  // the day the plan is reviewed/closed, not the day it was planned.
  planning_awarded?: boolean;
  planning_points?: number;
};

export type Profile = {
  id: string;
  display_name: string | null;
  points: number;
  theme: Theme;

  // Optional personal info — never required, kept for possible future
  // personalization (e.g. goal suggestions tuned to age/location).
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null; // YYYY-MM-DD
  address?: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
  shared_at?: string | null;
  is_admin?: boolean;
};

export type ConnectionStatus = "pending" | "accepted" | "declined";

// A connections row as returned to the current user, with the *other*
// party's id/display_name already resolved — callers never need to figure
// out "which side of requester/recipient am I" themselves.
export type Connection = {
  id: string;
  status: ConnectionStatus;
  created_at: string;
  responded_at: string | null;
  direction: "incoming" | "outgoing";
  otherUserId: string;
  otherDisplayName: string | null;
  // Captured at request time (requester's own session email; the exact
  // text the recipient was found by) — a fallback for display_name, which
  // is optional at signup and often null.
  otherEmail: string | null;
};

/**
 * display_name is optional at signup and often null — falls back to the
 * local part of the captured email, then a short id fragment, so a
 * connection never renders as a raw full UUID.
 */
export function connectionDisplayName(c: Pick<Connection, "otherDisplayName" | "otherEmail" | "otherUserId">): string {
  if (c.otherDisplayName) return c.otherDisplayName;
  if (c.otherEmail) return c.otherEmail.split("@")[0];
  return c.otherUserId.slice(0, 8);
}

export type GlimpseReaction = "like" | "support" | "fire" | "clap";

// The limited slice of a goal exposed on a goal_glimpse post — title/
// priority/status only, never notes/checklist/attachments/details.
export type GlimpseGoal = {
  goal_id: string;
  title: string;
  priority: number | null;
  status: GoalStatus;
  is_all_day: boolean | null;
  time_of_day: string | null;
};

export type PostType = "goal_glimpse" | "achievement" | "motivational";
export type PostVisibility = "connections" | "everyone";

/**
 * One feed item, as returned by get_feed() — a goal_glimpse post carries a
 * live current goal list (not a snapshot: progress keeps updating as the
 * owner works through their day), an achievement post carries just the id
 * (title/description/icon resolve client-side from achievements.ts, since
 * those are translation keys the server can't render), and a motivational
 * post carries freeform text.
 */
export type Post = {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  type: PostType;
  visibility: PostVisibility;
  createdAt: string;
  planDate: string | null;
  achievementId: string | null;
  body: string | null;
  myReaction: GlimpseReaction | null;
  goals: GlimpseGoal[] | null;
};

export type GoalNote = {
  id: string;
  goal_id: string;
  user_id: string;
  note: string;
  created_at: string;
};

export type ChecklistItem = {
  id: string;
  goal_id: string;
  user_id: string;
  text: string;
  is_checked: boolean;
  position: number;
  created_at: string;
};

export type GoalAttachment = {
  id: string;
  goal_id: string;
  user_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
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
  // Optional "HH:MM" (or "HH:MM:SS", as Postgres' `time` type comes back)
  // time-of-day — display-only, no reminders/notifications attached.
  time_of_day?: string | null;
  // When true, time_of_day is ignored for display — the goal spans the
  // whole day rather than a specific time.
  is_all_day?: boolean;
  // Optional single URL attached to the goal — a lighter-weight companion
  // to the checklist/attachments, for when a reference link is all a goal
  // needs (a doc, a meeting link, a job posting).
  link_url?: string | null;
  // Set when this goal was created by tapping a recurring-template
  // suggestion chip — used only to dedupe "already added today" against
  // that same template, not shown anywhere in the UI.
  source_template_id?: string | null;

  // ✅ NEW: Timestamps
  created_at: string;
  updated_at: string;

  // Reschedule metadata attached client-side (not raw DB columns)
  rescheduled_to?: string | null;
  rescheduled_from_date?: string | null;
  reschedule_reason?: string | null;
  previous_actions?: GoalNote[];
};

/** An undated goal in the backlog — not yet attached to any daily_plans row. Promoted to a real Goal via promoteBacklogGoal() when a day opens up for it. */
export type BacklogGoal = {
  id: string;
  user_id: string;
  title: string;
  details: string | null;
  priority: number;
  created_at: string;
};

/**
 * A recurring goal suggestion (e.g. "Workout" every Mon/Wed/Fri) — never
 * auto-creates a goal. Plan Tomorrow (and any future date's plan) shows
 * templates due that day as tap-to-add chips; tapping one calls
 * addGoalFromTemplate() to create a real, independent Goal.
 */
export type RecurringGoalTemplate = {
  id: string;
  user_id: string;
  title: string;
  details: string | null;
  priority: number | null;
  time_of_day: string | null;
  // 0=Sunday..6=Saturday, matching JS Date.getDay().
  days_of_week: number[];
  active: boolean;
  created_at: string;
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

/** Hours remaining in the local day (e.g. 5.5 at 6:30 PM) — used to nudge an end-of-day review reminder. */
export function hoursUntilMidnight(now: Date = new Date()): number {
  return 24 - now.getHours() - now.getMinutes() / 60;
}

// Display-only: "YYYY-MM-DD" -> "MM/DD/YYYY". Pure string manipulation
// (no Date parsing) so it can't shift a day across timezones. The
// underlying ISO string is still what's used for routing/keys/comparisons.
export function formatDateDisplay(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-");
  if (!yyyy || !mm || !dd) return isoDate;
  return `${mm}/${dd}/${yyyy}`;
}

// Display-only: a goal's optional time_of_day ("HH:MM" or "HH:MM:SS", as
// Postgres' `time` type comes back from supabase-js) -> "h:mm AM/PM". Pure
// string manipulation, same reasoning as formatDateDisplay above.
export function formatTimeOfDay(time: string): string {
  const [hh, mm] = time.split(":");
  const h = Number(hh);
  if (!Number.isFinite(h) || !mm) return time;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${period}`;
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

// getSession() reads the locally persisted session (no network round-trip);
// AuthGate already guarantees a valid session exists before any page-level
// data call runs, so re-validating the JWT against the Auth server here
// (what getUser() does) would just be a redundant network hop on every one
// of the ~25 call sites below.
export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) throw new Error("Not authenticated");
  return data.session.user.id;
}

/** Free-tier assistant usage for the current user — see src/lib/assistant/usage.ts for the cap/reset logic this feeds. Read-only; the actual increment/reset happens server-side in src/app/api/assistant/route.ts. */
export async function getAssistantUsage(): Promise<{ uses: number; resetAt: string }> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("assistant_uses_this_period, assistant_period_reset_at")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return { uses: data.assistant_uses_this_period, resetAt: data.assistant_period_reset_at };
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
    .insert({ id: userId, display_name: metaDisplayName, points: 0, theme: "dark" })
    .select("*")
    .single();

  if (insErr) throw insErr;
  return created as Profile;
}

/** Persists the signed-in user's theme choice to their profile so it follows them across devices and logins, instead of living only in this browser's localStorage. */
export async function updateThemePreference(theme: Theme) {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from("profiles").update({ theme }).eq("id", userId);
  if (error) throw error;
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

  // Uploaded files live in Supabase Storage, not Postgres — the cascade
  // delete on `goals` below removes goal_attachments' DB rows but never the
  // underlying objects, so those must be cleaned up separately while we
  // still know which paths were ours.
  try {
    const { data: attachments } = await supabase
      .from("goal_attachments")
      .select("storage_path")
      .eq("user_id", userId);
    const paths = [...new Set((attachments ?? []).map((a) => a.storage_path as string))];
    if (paths.length > 0) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove(paths);
    }
  } catch {
    // Non-fatal — worst case is an orphaned file rather than a failed
    // account deletion; the DB rows are gone either way once goals go.
  }

  const { error: goalsErr } = await supabase.from("goals").delete().eq("user_id", userId);
  if (goalsErr) throw goalsErr;

  try {
    await supabase.from("goal_reschedules").delete().eq("user_id", userId);
  } catch {
    // No client-facing delete policy is expected for this table — ignore.
  }

  try {
    await supabase.from("goal_backlog").delete().eq("user_id", userId);
  } catch {
    // Backlog items aren't reachable via the goals cascade above (they're
    // never attached to a plan) — clear them explicitly, non-fatally.
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

export type AdminRole = "member" | "admin" | "sys_admin";

export type AdminMember = {
  id: string;
  email: string;
  displayName: string | null;
  points: number;
  isAdmin: boolean;
  role: AdminRole;
  createdAt: string;
  totalDaysClosed: number;
  totalGoalsCompleted: number;
};

/**
 * Whether the current user is an admin. The RPC is SECURITY DEFINER so it
 * can read profiles.is_admin regardless of RLS; a non-admin (or logged-out)
 * caller just gets false back, not an error.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) throw error;
  return !!data;
}

/** Sys Admins are the only ones who can grant/revoke Admin and Sys Admin roles. */
export async function isCurrentUserSysAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_sys_admin");
  if (error) throw error;
  return !!data;
}

/**
 * Admin-only: every member with the stats the admin panel needs, including
 * email (joined from auth.users server-side — the client can never read
 * that table directly). Throws if the caller isn't an admin.
 */
export async function getAdminMembers(): Promise<AdminMember[]> {
  const { data, error } = await supabase.rpc("admin_list_members");
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    points: row.points,
    isAdmin: !!row.is_admin,
    role: (row.role ?? "member") as AdminRole,
    createdAt: row.created_at,
    totalDaysClosed: row.total_days_closed ?? 0,
    totalGoalsCompleted: row.total_goals_completed ?? 0,
  }));
}

export async function adminSetPoints(targetUserId: string, points: number) {
  const { error } = await supabase.rpc("admin_set_points", {
    p_user_id: targetUserId,
    p_points: points,
  });
  if (error) throw error;
}

/** Sys Admin-only: grant or revoke Admin/Sys Admin. Blocked server-side if it would remove the last Sys Admin. */
export async function adminSetRole(targetUserId: string, role: AdminRole) {
  const { error } = await supabase.rpc("admin_set_role", {
    p_user_id: targetUserId,
    p_role: role,
  });
  if (error) throw error;
}

/**
 * Wipes a member's app data (same scope as deleteAccount) without touching
 * their login. admin_wipe_member_data() is a plain SQL RPC — its cascade
 * delete on `goals` removes goal_attachments' DB rows but can't reach
 * Storage, so the target's uploaded files are removed here first. This
 * needs the requesting admin to have Storage access to another user's
 * folder (not just their own), granted by the
 * goal_attachments_storage_admin_* policies — see that migration.
 */
export async function adminWipeMemberData(targetUserId: string) {
  try {
    const { data: files, error: listErr } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .list(targetUserId);
    if (listErr) throw listErr;

    const paths = (files ?? []).map((f) => `${targetUserId}/${f.name}`);
    if (paths.length > 0) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove(paths);
    }
  } catch {
    // Non-fatal — worst case is an orphaned file rather than a blocked wipe.
  }

  const { error } = await supabase.rpc("admin_wipe_member_data", { p_user_id: targetUserId });
  if (error) throw error;
}

/**
 * Anonymous page-view logging for the landing page only, only for visitors
 * who aren't signed in (see src/app/page.tsx) — just a timestamp, nothing
 * that identifies who visited. Fails silently; a dropped log entry should
 * never be visible to a real visitor.
 */
export async function logLandingPageVisit() {
  try {
    await supabase.from("landing_page_visits").insert({});
  } catch {
    // non-fatal
  }
}

/** Shared between the landing page (checks it) and the Admin panel (sets/clears it) — a browser with this localStorage flag set never logs a visit, for testers/admins who know they'll deliberately re-visit the signed-out landing page. */
export const LANDING_VISIT_DNT_KEY = "standup-landing-dnt";

export type LandingVisitStats = {
  total: number;
  byDay: { date: string; count: number }[];
};

/** Admin-only: landing page visit counts, total and per-day for the last `days` days. */
export async function getAdminLandingVisitStats(days = 30): Promise<LandingVisitStats> {
  // Bucketed by the viewing admin's own local calendar day, same as every
  // other date boundary in the app (toISODate() always uses local Date
  // getters, never UTC) — without this, a visit in the evening lands under
  // "tomorrow" for anyone west of UTC.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [{ data: totalData, error: totalError }, { data: byDayData, error: byDayError }] = await Promise.all([
    supabase.rpc("admin_get_landing_visits_total"),
    supabase.rpc("admin_get_landing_visits", { p_days: days, p_tz: timezone }),
  ]);

  if (totalError) throw totalError;
  if (byDayError) throw byDayError;

  return {
    total: totalData ?? 0,
    byDay: (byDayData ?? []).map((row: any) => ({
      date: row.visit_date as string,
      count: row.visit_count as number,
    })),
  };
}

export type AdminAuditEntry = {
  id: string;
  adminEmail: string | null;
  targetEmail: string | null;
  action: string;
  details: Record<string, any> | null;
  createdAt: string;
};

/** Admin-only: recent admin actions (who did what to whom, and when). */
export async function getAdminAuditLog(limit = 100): Promise<AdminAuditEntry[]> {
  const { data, error } = await supabase.rpc("admin_get_audit_log", { p_limit: limit });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    adminEmail: row.admin_email,
    targetEmail: row.target_email,
    action: row.action,
    details: row.details,
    createdAt: row.created_at,
  }));
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
        .select("note, created_at, kind")
        .eq("goal_id", item.from_goal_id);

      if (notesSelErr) throw notesSelErr;

      if (priorNotes && priorNotes.length > 0) {
        const { error: notesInsErr } = await supabase.from("goal_notes").insert(
          priorNotes.map((n) => ({
            user_id: userId,
            goal_id: inserted.id,
            note: n.note,
            created_at: n.created_at,
            kind: n.kind ?? "note",
          }))
        );
        if (notesInsErr) throw notesInsErr;
      }

      // Same carry-forward for checklist items — a rescheduled grocery-list
      // goal keeps its list (and whatever was already checked off) instead
      // of starting over on the new date.
      const { data: priorItems, error: itemsSelErr } = await supabase
        .from("goal_checklist_items")
        .select("text, is_checked, position")
        .eq("goal_id", item.from_goal_id);

      if (itemsSelErr) throw itemsSelErr;

      if (priorItems && priorItems.length > 0) {
        const { error: itemsInsErr } = await supabase.from("goal_checklist_items").insert(
          priorItems.map((it) => ({
            user_id: userId,
            goal_id: inserted.id,
            text: it.text,
            is_checked: it.is_checked,
            position: it.position,
          }))
        );
        if (itemsInsErr) throw itemsInsErr;
      }

      // Same carry-forward for file attachments — points the new goal's row
      // at the SAME storage object rather than re-uploading/duplicating the
      // file, since the goal_attachments storage path is keyed by user id,
      // not goal id (see the migration's comment on why).
      const { data: priorAttachments, error: attachSelErr } = await supabase
        .from("goal_attachments")
        .select("storage_path, file_name, mime_type, size_bytes")
        .eq("goal_id", item.from_goal_id);

      if (attachSelErr) throw attachSelErr;

      if (priorAttachments && priorAttachments.length > 0) {
        const { error: attachInsErr } = await supabase.from("goal_attachments").insert(
          priorAttachments.map((a) => ({
            user_id: userId,
            goal_id: inserted.id,
            storage_path: a.storage_path,
            file_name: a.file_name,
            mime_type: a.mime_type,
            size_bytes: a.size_bytes,
          }))
        );
        if (attachInsErr) throw attachInsErr;
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
        time_of_day: g.time_of_day || null,
        is_all_day: !!(g as any).is_all_day,
        link_url: (g as any).link_url || null,
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
        time_of_day: g.time_of_day || null,
        is_all_day: !!(g as any).is_all_day,
        link_url: (g as any).link_url || null,
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

export async function getBacklogGoals(): Promise<BacklogGoal[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("goal_backlog")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as BacklogGoal[];
}

export async function addBacklogGoal(title: string, details: string | null, priority: number): Promise<BacklogGoal> {
  const userId = await getCurrentUserId();
  const trimmed = title.trim();

  const { data, error } = await supabase
    .from("goal_backlog")
    .insert({ user_id: userId, title: trimmed, details: details?.trim() || null, priority })
    .select()
    .single();

  if (error) throw error;
  return data as BacklogGoal;
}

export async function deleteBacklogGoal(backlogId: string) {
  const { error } = await supabase.from("goal_backlog").delete().eq("id", backlogId);
  if (error) throw error;
}

/**
 * The reverse of promoteBacklogGoal — for a scheduled goal you're no longer
 * sure you'll get to on any particular day. Insert-then-delete, same
 * safer-failure-mode order: if the delete fails, the goal exists in both
 * places rather than vanishing. Notes, checklist items, and file
 * attachments are NOT carried over — goal_backlog has no equivalent
 * sub-tables, and they cascade-delete with the goal itself.
 */
export async function moveGoalToBacklog(goal: Goal): Promise<BacklogGoal> {
  const created = await addBacklogGoal(
    goal.title,
    goal.details ?? null,
    typeof goal.priority === "number" ? goal.priority : 3
  );
  await deleteGoal(goal.id);
  return created;
}

/**
 * Pushes a backlog item onto an actual day's plan: creates a real Goal on
 * planDateISO (appended after that day's existing goals) and removes the
 * backlog row. Two separate calls rather than one transaction — there's no
 * RPC for this, and a delete that fails after a successful insert just
 * leaves the item in both places rather than losing it, which is the safer
 * failure mode for a promote-not-consume action.
 */
export async function promoteBacklogGoal(backlog: BacklogGoal, planDateISO: string): Promise<Goal> {
  const plan = await getOrCreatePlan(planDateISO);

  const { data: existing, error: existingErr } = await supabase
    .from("goals")
    .select("sort_order")
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (existingErr) throw existingErr;

  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const userId = await getCurrentUserId();
  const { data: created, error: insertErr } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      title: backlog.title,
      details: backlog.details,
      status: "not_started",
      sort_order: nextSortOrder,
      priority: backlog.priority,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;

  await deleteBacklogGoal(backlog.id);

  return created as Goal;
}

// ── Recurring goal templates ──────────────────────────────────────────

export async function getRecurringGoalTemplates(): Promise<RecurringGoalTemplate[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("recurring_goal_templates")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RecurringGoalTemplate[];
}

export async function addRecurringGoalTemplate(input: {
  title: string;
  details?: string | null;
  priority?: number | null;
  time_of_day?: string | null;
  days_of_week: number[];
}): Promise<RecurringGoalTemplate> {
  const userId = await getCurrentUserId();
  const trimmed = input.title.trim();
  const { data, error } = await supabase
    .from("recurring_goal_templates")
    .insert({
      user_id: userId,
      title: trimmed,
      details: input.details?.trim() || null,
      priority: input.priority ?? null,
      time_of_day: input.time_of_day || null,
      days_of_week: input.days_of_week,
    })
    .select()
    .single();
  if (error) throw error;
  return data as RecurringGoalTemplate;
}

/** Retiring (active=false) keeps history/dedupe intact without deleting the row. */
export async function setRecurringGoalTemplateActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("recurring_goal_templates").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deleteRecurringGoalTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("recurring_goal_templates").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Active templates due on planDateISO's weekday, minus any already added
 * to that specific date (via source_template_id) -- so a template you've
 * already tapped once for this day stops suggesting itself.
 */
export async function getSuggestedTemplatesForDate(planDateISO: string): Promise<RecurringGoalTemplate[]> {
  const userId = await getCurrentUserId();
  const weekday = new Date(`${planDateISO}T00:00:00`).getDay();

  const [{ data: templates, error: templatesErr }, plan] = await Promise.all([
    supabase.from("recurring_goal_templates").select("*").eq("user_id", userId).eq("active", true),
    getOrCreatePlan(planDateISO),
  ]);
  if (templatesErr) throw templatesErr;

  const due = ((templates ?? []) as RecurringGoalTemplate[]).filter((t) => t.days_of_week.includes(weekday));
  if (due.length === 0) return [];

  const { data: existingGoals, error: goalsErr } = await supabase
    .from("goals")
    .select("source_template_id")
    .eq("plan_id", plan.id)
    .not("source_template_id", "is", null);
  if (goalsErr) throw goalsErr;

  const addedTemplateIds = new Set((existingGoals ?? []).map((g) => g.source_template_id));
  return due.filter((t) => !addedTemplateIds.has(t.id));
}

/** Tap-to-add: creates a real, independent Goal from a template -- never automatic. */
export async function addGoalFromTemplate(template: RecurringGoalTemplate, planDateISO: string): Promise<Goal> {
  const plan = await getOrCreatePlan(planDateISO);

  const { data: existing, error: existingErr } = await supabase
    .from("goals")
    .select("sort_order")
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (existingErr) throw existingErr;
  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const userId = await getCurrentUserId();
  const { data: created, error: insertErr } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      title: template.title,
      details: template.details,
      status: "not_started",
      sort_order: nextSortOrder,
      priority: template.priority,
      time_of_day: template.time_of_day,
      source_template_id: template.id,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;
  return created as Goal;
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

/**
 * Manually dismisses a past day's "Missed" flag from its view-only page —
 * past days can never be reviewed retroactively, so this is the explicit
 * alternative to rescheduling every individual goal just to make the
 * Calendar/overdue-count stop flagging it.
 */
export async function markDayCleared(planId: string) {
  const { data, error } = await supabase
    .from("daily_plans")
    .update({ cleared_at: new Date().toISOString() })
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
    kind: "note",
  });

  if (error) throw error;
}

/** Sub-items within a goal (e.g. a grocery list under "Go to HEB"). Independent of the notes/timeline system — checking items off isn't logged there, since that would flood a goal's history with one entry per item. */
export async function getChecklistItemsForGoals(goalIds: string[]): Promise<Record<string, ChecklistItem[]>> {
  if (goalIds.length === 0) return {};

  const { data, error } = await supabase
    .from("goal_checklist_items")
    .select("*")
    .in("goal_id", goalIds)
    .order("position", { ascending: true });

  if (error) throw error;

  const map: Record<string, ChecklistItem[]> = {};
  (data ?? []).forEach((item) => {
    (map[item.goal_id] ??= []).push(item as ChecklistItem);
  });
  return map;
}

export async function addChecklistItem(goalId: string, text: string, position: number): Promise<ChecklistItem> {
  const userId = await getCurrentUserId();
  const trimmed = text.trim();

  const { data, error } = await supabase
    .from("goal_checklist_items")
    .insert({ user_id: userId, goal_id: goalId, text: trimmed, position })
    .select()
    .single();

  if (error) throw error;
  return data as ChecklistItem;
}

export async function toggleChecklistItem(itemId: string, isChecked: boolean) {
  const { error } = await supabase
    .from("goal_checklist_items")
    .update({ is_checked: isChecked })
    .eq("id", itemId);
  if (error) throw error;
}

export async function deleteChecklistItem(itemId: string) {
  const { error } = await supabase.from("goal_checklist_items").delete().eq("id", itemId);
  if (error) throw error;
}

const ATTACHMENT_BUCKET = "goal-attachments";
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
];

/** A goal's optional file attachments (receipts, documents). Kept out of the notes/timeline log for the same reason checklist items are. Uploaded to a private bucket — read access always goes through a short-lived signed URL (getAttachmentUrl), never a plain public link. */
export async function getAttachmentsForGoals(goalIds: string[]): Promise<Record<string, GoalAttachment[]>> {
  if (goalIds.length === 0) return {};

  const { data, error } = await supabase
    .from("goal_attachments")
    .select("*")
    .in("goal_id", goalIds)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const map: Record<string, GoalAttachment[]> = {};
  (data ?? []).forEach((row) => {
    (map[row.goal_id] ??= []).push(row as GoalAttachment);
  });
  return map;
}

export async function uploadGoalAttachment(goalId: string, file: File): Promise<GoalAttachment> {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(`File too large — max ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB.`);
  }
  if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Only images and PDFs are supported.");
  }

  const userId = await getCurrentUserId();
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const storagePath = `${userId}/${crypto.randomUUID()}${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, file, { contentType: file.type });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from("goal_attachments")
    .insert({
      user_id: userId,
      goal_id: goalId,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select()
    .single();

  if (error) {
    // Row insert failed — clean up the object we just uploaded so it doesn't
    // become an orphaned file the user can never see or remove.
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
    throw error;
  }

  return data as GoalAttachment;
}

/** Short-lived (5 min) signed URL — the bucket is private, so this is the only way to view or download a file. */
export async function getAttachmentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(storagePath, 60 * 5);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteGoalAttachment(attachmentId: string, storagePath: string) {
  const { error: delErr } = await supabase.from("goal_attachments").delete().eq("id", attachmentId);
  if (delErr) throw delErr;

  // Only remove the underlying file once nothing else still references it —
  // a rescheduled goal's attachment row points at the same storage object as
  // its original (see materializeReschedules), so deleting one shouldn't
  // pull the file out from under the other.
  const { data: stillReferenced, error: checkErr } = await supabase
    .from("goal_attachments")
    .select("id")
    .eq("storage_path", storagePath)
    .limit(1);

  if (checkErr) return; // non-fatal — the row is gone either way; skip storage cleanup
  if (!stillReferenced || stillReferenced.length === 0) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
  }
}

export type GoalEventKind = "status_change" | "priority_change" | "reviewed" | "rescheduled";

/**
 * System-generated timeline entries share the `goal_notes` table with real
 * user notes (distinguished by `kind`) rather than a separate log — that
 * table is already timestamped and already carried forward across a
 * reschedule's new goal row (see materializeReschedules above), so reusing
 * it gives every action a real, permanent moment in time for free instead
 * of deriving an approximate, unordered summary from current-state fields.
 * Never throws into the caller: a missed log entry shouldn't fail the
 * action that triggered it.
 */
async function logGoalEvent(goalId: string, kind: GoalEventKind, label: string) {
  try {
    const userId = await getCurrentUserId();
    await supabase.from("goal_notes").insert({
      user_id: userId,
      goal_id: goalId,
      note: label,
      kind,
    });
  } catch {
    // non-fatal
  }
}

const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  attempted: "Attempted",
  postponed: "Rescheduled",
  blocked: "Blocked",
  canceled: "Canceled",
};

export async function updateGoalStatus(goalId: string, status: GoalStatus) {
  const { error } = await supabase.from("goals").update({ status }).eq("id", goalId);
  if (error) throw error;
  await logGoalEvent(goalId, "status_change", `Status changed to ${GOAL_STATUS_LABELS[status] ?? status}`);
}

/** Updates a goal's priority and logs it as a timestamped timeline event (see logGoalEvent). */
export async function updateGoalPriority(goalId: string, planId: string, priority: number) {
  const { error } = await supabase.from("goals").update({ priority }).eq("id", goalId);
  if (error) throw error;
  if (priority === 1) {
    await enforceSingleP1(planId, goalId);
  }
  await logGoalEvent(goalId, "priority_change", `Priority changed to P${priority}`);
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

/** Sets or clears a goal's attached link — used on Today, where fields are
 * updated one at a time rather than through the draft-array upsert flow
 * Plan Tomorrow and the date detail page use. */
export async function updateGoalLink(goalId: string, linkUrl: string | null) {
  const { error } = await supabase.from("goals").update({ link_url: linkUrl }).eq("id", goalId);
  if (error) throw error;
}

export async function markGoalReviewed(goalId: string) {
  const { error } = await supabase
    .from("goals")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", goalId);
  if (error) throw error;
  await logGoalEvent(goalId, "reviewed", "Marked as reviewed");
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
  return row as { success: boolean; points: number };
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
  return row as { success: boolean; points: number };
}

/**
 * ✅ Planning bonus: awarded once when a plan is actually submitted (not
 * just drafted). Lives on the plan being submitted, same as the other two.
 */
export async function awardPlanningPoints(planId: string, points = 5) {
  await getOrCreateProfile();
  const { data, error } = await supabase.rpc("award_planning_points", {
    p_plan_id: planId,
    p_points: points,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { success: boolean; points: number };
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
  planningAwarded: boolean;
  planningPoints: number;
  reviewedAt: string | null;
};

/**
 * Recent days that earned at least one points bonus (awareness, closure,
 * and/or planning), newest first. The per-day amounts already live on
 * daily_plans — they're just never read back anywhere else in the app.
 */
export async function getPointsHistory(limit = 30): Promise<PointsHistoryEntry[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("daily_plans")
    .select(
      "plan_date, awareness_awarded, awareness_points, closure_awarded, closure_points, planning_awarded, planning_points, reviewed_at"
    )
    .eq("user_id", userId)
    .or("awareness_awarded.eq.true,closure_awarded.eq.true,planning_awarded.eq.true")
    .order("plan_date", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    planDate: row.plan_date as string,
    awarenessAwarded: !!row.awareness_awarded,
    awarenessPoints: row.awareness_points ?? 0,
    closureAwarded: !!row.closure_awarded,
    closurePoints: row.closure_points ?? 0,
    planningAwarded: !!row.planning_awarded,
    planningPoints: row.planning_points ?? 0,
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

/**
 * Pure: longest run of calendar-consecutive dates in a list of YYYY-MM-DD
 * strings (order/duplicates don't matter — sorted and deduped internally).
 * Unlike computeStreak (current streak, walking back from today), this
 * scans the whole list for the longest run ever, so a broken streak doesn't
 * erase a past achievement.
 */
export function computeLongestStreak(datesISO: string[]): number {
  if (datesISO.length === 0) return 0;

  const sorted = [...new Set(datesISO)].sort();
  let longest = 1;
  let current = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00`);
    const cur = new Date(`${sorted[i]}T00:00:00`);
    const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86400000);

    current = diffDays === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }

  return longest;
}

export type LifetimeStats = {
  longestStreak: number;
  totalDaysClosed: number;
  totalGoalsCompleted: number;
  maxGoalsCompletedInDay: number;
  totalReferrals: number;
  reschedulesCompleted: number;
  trackedGoalsCompleted: number;
  totalGoalsSubmitted: number;
};

/**
 * Feeds the Achievements list (src/lib/achievements.ts) — history-wide
 * totals, not scoped to any date window.
 */
export async function getLifetimeStats(): Promise<LifetimeStats> {
  const userId = await getCurrentUserId();

  // The seven queries below don't depend on each other's results, so they
  // run as one batch instead of seven sequential round-trips.
  const [
    { count: totalReferrals, error: referralsError },
    { data: plans, error: plansError },
    { count, error: goalsError },
    { data: reschedRows, error: reschedError },
    { data: notedRows, error: notesError },
    { count: totalGoalsSubmitted, error: submittedError },
    coveredDates,
  ] = await Promise.all([
    supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", userId)
      .eq("awarded", true),
    supabase.from("daily_plans").select("id, plan_date, reviewed_at").eq("user_id", userId),
    supabase
      .from("goals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed"),
    // Goals that started as a reschedule of an older goal, and ended up
    // completed anyway — following through after pushing something back.
    supabase
      .from("goal_reschedules")
      .select("materialized_goal_id")
      .eq("user_id", userId)
      .not("materialized_goal_id", "is", null),
    // Goals that were actively tracked with at least one note, and ended up
    // completed — closing the loop on something you were following up on.
    supabase.from("goal_notes").select("goal_id").eq("user_id", userId),
    supabase.from("goals").select("id", { count: "exact", head: true }).eq("user_id", userId),
    // Unbounded, matching this function's own unbounded daily_plans query.
    getStreakPassCoveredDates("0001-01-01", "9999-12-31"),
  ]);
  if (referralsError) throw referralsError;
  if (plansError) throw plansError;
  if (goalsError) throw goalsError;
  if (reschedError) throw reschedError;
  if (notesError) throw notesError;
  if (submittedError) throw submittedError;

  const reviewedDates = (plans ?? [])
    .filter((p) => !!p.reviewed_at)
    .map((p) => p.plan_date as string);
  // Streak-pass-covered days count toward the longest-streak *record* (the
  // whole point of a pass is to protect streak continuity) but must never
  // inflate totalDaysClosed, which stays keyed to reviewedDates alone —
  // a covered day was never actually reviewed.
  const streakDates = [...new Set([...reviewedDates, ...coveredDates])];
  const planIds = (plans ?? []).map((p) => p.id);
  const materializedGoalIds = [
    ...new Set((reschedRows ?? []).map((r) => r.materialized_goal_id).filter(Boolean)),
  ];
  const notedGoalIds = [...new Set((notedRows ?? []).map((n) => n.goal_id))];

  async function maxCompletedInAnyPlan(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { data, error } = await supabase
      .from("goals")
      .select("plan_id, status")
      .in("plan_id", ids)
      .eq("status", "completed");
    if (error) throw error;
    const perPlanCount: Record<string, number> = {};
    (data ?? []).forEach((g) => {
      perPlanCount[g.plan_id] = (perPlanCount[g.plan_id] ?? 0) + 1;
    });
    return Math.max(0, ...Object.values(perPlanCount));
  }

  async function completedCountAmong(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { count: n, error } = await supabase
      .from("goals")
      .select("id", { count: "exact", head: true })
      .in("id", ids)
      .eq("status", "completed");
    if (error) throw error;
    return n ?? 0;
  }

  // These three depend on ids resolved above, but not on each other.
  const [maxGoalsCompletedInDay, reschedulesCompleted, trackedGoalsCompleted] = await Promise.all([
    maxCompletedInAnyPlan(planIds),
    completedCountAmong(materializedGoalIds),
    completedCountAmong(notedGoalIds),
  ]);

  return {
    longestStreak: computeLongestStreak(streakDates),
    totalDaysClosed: reviewedDates.length,
    totalGoalsCompleted: count ?? 0,
    maxGoalsCompletedInDay,
    totalReferrals: totalReferrals ?? 0,
    reschedulesCompleted,
    trackedGoalsCompleted,
    totalGoalsSubmitted: totalGoalsSubmitted ?? 0,
  };
}

export type ArchivedGoal = Goal & { plan_date: string | null };

/**
 * Backs the "Goals completed" / "Goals submitted" drill-down on Data &
 * Metrics — "submitted" matches totalGoalsSubmitted's definition above
 * (every goal row ever created for this user, not filtered by whether its
 * plan was ever actually submitted), so the list count always matches the
 * tile it was opened from. Newest first, capped at `limit` since a
 * long-running account could otherwise return an unbounded number of rows.
 */
export async function getGoalsByFilter(
  filter: "completed" | "submitted",
  limit = 200
): Promise<ArchivedGoal[]> {
  const userId = await getCurrentUserId();

  let query = supabase
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filter === "completed") {
    query = query.eq("status", "completed");
  }

  const { data: goalRows, error } = await query;
  if (error) throw error;

  const rows = goalRows ?? [];
  const planIds = [...new Set(rows.map((g) => g.plan_id).filter(Boolean))];

  const planDateById: Record<string, string> = {};
  if (planIds.length > 0) {
    const { data: plans, error: plansErr } = await supabase
      .from("daily_plans")
      .select("id, plan_date")
      .in("id", planIds);
    if (plansErr) throw plansErr;
    (plans ?? []).forEach((p) => {
      planDateById[p.id] = p.plan_date;
    });
  }

  return rows.map((g) => ({ ...g, plan_date: planDateById[g.plan_id] ?? null })) as ArchivedGoal[];
}

/** Notes + logged history events for a batch of goals — feeds buildGoalTimeline for each. */
export async function getNotesForGoals(goalIds: string[]): Promise<Record<string, any[]>> {
  if (goalIds.length === 0) return {};

  const { data, error } = await supabase
    .from("goal_notes")
    .select("goal_id, note, created_at, kind")
    .in("goal_id", goalIds)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const byGoal: Record<string, any[]> = {};
  (data ?? []).forEach((n) => {
    (byGoal[n.goal_id] ??= []).push(n);
  });
  return byGoal;
}

// Hardcoded rather than window.location.origin — this link gets shared
// with other people, who need to land on the real production site
// regardless of where the current user happens to be viewing the app from
// (e.g. testing locally over the LAN).
const PRODUCTION_URL = "https://standup-app-two.vercel.app";

export function getReferralLink(userId: string): string {
  return `${PRODUCTION_URL}/signup?ref=${userId}`;
}

const PENDING_REFERRAL_KEY = "standup-pending-referral";

export function storePendingReferral(referrerId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_REFERRAL_KEY, referrerId);
  } catch {
    // Private browsing / storage disabled — referral is simply lost, non-fatal.
  }
}

/**
 * Consumes a referral code stashed by the signup page, if any. Called on
 * every authenticated session load (see Header.tsx) rather than only right
 * after signup, since email confirmation means the session that actually
 * gets created can be a fresh page load with no signup-flow state left.
 * Safe to call repeatedly — a no-op once nothing's pending, and a stale or
 * duplicate code just fails the insert quietly (referred_id is unique, and
 * self-referrals are rejected by RLS).
 */
export async function consumePendingReferral() {
  if (typeof window === "undefined") return;

  let referrerId: string | null = null;
  try {
    referrerId = window.localStorage.getItem(PENDING_REFERRAL_KEY);
  } catch {
    return;
  }
  if (!referrerId) return;

  try {
    window.localStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    // ignore
  }

  try {
    const userId = await getCurrentUserId();
    if (referrerId === userId) return;
    await supabase.from("referrals").insert({ referrer_id: referrerId, referred_id: userId });
  } catch {
    // Already recorded, invalid referrer, or rejected by RLS — fine either way.
  }
}

// ── Glimpse sharing: connections, publish, reactions ────────────────────

export async function findUserByEmail(
  email: string
): Promise<{ id: string; display_name: string | null } | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase.rpc("find_user_by_email", { p_email: trimmed });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

/**
 * Sends a connection request by email. Throws a friendly error for the
 * common failure cases (no account with that email, already connected/
 * pending, self-request) rather than surfacing the raw Postgres error.
 */
export async function sendConnectionRequest(email: string): Promise<void> {
  const userId = await getCurrentUserId();
  const match = await findUserByEmail(email);
  if (!match) throw new Error("No StandUp account found with that email.");
  if (match.id === userId) throw new Error("You can't connect with yourself.");

  // display_name is optional at signup, so both emails are captured here —
  // the requester's own (known from their session) and the recipient's
  // (the exact text they were found by) — as a fallback the UI can show
  // instead of a raw user id when display_name is null.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { error } = await supabase.from("connections").insert({
    requester_id: userId,
    recipient_id: match.id,
    requester_email: session?.user?.email ?? null,
    recipient_email: email.trim(),
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error("You're already connected, or a request is already pending.");
    }
    throw error;
  }
}

/**
 * Every connection row involving the current user, with the *other*
 * party's id/display name already resolved so callers never need to work
 * out which side of requester/recipient they are. Two queries (connections,
 * then a batched profiles lookup) rather than a PostgREST embed, since
 * connections only has a foreign key to auth.users, not to profiles.
 */
export async function listConnections(): Promise<Connection[]> {
  const userId = await getCurrentUserId();

  const { data: rows, error } = await supabase
    .from("connections")
    .select("id, requester_id, recipient_id, status, created_at, responded_at, requester_email, recipient_email")
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const otherIds = [...new Set(rows.map((r) => (r.requester_id === userId ? r.recipient_id : r.requester_id)))];
  const { data: profileRows, error: profileErr } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", otherIds);
  if (profileErr) throw profileErr;

  const nameById = new Map((profileRows ?? []).map((p) => [p.id, p.display_name as string | null]));

  return rows.map((r) => {
    const isRequester = r.requester_id === userId;
    const otherUserId = isRequester ? r.recipient_id : r.requester_id;
    return {
      id: r.id,
      status: r.status as ConnectionStatus,
      created_at: r.created_at,
      responded_at: r.responded_at,
      direction: isRequester ? "outgoing" : "incoming",
      otherUserId,
      otherDisplayName: nameById.get(otherUserId) ?? null,
      otherEmail: isRequester ? r.recipient_email : r.requester_email,
    };
  });
}

export async function respondToConnectionRequest(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase
    .from("connections")
    .update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Covers both "cancel my outgoing request" and "remove an existing connection". */
export async function removeConnection(id: string): Promise<void> {
  const { error } = await supabase.from("connections").delete().eq("id", id);
  if (error) throw error;
}

// ── Unified posts feed ────────────────────────────────────────────────

/**
 * Publishes (or re-publishes, changing visibility) today's goal list as a
 * post. Goes through the upsert_daily_glimpse RPC rather than a plain
 * client .upsert() -- PostgREST's upsert onConflict only supplies a
 * column list, which can't target the partial unique index
 * (posts_one_glimpse_per_day is scoped `where type = 'goal_glimpse'`, a
 * predicate the JS client has no way to pass).
 */
export async function publishGoalGlimpse(
  planDateISO: string,
  visibility: PostVisibility
): Promise<void> {
  const plan = await getOrCreatePlan(planDateISO);
  const { error } = await supabase.rpc("upsert_daily_glimpse", {
    p_plan_id: plan.id,
    p_plan_date: planDateISO,
    p_visibility: visibility,
  });
  if (error) throw error;
}

export async function unpublishGoalGlimpse(planDateISO: string): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("user_id", userId)
    .eq("type", "goal_glimpse")
    .eq("plan_date", planDateISO);
  if (error) throw error;
}

/**
 * The owner's own publish state for a date -- always visible to them via
 * posts' own RLS (`user_id = auth.uid()`), so this is a plain query, no
 * RPC needed.
 */
export async function getMyGoalGlimpsePost(
  planDateISO: string
): Promise<{ id: string; visibility: PostVisibility } | null> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("posts")
    .select("id, visibility")
    .eq("user_id", userId)
    .eq("type", "goal_glimpse")
    .eq("plan_date", planDateISO)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, visibility: data.visibility as PostVisibility } : null;
}

/**
 * Auto-posted the moment an achievement unlocks (see AchievementUnlockedModal),
 * once the user picks a visibility rather than skipping. The unique index
 * on (user_id, achievement_id) is what makes this safe to call from a
 * second device without duplicating the post -- unlock detection itself
 * is per-device (localStorage), so this can't be the source of truth for
 * "already posted"; the DB constraint is.
 */
export async function createAchievementPost(achievementId: string, visibility: PostVisibility): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("posts")
    .insert({ user_id: userId, type: "achievement", achievement_id: achievementId, visibility });
  if (error && error.code !== "23505") throw error;
}

const MOTIVATIONAL_POST_MAX_LENGTH = 280;

export async function createMotivationalPost(body: string, visibility: PostVisibility): Promise<void> {
  const userId = await getCurrentUserId();
  const trimmed = body.trim().slice(0, MOTIVATIONAL_POST_MAX_LENGTH);
  if (!trimmed) return;
  const { error } = await supabase.from("posts").insert({ user_id: userId, type: "motivational", body: trimmed, visibility });
  if (error) throw error;
}

type FeedRow = {
  post_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  type: PostType;
  visibility: PostVisibility;
  created_at: string;
  plan_date: string | null;
  achievement_id: string | null;
  body: string | null;
  my_reaction: GlimpseReaction | null;
  goals: GlimpseGoal[] | null;
};

/** The visibility-filtered feed (own posts + everyone + connections-visible), newest first. */
export async function getFeed(before?: string): Promise<Post[]> {
  const { data, error } = await supabase.rpc("get_feed", {
    p_limit: 30,
    p_before: before ?? null,
  });
  if (error) throw error;

  return ((data ?? []) as FeedRow[]).map((r) => ({
    id: r.post_id,
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    type: r.type,
    visibility: r.visibility,
    createdAt: r.created_at,
    planDate: r.plan_date,
    achievementId: r.achievement_id,
    body: r.body,
    myReaction: r.my_reaction,
    goals: r.goals,
  }));
}

/** Pass reaction: null to remove the viewer's current reaction. */
export async function setPostReaction(postId: string, reaction: GlimpseReaction | null): Promise<void> {
  const { error } = await supabase.rpc("set_post_reaction", { p_post_id: postId, p_reaction: reaction });
  if (error) throw error;
}

export async function markShared() {
  const userId = await getCurrentUserId();
  await supabase
    .from("profiles")
    .update({ shared_at: new Date().toISOString() })
    .eq("id", userId)
    .is("shared_at", null);
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

export type StreakPassBalance = { earned: number; used: number; available: number };

/**
 * Weekly streak passes: reviewing >=5 of 7 days in a Sunday-Saturday week
 * earns 2 passes (see the get_streak_pass_balance RPC for the week-bucketing
 * logic). Never stored as a balance — earned/used/available are all
 * computed on read from daily_plans.reviewed_at and streak_pass_uses.
 */
export async function getStreakPassBalance(): Promise<StreakPassBalance> {
  const { data, error } = await supabase.rpc("get_streak_pass_balance");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { earned: row?.earned ?? 0, used: row?.used ?? 0, available: row?.available ?? 0 };
}

export type StreakPassUse = {
  id: string;
  user_id: string;
  plan_id: string;
  plan_date: string;
  covered_at: string;
};

/** Spends one streak pass to cover planId's day. Never auto-applied — always an explicit user action. */
export async function useStreakPass(planId: string): Promise<StreakPassUse> {
  const todayISO = toISODate(new Date());
  const { data, error } = await supabase.rpc("use_streak_pass", { p_plan_id: planId, p_today: todayISO });
  if (error) throw error;
  return data as StreakPassUse;
}

/** Plan dates (within [startISO, endISO]) the current user has covered with a streak pass. */
export async function getStreakPassCoveredDates(startISO: string, endISO: string): Promise<Set<string>> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("streak_pass_uses")
    .select("plan_date")
    .eq("user_id", userId)
    .gte("plan_date", startISO)
    .lte("plan_date", endISO);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.plan_date as string));
}

/**
 * Looks back up to 400 days for closed daily_plans and computes the current
 * streak. 400 days is a documented limit, not a real cap — a streak longer
 * than that will undercount rather than fail.
 *
 * A day covered by a streak pass (see getStreakPassCoveredDates) counts
 * toward streak *continuity* here, same as a genuinely reviewed day — but
 * this union only ever happens for this streak-display purpose, never for
 * totalDaysClosed/achievements (see getLifetimeStats) or for earning more
 * passes (get_streak_pass_balance is keyed to reviewed_at only).
 */
export async function getStreak(): Promise<number> {
  const userId = await getCurrentUserId();
  const todayISO = toISODate(new Date());
  const windowStartISO = toISODate(addDays(new Date(), -400));

  const [{ data, error }, coveredDates] = await Promise.all([
    supabase
      .from("daily_plans")
      .select("plan_date, reviewed_at")
      .eq("user_id", userId)
      .gte("plan_date", windowStartISO)
      .lte("plan_date", todayISO),
    getStreakPassCoveredDates(windowStartISO, todayISO),
  ]);

  if (error) throw error;

  const reviewedDates = new Set(
    (data ?? []).filter((row) => !!row.reviewed_at).map((row) => row.plan_date as string)
  );
  for (const d of coveredDates) reviewedDates.add(d);

  return computeStreak(reviewedDates, todayISO);
}

export type OverdueSummary = {
  count: number;
  oldestDate: string | null;
};

export type OverdueDay = {
  date: string;
  goalCount: number;
};

/**
 * Past days that were planned (submitted) but never reviewed/closed. These
 * can't be reviewed retroactively — /standup/date/[date] is view-only for
 * past days — so this exists purely to flag the gap; the user's only
 * recourse for anything still worth pursuing is re-attempting (rescheduling)
 * individual goals forward from that day's view-only page.
 *
 * A day drops out of this list once every one of its goals has either been
 * reviewed or re-attempted (rescheduled forward, which sets status to
 * "postponed" but never touches reviewed_at), once it's been manually
 * cleared via the "Clear this day" button, or once it's been covered by a
 * streak pass — matches the Calendar page's "Missed"/"Cleared"/"Covered"
 * distinction, so all three stay consistent.
 */
export async function getOverdueDays(todayISO: string): Promise<OverdueDay[]> {
  const userId = await getCurrentUserId();

  const [{ data: candidatePlans, error: plansErr }, coveredDates] = await Promise.all([
    supabase
      .from("daily_plans")
      .select("id, plan_date")
      .eq("user_id", userId)
      .eq("status", "submitted")
      .is("reviewed_at", null)
      .is("cleared_at", null)
      .lt("plan_date", todayISO)
      .order("plan_date", { ascending: true }),
    getStreakPassCoveredDates("0001-01-01", todayISO),
  ]);

  if (plansErr) throw plansErr;
  const plans = (candidatePlans ?? []).filter((p) => !coveredDates.has(p.plan_date as string));
  if (plans.length === 0) return [];

  const { data: goalsData, error: goalsErr } = await supabase
    .from("goals")
    .select("plan_id, status, reviewed_at")
    .in(
      "plan_id",
      plans.map((p) => p.id)
    );

  if (goalsErr) throw goalsErr;
  const goals = goalsData ?? [];

  return plans
    .filter((plan) => {
      const planGoals = goals.filter((g) => g.plan_id === plan.id);
      if (planGoals.length === 0) return true;
      return !planGoals.every((g) => g.status === "postponed" || !!g.reviewed_at);
    })
    .map((plan) => ({
      date: plan.plan_date as string,
      goalCount: goals.filter((g) => g.plan_id === plan.id).length,
    }));
}

export async function getOverdueSummary(todayISO: string): Promise<OverdueSummary> {
  const days = await getOverdueDays(todayISO);
  return {
    count: days.length,
    oldestDate: days.length > 0 ? days[0].date : null,
  };
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

  // 1) mark old goal postponed — a raw update, not updateGoalStatus(), since
  // that would also log its own "Status changed to Rescheduled" timeline
  // entry, duplicating the more detailed "Rescheduled to <date> — <reason>"
  // entry logged via logGoalEvent below for the exact same action.
  const { error: statusErr } = await supabase
    .from("goals")
    .update({ status: "postponed" })
    .eq("id", params.goal.id);
  if (statusErr) throw statusErr;

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

  const reason = (params.reason ?? "").trim();
  await logGoalEvent(
    params.goal.id,
    "rescheduled",
    `Rescheduled to ${formatDateDisplay(params.toDateISO)}${reason ? ` — "${reason}"` : ""}`
  );

  // 3) If rescheduled to tomorrow, ensure it appears quickly by opening tomorrow plan
  const tomorrowISO = toISODate(addDays(new Date(), 1));
  if (params.toDateISO === tomorrowISO) {
    await getOrCreatePlan(tomorrowISO); // materializes via RPC
  }
}
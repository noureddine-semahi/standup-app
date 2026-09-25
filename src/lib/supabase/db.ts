import { supabase } from "@/lib/supabase/client";
import type { Theme } from "@/lib/theme";
import type { TranslationKey } from "@/lib/i18n/en";

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
  // Whether another user's email-based connection request can find this
  // account. Never affects existing connections, only future
  // find_user_by_email lookups. Defaults true.
  discoverable: boolean;

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
  privacy_accepted_at?: string | null;
  community_guidelines_accepted_at?: string | null;
};

/** Set once, the first time the user opens Community and clicks past the guidelines gate. No versioning — same limitation as privacy_accepted_at. */
export async function acceptCommunityGuidelines(): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("profiles")
    .update({ community_guidelines_accepted_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

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
  otherAvatarUrl: string | null;
  // Captured at request time (requester's own session email; the exact
  // text the recipient was found by) — a fallback for display_name, which
  // is optional at signup and often null.
  otherEmail: string | null;
  // Set once the requester has acknowledged a resolved (accepted/declined)
  // request on the Dashboard's notifications section — null while pending,
  // and irrelevant on the recipient's own side (they made the decision).
  requesterSeenAt: string | null;
};

/**
 * display_name is optional at signup and often null — falls back to the
 * same "A StandUp user" placeholder every other anonymous-person context
 * in this app already uses (feed posts, assignment labels), rather than
 * deriving anything from their email. That email fallback used to show
 * the local part of the captured email (e.g. "kabyldorado" from
 * "kabyldorado@hotmail.com") — still visibly a piece of someone's email
 * address, not a real identifier.
 */
export function connectionDisplayName(
  c: Pick<Connection, "otherDisplayName">,
  t: (key: TranslationKey) => string
): string {
  return c.otherDisplayName || t("social.anonymousUser");
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
export type PostVisibility = "connections" | "everyone" | "individual";

/**
 * One feed item, as returned by get_feed() — a goal_glimpse post carries a
 * live current goal list (not a snapshot: progress keeps updating as the
 * owner works through their day), an achievement post carries just the id
 * (title/description/icon resolve client-side from achievements.ts, since
 * those are translation keys the server can't render), and a motivational
 * post carries freeform text. targetUserId/targetDisplayName are only set
 * when visibility is "individual" (shared with exactly one connection).
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
  targetUserId: string | null;
  targetDisplayName: string | null;
  imagePath: string | null;
  videoPath: string | null;
  // Set only when THIS viewer reached the post via a share rather than
  // its own visibility rules — null for the owner's own view, or for
  // anyone who could already see it normally.
  sharedById: string | null;
  sharedByDisplayName: string | null;
  // Per-reaction-type counts (e.g. { like: 2, fire: 1 }) — a type with
  // zero reactions is simply absent, not present at 0.
  reactionCounts: Record<string, number>;
  commentCount: number;
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

/**
 * An undated goal in the backlog — not yet attached to any daily_plans
 * row. Promoted to a real Goal via promoteBacklogGoal() when a day opens
 * up for it. A row with target_date set is a "Long-Term Goal" (its own
 * section on the Backlog page); target_date null is a plain backlog item.
 */
export type BacklogGoal = {
  id: string;
  user_id: string;
  title: string;
  details: string | null;
  priority: number;
  target_date: string | null;
  category: string | null;
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

  // Same seeding pattern as display_name above, for the Privacy Policy
  // consent timestamp captured at signup (see PrivacyConsentModal).
  const metaPrivacyAcceptedAt =
    typeof userData.user.user_metadata?.privacy_accepted_at === "string"
      ? userData.user.user_metadata.privacy_accepted_at
      : null;

  const { data: created, error: insErr } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      display_name: metaDisplayName,
      points: 0,
      theme: "dark",
      privacy_accepted_at: metaPrivacyAcceptedAt,
    })
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

/** Whether this account can be found by another user's email-based connection request. Never affects existing connections, only future find_user_by_email lookups. */
export async function updateDiscoverablePreference(discoverable: boolean) {
  const userId = await getCurrentUserId();
  const { error } = await supabase.from("profiles").update({ discoverable }).eq("id", userId);
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

export async function addBacklogGoal(
  title: string,
  details: string | null,
  priority: number,
  targetDate: string | null = null,
  category: string | null = null
): Promise<BacklogGoal> {
  const userId = await getCurrentUserId();
  const trimmed = title.trim();

  const { data, error } = await supabase
    .from("goal_backlog")
    .insert({
      user_id: userId,
      title: trimmed,
      details: details?.trim() || null,
      priority,
      target_date: targetDate,
      category: category?.trim() || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as BacklogGoal;
}

/** Thin wrapper for the Long-Term Goals form — same table/insert as addBacklogGoal, just a self-documenting call site. */
export async function addLongTermGoal(
  title: string,
  details: string | null,
  priority: number,
  targetDate: string,
  category: string | null
): Promise<BacklogGoal> {
  return addBacklogGoal(title, details, priority, targetDate, category);
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

const POST_IMAGE_BUCKET = "post-images";
export const POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// PNG/JPEG/WEBP only — deliberately narrower than ATTACHMENT_ALLOWED_TYPES.
// Goal attachments are opened via window.open() and never rendered inline,
// so HEIC's spotty <img> support doesn't matter there. Post images render
// inline in other users' feeds across arbitrary browsers, so a HEIC photo
// could be posted but invisible to viewers — excluded to avoid that.
export const POST_IMAGE_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Uploads to the private "post-images" bucket and returns the storage path
 * (not a URL — see getPostImageUrl). Does not touch the posts table; the
 * caller wires the returned path into createMotivationalPost's imagePath.
 */
export async function uploadPostImage(file: File): Promise<string> {
  if (!POST_IMAGE_ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Only PNG, JPEG, or WEBP images are supported.");
  }
  if (file.size > POST_IMAGE_MAX_BYTES) {
    throw new Error(`Image too large — max ${Math.round(POST_IMAGE_MAX_BYTES / (1024 * 1024))}MB.`);
  }

  const userId = await getCurrentUserId();
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const storagePath = `${userId}/${crypto.randomUUID()}${ext}`;

  const { error } = await supabase.storage
    .from(POST_IMAGE_BUCKET)
    .upload(storagePath, file, { contentType: file.type });
  if (error) throw error;
  return storagePath;
}

/**
 * Signed URL, 1 hour — longer than getAttachmentUrl's 5 minutes (a one-off
 * click-to-open link) since this backs passive inline <img> rendering
 * during a feed-scroll session that can easily outlast 5 minutes, while
 * still expiring well within a browsing day rather than lingering
 * indefinitely like a public URL would.
 */
export async function getPostImageUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(POST_IMAGE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

async function deleteOrphanedPostImage(storagePath: string) {
  await supabase.storage.from(POST_IMAGE_BUCKET).remove([storagePath]);
}

const POST_VIDEO_BUCKET = "post-videos";
export const POST_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
// mp4/webm only -- unlike photos, an unplayable video renders as nothing
// at all in a viewer's feed, so format breadth matters less than every
// major browser being able to actually play what's allowed.
export const POST_VIDEO_ALLOWED_TYPES = ["video/mp4", "video/webm"];
export const POST_VIDEO_MAX_DURATION_SECONDS = 60;

// Reads a video's duration client-side (no server-side transcoding
// pipeline exists to enforce this otherwise) by loading it into an
// off-DOM <video> element just for its metadata. Resolves null rather
// than rejecting on any failure -- an unreadable duration shouldn't by
// itself block an otherwise-valid upload.
function readVideoDurationSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      const url = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(video.duration) ? video.duration : null);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      video.src = url;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Uploads to the private "post-videos" bucket and returns the storage
 * path (not a URL — see getPostVideoUrl). Does not touch the posts
 * table; the caller wires the returned path into createMotivationalPost's
 * videoPath. Mirrors uploadPostImage, plus a duration check images don't
 * need.
 */
export async function uploadPostVideo(file: File): Promise<string> {
  if (!POST_VIDEO_ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Only MP4 or WEBM videos are supported.");
  }
  if (file.size > POST_VIDEO_MAX_BYTES) {
    throw new Error(`Video too large — max ${Math.round(POST_VIDEO_MAX_BYTES / (1024 * 1024))}MB.`);
  }
  const duration = await readVideoDurationSeconds(file);
  if (duration !== null && duration > POST_VIDEO_MAX_DURATION_SECONDS) {
    throw new Error(`Video too long — max ${POST_VIDEO_MAX_DURATION_SECONDS}s.`);
  }

  const userId = await getCurrentUserId();
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const storagePath = `${userId}/${crypto.randomUUID()}${ext}`;

  const { error } = await supabase.storage
    .from(POST_VIDEO_BUCKET)
    .upload(storagePath, file, { contentType: file.type });
  if (error) throw error;
  return storagePath;
}

/** Signed URL, 1 hour — same reasoning as getPostImageUrl. */
export async function getPostVideoUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(POST_VIDEO_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

async function deleteOrphanedPostVideo(storagePath: string) {
  await supabase.storage.from(POST_VIDEO_BUCKET).remove([storagePath]);
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

/**
 * Notes + logged history events for a batch of goals — feeds
 * buildGoalTimeline for each. Goes through the get_goal_notes RPC rather
 * than a plain client query: for any requested goal the caller has
 * assigned out, this also pulls in the recipient's own notes on their
 * separate copy (their real, logged status changes/reviews/etc.) tagged
 * under the SAME requested goal id, so an assigner can actually see what
 * happened on a goal they handed off, not just their own frozen "Goal
 * created" entry. A plain query against goal_notes' own RLS could never
 * do this — it only ever returns the caller's own rows.
 */
export async function getNotesForGoals(goalIds: string[]): Promise<Record<string, any[]>> {
  if (goalIds.length === 0) return {};

  const { data, error } = await supabase.rpc("get_goal_notes", { p_goal_ids: goalIds });
  if (error) throw error;

  const rows = (data ?? []) as {
    request_goal_id: string;
    note: string;
    created_at: string;
    kind: string | null;
    actor_display_name: string | null;
  }[];

  const byGoal: Record<string, any[]> = {};
  rows.forEach((r) => {
    (byGoal[r.request_goal_id] ??= []).push({
      goal_id: r.request_goal_id,
      note: r.actor_display_name ? `${r.actor_display_name}: ${r.note}` : r.note,
      created_at: r.created_at,
      kind: r.kind,
    });
  });
  Object.values(byGoal).forEach((notes) =>
    notes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  );
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

export type DiscoverableUser = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  invited: boolean;
  createdAt: string; // pagination cursor only, not displayed
};

/** Browsable page of discoverable users (see get_discoverable_users for the exclusion rules), newest accounts first. */
export async function getDiscoverableUsers(beforeCreatedAt?: string, beforeId?: string): Promise<DiscoverableUser[]> {
  const { data, error } = await supabase.rpc("get_discoverable_users", {
    p_limit: 30,
    p_before: beforeCreatedAt ?? null,
    p_before_id: beforeId ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    invited: r.invited,
    createdAt: r.created_at,
  }));
}

/** Invite a user found via discovery (id already known — no email lookup needed). Same dedupe/self-request handling as sendConnectionRequest. */
export async function sendConnectionRequestToUser(userId: string): Promise<void> {
  const currentUserId = await getCurrentUserId();
  if (userId === currentUserId) throw new Error("You can't connect with yourself.");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { error } = await supabase.from("connections").insert({
    requester_id: currentUserId,
    recipient_id: userId,
    requester_email: session?.user?.email ?? null,
    recipient_email: null, // unknown here — discovery only exposes name/avatar, not email
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
 * out which side of requester/recipient they are. Goes through the
 * get_my_connections RPC (security definer) rather than a plain client
 * query joining profiles directly -- profiles' only SELECT policy is
 * "read your own row" (auth.uid() = id), so a direct query for the OTHER
 * party's display_name/avatar_url has always silently returned nothing.
 */
export async function listConnections(): Promise<Connection[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase.rpc("get_my_connections");
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    requester_id: string;
    recipient_id: string;
    status: string;
    created_at: string;
    responded_at: string | null;
    requester_email: string | null;
    recipient_email: string | null;
    requester_seen_at: string | null;
    other_display_name: string | null;
    other_avatar_url: string | null;
  }[];

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
      otherDisplayName: r.other_display_name,
      otherAvatarUrl: r.other_avatar_url,
      otherEmail: isRequester ? r.recipient_email : r.requester_email,
      requesterSeenAt: r.requester_seen_at,
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

/** Acknowledges a resolved connection request on the requester's side (see Connection.requesterSeenAt) — a security definer RPC since the requester has no UPDATE grant on this table under RLS at all, resolved or not. */
export async function markConnectionSeen(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_connection_seen", { p_connection_id: id });
  if (error) throw error;
}

/** Covers both "cancel my outgoing request" and "remove an existing connection". */
export async function removeConnection(id: string): Promise<void> {
  const { error } = await supabase.from("connections").delete().eq("id", id);
  if (error) throw error;
}

// ── Goal assignments ──────────────────────────────────────────────────

export type GoalAssignmentStatus = "pending" | "accepted" | "declined";
export type GoalAssignmentType = "shared" | "exclusive";

/**
 * One goal_assignments row as returned by get_my_goal_assignments(), with
 * `direction` pre-computed against the caller so UI never has to compare
 * ids itself — same convenience Connection.direction already provides.
 * assignerGoalStatus/recipientGoalStatus are the LIVE current status of
 * each side's own independent goal (null before a recipient accepts, or
 * if that goal was since deleted) — this is the one place either party
 * can see the other's goal status, since goals' own RLS is select-own-only.
 */
export type GoalAssignment = {
  id: string;
  status: GoalAssignmentStatus;
  createdAt: string;
  respondedAt: string | null;
  planDate: string;
  snapshotTitle: string;
  snapshotDetails: string | null;
  snapshotPriority: number;
  assignerId: string;
  assignerDisplayName: string | null;
  recipientId: string;
  recipientDisplayName: string | null;
  assignerGoalStatus: GoalStatus | null;
  recipientGoalStatus: GoalStatus | null;
  direction: "assigned" | "received";
  // Set once the assigner has acknowledged a resolved (accepted/declined)
  // assignment on the Dashboard's notifications section — null while
  // pending, and irrelevant on the recipient's own side.
  assignerSeenAt: string | null;
  // The assigner's own goals.id — lets Today/Tomorrow match this
  // assignment back to a specific row on the assigner's own plan so it
  // can switch to read-only. Null if that goal was since deleted.
  assignerGoalId: string | null;
  // "shared": both sides independently track their own copy, no lock at
  // all on the assigner's side. "exclusive": only the recipient can act
  // on it -- the assigner's own copy is fully locked and excluded from
  // their own day's review-before-close requirement.
  assignmentType: GoalAssignmentType;
  // The recipient's own goals.id, materialized once they accept -- the
  // mirror of assignerGoalId, for the other side. Lets Today/Tomorrow
  // recognize "this goal of mine IS an accepted assignment I received"
  // and lock its own Assign-to control (re-assigning something assigned
  // to you isn't a scenario the data model represents). Null while
  // pending/declined, or if that goal was since deleted.
  recipientGoalId: string | null;
  // The recipient's goal's ACTUAL CURRENT plan_date -- unlike planDate
  // above (a frozen snapshot from the moment of assignment), this tracks
  // live if the recipient reschedules their own copy forward. Lets the
  // assigner's Today page show a read-only view of the goal on whatever
  // date it's actually due now, not just its original date. Null before
  // acceptance or if that goal was since deleted.
  recipientPlanDate: string | null;
};

/** Assigns one of the caller's own already-saved goals to an accepted connection. Only works on a goal that already has a real id (post-autosave), same constraint the Reschedule/Checklist/Attachments/Link controls already enforce on these pages. */
export async function createGoalAssignment(
  goalId: string,
  recipientId: string,
  assignmentType: GoalAssignmentType = "exclusive"
): Promise<void> {
  const { error } = await supabase.rpc("create_goal_assignment", {
    p_goal_id: goalId,
    p_recipient_id: recipientId,
    p_assignment_type: assignmentType,
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error("This goal is already assigned.");
    }
    throw error;
  }
}

/**
 * Accept or decline a pending goal assignment. On accept, the RPC
 * materializes the recipient's own independent goal onto their plan for
 * the same plan_date as the assigner's original — never a shared row.
 */
export async function respondToGoalAssignment(assignmentId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_to_goal_assignment", {
    p_assignment_id: assignmentId,
    p_accept: accept,
  });
  if (error) throw error;
}

/** Dismiss an assignment record (either participant, any status) — never touches the recipient's already-materialized goal, only this join row. */
export async function removeGoalAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase.from("goal_assignments").delete().eq("id", assignmentId);
  if (error) throw error;
}

type GoalAssignmentRow = {
  assignment_id: string;
  status: GoalAssignmentStatus;
  created_at: string;
  responded_at: string | null;
  plan_date: string;
  snapshot_title: string;
  snapshot_details: string | null;
  snapshot_priority: number;
  assigner_id: string;
  assigner_display_name: string | null;
  recipient_id: string;
  recipient_display_name: string | null;
  assigner_goal_status: GoalStatus | null;
  recipient_goal_status: GoalStatus | null;
  assigner_seen_at: string | null;
  assigner_goal_id: string | null;
  assignment_type: GoalAssignmentType;
  recipient_goal_id: string | null;
  recipient_plan_date: string | null;
};

/** Every goal assignment the caller is either party to — the Friends tab's, Dashboard's, and Today/Tomorrow's shared source of assignment state. */
export async function getMyGoalAssignments(): Promise<GoalAssignment[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.rpc("get_my_goal_assignments");
  if (error) throw error;
  return ((data ?? []) as GoalAssignmentRow[]).map((r) => ({
    id: r.assignment_id,
    status: r.status,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
    planDate: r.plan_date,
    snapshotTitle: r.snapshot_title,
    snapshotDetails: r.snapshot_details,
    snapshotPriority: r.snapshot_priority,
    assignerId: r.assigner_id,
    assignerDisplayName: r.assigner_display_name,
    recipientId: r.recipient_id,
    recipientDisplayName: r.recipient_display_name,
    assignerGoalStatus: r.assigner_goal_status,
    recipientGoalStatus: r.recipient_goal_status,
    direction: r.assigner_id === userId ? "assigned" : "received",
    assignerSeenAt: r.assigner_seen_at,
    assignerGoalId: r.assigner_goal_id,
    assignmentType: r.assignment_type,
    recipientGoalId: r.recipient_goal_id,
    recipientPlanDate: r.recipient_plan_date,
  }));
}

/** Acknowledges a resolved goal assignment on the assigner's side (see GoalAssignment.assignerSeenAt) — a security definer RPC, same reasoning as markConnectionSeen. */
export async function markGoalAssignmentSeen(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_goal_assignment_seen", { p_assignment_id: id });
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
  visibility: PostVisibility,
  targetUserId?: string
): Promise<void> {
  const plan = await getOrCreatePlan(planDateISO);
  const { error } = await supabase.rpc("upsert_daily_glimpse", {
    p_plan_id: plan.id,
    p_plan_date: planDateISO,
    p_visibility: visibility,
    p_target_user_id: targetUserId ?? null,
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
): Promise<{ id: string; visibility: PostVisibility; targetUserId: string | null } | null> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("posts")
    .select("id, visibility, target_user_id")
    .eq("user_id", userId)
    .eq("type", "goal_glimpse")
    .eq("plan_date", planDateISO)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { id: data.id, visibility: data.visibility as PostVisibility, targetUserId: data.target_user_id }
    : null;
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

/**
 * Returns the new post's id so a caller can immediately follow up with
 * addMention() for any @mentions typed into the composer. The id is
 * generated client-side (same pattern uploadPostImage already uses for
 * its storage path) and inserted explicitly rather than requested back
 * via .select() -- an INSERT ... RETURNING makes Postgres also enforce
 * the table's SELECT policy (posts_select_visible/can_view_post) on the
 * brand-new row before it's returned, on top of the INSERT policy, and
 * that combination was intermittently failing with "new row violates
 * row-level security policy" even for the poster's own row. Knowing the
 * id upfront sidesteps needing RETURNING at all.
 */
export async function createMotivationalPost(
  body: string,
  visibility: PostVisibility,
  imagePath?: string | null,
  videoPath?: string | null
): Promise<string | null> {
  const userId = await getCurrentUserId();
  const trimmed = body.trim().slice(0, MOTIVATIONAL_POST_MAX_LENGTH);
  if (!trimmed) return null;
  const id = crypto.randomUUID();
  const { error } = await supabase.from("posts").insert({
    id,
    user_id: userId,
    type: "motivational",
    body: trimmed,
    visibility,
    image_path: imagePath ?? null,
    video_path: videoPath ?? null,
  });
  if (error) {
    // Mirrors uploadGoalAttachment's orphan cleanup: the image/video was
    // already uploaded successfully, so a failed post insert must not
    // leave it stranded with no row and no way for the user to ever
    // delete it. Only one of the two is ever actually set (the composer
    // enforces image XOR video), but cleaning up both is harmless.
    if (imagePath) await deleteOrphanedPostImage(imagePath);
    if (videoPath) await deleteOrphanedPostVideo(videoPath);
    throw error;
  }
  return id;
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
  target_user_id: string | null;
  target_display_name: string | null;
  image_path: string | null;
  video_path: string | null;
  shared_by_id: string | null;
  shared_by_display_name: string | null;
  reaction_counts: Record<string, number> | null;
  comment_count: number;
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
    targetUserId: r.target_user_id,
    targetDisplayName: r.target_display_name,
    imagePath: r.image_path,
    videoPath: r.video_path,
    sharedById: r.shared_by_id,
    sharedByDisplayName: r.shared_by_display_name,
    reactionCounts: r.reaction_counts ?? {},
    commentCount: r.comment_count,
  }));
}

/** Share a post you can see with one of your own accepted connections — even one who couldn't otherwise see it (extends visibility within your own network, doesn't leak beyond it). */
export async function sharePost(postId: string, recipientId: string): Promise<void> {
  const { error } = await supabase.rpc("share_post", { p_post_id: postId, p_recipient_id: recipientId });
  if (error) throw error;
}

// ── @mentions ────────────────────────────────────────────────────────
// Scoped the same way sharePost is: only ever an accepted connection,
// re-validated server-side regardless of what the composer's autocomplete
// already restricted to.

/** Tags an accepted connection on a post (commentId omitted) or a specific comment (commentId set) — they'll see it as a notification. */
export async function addMention(postId: string, mentionedUserId: string, commentId?: string | null): Promise<void> {
  const { error } = await supabase.rpc("add_mention", {
    p_post_id: postId,
    p_mentioned_user_id: mentionedUserId,
    p_comment_id: commentId ?? null,
  });
  if (error) throw error;
}

export type Mention = {
  id: string;
  postId: string;
  commentId: string | null;
  mentionedBy: string;
  mentionedByDisplayName: string | null;
  preview: string | null;
  createdAt: string;
  seenAt: string | null;
};

type MentionRow = {
  mention_id: string;
  post_id: string;
  comment_id: string | null;
  mentioned_by: string;
  mentioned_by_display_name: string | null;
  preview: string | null;
  created_at: string;
  seen_at: string | null;
};

/** Every mention of the current user, newest first — powers the Dashboard notifications section and the header bell count. */
export async function getMyMentions(): Promise<Mention[]> {
  const { data, error } = await supabase.rpc("get_my_mentions");
  if (error) throw error;
  return ((data ?? []) as MentionRow[]).map((r) => ({
    id: r.mention_id,
    postId: r.post_id,
    commentId: r.comment_id,
    mentionedBy: r.mentioned_by,
    mentionedByDisplayName: r.mentioned_by_display_name,
    preview: r.preview,
    createdAt: r.created_at,
    seenAt: r.seen_at,
  }));
}

/** Acknowledges a mention on the Dashboard's notifications section — never deletes it, same "Got it" pattern connections/assignments already use. */
export async function markMentionSeen(mentionId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_mention_seen", { p_mention_id: mentionId });
  if (error) throw error;
}

/** Pass reaction: null to remove the viewer's current reaction. */
export async function setPostReaction(postId: string, reaction: GlimpseReaction | null): Promise<void> {
  const { error } = await supabase.rpc("set_post_reaction", { p_post_id: postId, p_reaction: reaction });
  if (error) throw error;
}

export type PostComment = {
  id: string;
  postId: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  parentCommentId: string | null;
  body: string;
  createdAt: string;
  myReaction: GlimpseReaction | null;
  reactionCounts: Record<string, number>;
};

type CommentRow = {
  comment_id: string;
  post_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  parent_comment_id: string | null;
  body: string;
  created_at: string;
  my_reaction: GlimpseReaction | null;
  reaction_counts: Record<string, number> | null;
};

function commentRowToComment(r: CommentRow): PostComment {
  return {
    id: r.comment_id,
    postId: r.post_id,
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    parentCommentId: r.parent_comment_id,
    body: r.body,
    createdAt: r.created_at,
    myReaction: r.my_reaction,
    reactionCounts: r.reaction_counts ?? {},
  };
}

/** Every comment + reply on one post, oldest first (threads read top-down). */
export async function getPostComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase.rpc("get_post_comments", { p_post_id: postId });
  if (error) throw error;
  return ((data ?? []) as CommentRow[]).map(commentRowToComment);
}

// ── Admin moderation ─────────────────────────────────────────────────
// Full visibility into Community regardless of a post's own visibility
// setting, plus removal — for enforcing the community guidelines, not for
// everyday feed browsing (see getFeed for that). Every RPC these call
// throws server-side if the caller isn't an admin.

export type AdminFeedPost = Post & { reactionCount: number; commentCount: number };

type AdminFeedRow = FeedRow & { reaction_count: number; comment_count: number };

/** Every post ever published, any visibility, newest first — admin-only. */
export async function getAdminFeed(before?: string): Promise<AdminFeedPost[]> {
  const { data, error } = await supabase.rpc("admin_get_feed", {
    p_limit: 50,
    p_before: before ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as AdminFeedRow[]).map((r) => ({
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
    myReaction: null,
    goals: r.goals,
    targetUserId: r.target_user_id,
    targetDisplayName: r.target_display_name,
    imagePath: r.image_path,
    videoPath: r.video_path,
    sharedById: null,
    sharedByDisplayName: null,
    reactionCounts: {},
    reactionCount: r.reaction_count,
    commentCount: r.comment_count,
  }));
}

/** Removes any post (not just your own) and logs it to the admin audit log — admin-only. */
export async function adminDeletePost(postId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_post", { p_post_id: postId });
  if (error) throw error;
}

/** Every comment on one post regardless of the post's own visibility — admin-only. */
export async function getAdminPostComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase.rpc("admin_get_post_comments", { p_post_id: postId });
  if (error) throw error;
  return ((data ?? []) as Omit<CommentRow, "my_reaction">[]).map((r) => ({
    id: r.comment_id,
    postId: r.post_id,
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    parentCommentId: r.parent_comment_id,
    body: r.body,
    createdAt: r.created_at,
    myReaction: null,
    reactionCounts: {},
  }));
}

/** Removes any comment (not just your own) and logs it to the admin audit log — admin-only. */
export async function adminDeleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_comment", { p_comment_id: commentId });
  if (error) throw error;
}

/** Batched comment counts for a page of posts, keyed by post id — powers the collapsed "Comments (N)" toggle without a query per post. */
export async function getPostCommentCounts(postIds: string[]): Promise<Record<string, number>> {
  if (postIds.length === 0) return {};
  const { data, error } = await supabase.rpc("get_post_comment_counts", { p_post_ids: postIds });
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { post_id: string; comment_count: number }[]) {
    counts[row.post_id] = row.comment_count;
  }
  return counts;
}

/**
 * parentCommentId omitted (or null) for a top-level comment, set for a
 * reply — replies can't themselves be replied to (enforced server-side).
 * The RPC returns the raw inserted row (no profiles join), so
 * displayName/avatarUrl come back null; fill those in client-side from
 * the current user's already-known profile for optimistic display.
 */
export async function addPostComment(postId: string, body: string, parentCommentId?: string | null): Promise<PostComment> {
  const { data, error } = await supabase.rpc("add_post_comment", {
    p_post_id: postId,
    p_body: body,
    p_parent_comment_id: parentCommentId ?? null,
  });
  if (error) throw error;
  const row = data as {
    id: string;
    post_id: string;
    user_id: string;
    parent_comment_id: string | null;
    body: string;
    created_at: string;
  };
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    displayName: null,
    avatarUrl: null,
    parentCommentId: row.parent_comment_id,
    body: row.body,
    createdAt: row.created_at,
    myReaction: null,
    reactionCounts: {},
  };
}

export async function deletePostComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_post_comment", { p_comment_id: commentId });
  if (error) throw error;
}

/** Pass reaction: null to remove the viewer's current reaction. */
export async function setCommentReaction(commentId: string, reaction: GlimpseReaction | null): Promise<void> {
  const { error } = await supabase.rpc("set_comment_reaction", { p_comment_id: commentId, p_reaction: reaction });
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
import { isAtLimit, type AccountTier } from "@/lib/entitlements";

// Tools > Routines: the Free plan's cap on ACTIVE routines. The database enforces it (trigger on recurring_goal_templates,
// migration 20261112000100); this is the client's matching read of the same rule, used to say so up front.
//
// A routine counts only while it is active. Nothing here ever deletes or retires a routine: when an account that has more
// than the cap falls back to Free, only actions that would ADD an active routine (create, reactivate) are blocked.

export type RoutineLike = { active: boolean };

export function activeRoutineCount(routines: readonly RoutineLike[]): number {
  return routines.filter((r) => r.active).length;
}

/** True when the database refused because a Free account is at its active-routine limit (ROUTINE_LIMIT_REACHED, 53400). */
export function isRoutineLimitError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  return String(err.message ?? "").includes("ROUTINE_LIMIT_REACHED");
}

/**
 * Whether the account is at (or over) the active-routine cap right now. `tier` is null until the account's tier is known, in
 * which case the client says nothing and leaves it to the database. Exceeding the cap after a downgrade counts as at the limit.
 */
export function routineLimitReached(tier: AccountTier | null, routines: readonly RoutineLike[], refusedByDatabase = false): boolean {
  if (refusedByDatabase) return true;
  return tier !== null && isAtLimit(tier, "routines", activeRoutineCount(routines));
}

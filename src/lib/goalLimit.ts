import { isAtLimit, type AccountTier } from "@/lib/entitlements";

// Structured Goals (outcome_goals) and the Free plan's cap on ACTIVE ones. The database enforces it (trigger on outcome_goals,
// migration 20261113000100); this is the client's matching read of the same rule, used to say so up front and to word a refusal.
//
// Only status "active" counts. "completed" and "abandoned" (shown as Archived) do not, and neither do daily tasks or commitments
// (a different table). Nothing here ever deletes, completes or archives a Goal: after a downgrade only actions that would ADD an
// active Goal (create, reactivate) are blocked.

export type GoalLike = { status: string };

export function activeGoalCount(goals: readonly GoalLike[]): number {
  return goals.filter((g) => g.status === "active").length;
}

/** True when the database refused because a Free account is at its active-Goal limit (GOAL_LIMIT_REACHED, 53400). */
export function isGoalLimitError(e: unknown): boolean {
  const err = e as { message?: string } | null;
  if (!err) return false;
  return String(err.message ?? "").includes("GOAL_LIMIT_REACHED");
}

/** At (or over) the cap right now. `tier` is null until known: then the client says nothing and leaves it to the database. */
export function goalLimitReached(tier: AccountTier | null, goals: readonly GoalLike[], refusedByDatabase = false): boolean {
  if (refusedByDatabase) return true;
  return tier !== null && isAtLimit(tier, "structuredGoals", activeGoalCount(goals));
}

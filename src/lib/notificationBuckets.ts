import type { Connection, GoalAssignment } from "@/lib/supabase/db";

/**
 * The five "needs your attention" buckets shared by Dashboard's
 * PendingNotifications section and the header's notification bell count,
 * so the two never drift apart. See PendingNotifications.tsx for what
 * each bucket means and how it's dismissed/acknowledged.
 */
export function computeNotificationBuckets(connections: Connection[], goalAssignments: GoalAssignment[]) {
  return {
    pendingConnections: connections.filter((c) => c.direction === "incoming" && c.status === "pending"),
    pendingAssignments: goalAssignments.filter((a) => a.direction === "received" && a.status === "pending"),
    pendingAssignedByYou: goalAssignments.filter((a) => a.direction === "assigned" && a.status === "pending"),
    resolvedConnections: connections.filter(
      (c) => c.direction === "outgoing" && c.status !== "pending" && !c.requesterSeenAt
    ),
    resolvedAssignments: goalAssignments.filter(
      (a) => a.direction === "assigned" && a.status !== "pending" && !a.assignerSeenAt
    ),
  };
}

export function countNotifications(connections: Connection[], goalAssignments: GoalAssignment[]): number {
  const b = computeNotificationBuckets(connections, goalAssignments);
  return (
    b.pendingConnections.length +
    b.pendingAssignments.length +
    b.pendingAssignedByYou.length +
    b.resolvedConnections.length +
    b.resolvedAssignments.length
  );
}

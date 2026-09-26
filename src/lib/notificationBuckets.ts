import type { Connection, GoalAssignment, Mention } from "@/lib/supabase/db";

/**
 * The seven "needs your attention" buckets shared by Dashboard's
 * PendingNotifications section and the header's notification bell count,
 * so the two never drift apart. See PendingNotifications.tsx for what
 * each bucket means and how it's dismissed/acknowledged.
 */
export function computeNotificationBuckets(
  connections: Connection[],
  goalAssignments: GoalAssignment[],
  mentions: Mention[] = []
) {
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
    // Scoped to "canceled" specifically (not every non-pending status,
    // the way resolvedAssignments is) -- recipientSeenAt only started
    // getting set once cancellation shipped, so a broader filter would
    // flood every existing accepted/declined row as a fresh notification.
    // Only the ASSIGNER can cause a "canceled" status on a received
    // assignment (the recipient backing out of their own accepted one
    // sets recipientSeenAt immediately, self-caused, same convention
    // assignerSeenAt already uses) -- so this bucket only ever fires for
    // exactly the case its name describes.
    canceledForRecipient: goalAssignments.filter(
      (a) => a.direction === "received" && a.status === "canceled" && !a.recipientSeenAt
    ),
    unseenMentions: mentions.filter((m) => !m.seenAt),
  };
}

export function countNotifications(
  connections: Connection[],
  goalAssignments: GoalAssignment[],
  mentions: Mention[] = []
): number {
  const b = computeNotificationBuckets(connections, goalAssignments, mentions);
  return (
    b.pendingConnections.length +
    b.pendingAssignments.length +
    b.pendingAssignedByYou.length +
    b.resolvedConnections.length +
    b.resolvedAssignments.length +
    b.canceledForRecipient.length +
    b.unseenMentions.length
  );
}

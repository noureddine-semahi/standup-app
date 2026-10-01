import { useEffect, useState } from "react";
import { joinTeamGoal, addTeamGoalItem, toggleTeamGoalItem, type TeamGoalItem } from "@/lib/supabase/db";

/**
 * Owns the optimistic-update state machine for one team_goal post's join/
 * checklist interactions — same shape as usePostReaction in
 * glimpseReactions.ts, kept as its own copy since team goals have their
 * own three actions (join, toggle item, add item) rather than one.
 * Does NOT fetch the initial values itself; the caller supplies them (the
 * feed already returns each team_goal post's live state in one call).
 */
export function useTeamGoalCard(params: {
  teamGoalId: string;
  initialJoined: boolean;
  initialItems: TeamGoalItem[];
  initialParticipantCount: number;
  initialStatus: "open" | "completed";
}) {
  const { teamGoalId } = params;
  const [joined, setJoined] = useState(params.initialJoined);
  const [items, setItems] = useState(params.initialItems);
  const [participantCount, setParticipantCount] = useState(params.initialParticipantCount);
  const [status, setStatus] = useState(params.initialStatus);
  const [joining, setJoining] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Keeps this in sync if the parent re-fetches the feed (e.g. another
  // participant's change showing up on next load).
  useEffect(() => {
    setJoined(params.initialJoined);
    setItems(params.initialItems);
    setParticipantCount(params.initialParticipantCount);
    setStatus(params.initialStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.initialJoined, params.initialItems, params.initialParticipantCount, params.initialStatus]);

  async function join() {
    if (joining || joined) return;
    setJoining(true);
    setError(null);
    setJoined(true);
    setParticipantCount((c) => c + 1);
    try {
      await joinTeamGoal(teamGoalId);
    } catch (e: any) {
      setJoined(false);
      setParticipantCount((c) => Math.max(0, c - 1));
      setError(e?.message ?? "Failed to join.");
    } finally {
      setJoining(false);
    }
  }

  async function toggleItem(itemId: string, done: boolean) {
    if (togglingIds.has(itemId)) return;
    const prevItems = items;
    const prevStatus = status;
    setTogglingIds((prev) => new Set(prev).add(itemId));
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, done } : i)));
    setError(null);
    try {
      // The server (not a client guess) decides whether every item is now
      // checked — avoids a wrong "completed" flip if another participant
      // toggled something concurrently.
      const resultStatus = await toggleTeamGoalItem(itemId, done);
      setStatus(resultStatus);
    } catch (e: any) {
      setItems(prevItems);
      setStatus(prevStatus);
      setError(e?.message ?? "Failed to update.");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function addItem(text: string) {
    const trimmed = text.trim();
    if (!trimmed || addingItem) return;
    setAddingItem(true);
    setError(null);
    try {
      const created = await addTeamGoalItem(teamGoalId, trimmed);
      setItems((prev) => [...prev, created]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add item.");
    } finally {
      setAddingItem(false);
    }
  }

  return { joined, items, participantCount, status, joining, addingItem, togglingIds, error, join, toggleItem, addItem };
}

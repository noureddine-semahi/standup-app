"use client";

import { useEffect, useMemo, useState } from "react";
import { getAssigneeChecklists, type AssigneeChecklistItem } from "@/lib/supabase/db";

/** What the UI knows about one assignee checklist: still loading, loaded (items may be empty), nothing to show, or the request failed. */
export type AssigneeChecklistEntry = { state: "loading" } | { state: "error" } | { state: "unavailable" } | { state: "ready"; items: AssigneeChecklistItem[] };

const LOADING: AssigneeChecklistEntry = { state: "loading" };

/**
 * Loads the assignee's checklist for every ACCEPTED, ASSIGNED-OUT assignment in ONE batched request (re-run only when that set of
 * ids changes, and when the tab becomes visible or the window regains focus, so the assigner sees the assignee's latest changes). A failed refresh keeps whatever was
 * already shown; only a checklist that never loaded becomes "error".
 */
export function useAssigneeChecklists(assignments: { id: string; direction: string; status: string }[]) {
  const ids = useMemo(
    () => assignments.filter((a) => a.direction === "assigned" && a.status === "accepted").map((a) => a.id).sort(),
    [assignments]
  );
  const key = ids.join(",");
  const [results, setResults] = useState<Record<string, AssigneeChecklistEntry>>({});

  useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    let cancelled = false;
    let inFlight = false; // focus + visibilitychange often fire together: one request at a time
    const load = () => {
      if (inFlight) return Promise.resolve();
      inFlight = true;
      return getAssigneeChecklists(list)
        .then((fresh) => {
          if (!cancelled) setResults((prev) => ({ ...prev, ...fresh }));
        })
        .catch(() => {
          if (cancelled) return;
          setResults((prev) => {
            const next = { ...prev };
            for (const id of list) if (!next[id] || next[id].state === "loading" || next[id].state === "error") next[id] = { state: "error" };
            return next;
          });
        })
        .finally(() => {
          inFlight = false;
        });
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onFocus = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [key]);

  return (assignmentId: string): AssigneeChecklistEntry => results[assignmentId] ?? LOADING;
}

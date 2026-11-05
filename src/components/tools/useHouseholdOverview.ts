"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HouseholdConflictError,
  HouseholdIntegrityError,
  HouseholdValidationError,
  getHouseholdShared,
  getPartnerIncluded,
  isHouseholdSharedUnavailableError,
  saveHouseholdShared,
  setPartnerIncluded,
  type ReadyState,
} from "@/lib/supabase/householdShared";
import type { Composition, SharedHousehold } from "@/lib/householdPlan";
import type { SharedValidationError } from "@/lib/householdShared";

// Loads what the Household screens need beyond the Me and Partner profiles: the household's shared data and the
// partner's include_in_household setting. Shared data is saved ONLY through saveShared, which the shared-expense editor
// calls on an explicit user action; the Overview itself never saves. Every save goes through saveHouseholdShared, so it
// is validated, revision-checked (a stale save is refused, never merged) and blocked over unreadable stored data unless
// the user acknowledged exactly what was shown.
// Mounted only while the Household tab is open, so the Me and Partner screens do no extra work.

export type OverviewData =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  /** `shared` is null when the shared-data columns don't exist yet (migration not applied): the overview then shows only what needs no shared data. */
  | { phase: "ready"; shared: ReadyState | null; included: boolean };

/** What happened to a save. Nothing is ever retried or merged automatically. */
export type SaveOutcome =
  | { ok: true }
  /** The data failed validation; nothing was sent. */
  | { ok: false; kind: "validation"; errors: SharedValidationError[] }
  /** Someone else saved first. `data` now holds the latest stored version; nothing of ours was written. */
  | { ok: false; kind: "conflict" }
  /** Stored data is unreadable and no (or a stale) acknowledgement was given. Nothing was written. */
  | { ok: false; kind: "integrity" }
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "error"; message: string };

export type OverviewController = {
  data: OverviewData;
  /** true while the include flag is being saved */
  saving: boolean;
  /** an error from the last include change (null when none) */
  includeError: boolean;
  /** true while a shared-data save is in flight (saves never overlap) */
  savingShared: boolean;
  /**
   * Saves the household's shared data (expenses etc.) against the revision that was loaded. `acknowledge` must be true
   * to save over stored data that can't be fully read; it is tied to exactly the content the user was shown.
   */
  saveShared: (next: { shared: SharedHousehold; composition: Composition }, opts?: { acknowledge?: boolean }) => Promise<SaveOutcome>;
  setIncluded: (next: boolean) => Promise<void>;
  reload: () => void;
};

export function useHouseholdOverview(partnerId: string | null, fallbackError: string): OverviewController {
  const [data, setData] = useState<OverviewData>({ phase: "loading" });
  const [saving, setSaving] = useState(false);
  const [includeError, setIncludeError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [savingShared, setSavingShared] = useState(false);
  const inFlight = useRef(false);
  const dataRef = useRef<OverviewData>(data);
  dataRef.current = data;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [shared, flag] = await Promise.all([getHouseholdShared(), partnerId ? getPartnerIncluded() : Promise.resolve(null)]);
        if (cancelled) return;
        setData({ phase: "ready", shared: shared.status === "ready" ? shared : null, included: flag !== false });
      } catch (e) {
        if (cancelled) return;
        const message = (e as { message?: unknown } | null)?.message;
        setData({ phase: "error", message: typeof message === "string" && message ? message : fallbackError });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerId, fallbackError, nonce]);

  const setIncluded = useCallback(
    async (next: boolean) => {
      if (!partnerId) return;
      setSaving(true);
      setIncludeError(false);
      try {
        const saved = await setPartnerIncluded(partnerId, next);
        if (alive.current) setData((d) => (d.phase === "ready" ? { ...d, included: saved } : d));
      } catch {
        if (alive.current) setIncludeError(true);
      } finally {
        if (alive.current) setSaving(false);
      }
    },
    [partnerId]
  );

  const saveShared = useCallback(async (next: { shared: SharedHousehold; composition: Composition }, opts?: { acknowledge?: boolean }): Promise<SaveOutcome> => {
    const cur = dataRef.current;
    if (cur.phase !== "ready" || !cur.shared) return { ok: false, kind: "unavailable" };
    if (inFlight.current) return { ok: false, kind: "error", message: "busy" };
    inFlight.current = true;
    setSavingShared(true);
    try {
      const saved = await saveHouseholdShared({
        expectedRevision: cur.shared.revision,
        shared: next.shared,
        composition: next.composition,
        acknowledgeIntegrity: opts?.acknowledge ? cur.shared.integrity.fingerprint : undefined,
      });
      if (alive.current) setData((d) => (d.phase === "ready" ? { ...d, shared: saved } : d));
      return { ok: true };
    } catch (e) {
      if (e instanceof HouseholdValidationError) return { ok: false, kind: "validation", errors: e.errors };
      if (e instanceof HouseholdConflictError) {
        // Show the latest stored version; our edit was NOT written and is not re-applied unless the user saves again.
        if (e.latest.status === "ready" && alive.current) {
          const latest = e.latest;
          setData((d) => (d.phase === "ready" ? { ...d, shared: latest } : d));
        }
        return { ok: false, kind: "conflict" };
      }
      if (e instanceof HouseholdIntegrityError) return { ok: false, kind: "integrity" };
      if (isHouseholdSharedUnavailableError(e)) return { ok: false, kind: "unavailable" };
      const message = (e as { message?: unknown } | null)?.message;
      return { ok: false, kind: "error", message: typeof message === "string" && message ? message : fallbackError };
    } finally {
      inFlight.current = false;
      if (alive.current) setSavingShared(false);
    }
  }, [fallbackError]);

  const reload = useCallback(() => {
    setData({ phase: "loading" });
    setNonce((n) => n + 1);
  }, []);

  return { data, saving, includeError, savingShared, saveShared, setIncluded, reload };
}

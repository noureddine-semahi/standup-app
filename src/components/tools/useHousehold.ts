"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinancialProfile } from "@/lib/financialPlanner";
import {
  createPartner,
  getPartner,
  isHouseholdUnavailableError,
  removePartner,
  renamePartner,
  savePartnerProfile,
  type PartnerRecord,
} from "@/lib/supabase/household";
import { parsePartnerName } from "@/lib/household";
import type { FinancialProfileController, PlannerLoadState } from "./useFinancialProfile";

/**
 * The household's one optional partner. Every action resolves to an error message, or null on success.
 * Phase 1 only: no household totals, shared costs, record assignments or invitations.
 */
export type HouseholdController = {
  state: PlannerLoadState;
  loadError: string | null;
  partner: PartnerRecord | null;
  addPartner: (name: string) => Promise<string | null>;
  renamePartner: (name: string) => Promise<string | null>;
  removePartner: () => Promise<string | null>;
  /** Merges a patch into the partner's profile and saves it (same contract as the personal profile). */
  savePartner: (patch: Partial<FinancialProfile>) => Promise<string | null>;
};

function errorMessage(e: unknown, fallback: string): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : fallback;
}

export function useHousehold(fallbackError: string): HouseholdController {
  const [state, setState] = useState<PlannerLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partner, setPartner] = useState<PartnerRecord | null>(null);
  const latest = useRef<PartnerRecord | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getPartner();
        if (cancelled) return;
        latest.current = loaded;
        setPartner(loaded);
        setLoadError(null);
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        if (isHouseholdUnavailableError(e)) setState("unavailable");
        else {
          setLoadError(errorMessage(e, fallbackError));
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fallbackError]);

  const apply = useCallback((next: PartnerRecord | null) => {
    latest.current = next;
    setPartner(next);
  }, []);

  // Saves run one after another, each merging onto the newest saved partner profile.
  const enqueue = useCallback(
    (fn: () => Promise<void>): Promise<string | null> => {
      const run = queue.current.then(async () => {
        try {
          await fn();
          return null;
        } catch (e) {
          return errorMessage(e, fallbackError);
        }
      });
      queue.current = run;
      return run;
    },
    [fallbackError]
  );

  const addPartner = useCallback(
    (name: string) =>
      enqueue(async () => {
        if (latest.current) throw new Error(fallbackError);
        const parsed = parsePartnerName(name);
        if (!parsed.ok) throw new Error(fallbackError);
        apply(await createPartner(parsed.name));
      }),
    [apply, enqueue, fallbackError]
  );

  const rename = useCallback(
    (name: string) =>
      enqueue(async () => {
        const current = latest.current;
        const parsed = parsePartnerName(name);
        if (!current || !parsed.ok) throw new Error(fallbackError);
        apply(await renamePartner(current.id, parsed.name));
      }),
    [apply, enqueue, fallbackError]
  );

  const remove = useCallback(
    () =>
      enqueue(async () => {
        const current = latest.current;
        if (!current) return;
        await removePartner(current.id);
        apply(null);
      }),
    [apply, enqueue]
  );

  const savePartner = useCallback(
    (patch: Partial<FinancialProfile>) =>
      enqueue(async () => {
        const current = latest.current;
        if (!current) throw new Error(fallbackError);
        apply(await savePartnerProfile(current.id, { ...current.profile, ...patch }));
      }),
    [apply, enqueue, fallbackError]
  );

  return { state, loadError, partner, addPartner, renamePartner: rename, removePartner: remove, savePartner };
}

/** Adapts the partner to the same controller shape the Planner already uses for the personal profile. */
export function partnerAsController(h: HouseholdController, emptyProfileValue: FinancialProfile): FinancialProfileController {
  return { state: h.state, loadError: h.loadError, profile: h.partner?.profile ?? emptyProfileValue, save: h.savePartner };
}

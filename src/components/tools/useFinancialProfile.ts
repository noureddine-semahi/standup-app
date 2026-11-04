"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import { getFinancialProfile, isPlannerUnavailableError, saveFinancialProfile } from "@/lib/supabase/financialProfile";

export type PlannerLoadState = "loading" | "ready" | "unavailable" | "error";

/** What the Planner tab needs; save resolves to an error message, or null on success. */
export type FinancialProfileController = {
  state: PlannerLoadState;
  loadError: string | null;
  profile: FinancialProfile;
  /** Merges a patch into the profile and saves it. The screen only updates after the save succeeds. */
  save: (patch: Partial<FinancialProfile>) => Promise<string | null>;
};

function errorMessage(e: unknown, fallback: string): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : fallback;
}

export function useFinancialProfile(fallbackError: string): FinancialProfileController {
  const [state, setState] = useState<PlannerLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<FinancialProfile>(emptyProfile);
  // Always the newest profile, so two quick saves can't overwrite each other with a stale base.
  const latest = useRef<FinancialProfile>(profile);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getFinancialProfile();
        if (cancelled) return;
        latest.current = loaded;
        setProfile(loaded);
        setLoadError(null);
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        if (isPlannerUnavailableError(e)) setState("unavailable");
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

  const save = useCallback(
    (patch: Partial<FinancialProfile>): Promise<string | null> => {
      // Saves run one after another, each merging onto the latest saved profile.
      const run = queue.current.then(async () => {
        try {
          const saved = await saveFinancialProfile({ ...latest.current, ...patch });
          latest.current = saved;
          setProfile(saved);
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

  return { state, loadError, profile, save };
}

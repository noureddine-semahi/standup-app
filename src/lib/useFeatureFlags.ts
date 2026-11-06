"use client";

import { useEffect, useState } from "react";
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@/lib/featureFlags";
import { getFeatureFlags } from "@/lib/supabase/featureFlags";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** The flags, all OFF until the server has answered (so nothing promotional flashes), and off if it never does. */
export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FEATURE_FLAGS);
  useEffect(() => {
    let alive = true;
    void getFeatureFlags().then((f) => {
      if (alive) setFlags(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  return flags;
}

type LimitKind = "notes" | "goals" | "routines";

/**
 * The "you've reached the Free plan limit" text. While Premium promotion is off (the free beta) it only states the limit; with
 * promotion on it also points to Premium.
 */
export function useLimitReachedText(): (kind: LimitKind, limit: number) => string {
  const { t } = useLanguage();
  const flags = useFeatureFlags();
  return (kind, limit) => t(flags.premium_promotion_enabled ? `${kind}.limitReached` : `${kind}.limitReachedPlain`, { limit });
}

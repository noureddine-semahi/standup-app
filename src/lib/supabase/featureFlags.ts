import { supabase } from "@/lib/supabase/client";
import { DEFAULT_FEATURE_FLAGS, parseFeatureFlags, type FeatureFlags } from "@/lib/featureFlags";

// Reads the feature flags through the database function get_feature_flags() (supabase/migrations/20261117000100_feature_flags.sql).
// Read-only: there is no way to set a flag from the app. ANY failure (function not installed yet, offline, signed out) yields all flags
// OFF, so an error can never switch a promotional or paid feature on. Answers are cached briefly so many components share one call.

const TTL_MS = 30_000;
let cache: { at: number; value: Promise<FeatureFlags> } | null = null;

async function fetchFlags(): Promise<FeatureFlags> {
  try {
    const { data, error } = await supabase.rpc("get_feature_flags");
    if (error) return DEFAULT_FEATURE_FLAGS;
    return parseFeatureFlags(data);
  } catch {
    return DEFAULT_FEATURE_FLAGS;
  }
}

export function getFeatureFlags(): Promise<FeatureFlags> {
  const now = Date.now();
  if (!cache || now - cache.at > TTL_MS) cache = { at: now, value: fetchFlags() };
  return cache.value;
}

/** Forget the cached answer (after sign-in/out, and in tests). */
export function resetFeatureFlagsCache(): void {
  cache = null;
}

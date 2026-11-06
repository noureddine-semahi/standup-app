import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_FEATURE_FLAGS, parseFeatureFlags, type FeatureFlags } from "@/lib/featureFlags";

// Server-side Supabase access for billing, done AS THE CALLING USER: their access token is forwarded, so every call is subject to the
// same permissions as the browser's (no service role, nothing elevated). Reads only: it verifies who the caller is and reads the flags.

function userClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** The user this access token belongs to, verified by Supabase, or null. */
export async function authenticateUser(accessToken: string): Promise<{ id: string } | null> {
  const supabase = userClient(accessToken);
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  return error || !data.user ? null : { id: data.user.id };
}

/** The feature flags as this user sees them. Any failure is all OFF. */
export async function readFeatureFlagsForUser(accessToken: string): Promise<FeatureFlags> {
  try {
    const supabase = userClient(accessToken);
    if (!supabase) return DEFAULT_FEATURE_FLAGS;
    const { data, error } = await supabase.rpc("get_feature_flags");
    return error ? DEFAULT_FEATURE_FLAGS : parseFeatureFlags(data);
  } catch {
    return DEFAULT_FEATURE_FLAGS;
  }
}

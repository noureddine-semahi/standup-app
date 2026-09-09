// src/lib/supabase/client.ts
import { createClient, processLock } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Don't crash the whole app in production builds; but in dev we want a clear error.
  // You said it works now, so this should not trigger.
  throw new Error(
    "Missing Supabase env vars. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local (project root) and restart dev server."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Default (navigatorLock) coordinates token refreshes across tabs via
    // the Web Locks API, but throws "signal is aborted without reason" when
    // that lock gets stuck or contended — easy to hit with several tabs of
    // the app open at once. processLock is in-memory only (no cross-tab
    // coordination) but can't get stuck this way.
    lock: processLock,
  },
});

import { supabase } from "@/lib/supabase/client";
import { ACCOUNT_TIERS, type AccountTier } from "@/lib/entitlements";

// Data access for the persisted account tier. Requires supabase/migrations/20261110000100_account_entitlements.sql.
//
// READ-ONLY on purpose: there is no way to set a tier or trial date from the app. The effective tier is worked out by the
// database (get_my_account_entitlement), so an expired trial is already Free by the time it gets here; this module only
// validates and shapes what came back. Until the migration is applied every account is Free.

export type AccountEntitlement = {
  /** What applies right now (an expired trial is already "free"). */
  tier: AccountTier;
  /** What was granted, before expiry is applied. */
  storedTier: AccountTier;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
};

export const FREE_ENTITLEMENT: AccountEntitlement = { tier: "free", storedTier: "free", trialStartedAt: null, trialEndsAt: null };

type RpcRow = { r_tier?: unknown; r_stored_tier?: unknown; r_trial_started_at?: unknown; r_trial_ends_at?: unknown };

/** True when the error means the function/table doesn't exist yet (migration not applied). */
export function isEntitlementsUnavailableError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  const msg = String(err.message ?? "").toLowerCase();
  return (
    err.code === "42883" || // undefined_function
    err.code === "42P01" || // undefined_table
    err.code === "PGRST202" || // function not in schema cache
    err.code === "PGRST205" || // table not in schema cache
    msg.includes("could not find the function") ||
    msg.includes("could not find the table") ||
    (msg.includes("function") && msg.includes("does not exist"))
  );
}

const asTier = (v: unknown): AccountTier => ((ACCOUNT_TIERS as readonly unknown[]).includes(v) ? (v as AccountTier) : "free");
const asIso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** Turn whatever the database returned into an AccountEntitlement. Anything unrecognised is Free, never Premium. */
export function parseEntitlementRow(data: unknown): AccountEntitlement {
  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null | undefined;
  if (!row || typeof row !== "object") return FREE_ENTITLEMENT;
  return {
    tier: asTier(row.r_tier),
    storedTier: asTier(row.r_stored_tier),
    trialStartedAt: asIso(row.r_trial_started_at),
    trialEndsAt: asIso(row.r_trial_ends_at),
  };
}

/**
 * The signed-in user's entitlement, resolved by the database. Free when the migration isn't applied yet; other errors are thrown
 * so callers can decide (a failed check must not quietly grant Premium, and parseEntitlementRow never does).
 */
export async function getMyEntitlement(): Promise<AccountEntitlement> {
  const { data, error } = await supabase.rpc("get_my_account_entitlement");
  if (error) {
    if (isEntitlementsUnavailableError(error)) return FREE_ENTITLEMENT;
    throw error;
  }
  return parseEntitlementRow(data);
}

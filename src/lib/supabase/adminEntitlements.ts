import { supabase } from "@/lib/supabase/client";
import { ACCOUNT_TIERS, type AccountTier } from "@/lib/entitlements";

// Admin-only access to account entitlements. Requires supabase/migrations/20261115000100_admin_entitlements.sql.
//
// Authorization is enforced by the database, not here: admin_get_entitlement needs an admin, admin_set_entitlement needs a Sys Admin,
// and both raise for anyone else before reading or writing. The checks in the UI only avoid offering what the database would refuse.

export type AdminEntitlement = {
  /** What was granted (free | premium_trial | premium). */
  storedTier: AccountTier;
  /** What applies right now (an expired trial is already free). */
  effectiveTier: AccountTier;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** Permanent: a trial was started on this account at some point. Never cleared by a tier change. */
  trialUsed: boolean;
  updatedAt: string | null;
};

/** The two explicit grants an admin can make; trials start only through the user's own confirmed activation. */
export const ADMIN_SETTABLE_TIERS = ["free", "premium"] as const;
export type AdminSettableTier = (typeof ADMIN_SETTABLE_TIERS)[number];

type Row = {
  r_stored_tier?: unknown;
  r_effective_tier?: unknown;
  r_trial_started_at?: unknown;
  r_trial_ends_at?: unknown;
  r_trial_used?: unknown;
  r_updated_at?: unknown;
};

const asTier = (v: unknown): AccountTier => ((ACCOUNT_TIERS as readonly unknown[]).includes(v) ? (v as AccountTier) : "free");
const asIso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** Shape the database's answer. Anything unrecognised is Free, never Premium. */
export function parseAdminEntitlement(data: unknown): AdminEntitlement {
  const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
  if (!row || typeof row !== "object") return { storedTier: "free", effectiveTier: "free", trialStartedAt: null, trialEndsAt: null, trialUsed: false, updatedAt: null };
  return {
    storedTier: asTier(row.r_stored_tier),
    effectiveTier: asTier(row.r_effective_tier),
    trialStartedAt: asIso(row.r_trial_started_at),
    trialEndsAt: asIso(row.r_trial_ends_at),
    trialUsed: row.r_trial_used === true,
    updatedAt: asIso(row.r_updated_at),
  };
}

export type AdminEntitlementRefusal = "not_admin" | "not_sys_admin" | "invalid_tier" | "user_not_found";

export function adminEntitlementRefusal(e: unknown): AdminEntitlementRefusal | null {
  const msg = String((e as { message?: string } | null)?.message ?? "");
  if (msg.includes("sys admin access required")) return "not_sys_admin";
  if (msg.includes("admin access required")) return "not_admin";
  if (msg.includes("invalid tier")) return "invalid_tier";
  if (msg.includes("user not found")) return "user_not_found";
  return null;
}

export class AdminEntitlementError extends Error {
  constructor(readonly reason: AdminEntitlementRefusal) {
    super(`Entitlement change refused: ${reason}`);
    this.name = "AdminEntitlementError";
  }
}

/** Admin-only: a user's stored and effective tier, trial dates and whether a trial was ever used. */
export async function getAdminEntitlement(userId: string): Promise<AdminEntitlement> {
  const { data, error } = await supabase.rpc("admin_get_entitlement", { p_user_id: userId });
  if (error) {
    const reason = adminEntitlementRefusal(error);
    if (reason) throw new AdminEntitlementError(reason);
    throw error;
  }
  return parseAdminEntitlement(data);
}

/**
 * Sys Admin-only: set a user's tier to free (revoke) or premium (grant). Trial dates and trial history are left exactly as they are, and
 * nothing the user has created is touched. Resolves to the state after the change. Refused for anyone else, by the database.
 */
export async function setAdminEntitlement(userId: string, tier: AdminSettableTier): Promise<AdminEntitlement> {
  if (!(ADMIN_SETTABLE_TIERS as readonly string[]).includes(tier)) throw new AdminEntitlementError("invalid_tier");
  const { data, error } = await supabase.rpc("admin_set_entitlement", { p_user_id: userId, p_tier: tier });
  if (error) {
    const reason = adminEntitlementRefusal(error);
    if (reason) throw new AdminEntitlementError(reason);
    throw error;
  }
  return parseAdminEntitlement(data);
}

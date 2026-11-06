import { supabase } from "@/lib/supabase/client";
import { ACCOUNT_TIERS, type AccountTier } from "@/lib/entitlements";
import { getCurrentUserId } from "@/lib/supabase/db";

// Data access for the persisted account tier. Requires supabase/migrations/20261110000100_account_entitlements.sql.
//
// There is no way to set a tier or trial date from the app: reads go through get_my_account_entitlement, and the only write is
// startMyTrial (below), which calls the database's one trial function. The effective tier is worked out by the
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

// ── The one-time Premium trial ─────────────────────────────────────────────────────────────────────────────────────
// Requires supabase/migrations/20261114000100_premium_trial.sql. A trial can only be started through the database function
// start_my_premium_trial(); nothing in the app can set a tier or a trial date.

export type TrialRefusal = "already_used" | "already_premium" | "not_signed_in" | "activation_disabled";

/** Why the database refused to start a trial, or null if the error is something else. */
export function trialRefusalReason(e: unknown): TrialRefusal | null {
  const msg = String((e as { message?: string } | null)?.message ?? "");
  if (msg.includes("TRIAL_ALREADY_USED")) return "already_used";
  if (msg.includes("ALREADY_PREMIUM")) return "already_premium";
  if (msg.includes("NOT_SIGNED_IN")) return "not_signed_in";
  if (msg.includes("TRIAL_ACTIVATION_DISABLED")) return "activation_disabled";
  return null;
}

/** Thrown by startMyTrial when the account is not eligible. */
export class TrialNotAvailableError extends Error {
  constructor(readonly reason: TrialRefusal) {
    super(`Premium trial not available: ${reason}`);
    this.name = "TrialNotAvailableError";
  }
}

/**
 * Start the signed-in user's 14-day trial. Resolves to the account's entitlement as the database computed it (premium_trial for
 * 14 days). Refused, with a TrialNotAvailableError, if a trial was ever used or the account is already Premium. Safe to call twice at
 * once: the database serializes the attempts and only one can start a trial.
 */
export async function startMyTrial(): Promise<AccountEntitlement> {
  const { data, error } = await supabase.rpc("start_my_premium_trial");
  if (error) {
    const reason = trialRefusalReason(error);
    if (reason) throw new TrialNotAvailableError(reason);
    throw error;
  }
  const e = parseEntitlementRow(data);
  // A started trial always comes back as premium_trial; anything else means the response was not what a successful start returns.
  if (e.storedTier !== "premium_trial") throw new Error("Unexpected response starting the Premium trial");
  return e;
}

export type TrialHistory = { used: boolean; startedAt: string | null; endsAt: string | null };

/** Whether the signed-in user has ever had a trial (permanent history; read-only). Not used when the migration isn't applied yet. */
export async function getMyTrialHistory(): Promise<TrialHistory> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("account_trial_history").select("started_at, ends_at").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isEntitlementsUnavailableError(error)) return { used: false, startedAt: null, endsAt: null };
    throw error;
  }
  if (!data) return { used: false, startedAt: null, endsAt: null };
  const row = data as { started_at?: unknown; ends_at?: unknown };
  return { used: true, startedAt: asIso(row.started_at), endsAt: asIso(row.ends_at) };
}

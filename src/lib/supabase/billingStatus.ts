import { supabase } from "@/lib/supabase/client";
import { ACCOUNT_TIERS, type AccountTier } from "@/lib/entitlements";

// The signed-in member's OWN billing status, for Profile & Settings. Read-only. Requires supabase/migrations/20261121000100_billing_status.sql.
//
// get_my_billing_status() takes no parameters and answers only for the caller, so there is no way to ask about another account, and it
// returns no Stripe identifiers: nothing in this type can identify a customer, subscription or price.

export const ACCESS_SOURCES = ["none", "manual", "subscription", "trial"] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export type BillingStatus = {
  /** Premium access right now, from ANY source. Never evidence that a subscription is active. */
  access: AccountTier;
  /** Why the member has (or lacks) Premium: an admin grant, a subscription, the one-time trial, or nothing. */
  source: AccessSource;
  plan: "monthly" | "annual" | null;
  /** Stripe's own status string for the member's subscription, or null when they have none. */
  status: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  /** past_due only: when the 7-day grace period ends. */
  graceEndsAt: string | null;
  /** Whether the SUBSCRIPTION itself grants Premium right now (separate from `access`). */
  subscriptionGrantsPremium: boolean;
  trialEndsAt: string | null;
};

type Row = Record<string, unknown>;
const asIso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** Shape the database's answer. Anything unrecognised is treated as "no Premium, no subscription": it can only ever show less, never more. */
export function parseBillingStatus(data: unknown): BillingStatus | null {
  const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
  if (!row || typeof row !== "object") return null;
  const access = (ACCOUNT_TIERS as readonly unknown[]).includes(row.r_access) ? (row.r_access as AccountTier) : "free";
  const sourceRaw = (ACCESS_SOURCES as readonly unknown[]).includes(row.r_access_source) ? (row.r_access_source as AccessSource) : "none";
  return {
    access,
    // an access source only counts if Premium is actually on
    source: access === "free" ? "none" : sourceRaw,
    plan: row.r_plan === "monthly" || row.r_plan === "annual" ? row.r_plan : null,
    status: typeof row.r_status === "string" && row.r_status.length > 0 && row.r_status.length <= 40 ? row.r_status : null,
    periodEnd: asIso(row.r_period_end),
    cancelAtPeriodEnd: row.r_cancel_at_period_end === true,
    canceledAt: asIso(row.r_canceled_at),
    endedAt: asIso(row.r_ended_at),
    graceEndsAt: asIso(row.r_grace_ends_at),
    subscriptionGrantsPremium: row.r_subscription_grants_premium === true,
    trialEndsAt: asIso(row.r_trial_ends_at),
  };
}

/** The member's billing status, or null if it can't be read (for example before the migration is applied). Never throws. */
export async function getMyBillingStatus(): Promise<BillingStatus | null> {
  try {
    const { data, error } = await supabase.rpc("get_my_billing_status");
    return error ? null : parseBillingStatus(data);
  } catch {
    return null;
  }
}

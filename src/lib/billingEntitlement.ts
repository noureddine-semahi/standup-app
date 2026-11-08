import type { AccountTier } from "@/lib/entitlements";

// The billing-derived Premium POLICY, written down in one place as pure code. The database is the authority: it computes the same thing in
// public.account_effective_tier / public.billing_grants_premium (supabase/migrations/20261120000100_billing_entitlements.sql), and tests
// pin the two together. This module exists so the policy is readable, testable and reusable (for example by a future status display); it
// never decides access by itself.
//
// Billing-derived Premium is COMPUTED, never stored: it is a function of the synchronised Stripe record and the clock, so ending it needs no
// write, cannot overwrite a manual grant or a trial, and is the same however many times, in whatever order, events arrive.

/** A late renewal update is tolerated for this long after the paid period ends (active / trialing). */
export const BILLING_ACTIVE_SLACK_DAYS = 3;
/** After a failed renewal (past_due), Premium continues for this long after the paid period ends, then ends even if Stripe is still retrying. */
export const BILLING_PAST_DUE_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type BillingFacts = { status: string | null | undefined; currentPeriodEnd: string | null | undefined };

/** What each Stripe subscription status means for access. Anything not listed (unknown or future) is NOT Premium. */
export const BILLING_STATUS_POLICY = {
  active: "premium",
  trialing: "premium",
  past_due: "grace",
  unpaid: "none",
  canceled: "none",
  incomplete: "none",
  incomplete_expired: "none",
  paused: "none",
} as const;

export function billingGrantsPremium(facts: BillingFacts | null | undefined, now: Date | number = Date.now()): boolean {
  if (!facts?.status) return false;
  const t = typeof now === "number" ? now : now.getTime();
  const end = facts.currentPeriodEnd ? Date.parse(facts.currentPeriodEnd) : NaN;
  const policy = (BILLING_STATUS_POLICY as Record<string, string>)[facts.status];
  if (policy === "premium") return Number.isNaN(end) || t <= end + BILLING_ACTIVE_SLACK_DAYS * DAY_MS;
  if (policy === "grace") return !Number.isNaN(end) && t <= end + BILLING_PAST_DUE_GRACE_DAYS * DAY_MS;
  return false;
}

export type TierSources = {
  /** account_entitlements.tier: 'premium' is a manual admin grant; 'premium_trial' is the one-time trial. */
  storedTier: AccountTier | null | undefined;
  trialEndsAt: string | null | undefined;
  billing: BillingFacts | null | undefined;
};

/** Precedence: manual grant, then billing, then an active trial, then Free. */
export function effectiveTierFromSources(s: TierSources, now: Date | number = Date.now()): AccountTier {
  const t = typeof now === "number" ? now : now.getTime();
  if (s.storedTier === "premium") return "premium";
  if (billingGrantsPremium(s.billing, t)) return "premium";
  const ends = s.trialEndsAt ? Date.parse(s.trialEndsAt) : NaN;
  if (s.storedTier === "premium_trial" && !Number.isNaN(ends) && t < ends) return "premium_trial";
  return "free";
}

// Which Stripe subscription states stop a member starting ANOTHER paid subscription. Pure and secret-free; the database applies the same rule
// (public.begin_checkout_attempt in supabase/migrations/20261122000100_checkout_attempts.sql) and a test pins the two together.
//
// A second subscription is refused while the first is live OR could still come back: active, trialing, past_due (Stripe is retrying),
// unpaid (collection stopped but the subscription still exists and can be paid), incomplete (the first payment may still complete) and
// paused (it can be resumed). Only a subscription that is over for good (canceled, incomplete_expired) allows a new one. Any status this
// code doesn't know is treated as live: when in doubt, never open a second subscription.
//
// An admin Premium grant or the one-time StandUp trial are NOT Stripe subscriptions and never count here: they live in the member's entitlement
// records, which this rule never reads.

export const ENDED_SUBSCRIPTION_STATUSES = ["canceled", "incomplete_expired"] as const;

export const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"] as const;

export function blocksNewCheckout(status: string | null | undefined): boolean {
  if (!status) return false; // no subscription record at all
  return !(ENDED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

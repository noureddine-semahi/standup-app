import type { AccountTier } from "@/lib/entitlements";
import { TRIAL_DAYS } from "@/lib/entitlements";
import type { BillingStatus } from "@/lib/supabase/billingStatus";
import type { TranslationKey } from "@/lib/i18n/en";

// The seven member situations the admin preview can show. SAMPLE DATA ONLY, built from a clock the caller passes in: it never reads a real account,
// and nothing here can reach the database, Stripe or the network (this file imports types and constants only).

export const PREVIEW_IDS = ["free", "trialAvailable", "trialActive", "activePremium", "cancellationScheduled", "pastDue", "canceled"] as const;
export type PreviewId = (typeof PREVIEW_IDS)[number];

export type PreviewState = {
  id: PreviewId;
  labelKey: TranslationKey;
  /** The member's effective plan. */
  tier: AccountTier;
  /** Whether the one-time trial has ever been used. */
  trialUsed: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** What the member-facing billing status would say, or null for no subscription. */
  billing: BillingStatus | null;
};

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const none = (o: Partial<BillingStatus> = {}): BillingStatus => ({ access: "free", source: "none", plan: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: false, trialEndsAt: null, ...o });

export function previewStates(now: number): PreviewState[] {
  const periodEnd = iso(now + 20 * DAY);
  const base = { trialStartedAt: null, trialEndsAt: null };
  return [
    { id: "free", labelKey: "adminBill.preview.free", tier: "free", trialUsed: true, ...base, billing: null },
    { id: "trialAvailable", labelKey: "adminBill.preview.trialAvailable", tier: "free", trialUsed: false, ...base, billing: null },
    { id: "trialActive", labelKey: "adminBill.preview.trialActive", tier: "premium_trial", trialUsed: true, trialStartedAt: iso(now - 4 * DAY), trialEndsAt: iso(now + (TRIAL_DAYS - 4) * DAY), billing: none({ access: "premium_trial", source: "trial", trialEndsAt: iso(now + (TRIAL_DAYS - 4) * DAY) }) },
    { id: "activePremium", labelKey: "adminBill.preview.activePremium", tier: "premium", trialUsed: true, ...base, billing: none({ access: "premium", source: "subscription", plan: "monthly", status: "active", periodEnd, subscriptionGrantsPremium: true }) },
    { id: "cancellationScheduled", labelKey: "adminBill.preview.cancellationScheduled", tier: "premium", trialUsed: true, ...base, billing: none({ access: "premium", source: "subscription", plan: "annual", status: "active", periodEnd, cancelAtPeriodEnd: true, canceledAt: iso(now - DAY), subscriptionGrantsPremium: true }) },
    { id: "pastDue", labelKey: "adminBill.preview.pastDue", tier: "premium", trialUsed: true, ...base, billing: none({ access: "premium", source: "subscription", plan: "monthly", status: "past_due", periodEnd: iso(now - 2 * DAY), graceEndsAt: iso(now + 5 * DAY), subscriptionGrantsPremium: true }) },
    { id: "canceled", labelKey: "adminBill.preview.canceled", tier: "free", trialUsed: true, ...base, billing: none({ access: "free", source: "none", plan: "monthly", status: "canceled", periodEnd: iso(now - 10 * DAY), endedAt: iso(now - 10 * DAY), canceledAt: iso(now - 40 * DAY) }) },
  ];
}

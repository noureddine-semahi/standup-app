import { billingGrantsPremium, effectiveTierFromSources } from "@/lib/billingEntitlement";
import type { AccountTier } from "@/lib/entitlements";

// The Premium & Billing dashboard's numbers, worked out from rows the server has read. PURE and AGGREGATE-ONLY: it takes rows in and gives counts out,
// so nothing that identifies a member (an ID, an email, a Stripe reference) can appear in what is returned. The tier rules are the app's own
// (lib/billingEntitlement.ts): a manual admin grant, then billing, then an active trial, then Free.

export type EntitlementRow = { userId: string; tier: AccountTier | null; trialEndsAt: string | null };
export type BillingRow = { userId: string; status: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean };

export type SubscriptionCounts = {
  /** Running normally (active or trialing in Stripe) and not set to end. */
  active: number;
  /** Running, but set to cancel at the end of the paid period. */
  scheduledCancellation: number;
  pastDue: number;
  /** Over for good (canceled, or never completed and expired). */
  canceled: number;
  /** Anything else Stripe can report: incomplete, unpaid, paused, or a status this code doesn't know. Never counted as active. */
  other: number;
  total: number;
};

export type AccountCounts = {
  total: number;
  free: number;
  trial: number;
  premium: number;
  /** Free accounts that have never used the one-time trial (so the trial could still be offered). */
  trialAvailable: number;
};

export type PremiumSources = {
  /** Accounts holding a manual admin Premium grant. */
  manualGrants: number;
  /** Accounts whose Premium comes from a Stripe subscription (active or in its grace period) under the unchanged billing policy. */
  stripeSubscriptions: number;
  /** Accounts that have both (the manual grant takes precedence for access). */
  both: number;
};

export type BillingOverviewNumbers = { accounts: AccountCounts; subscriptions: SubscriptionCounts; premiumSources: PremiumSources };

export type SubscriptionKind = keyof Omit<SubscriptionCounts, "total">;

/** How one Stripe subscription record is counted. Pure, so it is easy to test and to keep identical wherever it is used. */
export function subscriptionKind(row: Pick<BillingRow, "status" | "cancelAtPeriodEnd">): SubscriptionKind {
  switch (row.status) {
    case "active":
    case "trialing":
      return row.cancelAtPeriodEnd ? "scheduledCancellation" : "active";
    case "past_due":
      return "pastDue";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "other";
  }
}

export function summarizeSubscriptions(rows: readonly BillingRow[]): SubscriptionCounts {
  const out: SubscriptionCounts = { active: 0, scheduledCancellation: 0, pastDue: 0, canceled: 0, other: 0, total: 0 };
  for (const r of rows) {
    out[subscriptionKind(r)]++;
    out.total++;
  }
  return out;
}

export function summarizeBillingOverview(input: {
  /** All accounts (profiles). */
  totalAccounts: number;
  entitlements: readonly EntitlementRow[];
  billing: readonly BillingRow[];
  /** Account IDs that have ever used the one-time trial (permanent history). */
  trialHistoryUserIds: readonly string[];
  now: Date | number;
}): BillingOverviewNumbers {
  const t = typeof input.now === "number" ? input.now : input.now.getTime();
  const ent = new Map(input.entitlements.map((e) => [e.userId, e]));
  const bill = new Map(input.billing.map((b) => [b.userId, b]));
  const history = new Set(input.trialHistoryUserIds);
  const known = new Set<string>([...ent.keys(), ...bill.keys()]);

  let free = 0;
  let trial = 0;
  let premium = 0;
  let trialUsedAmongFree = 0;
  let manual = 0;
  let stripe = 0;
  let both = 0;

  for (const id of known) {
    const e = ent.get(id);
    const b = bill.get(id);
    const billing = b ? { status: b.status, currentPeriodEnd: b.periodEnd } : null;
    const tier = effectiveTierFromSources({ storedTier: e?.tier ?? null, trialEndsAt: e?.trialEndsAt ?? null, billing }, t);
    if (tier === "premium") premium++;
    else if (tier === "premium_trial") trial++;
    else {
      free++;
      if (history.has(id)) trialUsedAmongFree++;
    }
    const isManual = e?.tier === "premium";
    const isStripe = billingGrantsPremium(billing, t);
    if (isManual) manual++;
    if (isStripe) stripe++;
    if (isManual && isStripe) both++;
  }

  // Accounts with no entitlement or billing row at all are plain Free accounts that have never had a trial.
  const plainFree = Math.max(0, input.totalAccounts - known.size);
  free += plainFree;
  const total = Math.max(input.totalAccounts, known.size);
  return {
    accounts: { total, free, trial, premium, trialAvailable: Math.max(0, free - trialUsedAmongFree) },
    subscriptions: summarizeSubscriptions(input.billing),
    premiumSources: { manualGrants: manual, stripeSubscriptions: stripe, both },
  };
}

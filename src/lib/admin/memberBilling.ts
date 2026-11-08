import { billingGrantsPremium, effectiveTierFromSources } from "@/lib/billingEntitlement";
import type { AccountTier } from "@/lib/entitlements";
import { subscriptionKind, type SubscriptionKind } from "@/lib/admin/billingSummary";

// The admin member billing table: how one member is described, and how a list of members is searched, filtered and paged. PURE: rows in, rows out. The
// tier rules are the app's own (manual grant, then billing, then an active trial, then Free); nothing here decides access, it only DESCRIBES it.

export type DeletionState = "pending" | "billing_cancelled" | "data_cleaned";

/** Everything the server read about one member (this never leaves the server as-is; only a MemberRow does). */
export type MemberInput = {
  id: string;
  email: string | null;
  displayName: string | null;
  tier: AccountTier | null;
  trialEndsAt: string | null;
  status: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  syncedAt: string | null;
  deletionState: DeletionState | null;
};

export type MemberPlan = "free" | "trial" | "premium";
export type PremiumSource = "manual" | "stripe" | "trial" | "none";

/** The minimum an administrator needs about a member to see where they stand and to act on a manual grant. No Stripe reference, no payment detail. */
export type MemberRow = {
  id: string;
  email: string | null;
  displayName: string | null;
  plan: MemberPlan;
  /** Where the Premium access comes from, by the app's precedence: a manual grant, then a Stripe subscription, then a free trial. */
  source: PremiumSource;
  /** A manual grant is the source and the member ALSO has a Stripe subscription that would give Premium. */
  alsoStripe: boolean;
  manualGrant: boolean;
  /** Stripe's own status word (active, past_due, canceled…), or null when the member has no subscription record. */
  stripeStatus: string | null;
  stripeKind: SubscriptionKind | null;
  /** When the subscription is set to end (the end of the paid period), only while a cancellation is scheduled. */
  scheduledCancellationAt: string | null;
  /** When this member's subscription record was last synchronised from Stripe. */
  lastSyncAt: string | null;
  deletionPending: DeletionState | null;
};

export function classifyMember(m: MemberInput, now: Date | number): MemberRow {
  const t = typeof now === "number" ? now : now.getTime();
  const billing = m.status === null && m.periodEnd === null ? null : { status: m.status, currentPeriodEnd: m.periodEnd };
  const hasBilling = m.status !== null;
  const tier = effectiveTierFromSources({ storedTier: m.tier, trialEndsAt: m.trialEndsAt, billing }, t);
  const manualGrant = m.tier === "premium";
  const stripeGives = hasBilling && billingGrantsPremium(billing, t);
  const plan: MemberPlan = tier === "premium" ? "premium" : tier === "premium_trial" ? "trial" : "free";
  const source: PremiumSource = manualGrant ? "manual" : stripeGives ? "stripe" : plan === "trial" ? "trial" : "none";
  const kind = hasBilling ? subscriptionKind({ status: m.status, cancelAtPeriodEnd: m.cancelAtPeriodEnd }) : null;
  return {
    id: m.id,
    email: m.email,
    displayName: m.displayName,
    plan,
    source,
    alsoStripe: manualGrant && stripeGives,
    manualGrant,
    stripeStatus: m.status,
    stripeKind: kind,
    scheduledCancellationAt: kind === "scheduledCancellation" ? m.periodEnd : null,
    lastSyncAt: m.syncedAt,
    deletionPending: m.deletionState,
  };
}

export const MEMBER_PLAN_FILTERS = ["all", "free", "trial", "premium"] as const;
export const MEMBER_FLAG_FILTERS = ["all", "manualGrant", "stripe", "scheduledCancellation", "pastDue", "deletionPending"] as const;
export type MemberPlanFilter = (typeof MEMBER_PLAN_FILTERS)[number];
export type MemberFlagFilter = (typeof MEMBER_FLAG_FILTERS)[number];

export const PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_SEARCH_LENGTH = 100;

export type MemberQuery = { search: string; plan: MemberPlanFilter; filter: MemberFlagFilter; page: number; pageSize: number };

function matchesFlag(r: MemberRow, f: MemberFlagFilter): boolean {
  switch (f) {
    case "manualGrant":
      return r.manualGrant;
    case "stripe":
      return r.stripeStatus !== null;
    case "scheduledCancellation":
      return r.stripeKind === "scheduledCancellation";
    case "pastDue":
      return r.stripeKind === "pastDue";
    case "deletionPending":
      return r.deletionPending !== null;
    default:
      return true;
  }
}

/** Search (email, name or exact account ID, case-insensitive), the two filters, a stable order (email, then ID), and one page. Out-of-range pages are clamped. */
export function queryMembers(rows: readonly MemberRow[], q: MemberQuery): { items: MemberRow[]; total: number; page: number; pageSize: number; pages: number } {
  const needle = q.search.trim().toLowerCase();
  const matched = rows
    .filter((r) => (q.plan === "all" || r.plan === q.plan) && matchesFlag(r, q.filter))
    .filter((r) => !needle || (r.email ?? "").toLowerCase().includes(needle) || (r.displayName ?? "").toLowerCase().includes(needle) || r.id.toLowerCase() === needle)
    .sort((a, b) => (a.email ?? "￿").toLowerCase().localeCompare((b.email ?? "￿").toLowerCase()) || a.id.localeCompare(b.id));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(q.pageSize) ? q.pageSize : DEFAULT_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(q.page) || 1), pages);
  return { items: matched.slice((page - 1) * pageSize, page * pageSize), total: matched.length, page, pageSize, pages };
}

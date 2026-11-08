import type { TranslationKey } from "@/lib/i18n/en";
import type { BillingStatus } from "@/lib/supabase/billingStatus";

// How a member's billing status is explained. Pure: it turns what the database reported into which words to show, and decides nothing about
// access. Two rules shape it:
//   * "has Premium" is never read as "has an active subscription": the subscription is described from ITS OWN status, and its own
//     Premium switch (subscriptionGrantsPremium) is shown separately from the member's overall Premium access;
//   * a status the app doesn't recognise is described neutrally, never as active.

export type StatusKind =
  | "active"
  | "activeCanceling"
  | "activeStale"
  | "trialing"
  | "pastDueGrace"
  | "pastDueEnded"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incompleteExpired"
  | "paused"
  | "unknown";

export function statusKind(b: Pick<BillingStatus, "status" | "cancelAtPeriodEnd" | "subscriptionGrantsPremium">): StatusKind {
  switch (b.status) {
    case "active":
      return !b.subscriptionGrantsPremium ? "activeStale" : b.cancelAtPeriodEnd ? "activeCanceling" : "active";
    case "trialing":
      return !b.subscriptionGrantsPremium ? "activeStale" : b.cancelAtPeriodEnd ? "activeCanceling" : "trialing";
    case "past_due":
      return b.subscriptionGrantsPremium ? "pastDueGrace" : "pastDueEnded";
    case "unpaid":
      return "unpaid";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
      return "incompleteExpired";
    case "paused":
      return "paused";
    default:
      return "unknown";
  }
}

export type BillingView = {
  /** The member has Premium from an admin grant or a trial, or has a subscription record: something worth showing. */
  access: { key: TranslationKey; date: string | null } | null;
  subscription: null | {
    planKey: TranslationKey;
    kind: StatusKind;
    statusKey: TranslationKey;
    explainKey: TranslationKey;
    /** The date the explanation refers to, or null when there is none (a no-date wording is then used). */
    date: string | null;
    grantsPremium: boolean;
  };
};

const STATUS_KEY: Record<StatusKind, TranslationKey> = {
  active: "billing.status.active",
  activeCanceling: "billing.status.activeCanceling",
  activeStale: "billing.status.activeStale",
  trialing: "billing.status.trialing",
  pastDueGrace: "billing.status.pastDueGrace",
  pastDueEnded: "billing.status.pastDueEnded",
  unpaid: "billing.status.unpaid",
  canceled: "billing.status.canceled",
  incomplete: "billing.status.incomplete",
  incompleteExpired: "billing.status.incompleteExpired",
  paused: "billing.status.paused",
  unknown: "billing.status.unknown",
};

/** [explanation with a date, explanation without one]. */
const EXPLAIN: Record<StatusKind, [TranslationKey, TranslationKey]> = {
  active: ["billing.explain.active", "billing.explain.activeNoDate"],
  activeCanceling: ["billing.explain.activeCanceling", "billing.explain.activeCancelingNoDate"],
  activeStale: ["billing.explain.activeStale", "billing.explain.activeStaleNoDate"],
  trialing: ["billing.explain.trialing", "billing.explain.activeNoDate"],
  pastDueGrace: ["billing.explain.pastDueGrace", "billing.explain.pastDueGraceNoDate"],
  pastDueEnded: ["billing.explain.pastDueEnded", "billing.explain.pastDueEndedNoDate"],
  unpaid: ["billing.explain.unpaid", "billing.explain.unpaid"],
  canceled: ["billing.explain.canceled", "billing.explain.canceledNoDate"],
  incomplete: ["billing.explain.incomplete", "billing.explain.incomplete"],
  incompleteExpired: ["billing.explain.incompleteExpired", "billing.explain.incompleteExpired"],
  paused: ["billing.explain.paused", "billing.explain.paused"],
  unknown: ["billing.explain.unknown", "billing.explain.unknown"],
};

function dateFor(kind: StatusKind, b: BillingStatus): string | null {
  switch (kind) {
    case "active":
    case "activeCanceling":
    case "activeStale":
    case "trialing":
      return b.periodEnd;
    case "pastDueGrace":
    case "pastDueEnded":
      return b.graceEndsAt;
    case "canceled":
      return b.endedAt ?? b.periodEnd;
    default:
      return null;
  }
}

/** What to show for a member, or null when there is nothing worth adding (a plain Free account, or a trial-only one the trial card already covers). */
export function billingView(b: BillingStatus | null | undefined): BillingView | null {
  if (!b) return null;
  const hasSubscription = b.status !== null;

  let access: BillingView["access"] = null;
  if (b.source === "manual") access = { key: "billing.access.manual", date: null };
  else if (b.source === "subscription") access = { key: "billing.access.subscription", date: null };
  else if (b.source === "trial" && hasSubscription) access = { key: "billing.access.trial", date: b.trialEndsAt };
  else if (b.source === "none" && hasSubscription) access = { key: "billing.access.free", date: null };

  let subscription: BillingView["subscription"] = null;
  if (hasSubscription) {
    const kind = statusKind(b);
    const date = dateFor(kind, b);
    subscription = {
      planKey: b.plan === "annual" ? "billing.plan.annual" : "billing.plan.monthly",
      kind,
      statusKey: STATUS_KEY[kind],
      explainKey: EXPLAIN[kind][date ? 0 : 1],
      date,
      grantsPremium: b.subscriptionGrantsPremium,
    };
    if (b.plan === null) subscription.planKey = "billing.plan.unknown";
  }

  return access || subscription ? { access, subscription } : null;
}

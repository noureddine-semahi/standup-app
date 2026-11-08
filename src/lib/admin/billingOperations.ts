import { subscriptionKind } from "@/lib/admin/billingSummary";

// The admin Billing Operations view: how Stripe webhook processing and reconciliation are doing, worked out from rows the server has read. PURE and
// READ-ONLY. It only ever sees what the ledger and the billing records already hold: event TYPES and outcomes (never a webhook payload), and the
// reconcile retry memory. Stripe IDs are not carried through: a member is identified by email, and an event by its type.

export type WebhookEvent = {
  type: string;
  status: "processing" | "processed" | "failed";
  attempts: number;
  /** A short machine code such as "handler_error" (the ledger never stores a message or payload). */
  lastError: string | null;
  receivedAt: string;
  claimedAt: string | null;
  processedAt: string | null;
};

export type SyncRecord = {
  /** The member's email: how an administrator recognises the record. */
  member: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  syncedAt: string | null;
  reconcileFailures: number;
  lastOutcome: string | null;
  lastFailedAt: string | null;
  nextAttemptAt: string | null;
};

const HOUR = 3_600_000;
/** A subscription record not refreshed for this long is reported as stale (reconciliation is scheduled daily, so a healthy record is refreshed within a day or so). */
export const STALE_AFTER_HOURS = 48;
/** The webhook ledger treats a claim older than this as a crashed run that may be retried (see claim_stripe_event). */
export const STUCK_AFTER_MINUTES = 5;
export const RECENT_EVENTS = 20;
export const LIST_LIMIT = 25;

export type RecentWebhook = { type: string; status: WebhookEvent["status"]; attempts: number; error: string | null; receivedAt: string; processedAt: string | null };
export type BackoffRecord = { member: string | null; outcome: string | null; failures: number; lastFailedAt: string | null; nextAttemptAt: string | null; waiting: boolean };
export type UnresolvedKind = "webhook_failed" | "webhook_stuck" | "never_synced" | "stale_sync" | "status_other";
export type UnresolvedItem = { kind: UnresolvedKind; /** a member's email, or an event type */ subject: string | null; detail: string | null; at: string | null };

export type OperationsOverview = {
  generatedAt: string;
  webhooks: {
    recent: RecentWebhook[];
    last24h: { processed: number; failed: number; processing: number };
    lastProcessedAt: string | null;
    totalRecorded: number;
  };
  reconciliation: {
    tracked: number;
    freshWithin24h: number;
    stale: number;
    neverSynced: number;
    lastCheckAt: string | null;
    oldestCheckAt: string | null;
    failing: number;
    waitingInBackoff: number;
    byOutcome: { missing: number; conflict: number; stripe_error: number; ignored: number };
    /** Run history isn't stored anywhere: what is shown is the outcome per record, not per run. */
    runHistoryAvailable: false;
  };
  backoff: BackoffRecord[];
  unresolved: { items: UnresolvedItem[]; total: number };
};

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
};

export function summarizeOperations(input: { events: readonly WebhookEvent[]; records: readonly SyncRecord[]; now: Date | number }): OperationsOverview {
  const now = typeof input.now === "number" ? input.now : input.now.getTime();
  const byRecent = [...input.events].sort((a, b) => (ms(b.receivedAt) ?? 0) - (ms(a.receivedAt) ?? 0));

  const last24h = { processed: 0, failed: 0, processing: 0 };
  let lastProcessed: number | null = null;
  for (const e of byRecent) {
    const r = ms(e.receivedAt);
    if (r !== null && now - r <= 24 * HOUR) last24h[e.status]++;
    const p = ms(e.processedAt);
    if (e.status === "processed" && p !== null && (lastProcessed === null || p > lastProcessed)) lastProcessed = p;
  }

  const byOutcome = { missing: 0, conflict: 0, stripe_error: 0, ignored: 0 };
  let fresh = 0;
  let stale = 0;
  let never = 0;
  let waiting = 0;
  let failing = 0;
  let newest: number | null = null;
  let oldest: number | null = null;
  const backoff: BackoffRecord[] = [];
  const unresolved: UnresolvedItem[] = [];

  for (const r of input.records) {
    const synced = ms(r.syncedAt);
    if (synced === null) {
      never++;
      unresolved.push({ kind: "never_synced", subject: r.member, detail: r.status, at: null });
    } else {
      if (newest === null || synced > newest) newest = synced;
      if (oldest === null || synced < oldest) oldest = synced;
      if (now - synced <= 24 * HOUR) fresh++;
      if (now - synced > STALE_AFTER_HOURS * HOUR) {
        stale++;
        unresolved.push({ kind: "stale_sync", subject: r.member, detail: r.status, at: r.syncedAt });
      }
    }
    if (r.status !== null && subscriptionKind({ status: r.status, cancelAtPeriodEnd: r.cancelAtPeriodEnd }) === "other") unresolved.push({ kind: "status_other", subject: r.member, detail: r.status, at: r.syncedAt });

    if (r.reconcileFailures > 0) {
      failing++;
      const next = ms(r.nextAttemptAt);
      const isWaiting = next !== null && next > now;
      if (isWaiting) waiting++;
      const o = r.lastOutcome;
      if (o === "missing" || o === "conflict" || o === "stripe_error" || o === "ignored") byOutcome[o]++;
      backoff.push({ member: r.member, outcome: o, failures: r.reconcileFailures, lastFailedAt: r.lastFailedAt, nextAttemptAt: r.nextAttemptAt, waiting: isWaiting });
    }
  }
  backoff.sort((a, b) => Number(b.waiting) - Number(a.waiting) || (ms(a.nextAttemptAt) ?? 0) - (ms(b.nextAttemptAt) ?? 0));

  for (const e of byRecent) {
    if (e.status === "failed") unresolved.push({ kind: "webhook_failed", subject: e.type, detail: e.lastError, at: e.receivedAt });
    else if (e.status === "processing") {
      const claimed = ms(e.claimedAt) ?? ms(e.receivedAt);
      if (claimed !== null && now - claimed > STUCK_AFTER_MINUTES * 60_000) unresolved.push({ kind: "webhook_stuck", subject: e.type, detail: null, at: e.claimedAt ?? e.receivedAt });
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    webhooks: {
      recent: byRecent.slice(0, RECENT_EVENTS).map((e) => ({ type: e.type, status: e.status, attempts: e.attempts, error: e.lastError, receivedAt: e.receivedAt, processedAt: e.processedAt })),
      last24h,
      lastProcessedAt: lastProcessed === null ? null : new Date(lastProcessed).toISOString(),
      totalRecorded: input.events.length,
    },
    reconciliation: {
      tracked: input.records.length,
      freshWithin24h: fresh,
      stale,
      neverSynced: never,
      lastCheckAt: newest === null ? null : new Date(newest).toISOString(),
      oldestCheckAt: oldest === null ? null : new Date(oldest).toISOString(),
      failing,
      waitingInBackoff: waiting,
      byOutcome,
      runHistoryAvailable: false,
    },
    backoff: backoff.slice(0, LIST_LIMIT),
    unresolved: { items: unresolved.slice(0, LIST_LIMIT), total: unresolved.length },
  };
}

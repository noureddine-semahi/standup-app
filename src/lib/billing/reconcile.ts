import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import type Stripe from "stripe";
import { readBillingConfig } from "@/lib/billing/config";
import { createReconcileStore, type ReconcileCandidate, type ReconcileFailureKind, type ReconcileStore } from "@/lib/billing/reconcileStore";
import { getStripe } from "@/lib/billing/stripe";
import { buildSyncArgs } from "@/lib/billing/subscriptionSync";
import type { BillingPlan } from "@/lib/billing/plans";
import { createWebhookStore, type SubscriptionSyncArgs, type WebhookStore } from "@/lib/billing/webhookStore";

// Phase 5.6 step 9: SUBSCRIPTION RECONCILIATION. If a Stripe webhook is missed or delayed, the stored billing record can drift from Stripe (a cancellation, a
// reversal, a renewal, a failed payment). This re-reads each stored subscription from Stripe and records what Stripe says NOW, through the SAME
// code the webhooks use:
//   * WHICH subscription: only the subscription IDs already stored in the billing records (never anything a client sends);
//   * WHAT it says: fetched from Stripe's API with our secret key, then turned into a record by buildSyncArgs (the plan from OUR Price IDs, the
//     scheduled-cancellation normalisation, the live-mode guard), exactly as the webhook handler does;
//   * WHERE it goes: the existing database function sync_stripe_subscription, which serialises per customer and per account, refuses a snapshot
//     older than the stored one ('stale'), and refuses any ownership or subscription conflict. The snapshot time (fetchedAt) is taken BEFORE
//     the Stripe call, so a slow reconciliation can never overwrite what a webhook recorded while it was waiting.
// It creates no subscription, Checkout session, customer or entitlement; it touches no trial, admin grant or Free limit. It only refreshes an
// existing billing record, and Premium follows that record by the unchanged billing policy.
//
// Bounded: at most MAX_LIMIT records per run and a time budget; the rest wait for the next run. A Stripe or database failure on one record is
// counted and leaves that record's billing data exactly as it was.
//
// RETRY BACKOFF (step 9.2). A record Stripe can't answer for (missing, conflict, ignored, repeated Stripe errors) used to stay the "oldest" forever and
// take a slot in every batch. Now each failure is remembered (reconcile_* columns, written only by record_reconcile_result) with a retry time that
// doubles on each consecutive failure up to a cap: Stripe errors 5 min -> 1 h (after 5 in a row they are treated as persistent), missing / conflict /
// ignored 1 h -> 24 h. Until then the record is skipped but stays visible (columns + the "backedOff" count); then it is tried again, and any success
// clears the memory. Healthy records are always ahead of retries in a batch. The memory never touches billing status, dates, entitlements, trials or
// grants, and the 10-minute successful-check cooldown, batch limit and time budget are unchanged.

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;
export const DEFAULT_STALE_MINUTES = 10;
export const DEFAULT_BUDGET_MS = 20_000;

export const TRANSIENT_BACKOFF = { baseMs: 5 * 60_000, capMs: 60 * 60_000 } as const;
export const PERSISTENT_BACKOFF = { baseMs: 60 * 60_000, capMs: 24 * 60 * 60_000 } as const;
/** After this many Stripe errors in a row the record is treated like a persistent failure (slower retries). */
export const TRANSIENT_ESCALATE_AFTER = 5;

/** How long to wait before retrying a record whose check just failed, given how many checks had failed in a row BEFORE this one. Doubles each time, capped. */
export function retryDelayMs(kind: ReconcileFailureKind, priorFailures: number): number {
  const persistent = kind !== "stripe_error" || priorFailures >= TRANSIENT_ESCALATE_AFTER;
  const { baseMs, capMs } = persistent ? PERSISTENT_BACKOFF : TRANSIENT_BACKOFF;
  return Math.min(capMs, baseMs * 2 ** Math.min(Math.max(0, Math.trunc(priorFailures)), 20));
}

export type ReconcileOutcome =
  | "changed" // Stripe disagreed with the record: it was updated
  | "unchanged" // already in step with Stripe: only its "last checked" time was refreshed
  | "stale" // a webhook recorded something newer meanwhile: left alone
  | "missing" // Stripe has no such subscription: left alone for a person to look at
  | "conflict" // the record and Stripe disagree about who owns it: left alone
  | "ignored" // not ours to record (live mode, unknown price, incomplete data, unmapped): left alone
  | "stripe_error" // Stripe failed: left as it was, retried next run
  | "store_error"; // the database failed: the run stops

export type ReconcileSummary = {
  examined: number;
  outcomes: Record<ReconcileOutcome, number>;
  /** More records were due than this run's limit or time allowed. */
  moreDue: boolean;
  /** Records currently waiting out a retry delay after failing (still stored and visible; they are retried when the delay ends). */
  backedOff: number;
  /** The run stopped early because the database failed. */
  aborted: boolean;
};

export type ReconcileDeps = {
  store: ReconcileStore;
  sync: WebhookStore["syncSubscription"];
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  prices(): Readonly<Record<BillingPlan, string>>;
  now(): Date;
};

export type ReconcileOptions = { limit?: number; staleMinutes?: number; budgetMs?: number };

const emptyOutcomes = (): Record<ReconcileOutcome, number> => ({ changed: 0, unchanged: 0, stale: 0, missing: 0, conflict: 0, ignored: 0, stripe_error: 0, store_error: 0 });

const isNotFound = (e: unknown): boolean => {
  const err = e as { code?: string; statusCode?: number } | null;
  return err?.code === "resource_missing" || err?.statusCode === 404;
};

/** Whether Stripe's current facts differ from the stored record (what the webhooks would have changed). */
function differs(c: ReconcileCandidate, a: SubscriptionSyncArgs): boolean {
  const same = (x: string | null, y: string | null) => (x === null || y === null ? x === y : Date.parse(x) === Date.parse(y));
  return c.status !== a.status || c.priceId !== a.priceId || c.cancelAtPeriodEnd !== a.cancelAtPeriodEnd || !same(c.periodEnd, a.periodEnd) || !same(c.canceledAt, a.canceledAt) || !same(c.endedAt, a.endedAt);
}

export async function reconcileSubscriptions(deps: ReconcileDeps, opts: ReconcileOptions = {}): Promise<ReconcileSummary> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)));
  const staleMs = Math.max(0, (opts.staleMinutes ?? DEFAULT_STALE_MINUTES) * 60_000);
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const started = deps.now().getTime();
  const summary: ReconcileSummary = { examined: 0, outcomes: emptyOutcomes(), moreDue: false, backedOff: 0, aborted: false };

  const prices = deps.prices(); // throws if billing isn't configured: nothing is attempted
  const due = await deps.store.candidates(new Date(started - staleMs).toISOString(), new Date(started).toISOString(), limit + 1);
  summary.moreDue = due.length > limit;

  // Remember how a check went. Best-effort: losing this memory costs only a repeat attempt, never billing data, so it never stops the run.
  const remember = async (c: ReconcileCandidate, kind: ReconcileFailureKind | null) => {
    try {
      if (kind === null) {
        if (c.failures > 0) await deps.store.record(c.subscriptionId, { ok: true }); // a success clears earlier failures
      } else {
        await deps.store.record(c.subscriptionId, { ok: false, kind, nextAttemptAtIso: new Date(deps.now().getTime() + retryDelayMs(kind, c.failures)).toISOString() });
      }
    } catch {
      // ignored on purpose
    }
  };

  for (const c of due.slice(0, limit)) {
    if (deps.now().getTime() - started > budgetMs) {
      summary.moreDue = true;
      break;
    }
    summary.examined++;
    const fetchedAt = deps.now().toISOString(); // BEFORE the Stripe call, like the webhook handler
    let sub: Stripe.Subscription;
    try {
      sub = await deps.retrieveSubscription(c.subscriptionId);
    } catch (e) {
      const kind = isNotFound(e) ? "missing" : "stripe_error";
      summary.outcomes[kind]++;
      await remember(c, kind);
      continue;
    }
    const built = buildSyncArgs(sub, prices, c.lastEventId, [], fetchedAt); // no user hint: the database finds the owner from the stored subscription/customer
    if (!built.ok) {
      summary.outcomes.ignored++;
      await remember(c, "ignored");
      continue;
    }
    if (built.args.subscriptionId !== c.subscriptionId) {
      summary.outcomes.conflict++; // Stripe answered with a different subscription than we asked for: never record it
      await remember(c, "conflict");
      continue;
    }
    let failure: ReconcileFailureKind | null = null;
    try {
      const result = await deps.sync(built.args);
      if (result === "applied") summary.outcomes[differs(c, built.args) ? "changed" : "unchanged"]++;
      else if (result === "stale") summary.outcomes.stale++; // a webhook was newer: the check itself worked
      else if (result === "ownership_conflict" || result === "subscription_conflict") {
        summary.outcomes.conflict++;
        failure = "conflict";
      } else {
        summary.outcomes.ignored++;
        failure = "ignored";
      }
    } catch {
      summary.outcomes.store_error++;
      summary.aborted = true;
      break;
    }
    await remember(c, failure);
  }
  summary.backedOff = await deps.store.waiting(deps.now().toISOString()).catch(() => 0);
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The server-side invocation: POST /api/billing/reconcile, for the owner's scheduler or an operator, never for members or browsers.
//
// Authorization: a shared secret, BILLING_RECONCILE_SECRET (at least 32 characters), sent as "Authorization: Bearer <secret>". Without the
// variable (or with a short one) the endpoint is switched off entirely. The comparison is constant-time. A request carrying an Origin header is a
// browser request and is refused. The request names no account, customer or subscription: the optional body is {} or { "limit": 1..25 }.

export const RECONCILE_SECRET_ENV = "BILLING_RECONCILE_SECRET";
const MIN_SECRET_LENGTH = 32;

export type ReconcileRouteDeps = {
  env: Readonly<Record<string, string | undefined>>;
  run(opts: ReconcileOptions): Promise<ReconcileSummary>;
};

const realRouteDeps = (): ReconcileRouteDeps => ({
  env: process.env,
  run: (opts) =>
    reconcileSubscriptions(
      {
        store: createReconcileStore(),
        sync: (a) => createWebhookStore().syncSubscription(a),
        retrieveSubscription: (id) => getStripe().subscriptions.retrieve(id),
        prices: () => readBillingConfig().prices,
        now: () => new Date(),
      },
      opts
    ),
});

const respond = (body: Record<string, unknown>, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const digest = (s: string) => createHash("sha256").update(s).digest();
function secretMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

/** The optional body: nothing, {} or { "limit": n }. Anything else (an account, customer, subscription, URL…) is refused. */
export function parseReconcileBody(text: string): ReconcileOptions | null {
  if (text.trim().length === 0) return {};
  if (text.length > 64) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length === 0) return {};
  const limit = (body as { limit?: unknown }).limit;
  if (keys.length === 1 && keys[0] === "limit" && typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT) return { limit };
  return null;
}

export async function handleReconcileRequest(req: Request, deps: ReconcileRouteDeps = realRouteDeps()): Promise<Response> {
  const secret = deps.env[RECONCILE_SECRET_ENV]?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return respond({ error: "reconcile_unavailable" }, 503);

  if (req.headers.get("origin")) return respond({ error: "forbidden" }, 403); // browsers send Origin; this is for servers only
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m || !secretMatches(m[1], secret)) return respond({ error: "unauthorized" }, 401);

  const opts = parseReconcileBody(await req.text().catch(() => "x"));
  if (!opts) return respond({ error: "invalid_request" }, 400);

  try {
    const summary = await deps.run(opts);
    console.info("billing reconcile", { examined: summary.examined, ...summary.outcomes, moreDue: summary.moreDue, aborted: summary.aborted }); // counts only
    return respond({ ...summary }, summary.aborted ? 503 : 200);
  } catch {
    return respond({ error: "reconcile_failed" }, 503); // not configured / database unreachable: nothing was changed; no detail is given
  }
}

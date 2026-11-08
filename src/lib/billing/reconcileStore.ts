import "server-only";
import { createClient } from "@supabase/supabase-js";

// Which billing records the reconciler should re-check against Stripe, and the memory of which ones failed: read from public.account_billing with
// the Supabase service role (that table has no policies and no browser access). Refreshed billing state is NOT written here; it goes through the
// existing sync function (webhookStore.syncSubscription), the same path the webhooks use, with its stale-snapshot guard.
//
// The only thing this store writes is the retry/backoff memory (reconcile_* columns), through the one function record_reconcile_result
// (supabase/migrations/20261123000100_reconcile_backoff.sql). That function can touch those four columns and nothing else, so backoff metadata can
// never alter a status, plan, period, entitlement, trial or admin grant.
//
// Failures are logged with the same safe fields as the other stores (category, operation, error code, HTTP status): never a message, key, URL
// or identifier.

/** A stored record, as far as the reconciler needs: the identifiers to ask Stripe about and the facts to compare with what Stripe says. */
export type ReconcileCandidate = {
  subscriptionId: string;
  lastEventId: string | null;
  status: string | null;
  priceId: string | null;
  cancelAtPeriodEnd: boolean;
  periodEnd: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  syncedAt: string | null;
  /** How many reconciliation attempts in a row have failed for this record (0 = healthy). */
  failures: number;
};

export type ReconcileFailureKind = "missing" | "conflict" | "stripe_error" | "ignored";
export type ReconcileRecord = { ok: true } | { ok: false; kind: ReconcileFailureKind; nextAttemptAtIso: string };

export type ReconcileStore = {
  /**
   * Records worth re-checking: they have a subscription, are not over for good (canceled / incomplete_expired are final in Stripe), were last
   * synchronised before `staleBefore` (or never), and are NOT waiting out a retry delay (`now` is past their next attempt time, or they have none).
   * Healthy records (no failures) come first, then the longest-unsynchronised; at most `limit`. A failing record therefore cannot keep a healthy
   * one out of a batch, and cannot occupy a batch until its own retry time comes round.
   */
  candidates(staleBeforeIso: string, nowIso: string, limit: number): Promise<ReconcileCandidate[]>;
  /** How many records are currently waiting out a retry delay: failures that are still visible and will be retried, not discarded. */
  waiting(nowIso: string): Promise<number>;
  /** Remember the result of one check (success clears the failure memory; a failure counts it and sets the earliest retry time). Best-effort. */
  record(subscriptionId: string, result: ReconcileRecord): Promise<void>;
};

export class ReconcileStoreUnavailableError extends Error {
  constructor(readonly reason: "missing_env" | "query_error" = "query_error") {
    super("Billing reconcile store is unavailable");
    this.name = "ReconcileStoreUnavailableError";
  }
}

const SUB_ID = /^sub_[A-Za-z0-9]+$/;
const EVENT_ID = /^evt_[A-Za-z0-9]+$/;
const SAFE_CODE = /^[A-Za-z0-9_]{1,16}$/;
const safeCode = (c: unknown) => (typeof c === "string" && SAFE_CODE.test(c) ? c : undefined);
const safeStatus = (s: unknown) => (typeof s === "number" && Number.isInteger(s) && s >= 0 && s < 1000 ? s : undefined);
const logFailure = (d: { reason: string; op: string; missing?: string[]; code?: string; status?: number }) => console.error("reconcile billing store failure", d);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function createReconcileStore(env: Readonly<Record<string, string | undefined>> = process.env): ReconcileStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter((x): x is string => !!x);
  if (!url || !key) {
    logFailure({ reason: "missing_env", op: "init", missing });
    throw new ReconcileStoreUnavailableError("missing_env");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  async function run<T>(op: string, fn: () => PromiseLike<{ data: T; error: { code?: unknown } | null; status?: unknown; count?: number | null }>): Promise<{ data: T; count: number | null }> {
    let res: Awaited<ReturnType<typeof fn>>;
    try {
      res = await fn();
    } catch {
      logFailure({ reason: "query_error", op });
      throw new ReconcileStoreUnavailableError("query_error");
    }
    if (res.error) {
      logFailure({ reason: "query_error", op, code: safeCode(res.error.code), status: safeStatus(res.status) });
      throw new ReconcileStoreUnavailableError("query_error");
    }
    return { data: res.data, count: res.count ?? null };
  }

  return {
    async candidates(staleBeforeIso, nowIso, limit) {
      // (never synchronised OR synchronised before the cut-off) AND (no retry time OR the retry time has come). PostgREST takes ONE top-level
      // "or", so the AND of two ORs is written out as an OR of the four combinations.
      const due = `subscription_synced_at.is.null,subscription_synced_at.lt.${staleBeforeIso}`.split(",");
      const ready = `reconcile_next_attempt_at.is.null,reconcile_next_attempt_at.lte.${nowIso}`.split(",");
      const combos = due.flatMap((d) => ready.map((r) => `and(${d},${r})`)).join(",");
      const { data } = await run("candidates", () =>
        db
          .from("account_billing")
          .select("stripe_subscription_id, last_event_id, subscription_status, stripe_price_id, cancel_at_period_end, current_period_end, canceled_at, ended_at, subscription_synced_at, reconcile_failures")
          .not("stripe_subscription_id", "is", null)
          .not("subscription_status", "in", "(canceled,incomplete_expired)")
          .or(combos)
          .order("reconcile_failures", { ascending: true })
          .order("subscription_synced_at", { ascending: true, nullsFirst: true })
          .limit(limit)
      );
      const out: ReconcileCandidate[] = [];
      for (const r of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) {
        const subscriptionId = str(r.stripe_subscription_id);
        if (!subscriptionId || !SUB_ID.test(subscriptionId)) continue; // never ask Stripe about anything that isn't a subscription ID
        const last = str(r.last_event_id);
        out.push({
          subscriptionId,
          lastEventId: last && EVENT_ID.test(last) ? last : null,
          status: str(r.subscription_status),
          priceId: str(r.stripe_price_id),
          cancelAtPeriodEnd: r.cancel_at_period_end === true,
          periodEnd: str(r.current_period_end),
          canceledAt: str(r.canceled_at),
          endedAt: str(r.ended_at),
          syncedAt: str(r.subscription_synced_at),
          failures: typeof r.reconcile_failures === "number" && Number.isInteger(r.reconcile_failures) && r.reconcile_failures > 0 ? r.reconcile_failures : 0,
        });
      }
      return out;
    },

    async waiting(nowIso) {
      const { count } = await run("waiting", () =>
        db
          .from("account_billing")
          .select("stripe_subscription_id", { count: "exact", head: true })
          .not("stripe_subscription_id", "is", null)
          .not("subscription_status", "in", "(canceled,incomplete_expired)")
          .gt("reconcile_next_attempt_at", nowIso)
      );
      return count ?? 0;
    },

    async record(subscriptionId, result) {
      if (!SUB_ID.test(subscriptionId)) return;
      await run("record", () =>
        db.rpc("record_reconcile_result", {
          p_subscription_id: subscriptionId,
          p_outcome: result.ok ? "ok" : result.kind,
          p_next_attempt_at: result.ok ? null : result.nextAttemptAtIso,
        })
      );
    },
  };
}

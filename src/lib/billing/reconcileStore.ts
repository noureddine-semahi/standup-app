import "server-only";
import { createClient } from "@supabase/supabase-js";

// Which billing records the reconciler should re-check against Stripe: read from public.account_billing with the Supabase service role (that
// table has no policies and no browser access). READ-ONLY: one select, no filters from any request. Writing the refreshed state is NOT done
// here; it goes through the existing sync function (webhookStore.syncSubscription), the same path the webhooks use, with its stale-snapshot guard.
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
};

export type ReconcileStore = {
  /**
   * Records worth re-checking, oldest synchronisation first: they have a subscription, are not over for good (canceled / incomplete_expired
   * are final in Stripe), and were last synchronised before `staleBefore` (or never). At most `limit`.
   */
  candidates(staleBeforeIso: string, limit: number): Promise<ReconcileCandidate[]>;
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

  return {
    async candidates(staleBeforeIso, limit) {
      let res: { data: unknown; error: { code?: unknown } | null; status?: unknown };
      try {
        res = (await db
          .from("account_billing")
          .select("stripe_subscription_id, last_event_id, subscription_status, stripe_price_id, cancel_at_period_end, current_period_end, canceled_at, ended_at, subscription_synced_at")
          .not("stripe_subscription_id", "is", null)
          .not("subscription_status", "in", "(canceled,incomplete_expired)")
          .or(`subscription_synced_at.is.null,subscription_synced_at.lt.${staleBeforeIso}`)
          .order("subscription_synced_at", { ascending: true, nullsFirst: true })
          .limit(limit)) as typeof res;
      } catch {
        logFailure({ reason: "query_error", op: "candidates" });
        throw new ReconcileStoreUnavailableError("query_error");
      }
      if (res.error) {
        logFailure({ reason: "query_error", op: "candidates", code: safeCode(res.error.code), status: safeStatus(res.status) });
        throw new ReconcileStoreUnavailableError("query_error");
      }
      const out: ReconcileCandidate[] = [];
      for (const r of Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : []) {
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
        });
      }
      return out;
    },
  };
}

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { AccountTier } from "@/lib/entitlements";
import type { DeletionState, MemberInput } from "@/lib/admin/memberBilling";
import type { SyncRecord, WebhookEvent } from "@/lib/admin/billingOperations";

// The rows behind the admin member table and Billing Operations view, read with the Supabase service role (these tables are not readable by browsers).
// READ-ONLY: select queries and the Auth user listing, nothing else. The callers have already verified a System Admin, and turn these rows into
// minimal answers: a member's email, name, plan and billing status; webhook event TYPES and outcomes. No payload, Stripe ID, payment detail or secret
// is ever selected (the ledger holds none) and nothing identifying is kept beyond what the endpoints return.
//
// Failures are logged with the same safe fields as the other stores: operation, error code, HTTP status. Never a message, key, URL or identifier.

export type AdminBillingStore = {
  members(): Promise<MemberInput[]>;
  operations(): Promise<{ events: WebhookEvent[]; records: SyncRecord[] }>;
};

export class AdminBillingStoreUnavailableError extends Error {
  constructor(readonly reason: "missing_env" | "query_error" = "query_error") {
    super("Admin billing store is unavailable");
    this.name = "AdminBillingStoreUnavailableError";
  }
}

const PAGE = 1000;
const MAX_PAGES = 50;
const EVENT_LIMIT = 200;
const TIERS: readonly string[] = ["free", "premium_trial", "premium"];
const STATES: readonly string[] = ["pending", "billing_cancelled", "data_cleaned"];
const EVENT_STATUS: readonly string[] = ["processing", "processed", "failed"];
const SAFE_CODE = /^[A-Za-z0-9_]{1,16}$/;
const logFailure = (d: { reason: string; op: string; missing?: string[]; code?: string; status?: number }) => console.error("admin billing store failure", d);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function createAdminBillingStore(env: Readonly<Record<string, string | undefined>> = process.env): AdminBillingStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter((x): x is string => !!x);
  if (!url || !key) {
    logFailure({ reason: "missing_env", op: "init", missing });
    throw new AdminBillingStoreUnavailableError("missing_env");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const fail = (op: string, e?: { code?: unknown; status?: unknown } | null): never => {
    logFailure({ reason: "query_error", op, code: typeof e?.code === "string" && SAFE_CODE.test(e.code) ? e.code : undefined, status: typeof e?.status === "number" && e.status >= 0 && e.status < 1000 ? e.status : undefined });
    throw new AdminBillingStoreUnavailableError("query_error");
  };

  type Res = { data: unknown; error: { code?: unknown; status?: unknown } | null; status?: unknown };
  async function page(op: string, table: string, columns: string, order: string, from: number, to: number, desc = false): Promise<Record<string, unknown>[]> {
    let res: Res;
    try {
      res = (await db.from(table).select(columns).order(order, { ascending: !desc }).range(from, to)) as unknown as Res;
    } catch {
      return fail(op);
    }
    if (res.error) return fail(op, { code: res.error.code, status: res.status });
    return Array.isArray(res.data) ? (res.data as unknown as Record<string, unknown>[]) : [];
  }
  async function all(op: string, table: string, columns: string, order: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const batch = await page(op, table, columns, order, p * PAGE, p * PAGE + PAGE - 1);
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    return rows;
  }

  /** Every Supabase Auth account's ID and email (only those two fields are kept). */
  async function users(): Promise<{ id: string; email: string | null }[]> {
    const out: { id: string; email: string | null }[] = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      let res: { data: { users?: { id?: unknown; email?: unknown }[] } | null; error: { code?: unknown; status?: unknown } | null };
      try {
        res = (await db.auth.admin.listUsers({ page: p, perPage: PAGE })) as unknown as typeof res;
      } catch {
        return fail("accounts");
      }
      if (res.error) return fail("accounts", res.error);
      const batch = res.data?.users ?? [];
      for (const u of batch) {
        const id = str(u.id);
        if (id) out.push({ id, email: str(u.email) });
      }
      if (batch.length < PAGE) break;
    }
    return out;
  }

  return {
    async members() {
      const [accounts, profiles, ent, bill, dels] = await Promise.all([
        users(),
        all("profiles", "profiles", "id, display_name", "id"),
        all("entitlements", "account_entitlements", "user_id, tier, trial_ends_at", "user_id"),
        all("billing", "account_billing", "user_id, subscription_status, current_period_end, cancel_at_period_end, subscription_synced_at", "user_id"),
        all("deletions", "account_deletions", "user_id, state", "user_id"),
      ]);
      const name = new Map(profiles.map((r) => [str(r.id), str(r.display_name)] as const));
      const e = new Map(ent.map((r) => [str(r.user_id), r] as const));
      const b = new Map(bill.map((r) => [str(r.user_id), r] as const));
      const d = new Map(dels.map((r) => [str(r.user_id), str(r.state)] as const));
      return accounts.map((a): MemberInput => {
        const er = e.get(a.id);
        const br = b.get(a.id);
        const st = d.get(a.id) ?? null;
        return {
          id: a.id,
          email: a.email,
          displayName: name.get(a.id) ?? null,
          tier: (typeof er?.tier === "string" && TIERS.includes(er.tier) ? er.tier : null) as AccountTier | null,
          trialEndsAt: str(er?.trial_ends_at),
          status: str(br?.subscription_status),
          periodEnd: str(br?.current_period_end),
          cancelAtPeriodEnd: br?.cancel_at_period_end === true,
          syncedAt: str(br?.subscription_synced_at),
          deletionState: (st && STATES.includes(st) ? st : null) as DeletionState | null,
        };
      });
    },

    async operations() {
      const [accounts, evs, bill] = await Promise.all([
        users(),
        page("events", "stripe_webhook_events", "event_type, status, attempts, last_error, received_at, claimed_at, processed_at", "received_at", 0, EVENT_LIMIT - 1, true),
        all("billing", "account_billing", "user_id, subscription_status, cancel_at_period_end, subscription_synced_at, reconcile_failures, reconcile_last_outcome, reconcile_last_failed_at, reconcile_next_attempt_at", "user_id"),
      ]);
      const email = new Map(accounts.map((a) => [a.id, a.email] as const));
      return {
        events: evs.flatMap((r): WebhookEvent[] => {
          const type = str(r.event_type);
          const receivedAt = str(r.received_at);
          const status = str(r.status);
          if (!type || !receivedAt || !status || !EVENT_STATUS.includes(status)) return [];
          return [{ type, status: status as WebhookEvent["status"], attempts: typeof r.attempts === "number" ? r.attempts : 1, lastError: str(r.last_error), receivedAt, claimedAt: str(r.claimed_at), processedAt: str(r.processed_at) }];
        }),
        records: bill.map((r): SyncRecord => ({
          member: email.get(str(r.user_id) ?? "") ?? null,
          status: str(r.subscription_status),
          cancelAtPeriodEnd: r.cancel_at_period_end === true,
          syncedAt: str(r.subscription_synced_at),
          reconcileFailures: typeof r.reconcile_failures === "number" && r.reconcile_failures > 0 ? r.reconcile_failures : 0,
          lastOutcome: str(r.reconcile_last_outcome),
          lastFailedAt: str(r.reconcile_last_failed_at),
          nextAttemptAt: str(r.reconcile_next_attempt_at),
        })),
      };
    },
  };
}

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { AccountTier } from "@/lib/entitlements";
import type { BillingRow, EntitlementRow } from "@/lib/admin/billingSummary";

// The rows behind the admin Premium & Billing dashboard, read with the Supabase service role (account_billing and the entitlement tables are not
// readable by browsers). READ-ONLY: selects only, whole tables, no filter from any request. The caller (billingOverview.ts) has already verified that
// the requester is a System Admin, and turns these rows into AGGREGATE COUNTS: nothing that identifies a member leaves the server.
//
// Failures are logged with the same safe fields as the other stores (operation, error code, HTTP status): never a message, key, URL or identifier.

export type OverviewInputs = {
  totalAccounts: number;
  entitlements: EntitlementRow[];
  billing: BillingRow[];
  trialHistoryUserIds: string[];
};

export type OverviewStore = { load(): Promise<OverviewInputs> };

export class OverviewStoreUnavailableError extends Error {
  constructor(readonly reason: "missing_env" | "query_error" = "query_error") {
    super("Admin overview store is unavailable");
    this.name = "OverviewStoreUnavailableError";
  }
}

const PAGE = 1000;
const MAX_PAGES = 50;
const TIERS: readonly string[] = ["free", "premium_trial", "premium"];
const SAFE_CODE = /^[A-Za-z0-9_]{1,16}$/;
const logFailure = (d: { reason: string; op: string; missing?: string[]; code?: string; status?: number }) => console.error("admin overview store failure", d);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function createOverviewStore(env: Readonly<Record<string, string | undefined>> = process.env): OverviewStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter((x): x is string => !!x);
  if (!url || !key) {
    logFailure({ reason: "missing_env", op: "init", missing });
    throw new OverviewStoreUnavailableError("missing_env");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  type Res = { data: unknown; error: { code?: unknown } | null; status?: unknown; count?: number | null };
  async function run(op: string, fn: () => PromiseLike<Res>): Promise<Res> {
    let res: Res;
    try {
      res = await fn();
    } catch {
      logFailure({ reason: "query_error", op });
      throw new OverviewStoreUnavailableError("query_error");
    }
    if (res.error) {
      const code = typeof res.error.code === "string" && SAFE_CODE.test(res.error.code) ? res.error.code : undefined;
      const status = typeof res.status === "number" && Number.isInteger(res.status) && res.status >= 0 && res.status < 1000 ? res.status : undefined;
      logFailure({ reason: "query_error", op, code, status });
      throw new OverviewStoreUnavailableError("query_error");
    }
    return res;
  }

  /** Every row of one table, page by page (a hard page cap keeps a runaway table from looping forever). */
  async function all(op: string, table: string, columns: string, order: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await run(op, () => db.from(table).select(columns).order(order, { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1) as unknown as PromiseLike<Res>);
      const batch = Array.isArray(res.data) ? (res.data as unknown as Record<string, unknown>[]) : [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    return rows;
  }

  return {
    async load() {
      // Every account, as Supabase Auth counts them. (Profile rows are created lazily the first time a member opens the app, so counting profiles would
      // miss anyone who signed up but hasn't been back.) Only the number is kept: the user records themselves are never read into the result.
      let totalAccounts = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        let res: { data: { users?: unknown[] } | null; error: { code?: unknown; status?: unknown } | null };
        try {
          res = (await db.auth.admin.listUsers({ page, perPage: PAGE })) as unknown as typeof res;
        } catch {
          logFailure({ reason: "query_error", op: "accounts" });
          throw new OverviewStoreUnavailableError("query_error");
        }
        if (res.error) {
          logFailure({ reason: "query_error", op: "accounts", code: typeof res.error.code === "string" && SAFE_CODE.test(res.error.code) ? res.error.code : undefined, status: typeof res.error.status === "number" ? res.error.status : undefined });
          throw new OverviewStoreUnavailableError("query_error");
        }
        const n = res.data?.users?.length ?? 0;
        totalAccounts += n;
        if (n < PAGE) break;
      }
      const ent = await all("entitlements", "account_entitlements", "user_id, tier, trial_ends_at", "user_id");
      const bill = await all("billing", "account_billing", "user_id, subscription_status, current_period_end, cancel_at_period_end", "user_id");
      const hist = await all("trial_history", "account_trial_history", "user_id", "user_id");
      return {
        totalAccounts,
        entitlements: ent.flatMap((r) => {
          const userId = str(r.user_id);
          return userId ? [{ userId, tier: (typeof r.tier === "string" && TIERS.includes(r.tier) ? r.tier : null) as AccountTier | null, trialEndsAt: str(r.trial_ends_at) }] : [];
        }),
        billing: bill.flatMap((r) => {
          const userId = str(r.user_id);
          return userId ? [{ userId, status: str(r.subscription_status), periodEnd: str(r.current_period_end), cancelAtPeriodEnd: r.cancel_at_period_end === true }] : [];
        }),
        trialHistoryUserIds: hist.flatMap((r) => (str(r.user_id) ? [str(r.user_id) as string] : [])),
      };
    },
  };
}

import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-side persistence for account deletion, with the Supabase service role (the only way to delete an Auth user or to reach other members'
// Storage folders). The account ID passed in is always the one the server just verified from the member's sign-in; nothing from a request body is ever
// used to look anything up. Durable deletion state, the lease and the trial marker live in SQL (supabase/migrations/20261124000100_safe_account_deletion.sql).
//
// Failures are logged with the same safe fields as the other stores (category, operation, error code, HTTP status): never a message, key, URL or identifier.

export type DeletionState = "pending" | "billing_cancelled" | "data_cleaned";
export type DeletionFailure = "billing" | "storage" | "data" | "auth" | "unexpected";
export type DeletionBegin = { result: "acquired"; state: DeletionState } | { result: "busy" } | { result: "invalid" };

export type BillingRefs = {
  customerId: string | null;
  subscriptionId: string | null;
  /** Checkout sessions this app recorded for the member (the Stripe-side search covers the ones it didn't). */
  sessionIds: string[];
};

export type DeletionStore = {
  /** Start or resume a deletion, atomically. "busy" means another request holds a live lease. */
  begin(userId: string): Promise<DeletionBegin>;
  /** Move the deletion forward (never back). With a failure the lease is released so the member can retry immediately. */
  advance(userId: string, state: DeletionState, failure: DeletionFailure | null): Promise<void>;
  /** Whether a deletion is in progress for this account (Checkout refuses while it is). */
  isPending(userId: string): Promise<boolean>;
  /** The member's own Stripe references from the billing records. */
  billingRefs(userId: string): Promise<BillingRefs>;
  /** Hand shared team goals to another participant, clear blocking references, and remove stored Premium grants/trial rows. Idempotent. */
  cleanupData(userId: string): Promise<void>;
  /** Remove every Storage object in the member's folder of each user bucket; throws unless all are gone. */
  removeStorage(userId: string): Promise<void>;
  /** The irreversible step. A missing user counts as done. */
  deleteAuthUser(userId: string): Promise<void>;
};

export class DeletionStoreUnavailableError extends Error {
  constructor(readonly reason: "missing_env" | "rpc_error" | "unexpected_response" | "storage_error" | "auth_error" = "rpc_error") {
    super("Account deletion store is unavailable");
    this.name = "DeletionStoreUnavailableError";
  }
}

/** Every bucket that stores a member's files under "<userId>/…". */
export const USER_BUCKETS = ["goal-attachments", "post-images", "post-videos", "avatars"] as const;

const SAFE_CODE = /^[A-Za-z0-9_]{1,16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUS = /^cus_[A-Za-z0-9]+$/;
const SUB = /^sub_[A-Za-z0-9]+$/;
const SESSION = /^cs_[A-Za-z0-9_]+$/;
const STATES: readonly string[] = ["pending", "billing_cancelled", "data_cleaned"];
const safeCode = (c: unknown) => (typeof c === "string" && SAFE_CODE.test(c) ? c : undefined);
const safeStatus = (s: unknown) => (typeof s === "number" && Number.isInteger(s) && s >= 0 && s < 1000 ? s : undefined);
const logFailure = (d: { reason: string; op: string; missing?: string[]; code?: string; status?: number }) => console.error("account deletion store failure", d);
const PAGE = 100;
const MAX_PAGES = 50;

export function createDeletionStore(env: Readonly<Record<string, string | undefined>> = process.env): DeletionStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter((x): x is string => !!x);
  if (!url || !key) {
    logFailure({ reason: "missing_env", op: "init", missing });
    throw new DeletionStoreUnavailableError("missing_env");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  type Res = { data: unknown; error: { code?: unknown } | null; status?: unknown };
  async function run(op: string, reason: "rpc_error" | "storage_error" | "auth_error", fn: () => PromiseLike<Res>): Promise<unknown> {
    let res: Res;
    try {
      res = await fn();
    } catch {
      logFailure({ reason, op });
      throw new DeletionStoreUnavailableError(reason);
    }
    if (res.error) {
      logFailure({ reason, op, code: safeCode(res.error.code), status: safeStatus(res.status) });
      throw new DeletionStoreUnavailableError(reason);
    }
    return res.data;
  }
  const rpc = (op: string, fn: string, args: Record<string, string | null>) => run(op, "rpc_error", () => db.rpc(fn, args) as unknown as PromiseLike<Res>);

  async function listFolder(bucket: string, userId: string): Promise<string[]> {
    const names: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = (await run("storage_list", "storage_error", () => db.storage.from(bucket).list(userId, { limit: PAGE, offset: page * PAGE }) as unknown as PromiseLike<Res>)) as { name?: unknown }[] | null;
      const batch = (data ?? []).map((o) => o.name).filter((n): n is string => typeof n === "string" && n.length > 0);
      names.push(...batch);
      if ((data ?? []).length < PAGE) break;
    }
    return names;
  }

  return {
    async begin(userId) {
      const data = await rpc("begin", "begin_account_deletion", { p_user_id: userId });
      const row = (Array.isArray(data) ? data[0] : data) as { r_result?: unknown; r_state?: unknown } | null;
      if (row?.r_result === "busy") return { result: "busy" };
      if (row?.r_result === "invalid") return { result: "invalid" };
      if (row?.r_result === "acquired" && typeof row.r_state === "string" && STATES.includes(row.r_state)) return { result: "acquired", state: row.r_state as DeletionState };
      logFailure({ reason: "unexpected_response", op: "begin" });
      throw new DeletionStoreUnavailableError("unexpected_response");
    },

    async advance(userId, state, failure) {
      const data = await rpc("advance", "advance_account_deletion", { p_user_id: userId, p_state: state, p_failure: failure });
      if (data !== "ok") {
        logFailure({ reason: "unexpected_response", op: "advance" });
        throw new DeletionStoreUnavailableError("unexpected_response");
      }
    },

    async isPending(userId) {
      const data = await rpc("pending", "account_deletion_pending", { p_user_id: userId });
      if (typeof data !== "boolean") {
        logFailure({ reason: "unexpected_response", op: "pending" });
        throw new DeletionStoreUnavailableError("unexpected_response");
      }
      return data;
    },

    async billingRefs(userId) {
      const billing = (await run("billing_refs", "rpc_error", () => db.from("account_billing").select("stripe_customer_id, stripe_subscription_id").eq("user_id", userId).limit(1) as unknown as PromiseLike<Res>)) as { stripe_customer_id?: unknown; stripe_subscription_id?: unknown }[] | null;
      const attempts = (await run("attempt_refs", "rpc_error", () => db.from("checkout_attempts").select("stripe_session_id").eq("user_id", userId).limit(200) as unknown as PromiseLike<Res>)) as { stripe_session_id?: unknown }[] | null;
      const b = billing?.[0];
      return {
        customerId: typeof b?.stripe_customer_id === "string" && CUS.test(b.stripe_customer_id) ? b.stripe_customer_id : null,
        subscriptionId: typeof b?.stripe_subscription_id === "string" && SUB.test(b.stripe_subscription_id) ? b.stripe_subscription_id : null,
        sessionIds: [...new Set((attempts ?? []).map((a) => a.stripe_session_id).filter((s): s is string => typeof s === "string" && SESSION.test(s)))],
      };
    },

    async cleanupData(userId) {
      await rpc("cleanup", "cleanup_account_shared_data", { p_user_id: userId });
    },

    async removeStorage(userId) {
      if (!UUID.test(userId)) throw new DeletionStoreUnavailableError("storage_error");
      for (const bucket of USER_BUCKETS) {
        for (let round = 0; round < 5; round++) {
          const names = await listFolder(bucket, userId);
          if (names.length === 0) break;
          for (let i = 0; i < names.length; i += PAGE) {
            await run("storage_remove", "storage_error", () => db.storage.from(bucket).remove(names.slice(i, i + PAGE).map((n) => `${userId}/${n}`)) as unknown as PromiseLike<Res>);
          }
        }
        if ((await listFolder(bucket, userId)).length > 0) {
          logFailure({ reason: "storage_error", op: "storage_verify" });
          throw new DeletionStoreUnavailableError("storage_error");
        }
      }
    },

    async deleteAuthUser(userId) {
      let res: { error: { status?: unknown; code?: unknown } | null };
      try {
        res = await db.auth.admin.deleteUser(userId);
      } catch {
        logFailure({ reason: "auth_error", op: "delete_user" });
        throw new DeletionStoreUnavailableError("auth_error");
      }
      if (res.error) {
        if (res.error.status === 404 || res.error.code === "user_not_found") return; // already gone: the goal is reached
        logFailure({ reason: "auth_error", op: "delete_user", code: safeCode(res.error.code), status: safeStatus(res.error.status) });
        throw new DeletionStoreUnavailableError("auth_error");
      }
    },
  };
}

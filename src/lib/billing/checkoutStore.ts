import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { BillingPlan } from "@/lib/billing/plans";

// The ledger of in-flight Checkout attempts (public.checkout_attempts, supabase/migrations/20261122000100_checkout_attempts.sql). It uses the
// Supabase service role, like the webhook ledger, and ONLY to call the three attempt functions: nothing else, no entitlements, no user data.
// The account ID passed in is always the one the server just verified from the member's sign-in; browsers can never call these functions.
//
// Failures are logged with the same safe fields as the webhook store (category, operation, error code, HTTP status): never a message, key,
// URL, ID or request body.

export type BeginResult =
  | { result: "claimed"; attemptId: string; plan: BillingPlan }
  | { result: "pending"; attemptId: string; sessionId: string; plan: BillingPlan }
  | { result: "subscription_exists" }
  | { result: "in_progress" };

export type CheckoutStore = {
  /** Decide, atomically, whether this member may start a Checkout now. */
  begin(userId: string, plan: BillingPlan): Promise<BeginResult>;
  /** The Stripe session now exists: remember it. */
  record(attemptId: string, sessionId: string, expiresAt: string | null): Promise<void>;
  finish(attemptId: string, status: "completed" | "expired" | "failed"): Promise<void>;
};

export class CheckoutStoreUnavailableError extends Error {
  constructor(readonly reason: "missing_env" | "rpc_error" | "unexpected_response" = "rpc_error") {
    super("Checkout attempt store is unavailable");
    this.name = "CheckoutStoreUnavailableError";
  }
}

const SAFE_CODE = /^[A-Za-z0-9_]{1,16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeCode = (c: unknown) => (typeof c === "string" && SAFE_CODE.test(c) ? c : undefined);
const safeStatus = (s: unknown) => (typeof s === "number" && Number.isInteger(s) && s >= 0 && s < 1000 ? s : undefined);
const logFailure = (d: { reason: string; op: string; missing?: string[]; code?: string; status?: number }) => console.error("checkout attempt store failure", d);

export function createCheckoutStore(env: Readonly<Record<string, string | undefined>> = process.env): CheckoutStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter((x): x is string => !!x);
  if (!url || !key) {
    logFailure({ reason: "missing_env", op: "init", missing });
    throw new CheckoutStoreUnavailableError("missing_env");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  async function call(op: string, fn: string, args: Record<string, string | null>): Promise<unknown> {
    let res: { data: unknown; error: { code?: unknown } | null; status?: unknown };
    try {
      res = (await db.rpc(fn, args)) as typeof res;
    } catch {
      logFailure({ reason: "rpc_error", op });
      throw new CheckoutStoreUnavailableError("rpc_error");
    }
    if (res.error) {
      logFailure({ reason: "rpc_error", op, code: safeCode(res.error.code), status: safeStatus(res.status) });
      throw new CheckoutStoreUnavailableError("rpc_error");
    }
    return res.data;
  }

  return {
    async begin(userId, plan) {
      const data = await call("begin", "begin_checkout_attempt", { p_user_id: userId, p_plan: plan });
      const row = (Array.isArray(data) ? data[0] : data) as { r_result?: unknown; r_attempt_id?: unknown; r_session_id?: unknown; r_plan?: unknown } | null;
      const result = row?.r_result;
      const attemptId = typeof row?.r_attempt_id === "string" && UUID.test(row.r_attempt_id) ? row.r_attempt_id : null;
      const rowPlan: BillingPlan | null = row?.r_plan === "monthly" || row?.r_plan === "annual" ? row.r_plan : null;
      if (result === "subscription_exists") return { result };
      if (result === "in_progress") return { result };
      if (result === "claimed" && attemptId && rowPlan) return { result, attemptId, plan: rowPlan };
      if (result === "pending" && attemptId && rowPlan && typeof row?.r_session_id === "string" && /^cs_/.test(row.r_session_id)) return { result, attemptId, sessionId: row.r_session_id, plan: rowPlan };
      logFailure({ reason: "unexpected_response", op: "begin" });
      throw new CheckoutStoreUnavailableError("unexpected_response");
    },
    async record(attemptId, sessionId, expiresAt) {
      await call("record", "record_checkout_session", { p_attempt_id: attemptId, p_session_id: sessionId, p_expires_at: expiresAt });
    },
    async finish(attemptId, status) {
      await call("finish", "finish_checkout_attempt", { p_attempt_id: attemptId, p_status: status });
    },
  };
}

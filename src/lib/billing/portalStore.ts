import "server-only";
import { createClient } from "@supabase/supabase-js";

// Where the Customer Portal learns WHICH Stripe customer a member is: the member's own row in public.account_billing, read with the Supabase
// service role (that table has no policies and no browser access). It is the only place a customer ID comes from. The account ID passed in is
// always the one the server just verified from the member's sign-in; nothing the browser sends is ever used to look anything up.
//
// READ-ONLY: one select of two columns for one account. Failures are logged with the same safe fields as the other stores (category, operation,
// error code, HTTP status): never a message, key, URL or identifier.

export type PortalCustomer = { customerId: string; status: string | null };

export class PortalStoreUnavailableError extends Error {
  constructor(readonly reason: "missing_env" | "query_error" = "query_error") {
    super("Billing record store is unavailable");
    this.name = "PortalStoreUnavailableError";
  }
}

export type PortalStore = {
  /** The member's Stripe customer and subscription status, or null when they have no billing record (or no customer in it). */
  customerFor(userId: string): Promise<PortalCustomer | null>;
};

const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/;
const SAFE_CODE = /^[A-Za-z0-9_]{1,16}$/;
const safeCode = (c: unknown) => (typeof c === "string" && SAFE_CODE.test(c) ? c : undefined);
const safeStatus = (s: unknown) => (typeof s === "number" && Number.isInteger(s) && s >= 0 && s < 1000 ? s : undefined);
const logFailure = (d: { reason: string; op: string; missing?: string[]; code?: string; status?: number }) => console.error("portal billing store failure", d);

export function createPortalStore(env: Readonly<Record<string, string | undefined>> = process.env): PortalStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter((x): x is string => !!x);
  if (!url || !key) {
    logFailure({ reason: "missing_env", op: "init", missing });
    throw new PortalStoreUnavailableError("missing_env");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  return {
    async customerFor(userId) {
      let res: { data: unknown; error: { code?: unknown } | null; status?: unknown };
      try {
        res = (await db.from("account_billing").select("stripe_customer_id, subscription_status").eq("user_id", userId).limit(1)) as typeof res;
      } catch {
        logFailure({ reason: "query_error", op: "customerFor" });
        throw new PortalStoreUnavailableError("query_error");
      }
      if (res.error) {
        logFailure({ reason: "query_error", op: "customerFor", code: safeCode(res.error.code), status: safeStatus(res.status) });
        throw new PortalStoreUnavailableError("query_error");
      }
      const row = (Array.isArray(res.data) ? res.data[0] : null) as { stripe_customer_id?: unknown; subscription_status?: unknown } | null;
      if (!row || typeof row.stripe_customer_id !== "string" || !CUSTOMER_ID.test(row.stripe_customer_id)) return null;
      return { customerId: row.stripe_customer_id, status: typeof row.subscription_status === "string" && row.subscription_status ? row.subscription_status : null };
    },
  };
}

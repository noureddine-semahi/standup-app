import "server-only";
import { createClient } from "@supabase/supabase-js";

// Persistent webhook-event deduplication (public.stripe_webhook_events, supabase/migrations/20261118000100_stripe_webhook_events.sql).
// This is the ONE place the Supabase service role is used, and only to call the three claim/complete/fail functions: nothing else in
// the app uses elevated access, and these functions touch no user data or entitlements. The service role key never leaves the server.
//
// When the store fails the webhook answers a generic 503 (unchanged), but the SERVER log says why, with safe fields only: the failure
// category, the operation, the names of any missing variables, and a PostgREST/Postgres error code and HTTP status. Never a message,
// hint, detail, URL, key, token or request body: those can quote credentials or customer data.

export type ClaimResult = "claimed" | "duplicate" | "in_progress";

export type WebhookStore = {
  /** Atomically claim an event for processing. Concurrent deliveries of one event: exactly one gets "claimed". */
  claim(eventId: string, eventType: string): Promise<ClaimResult>;
  complete(eventId: string): Promise<void>;
  /** `code` is a short machine code (e.g. "handler_error"), never a message. */
  fail(eventId: string, code: string): Promise<void>;
};

/** missing_env: a required variable isn't set. rpc_error: Supabase (or the network) failed the call. unexpected_response: it answered with something else. */
export type StoreFailure = "missing_env" | "rpc_error" | "unexpected_response";

export class WebhookStoreUnavailableError extends Error {
  constructor(readonly reason: StoreFailure = "rpc_error") {
    super("Webhook event store is unavailable");
    this.name = "WebhookStoreUnavailableError";
  }
}

const SAFE_CODE = /^[A-Za-z0-9_]{1,16}$/;

type Diagnostic = { reason: StoreFailure; op: string; missing?: string[]; code?: string; status?: number };

/** Log a diagnostic built ONLY from the allow-listed fields above (the type admits nothing else). */
function logStoreFailure(d: Diagnostic): void {
  console.error("stripe webhook store failure", d);
}

/** The error code only if it looks like a code (e.g. "42501", "PGRST202"); anything else is dropped rather than risk logging free text. */
const safeCode = (code: unknown): string | undefined => (typeof code === "string" && SAFE_CODE.test(code) ? code : undefined);
const safeStatus = (status: unknown): number | undefined => (typeof status === "number" && Number.isInteger(status) && status >= 0 && status < 1000 ? status : undefined);

export function createWebhookStore(env: Readonly<Record<string, string | undefined>> = process.env): WebhookStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter((x): x is string => !!x);
  if (!url || !key || missing.length > 0) {
    logStoreFailure({ reason: "missing_env", op: "init", missing });
    throw new WebhookStoreUnavailableError("missing_env");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  /** One rpc call. Returns the data on success; on any failure logs the safe diagnostic and throws. */
  async function call(op: string, fn: string, args: Record<string, string>): Promise<unknown> {
    let res: { data: unknown; error: { code?: unknown } | null; status?: unknown };
    try {
      res = (await db.rpc(fn, args)) as typeof res;
    } catch {
      logStoreFailure({ reason: "rpc_error", op }); // the call itself threw (network, DNS, timeout): no code or status exists
      throw new WebhookStoreUnavailableError("rpc_error");
    }
    if (res.error) {
      logStoreFailure({ reason: "rpc_error", op, code: safeCode(res.error.code), status: safeStatus(res.status) });
      throw new WebhookStoreUnavailableError("rpc_error");
    }
    return res.data;
  }

  return {
    async claim(eventId, eventType) {
      const data = await call("claim", "claim_stripe_event", { p_event_id: eventId, p_event_type: eventType });
      if (data !== "claimed" && data !== "duplicate" && data !== "in_progress") {
        logStoreFailure({ reason: "unexpected_response", op: "claim" });
        throw new WebhookStoreUnavailableError("unexpected_response");
      }
      return data;
    },
    async complete(eventId) {
      await call("complete", "complete_stripe_event", { p_event_id: eventId });
    },
    async fail(eventId, code) {
      await call("fail", "fail_stripe_event", { p_event_id: eventId, p_error: code });
    },
  };
}

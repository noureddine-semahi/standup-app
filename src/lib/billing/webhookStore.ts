import "server-only";
import { createClient } from "@supabase/supabase-js";

// Persistent webhook-event deduplication (public.stripe_webhook_events, supabase/migrations/20261118000100_stripe_webhook_events.sql).
// This is the ONE place the Supabase service role is used, and only to call the three claim/complete/fail functions: nothing else in
// the app uses elevated access, and these functions touch no user data or entitlements. The service role key never leaves the server.

export type ClaimResult = "claimed" | "duplicate" | "in_progress";

export type WebhookStore = {
  /** Atomically claim an event for processing. Concurrent deliveries of one event: exactly one gets "claimed". */
  claim(eventId: string, eventType: string): Promise<ClaimResult>;
  complete(eventId: string): Promise<void>;
  /** `code` is a short machine code (e.g. "handler_error"), never a message. */
  fail(eventId: string, code: string): Promise<void>;
};

export class WebhookStoreUnavailableError extends Error {
  constructor() {
    super("Webhook event store is unavailable");
    this.name = "WebhookStoreUnavailableError";
  }
}

export function createWebhookStore(env: Readonly<Record<string, string | undefined>> = process.env): WebhookStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new WebhookStoreUnavailableError();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  return {
    async claim(eventId, eventType) {
      const { data, error } = await db.rpc("claim_stripe_event", { p_event_id: eventId, p_event_type: eventType });
      if (error || (data !== "claimed" && data !== "duplicate" && data !== "in_progress")) throw new WebhookStoreUnavailableError();
      return data;
    },
    async complete(eventId) {
      const { error } = await db.rpc("complete_stripe_event", { p_event_id: eventId });
      if (error) throw new WebhookStoreUnavailableError();
    },
    async fail(eventId, code) {
      const { error } = await db.rpc("fail_stripe_event", { p_event_id: eventId, p_error: code });
      if (error) throw new WebhookStoreUnavailableError();
    },
  };
}

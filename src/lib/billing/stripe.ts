import "server-only";
import Stripe from "stripe";
import { readBillingConfig, type BillingConfig } from "@/lib/billing/config";

// The one Stripe client, created lazily on the server from validated test-mode configuration. Import this only from server code
// (route handlers, server actions); the `server-only` import stops the build if a client component tries. Making the client does not
// contact Stripe; nothing in this phase calls Stripe at all.

export function createStripeClient(config: BillingConfig): Stripe {
  return new Stripe(config.secretKey, { appInfo: { name: "StandUp" }, maxNetworkRetries: 2 });
}

let client: Stripe | null = null;

/** The shared client. Throws BillingConfigError (naming the bad variables, never their values) if the environment isn't set up. */
export function getStripe(): Stripe {
  if (!client) client = createStripeClient(readBillingConfig());
  return client;
}

/** For tests only. */
export function resetStripeClientForTests(): void {
  client = null;
}

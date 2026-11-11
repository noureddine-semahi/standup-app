import "server-only";
import Stripe from "stripe";
import { readBillingConfig, type BillingConfig } from "@/lib/billing/config";

// The one Stripe client, created lazily on the server from validated configuration (test mode by default; live only when STRIPE_MODE=live
// and the key is a restricted live key: see config.ts). Checkout, the Customer Portal, reconciliation, the webhook and account deletion all
// reach Stripe through this client or through readBillingConfig/readWebhookConfig. Import this only from server code (route handlers,
// server actions); the `server-only` import stops the build if a client component tries. Making the client does not contact Stripe.

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

/**
 * Verifies a webhook's signature against its RAW body and returns the verified event; throws if the signature is missing, malformed,
 * wrong or too old (Stripe's default 5-minute tolerance). The only place the webhook secret is used.
 */
export function createWebhookVerifier(secretKey: string, webhookSecret: string): (rawBody: string, signatureHeader: string) => Stripe.Event {
  const stripe = new Stripe(secretKey, { appInfo: { name: "StandUp" } });
  return (rawBody, signatureHeader) => stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

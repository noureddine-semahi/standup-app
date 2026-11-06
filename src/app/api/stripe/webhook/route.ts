import { handleStripeWebhook } from "@/lib/billing/webhook";

// POST /api/stripe/webhook. Logic and contract: src/lib/billing/webhook.ts. POST only; Next answers any other method with 405.
// The raw request body is read inside the handler (the signature is over the raw bytes).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleStripeWebhook(request);
}

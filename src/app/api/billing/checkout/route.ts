import { handleCheckoutRequest } from "@/lib/billing/checkout";

// POST /api/billing/checkout. The logic, and the contract, are in src/lib/billing/checkout.ts. POST only: Next answers any other method with 405.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleCheckoutRequest(request);
}

import { handlePortalRequest } from "@/lib/billing/portal";

// POST /api/billing/portal. The logic, and the contract, are in src/lib/billing/portal.ts. POST only: Next answers any other method with 405.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handlePortalRequest(request);
}

import { handleBillingOverviewRequest } from "@/lib/admin/billingOverview";

// POST /api/admin/billing-overview. The logic, and the contract, are in src/lib/admin/billingOverview.ts. POST only: Next answers any other method with 405.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleBillingOverviewRequest(request);
}

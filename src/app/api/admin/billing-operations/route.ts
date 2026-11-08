import { handleOperationsRequest } from "@/lib/admin/billingAdmin";

// POST /api/admin/billing-operations. The logic, and the contract, are in src/lib/admin/billingAdmin.ts. POST only: Next answers any other method with 405.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleOperationsRequest(request);
}

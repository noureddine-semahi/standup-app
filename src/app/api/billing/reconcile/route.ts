import { handleReconcileRequest } from "@/lib/billing/reconcile";

// POST /api/billing/reconcile: server-to-server only, authorised by a shared secret (see src/lib/billing/reconcile.ts). POST only: Next answers any
// other method with 405.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleReconcileRequest(request);
}

import { handleReconcileRequest } from "@/lib/billing/reconcile";

// /api/billing/reconcile: server-to-server only, authorised by a shared secret (see src/lib/billing/reconcile.ts).
//   POST: manual or external scheduler. GET: Vercel Cron (the only method it can use); the schedule is in vercel.json.
// Any other method: Next answers 405.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The run's own time budget is 20 s (DEFAULT_BUDGET_MS); this leaves headroom for the last Stripe call and the response so the platform doesn't cut a run off.
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleReconcileRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleReconcileRequest(request);
}

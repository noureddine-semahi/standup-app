import { handleDeleteAccountRequest } from "@/lib/account/deleteAccount";

// POST /api/account/delete. The logic, and the contract, are in src/lib/account/deleteAccount.ts. POST only: Next answers any other method with 405.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A deletion cancels subscriptions, empties Storage and deletes the login in one request: allow it time (a timeout simply leaves a resumable state).
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleDeleteAccountRequest(request);
}

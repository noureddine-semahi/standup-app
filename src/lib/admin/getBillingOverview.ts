import type { BillingOverviewResponse } from "@/lib/admin/billingOverview";

// The browser side of the admin Premium & Billing dashboard: ask the server endpoint for the aggregate numbers. The server decides who may see them;
// this only forwards the member's own token. It sends nothing else and never changes anything.

export type OverviewResult = { kind: "ok"; data: BillingOverviewResponse } | { kind: "login" } | { kind: "forbidden" } | { kind: "error" };

export async function getBillingOverview(deps: { getAccessToken(): Promise<string | null>; fetchImpl?: typeof fetch }): Promise<OverviewResult> {
  let token: string | null = null;
  try {
    token = await deps.getAccessToken();
  } catch {
    token = null;
  }
  if (!token) return { kind: "login" };
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)("/api/admin/billing-overview", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch {
    return { kind: "error" };
  }
  if (res.status === 401) return { kind: "login" };
  if (res.status === 403) return { kind: "forbidden" };
  const body = (await res.json().catch(() => null)) as BillingOverviewResponse | null;
  if (!res.ok || !body || typeof body !== "object" || !body.accounts || !body.subscriptions || !body.premiumSources || !body.flags) return { kind: "error" };
  return { kind: "ok", data: body };
}

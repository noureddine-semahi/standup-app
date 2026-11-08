import type { MemberFlagFilter, MemberPlanFilter, MemberRow } from "@/lib/admin/memberBilling";
import type { OperationsOverview } from "@/lib/admin/billingOperations";

// The browser side of the admin member table, billing operations and manual grant/revoke. The SERVER decides who may see or do anything (it verifies a
// System Admin before reading or changing anything); this only forwards the member's own token and the typed request. Nothing here talks to Stripe.

export type ApiResult<T> = { kind: "ok"; data: T } | { kind: "login" } | { kind: "forbidden" } | { kind: "refused"; code: string } | { kind: "error" };
type Deps = { getAccessToken(): Promise<string | null>; fetchImpl?: typeof fetch };

export type MembersPage = { generatedAt: string; items: MemberRow[]; total: number; page: number; pageSize: number; pages: number };
export type MembersRequest = { search: string; plan: MemberPlanFilter; filter: MemberFlagFilter; page: number; pageSize: number };

async function post<T>(path: string, body: unknown, deps: Deps, valid: (d: unknown) => boolean): Promise<ApiResult<T>> {
  let token: string | null = null;
  try {
    token = await deps.getAccessToken();
  } catch {
    token = null;
  }
  if (!token) return { kind: "login" };
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(path, { method: "POST", headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { kind: "error" };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 401) return { kind: "login" };
  if (res.status === 403) return { kind: "forbidden" };
  if (res.status === 409 || res.status === 404) return { kind: "refused", code: typeof json?.error === "string" ? json.error : "change_failed" };
  if (!res.ok || !json || !valid(json)) return { kind: "error" };
  return { kind: "ok", data: json as T };
}

export const getBillingMembers = (q: MembersRequest, deps: Deps) => post<MembersPage>("/api/admin/billing-members", q, deps, (d) => Array.isArray((d as { items?: unknown }).items) && typeof (d as { total?: unknown }).total === "number");
export const getBillingOperations = (deps: Deps) => post<OperationsOverview>("/api/admin/billing-operations", undefined, deps, (d) => !!(d as { webhooks?: unknown }).webhooks && !!(d as { reconciliation?: unknown }).reconciliation);
export const setMemberPremium = (userId: string, action: "grant" | "revoke", deps: Deps) => post<{ status: "ok"; manualGrant: boolean; effectiveTier: string }>("/api/admin/billing-premium", { userId, action }, deps, (d) => (d as { status?: unknown }).status === "ok");

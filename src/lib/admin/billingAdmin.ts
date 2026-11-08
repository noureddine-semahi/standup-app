import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createDeletionStore } from "@/lib/account/deletionStore";
import { authenticateUser } from "@/lib/billing/serverAuth";
import { adminJson, isSysAdminViaDatabase, requireSysAdmin, type GuardDeps } from "@/lib/admin/adminGuard";
import { createAdminBillingStore, type AdminBillingStore } from "@/lib/admin/adminBillingStore";
import { summarizeOperations } from "@/lib/admin/billingOperations";
import { DEFAULT_PAGE_SIZE, MAX_SEARCH_LENGTH, MEMBER_FLAG_FILTERS, MEMBER_PLAN_FILTERS, PAGE_SIZES, classifyMember, queryMembers, type MemberFlagFilter, type MemberPlanFilter, type MemberQuery } from "@/lib/admin/memberBilling";

// The System Admin billing endpoints beyond the overview counts (Phase 5.8.2B):
//   POST /api/admin/billing-members     searchable, filtered, PAGED member billing rows (read-only)
//   POST /api/admin/billing-operations  webhook processing results, reconciliation health, retry backoff, unresolved items (read-only)
//   POST /api/admin/billing-premium     grant or revoke a MANUAL Premium grant, through the EXISTING admin_set_entitlement database function
//
// Every one authorises on the server, before anything is read or changed (adminGuard.ts: trusted Origin, valid sign-in, is_sys_admin() as the caller).
// Reads return the minimum an administrator needs: a member's email, name, plan, billing status and dates; webhook event TYPES and outcomes. Never a
// Stripe ID or secret, a webhook payload, a payment detail or a credential. Nothing here talks to Stripe or edits a subscription.
//
// The grant endpoint is NOT a second entitlement system: it calls the same database function the Plans screen uses, with the ADMIN's own token, so that
// function's own Sys Admin check, its change and its audit-log entry apply unchanged. The one thing added is a refusal to GRANT Premium to an account whose
// deletion is in progress (a grant must not override the deletion safeguards). Revoking is always allowed.

export type AdminBillingDeps = GuardDeps & {
  store(): AdminBillingStore;
  now(): Date;
  deletionPending(userId: string): Promise<boolean>;
  setEntitlement(accessToken: string, userId: string, tier: "free" | "premium"): Promise<SetEntitlementResult>;
};

export type SetEntitlementResult = { ok: true; storedTier: string; effectiveTier: string } | { ok: false; reason: "forbidden" | "not_found" | "invalid" | "failed" };

/** The existing admin_set_entitlement function, called as the admin (it checks for a Sys Admin itself). */
async function setEntitlementViaDatabase(accessToken: string, userId: string, tier: "free" | "premium"): Promise<SetEntitlementResult> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return { ok: false, reason: "failed" };
    const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data, error } = await supabase.rpc("admin_set_entitlement", { p_user_id: userId, p_tier: tier });
    if (error) {
      const msg = String(error.message ?? "");
      if (/sys admin access required/i.test(msg)) return { ok: false, reason: "forbidden" };
      if (/user not found/i.test(msg)) return { ok: false, reason: "not_found" };
      if (/invalid tier/i.test(msg)) return { ok: false, reason: "invalid" };
      return { ok: false, reason: "failed" };
    }
    const row = (Array.isArray(data) ? data[0] : data) as { r_stored_tier?: unknown; r_effective_tier?: unknown } | null;
    return typeof row?.r_stored_tier === "string" && typeof row?.r_effective_tier === "string" ? { ok: true, storedTier: row.r_stored_tier, effectiveTier: row.r_effective_tier } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

const realDeps = (): AdminBillingDeps => ({
  env: process.env,
  authenticate: authenticateUser,
  isSysAdmin: isSysAdminViaDatabase,
  store: () => createAdminBillingStore(),
  now: () => new Date(),
  deletionPending: (id) => createDeletionStore().isPending(id),
  setEntitlement: setEntitlementViaDatabase,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 512;

/** The optional query body: only search, plan, filter, page and pageSize, each strictly typed. Anything else (an ID, a customer, a URL…) is refused. */
export function parseMembersBody(text: string): MemberQuery | null {
  const q: MemberQuery = { search: "", plan: "all", filter: "all", page: 1, pageSize: DEFAULT_PAGE_SIZE };
  if (text.trim().length === 0) return q;
  if (text.length > MAX_BODY) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const [k, v] of Object.entries(body)) {
    if (k === "search" && typeof v === "string" && v.length <= MAX_SEARCH_LENGTH && !/[\u0000-\u001f]/.test(v)) q.search = v;
    else if (k === "plan" && (MEMBER_PLAN_FILTERS as readonly unknown[]).includes(v)) q.plan = v as MemberPlanFilter;
    else if (k === "filter" && (MEMBER_FLAG_FILTERS as readonly unknown[]).includes(v)) q.filter = v as MemberFlagFilter;
    else if (k === "page" && typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100000) q.page = v;
    else if (k === "pageSize" && typeof v === "number" && (PAGE_SIZES as readonly number[]).includes(v)) q.pageSize = v;
    else return null;
  }
  return q;
}

export async function handleMembersRequest(req: Request, deps: AdminBillingDeps = realDeps()): Promise<Response> {
  const g = await requireSysAdmin(req, deps);
  if (!g.ok) return g.response;
  const q = parseMembersBody(await req.text().catch(() => "x"));
  if (!q) return adminJson({ error: "invalid_request" }, 400);
  let inputs;
  try {
    inputs = await deps.store().members();
  } catch {
    return adminJson({ error: "unavailable" }, 503);
  }
  const now = deps.now();
  const result = queryMembers(inputs.map((m) => classifyMember(m, now)), q);
  return adminJson({ generatedAt: now.toISOString(), ...result }, 200);
}

export async function handleOperationsRequest(req: Request, deps: AdminBillingDeps = realDeps()): Promise<Response> {
  const g = await requireSysAdmin(req, deps);
  if (!g.ok) return g.response;
  if ((await req.text().catch(() => "x")).trim().length > 0) return adminJson({ error: "invalid_request" }, 400);
  let data;
  try {
    data = await deps.store().operations();
  } catch {
    return adminJson({ error: "unavailable" }, 503);
  }
  return adminJson({ ...summarizeOperations({ events: data.events, records: data.records, now: deps.now() }) }, 200);
}

/** Exactly { "userId": <uuid>, "action": "grant" | "revoke" }. */
export function parsePremiumBody(text: string): { userId: string; action: "grant" | "revoke" } | null {
  if (text.length === 0 || text.length > MAX_BODY) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort();
  const { userId, action } = body as { userId?: unknown; action?: unknown };
  if (keys.length !== 2 || keys[0] !== "action" || keys[1] !== "userId") return null;
  if (typeof userId !== "string" || !UUID.test(userId) || (action !== "grant" && action !== "revoke")) return null;
  return { userId: userId.toLowerCase(), action };
}

export async function handleMemberPremiumRequest(req: Request, deps: AdminBillingDeps = realDeps()): Promise<Response> {
  const g = await requireSysAdmin(req, deps);
  if (!g.ok) return g.response;
  const body = parsePremiumBody(await req.text().catch(() => ""));
  if (!body) return adminJson({ error: "invalid_request" }, 400);

  if (body.action === "grant") {
    // A manual grant must never override an account deletion in progress. If that can't be established, fail closed.
    let pending: boolean;
    try {
      pending = await deps.deletionPending(body.userId);
    } catch {
      return adminJson({ error: "unavailable" }, 503);
    }
    if (pending) return adminJson({ error: "deletion_pending" }, 409);
  }

  const r = await deps.setEntitlement(g.token, body.userId, body.action === "grant" ? "premium" : "free");
  if (!r.ok) {
    const status = r.reason === "forbidden" ? 403 : r.reason === "not_found" ? 404 : r.reason === "invalid" ? 400 : 502;
    return adminJson({ error: r.reason === "failed" ? "change_failed" : r.reason }, status);
  }
  return adminJson({ status: "ok", manualGrant: r.storedTier === "premium", effectiveTier: r.effectiveTier }, 200);
}

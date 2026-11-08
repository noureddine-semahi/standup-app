// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/serverAuth", () => ({ authenticateUser: vi.fn() }));
vi.mock("@/lib/account/deletionStore", () => ({ createDeletionStore: vi.fn() }));
vi.mock("@/lib/admin/adminBillingStore", () => ({ createAdminBillingStore: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

import { handleMembersRequest, handleOperationsRequest, handleMemberPremiumRequest, parseMembersBody, parsePremiumBody, type AdminBillingDeps } from "./billingAdmin";
import type { AdminBillingStore } from "./adminBillingStore";
import type { MemberInput } from "./memberBilling";

const ORIGIN = "https://standup-app-two.vercel.app";
const ADMIN = { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" };
const MEMBER = { id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb" };
const TARGET = "cccccccc-3333-4333-8333-cccccccccccc";
const NOW = new Date("2026-11-20T12:00:00Z");

const member = (i: number, o: Partial<MemberInput> = {}): MemberInput => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, email: `user${String(i).padStart(2, "0")}@x.test`, displayName: null, tier: "free", trialEndsAt: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, syncedAt: null, deletionState: null, ...o });
const MEMBERS: MemberInput[] = [...Array.from({ length: 24 }, (_, i) => member(i)), member(90, { email: "grant@x.test", tier: "premium" }), member(91, { email: "sub@x.test", status: "active", periodEnd: "2026-12-10T00:00:00Z", syncedAt: "2026-11-20T04:00:00Z" })];

function make(over: Partial<AdminBillingDeps> = {}) {
  const members = vi.fn(async () => MEMBERS);
  const operations = vi.fn(async () => ({ events: [{ type: "invoice.paid", status: "processed" as const, attempts: 1, lastError: null, receivedAt: "2026-11-20T10:00:00Z", claimedAt: null, processedAt: "2026-11-20T10:00:01Z" }], records: [] }));
  const store: AdminBillingStore = { members, operations };
  const setEntitlement = vi.fn(async (_t: string, _u: string, tier: "free" | "premium") => ({ ok: true as const, storedTier: tier, effectiveTier: tier }));
  const deletionPending = vi.fn(async () => false);
  const deps: AdminBillingDeps = {
    env: { NODE_ENV: "production" },
    authenticate: vi.fn(async (t: string) => (t === "admin-token" ? ADMIN : t === "member-token" ? MEMBER : null)),
    isSysAdmin: vi.fn(async (t: string) => t === "admin-token"),
    store: () => store,
    now: () => NOW,
    deletionPending,
    setEntitlement,
    ...over,
  };
  return { deps, members, operations, setEntitlement, deletionPending };
}
const req = (path: string, o: { auth?: string | null; origin?: string | null; body?: unknown } = {}) =>
  new Request(`${ORIGIN}/api/admin/${path}`, { method: "POST", headers: { ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }), ...(o.auth === null ? {} : { authorization: o.auth ?? "Bearer admin-token" }) }, body: o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body) });

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

const ENDPOINTS = [
  ["members", (r: Request, d: AdminBillingDeps) => handleMembersRequest(r, d), "billing-members"],
  ["operations", (r: Request, d: AdminBillingDeps) => handleOperationsRequest(r, d), "billing-operations"],
  ["premium", (r: Request, d: AdminBillingDeps) => handleMemberPremiumRequest(r, d), "billing-premium"],
] as const;

describe.each(ENDPOINTS)("%s: authorization is enforced on the server before anything is read or changed", (_n, handler, path) => {
  const body = path === "billing-premium" ? { userId: TARGET, action: "grant" } : undefined;
  it("signed-out callers (none, malformed, unknown token) get 401 and nothing is touched", async () => {
    for (const auth of [null, "", "Bearer", "Basic abc", "Bearer unknown", "admin-token"]) {
      const m = make();
      const res = await handler(req(path, { auth, body }), m.deps);
      expect(res.status, String(auth)).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
      expect(m.members).not.toHaveBeenCalled();
      expect(m.operations).not.toHaveBeenCalled();
      expect(m.setEntitlement).not.toHaveBeenCalled();
      expect(m.deletionPending).not.toHaveBeenCalled();
    }
  });
  it("a signed-in member who is not a System Admin gets 403 and nothing is touched", async () => {
    const m = make();
    const res = await handler(req(path, { auth: "Bearer member-token", body }), m.deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(m.members).not.toHaveBeenCalled();
    expect(m.operations).not.toHaveBeenCalled();
    expect(m.setEntitlement).not.toHaveBeenCalled();
    expect(m.deletionPending).not.toHaveBeenCalled();
  });
  it("an untrusted or missing Origin is refused", async () => {
    for (const origin of [null, "https://evil.example"]) {
      const m = make();
      const res = await handler(req(path, { origin, body }), m.deps);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden_origin" });
      expect(m.members).not.toHaveBeenCalled();
    }
  });
  it("a failing admin check fails closed", async () => {
    const m = make({ isSysAdmin: vi.fn(async () => { throw new Error("boom"); }) });
    expect((await handler(req(path, { body }), m.deps)).status).toBe(403);
    expect(m.members).not.toHaveBeenCalled();
  });
  it("responses are never cached", async () => {
    const res = await handler(req(path, { auth: null, body }), make().deps);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("members: filtering, pagination and minimal fields", () => {
  const call = async (body?: unknown) => {
    const m = make();
    const res = await handleMembersRequest(req("billing-members", { body }), m.deps);
    return { res, json: await res.json(), m };
  };
  it("returns the first page by default, with totals", async () => {
    const { res, json } = await call();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ total: 26, page: 1, pageSize: 20, pages: 2 });
    expect(json.items).toHaveLength(20);
    expect(json.generatedAt).toBe(NOW.toISOString());
  });
  it("pages, searches and filters", async () => {
    expect((await call({ page: 2 })).json.items).toHaveLength(6);
    expect((await call({ search: "sub@x" })).json.items.map((r: { email: string }) => r.email)).toEqual(["sub@x.test"]);
    expect((await call({ filter: "manualGrant" })).json.items.map((r: { email: string }) => r.email)).toEqual(["grant@x.test"]);
    expect((await call({ filter: "stripe" })).json.total).toBe(1);
    expect((await call({ plan: "premium" })).json.total).toBe(2);
    expect((await call({ pageSize: 10, page: 3 })).json.items).toHaveLength(6);
    expect((await call({ search: "none-match" })).json).toMatchObject({ total: 0, items: [] });
  });
  it("returns only the minimum member fields: no Stripe reference, payment detail, secret or raw billing row", async () => {
    const { json } = await call({ search: "sub@x" });
    expect(Object.keys(json.items[0]).sort()).toEqual(["alsoStripe", "deletionPending", "displayName", "email", "id", "lastSyncAt", "manualGrant", "plan", "scheduledCancellationAt", "source", "stripeKind", "stripeStatus"]);
    expect(JSON.stringify(json)).not.toMatch(/cus_|sub_|pi_|whsec_|sk_(test|live)|service_role|payload|card|periodEnd|current_period/i);
  });
  it("does not leak one member's data into another's row", async () => {
    const { json } = await call({ pageSize: 50 });
    const byEmail = Object.fromEntries(json.items.map((r: { email: string }) => [r.email, r]));
    expect(byEmail["grant@x.test"]).toMatchObject({ source: "manual", stripeStatus: null });
    expect(byEmail["sub@x.test"]).toMatchObject({ source: "stripe", manualGrant: false });
    expect(byEmail["user00@x.test"]).toMatchObject({ plan: "free", stripeStatus: null, lastSyncAt: null });
  });
  it("rejects malformed bodies without reading data", async () => {
    for (const body of ["{", "[]", "null", { page: 0 }, { page: 1.5 }, { pageSize: 7 }, { plan: "gold" }, { filter: "x" }, { search: "a".repeat(101) }, { search: "bad\u0000" }, { userId: "x" }, { search: 5 }, "x".repeat(600)]) {
      const { res, m } = await call(body);
      expect(res.status, JSON.stringify(body)?.slice(0, 40)).toBe(400);
      expect(m.members).not.toHaveBeenCalled();
    }
  });
  it("a store failure is a plain 503 with nothing sensitive", async () => {
    const m = make({ store: () => ({ members: async () => { throw new Error("secret detail"); }, operations: async () => ({ events: [], records: [] }) }) });
    const res = await handleMembersRequest(req("billing-members", {}), m.deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
  it("parseMembersBody accepts empty, full and partial bodies", () => {
    expect(parseMembersBody("")).toEqual({ search: "", plan: "all", filter: "all", page: 1, pageSize: 20 });
    expect(parseMembersBody('{"search":"a","plan":"free","filter":"pastDue","page":2,"pageSize":50}')).toEqual({ search: "a", plan: "free", filter: "pastDue", page: 2, pageSize: 50 });
  });
});

describe("operations: read-only overview", () => {
  it("returns the summarized webhooks and reconciliation", async () => {
    const m = make();
    const res = await handleOperationsRequest(req("billing-operations", {}), m.deps);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhooks.recent[0]).toMatchObject({ type: "invoice.paid", status: "processed" });
    expect(json.reconciliation.runHistoryAvailable).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/payload|whsec_|sk_(test|live)|cus_|sub_/);
  });
  it("refuses a body, and a store failure is 503", async () => {
    expect((await handleOperationsRequest(req("billing-operations", { body: "{}" }), make().deps)).status).toBe(400);
    const m = make({ store: () => ({ members: async () => [], operations: async () => { throw new Error("x"); } }) });
    expect((await handleOperationsRequest(req("billing-operations", {}), m.deps)).status).toBe(503);
  });
});

describe("manual Premium grant / revoke goes through the existing entitlement function", () => {
  const go = async (body: unknown, over: Partial<AdminBillingDeps> = {}) => {
    const m = make(over);
    const res = await handleMemberPremiumRequest(req("billing-premium", { body }), m.deps);
    return { res, json: await res.json(), m };
  };
  it("grant calls admin_set_entitlement as the ADMIN (their token) with premium", async () => {
    const { res, json, m } = await go({ userId: TARGET.toUpperCase(), action: "grant" });
    expect(res.status).toBe(200);
    expect(json).toEqual({ status: "ok", manualGrant: true, effectiveTier: "premium" });
    expect(m.setEntitlement).toHaveBeenCalledWith("admin-token", TARGET, "premium");
    expect(m.deletionPending).toHaveBeenCalledWith(TARGET);
  });
  it("revoke sets free and does not even need the deletion check", async () => {
    const { res, json, m } = await go({ userId: TARGET, action: "revoke" });
    expect(res.status).toBe(200);
    expect(json.manualGrant).toBe(false);
    expect(m.setEntitlement).toHaveBeenCalledWith("admin-token", TARGET, "free");
    expect(m.deletionPending).not.toHaveBeenCalled();
  });
  it("a grant is REFUSED while the account's deletion is in progress, and nothing is changed", async () => {
    const { res, json, m } = await go({ userId: TARGET, action: "grant" }, { deletionPending: vi.fn(async () => true) });
    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "deletion_pending" });
    expect(m.setEntitlement).not.toHaveBeenCalled();
  });
  it("if the deletion state cannot be checked, the grant fails closed (503)", async () => {
    const { res, m } = await go({ userId: TARGET, action: "grant" }, { deletionPending: vi.fn(async () => { throw new Error("db down"); }) });
    expect(res.status).toBe(503);
    expect(m.setEntitlement).not.toHaveBeenCalled();
  });
  it("revoking is still allowed for an account whose deletion is in progress", async () => {
    const { res, m } = await go({ userId: TARGET, action: "revoke" }, { deletionPending: vi.fn(async () => true) });
    expect(res.status).toBe(200);
    expect(m.setEntitlement).toHaveBeenCalledWith("admin-token", TARGET, "free");
  });
  it("maps the function's refusals: not found 404, forbidden 403, failure 502 (generic)", async () => {
    const fail = (reason: "forbidden" | "not_found" | "invalid" | "failed") => ({ setEntitlement: vi.fn(async () => ({ ok: false as const, reason })) });
    expect((await go({ userId: TARGET, action: "grant" }, fail("not_found"))).res.status).toBe(404);
    expect((await go({ userId: TARGET, action: "grant" }, fail("forbidden"))).res.status).toBe(403);
    const f = await go({ userId: TARGET, action: "grant" }, fail("failed"));
    expect(f.res.status).toBe(502);
    expect(f.json).toEqual({ error: "change_failed" });
  });
  it("accepts only exactly {userId: uuid, action: grant|revoke}", async () => {
    for (const body of ["", "{", "[]", {}, { userId: TARGET }, { action: "grant" }, { userId: "nope", action: "grant" }, { userId: TARGET, action: "delete" }, { userId: TARGET, action: "grant", tier: "premium" }, { userId: TARGET, action: "grant", stripeCustomer: "cus_1" }, { userId: 5, action: "grant" }]) {
      const { res, m } = await go(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(m.setEntitlement).not.toHaveBeenCalled();
    }
    expect(parsePremiumBody(JSON.stringify({ userId: TARGET, action: "revoke" }))).toEqual({ userId: TARGET, action: "revoke" });
  });
  it("never logs identifiers or tokens", async () => {
    await go({ userId: TARGET, action: "grant" });
    expect(JSON.stringify(logs)).not.toMatch(/admin-token|cccccccc/);
  });
});

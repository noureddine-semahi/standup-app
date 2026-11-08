import { describe, it, expect, vi } from "vitest";
import { getBillingMembers, getBillingOperations, setMemberPremium } from "./billingAdminClient";

const q = { search: "a", plan: "all", filter: "all", page: 1, pageSize: 20 } as const;
const json = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const deps = (fetchImpl: typeof fetch, token: string | null = "tok") => ({ getAccessToken: async () => token, fetchImpl });

describe("billingAdminClient", () => {
  it("sends the member's own token and the typed query, and returns the data", async () => {
    const f = json(200, { items: [], total: 0, page: 1, pageSize: 20, pages: 1, generatedAt: "x" });
    const r = await getBillingMembers(q, deps(f as unknown as typeof fetch));
    expect(r.kind).toBe("ok");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/billing-members");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual(q);
  });
  it("no session means login, without calling the server", async () => {
    const f = json(200, {});
    expect((await getBillingOperations(deps(f as unknown as typeof fetch, null))).kind).toBe("login");
    expect(f).not.toHaveBeenCalled();
  });
  it("maps 401, 403, refusals, bad shapes and network errors", async () => {
    const d = (s: number, b: unknown) => deps(json(s, b) as unknown as typeof fetch);
    expect((await getBillingMembers(q, d(401, {}))).kind).toBe("login");
    expect((await getBillingMembers(q, d(403, {}))).kind).toBe("forbidden");
    expect(await setMemberPremium("u", "grant", d(409, { error: "deletion_pending" }))).toEqual({ kind: "refused", code: "deletion_pending" });
    expect(await setMemberPremium("u", "grant", d(404, { error: "not_found" }))).toEqual({ kind: "refused", code: "not_found" });
    expect((await getBillingMembers(q, d(200, { nope: 1 }))).kind).toBe("error");
    expect((await getBillingOperations(d(503, { error: "unavailable" }))).kind).toBe("error");
    expect((await getBillingOperations(deps((async () => { throw new Error("net"); }) as unknown as typeof fetch))).kind).toBe("error");
  });
  it("grant/revoke posts exactly userId and action", async () => {
    const f = json(200, { status: "ok", manualGrant: true, effectiveTier: "premium" });
    expect((await setMemberPremium("u1", "revoke", deps(f as unknown as typeof fetch))).kind).toBe("ok");
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ userId: "u1", action: "revoke" });
  });
});

import { describe, it, expect } from "vitest";
import { classifyMember, queryMembers, type MemberInput, type MemberRow } from "./memberBilling";

const NOW = new Date("2026-11-20T12:00:00Z");
const base: MemberInput = { id: "id-1", email: "a@x.test", displayName: "Ann", tier: "free", trialEndsAt: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, syncedAt: null, deletionState: null };
const m = (o: Partial<MemberInput>) => classifyMember({ ...base, ...o }, NOW);

describe("classifyMember: plan and Premium source follow the app's precedence", () => {
  it("a plain member is Free with no source", () => {
    expect(m({})).toMatchObject({ plan: "free", source: "none", manualGrant: false, stripeStatus: null, scheduledCancellationAt: null });
  });
  it("a manual grant is Premium from 'manual'", () => {
    expect(m({ tier: "premium" })).toMatchObject({ plan: "premium", source: "manual", manualGrant: true, alsoStripe: false });
  });
  it("an active Stripe subscription is Premium from 'stripe'", () => {
    expect(m({ status: "active", periodEnd: "2026-12-10T00:00:00Z", syncedAt: "2026-11-20T04:00:00Z" })).toMatchObject({ plan: "premium", source: "stripe", stripeStatus: "active", lastSyncAt: "2026-11-20T04:00:00Z" });
  });
  it("a running trial is 'trial'; an expired trial is Free", () => {
    expect(m({ tier: "premium_trial", trialEndsAt: "2026-12-01T00:00:00Z" })).toMatchObject({ plan: "trial", source: "trial" });
    expect(m({ tier: "premium_trial", trialEndsAt: "2026-11-01T00:00:00Z" })).toMatchObject({ plan: "free", source: "none" });
  });
  it("manual grant wins over Stripe, and the overlap is flagged", () => {
    expect(m({ tier: "premium", status: "active", periodEnd: "2026-12-10T00:00:00Z" })).toMatchObject({ source: "manual", alsoStripe: true });
  });
  it("a canceled, lapsed subscription is Free but still reports its Stripe status", () => {
    expect(m({ status: "canceled", periodEnd: "2026-10-01T00:00:00Z" })).toMatchObject({ plan: "free", source: "none", stripeStatus: "canceled" });
  });
  it("a scheduled cancellation shows the end date only while it is scheduled", () => {
    expect(m({ status: "active", periodEnd: "2026-12-10T00:00:00Z", cancelAtPeriodEnd: true })).toMatchObject({ stripeKind: "scheduledCancellation", scheduledCancellationAt: "2026-12-10T00:00:00Z", plan: "premium" });
    expect(m({ status: "active", periodEnd: "2026-12-10T00:00:00Z", cancelAtPeriodEnd: false }).scheduledCancellationAt).toBeNull();
  });
  it("past_due keeps Premium inside the grace window and is classified pastDue; after it, Free", () => {
    expect(m({ status: "past_due", periodEnd: "2026-11-18T00:00:00Z" })).toMatchObject({ stripeKind: "pastDue", plan: "premium" });
    expect(m({ status: "past_due", periodEnd: "2026-10-01T00:00:00Z" })).toMatchObject({ stripeKind: "pastDue", plan: "free" });
  });
  it("carries the deletion state", () => {
    expect(m({ deletionState: "pending" }).deletionPending).toBe("pending");
  });
  it("the row has no field beyond the minimum (no Stripe reference, no payment detail)", () => {
    expect(Object.keys(m({})).sort()).toEqual(["alsoStripe", "deletionPending", "displayName", "email", "id", "lastSyncAt", "manualGrant", "plan", "scheduledCancellationAt", "source", "stripeKind", "stripeStatus"]);
  });
});

describe("queryMembers: search, filters, paging", () => {
  const rows: MemberRow[] = Array.from({ length: 25 }, (_, i) =>
    classifyMember({ ...base, id: `id-${String(i).padStart(2, "0")}`, email: `user${String(i).padStart(2, "0")}@x.test`, displayName: i === 3 ? "Zed Special" : null, tier: i % 5 === 0 ? "premium" : "free", status: i % 4 === 0 ? "active" : null, periodEnd: i % 4 === 0 ? "2026-12-10T00:00:00Z" : null, cancelAtPeriodEnd: i === 4, deletionState: i === 8 ? "pending" : null }, NOW)
  );
  const q = (o: Partial<Parameters<typeof queryMembers>[1]> = {}) => queryMembers(rows, { search: "", plan: "all", filter: "all", page: 1, pageSize: 10, ...o });

  it("pages in a stable order and reports totals", () => {
    const p1 = q();
    expect(p1).toMatchObject({ total: 25, pages: 3, page: 1, pageSize: 10 });
    expect(p1.items.map((r) => r.email)).toEqual([...p1.items.map((r) => r.email)].sort());
    expect(q({ page: 3 }).items).toHaveLength(5);
    const ids = [1, 2, 3].flatMap((page) => q({ page }).items.map((r) => r.id));
    expect(new Set(ids).size).toBe(25);
  });
  it("clamps out-of-range and nonsense pages and page sizes", () => {
    expect(q({ page: 99 }).page).toBe(3);
    expect(q({ page: -4 }).page).toBe(1);
    expect(q({ page: Number.NaN }).page).toBe(1);
    expect(q({ pageSize: 7 }).pageSize).toBe(20);
  });
  it("searches email, name and exact ID, case-insensitively; ignores partial IDs", () => {
    expect(q({ search: "USER07" }).items.map((r) => r.id)).toEqual(["id-07"]);
    expect(q({ search: "zed" }).items.map((r) => r.id)).toEqual(["id-03"]);
    expect(q({ search: "ID-12" }).items.map((r) => r.id)).toEqual(["id-12"]);
    expect(q({ search: "nobody" })).toMatchObject({ total: 0, items: [], pages: 1, page: 1 });
  });
  it("filters by plan and by flag", () => {
    expect(q({ plan: "premium", pageSize: 50 }).total).toBe(rows.filter((r) => r.plan === "premium").length);
    expect(q({ filter: "manualGrant", pageSize: 50 }).items.every((r) => r.manualGrant)).toBe(true);
    expect(q({ filter: "scheduledCancellation" }).items.map((r) => r.id)).toEqual(["id-04"]);
    expect(q({ filter: "deletionPending" }).items.map((r) => r.id)).toEqual(["id-08"]);
    expect(q({ filter: "stripe", pageSize: 50 }).total).toBe(7);
    expect(q({ plan: "premium", filter: "deletionPending" }).total).toBe(1);
  });
});

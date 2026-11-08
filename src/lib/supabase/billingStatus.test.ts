import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc } }));

import { getMyBillingStatus, parseBillingStatus } from "./billingStatus";

const row = {
  r_access: "premium", r_access_source: "subscription", r_plan: "annual", r_status: "past_due", r_period_end: "2026-12-01T00:00:00Z", r_cancel_at_period_end: false,
  r_canceled_at: null, r_ended_at: null, r_grace_ends_at: "2026-12-08T00:00:00Z", r_subscription_grants_premium: true, r_trial_ends_at: null,
};

beforeEach(() => {
  rpc.mockReset();
});

describe("parseBillingStatus", () => {
  it("maps the row", () => {
    expect(parseBillingStatus([row])).toEqual({
      access: "premium", source: "subscription", plan: "annual", status: "past_due", periodEnd: "2026-12-01T00:00:00Z", cancelAtPeriodEnd: false, canceledAt: null, endedAt: null,
      graceEndsAt: "2026-12-08T00:00:00Z", subscriptionGrantsPremium: true, trialEndsAt: null,
    });
  });
  it("carries no Stripe or account identifiers, even if the database were to send them", () => {
    const p = parseBillingStatus([{ ...row, r_customer_id: "cus_SECRET", r_subscription_id: "sub_SECRET", r_price_id: "price_SECRET", r_user_id: "0b8c1d1e-2f3a-4b5c-8d6e-7f8091a2b3c4" }])!;
    expect(JSON.stringify(p)).not.toMatch(/cus_|sub_|price_|SECRET|0b8c1d1e/);
    expect(Object.keys(p).sort()).toEqual(["access", "cancelAtPeriodEnd", "canceledAt", "endedAt", "graceEndsAt", "periodEnd", "plan", "source", "status", "subscriptionGrantsPremium", "trialEndsAt"]);
  });
  it("anything unrecognised can only show LESS: unknown tier is Free, a source without Premium is none, bad dates and plans are dropped", () => {
    const p = parseBillingStatus([{ r_access: "enterprise", r_access_source: "manual", r_plan: "lifetime", r_status: "x".repeat(60), r_period_end: "garbage", r_subscription_grants_premium: "yes" }])!;
    expect(p).toMatchObject({ access: "free", source: "none", plan: null, status: null, periodEnd: null, subscriptionGrantsPremium: false });
  });
  it("no row or a non-object is no status", () => {
    for (const bad of [null, undefined, [], "x", 3]) expect(parseBillingStatus(bad)).toBeNull();
  });
});

describe("getMyBillingStatus", () => {
  it("asks the member-scoped function with NO parameters, so it cannot be pointed at another account", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    expect((await getMyBillingStatus())?.status).toBe("past_due");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_my_billing_status");
  });
  it("any failure (function not installed yet, offline, signed out) is null: nothing is shown rather than anything guessed", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_my_billing_status" } });
    expect(await getMyBillingStatus()).toBeNull();
    rpc.mockRejectedValue(new Error("offline"));
    expect(await getMyBillingStatus()).toBeNull();
  });
  it("is read-only: the module exposes only readers", async () => {
    const mod = await import("./billingStatus");
    expect(Object.keys(mod).sort()).toEqual(["ACCESS_SOURCES", "getMyBillingStatus", "parseBillingStatus"]);
  });
});

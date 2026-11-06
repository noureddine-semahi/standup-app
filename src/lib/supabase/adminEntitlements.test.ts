import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc } }));

import { AdminEntitlementError, adminEntitlementRefusal, getAdminEntitlement, parseAdminEntitlement, setAdminEntitlement } from "./adminEntitlements";

const row = {
  r_stored_tier: "premium",
  r_effective_tier: "premium",
  r_trial_started_at: "2026-10-01T00:00:00Z",
  r_trial_ends_at: "2026-10-15T00:00:00Z",
  r_trial_used: true,
  r_updated_at: "2026-11-01T00:00:00Z",
};

beforeEach(() => rpc.mockReset());

describe("parseAdminEntitlement", () => {
  it("maps the row", () => {
    expect(parseAdminEntitlement([row])).toEqual({
      storedTier: "premium",
      effectiveTier: "premium",
      trialStartedAt: "2026-10-01T00:00:00Z",
      trialEndsAt: "2026-10-15T00:00:00Z",
      trialUsed: true,
      updatedAt: "2026-11-01T00:00:00Z",
    });
  });
  it("anything unrecognised is Free, never Premium", () => {
    expect(parseAdminEntitlement(null).effectiveTier).toBe("free");
    expect(parseAdminEntitlement([]).storedTier).toBe("free");
    const p = parseAdminEntitlement([{ r_stored_tier: "enterprise", r_effective_tier: "root", r_trial_ends_at: "garbage", r_trial_used: "yes" }]);
    expect(p).toMatchObject({ storedTier: "free", effectiveTier: "free", trialEndsAt: null, trialUsed: false });
  });
});

describe("getAdminEntitlement", () => {
  it("calls the admin RPC for that user", async () => {
    rpc.mockResolvedValue({ data: [{ ...row, r_stored_tier: "premium_trial", r_effective_tier: "free" }], error: null });
    const e = await getAdminEntitlement("u1");
    expect(rpc).toHaveBeenCalledWith("admin_get_entitlement", { p_user_id: "u1" });
    expect(e.storedTier).toBe("premium_trial");
    expect(e.effectiveTier).toBe("free");
  });
  it("a refusal from the database becomes a typed error, not data", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "admin access required" } });
    await expect(getAdminEntitlement("u1")).rejects.toMatchObject({ reason: "not_admin" });
  });
  it("other failures propagate unchanged", async () => {
    const err = { message: "connection lost", code: "08006" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(getAdminEntitlement("u1")).rejects.toBe(err);
  });
});

describe("setAdminEntitlement", () => {
  it("grants and revokes through the admin RPC and returns the new state", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    expect((await setAdminEntitlement("u1", "premium")).storedTier).toBe("premium");
    expect(rpc).toHaveBeenLastCalledWith("admin_set_entitlement", { p_user_id: "u1", p_tier: "premium" });
    await setAdminEntitlement("u1", "free");
    expect(rpc).toHaveBeenLastCalledWith("admin_set_entitlement", { p_user_id: "u1", p_tier: "free" });
  });
  it("never sends a tier other than free or premium, not even a trial", async () => {
    for (const bad of ["premium_trial", "admin", ""]) {
      await expect(setAdminEntitlement("u1", bad as never)).rejects.toMatchObject({ reason: "invalid_tier" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a non-sys-admin is refused by the database and the caller sees a typed refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sys admin access required" } });
    const p = setAdminEntitlement("u1", "premium");
    await expect(p).rejects.toBeInstanceOf(AdminEntitlementError);
    await expect(p).rejects.toMatchObject({ reason: "not_sys_admin" });
  });
});

describe("adminEntitlementRefusal", () => {
  it("tells sys admin from admin apart", () => {
    expect(adminEntitlementRefusal({ message: "sys admin access required" })).toBe("not_sys_admin");
    expect(adminEntitlementRefusal({ message: "admin access required" })).toBe("not_admin");
    expect(adminEntitlementRefusal({ message: "user not found" })).toBe("user_not_found");
    expect(adminEntitlementRefusal({ message: "invalid tier" })).toBe("invalid_tier");
    expect(adminEntitlementRefusal({ message: "boom" })).toBeNull();
    expect(adminEntitlementRefusal(null)).toBeNull();
  });
});

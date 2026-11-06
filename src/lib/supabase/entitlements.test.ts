import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as string[], data: null as unknown, error: null as unknown }));
vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string) => {
      state.calls.push(fn);
      return { data: state.error ? null : state.data, error: state.error };
    },
  },
}));

import { FREE_ENTITLEMENT, getMyEntitlement, isEntitlementsUnavailableError, parseEntitlementRow } from "./entitlements";

beforeEach(() => {
  state.calls = [];
  state.data = null;
  state.error = null;
});

const row = (over: Record<string, unknown> = {}) => ({ r_tier: "free", r_stored_tier: "free", r_trial_started_at: null, r_trial_ends_at: null, ...over });

describe("getMyEntitlement", () => {
  it("asks the database for the effective tier (one read-only call, nothing written)", async () => {
    state.data = [row({ r_tier: "premium", r_stored_tier: "premium" })];
    const e = await getMyEntitlement();
    expect(state.calls).toEqual(["get_my_account_entitlement"]);
    expect(e).toEqual({ tier: "premium", storedTier: "premium", trialStartedAt: null, trialEndsAt: null });
  });
  it("an expired trial arrives as free (the database already applied expiry) while the stored grant is still visible", async () => {
    state.data = [row({ r_tier: "free", r_stored_tier: "premium_trial", r_trial_started_at: "2026-10-01T00:00:00Z", r_trial_ends_at: "2026-10-15T00:00:00Z" })];
    const e = await getMyEntitlement();
    expect(e.tier).toBe("free");
    expect(e.storedTier).toBe("premium_trial");
    expect(e.trialEndsAt).toBe("2026-10-15T00:00:00Z");
  });
  it("an active trial carries its dates", async () => {
    state.data = [row({ r_tier: "premium_trial", r_stored_tier: "premium_trial", r_trial_started_at: "2026-11-01T00:00:00Z", r_trial_ends_at: "2026-11-15T00:00:00Z" })];
    expect(await getMyEntitlement()).toEqual({ tier: "premium_trial", storedTier: "premium_trial", trialStartedAt: "2026-11-01T00:00:00Z", trialEndsAt: "2026-11-15T00:00:00Z" });
  });
  it("is Free when the migration isn't applied yet", async () => {
    for (const error of [{ code: "PGRST202", message: "Could not find the function public.get_my_account_entitlement" }, { code: "42883", message: "function does not exist" }]) {
      state.error = error;
      await expect(getMyEntitlement()).resolves.toEqual(FREE_ENTITLEMENT);
    }
  });
  it("any other failure is thrown, never turned into Premium", async () => {
    state.error = { code: "08006", message: "connection lost" };
    await expect(getMyEntitlement()).rejects.toMatchObject({ message: "connection lost" });
  });
  it("has no function that could change a tier or a trial date", async () => {
    const mod = await import("./entitlements");
    expect(Object.keys(mod).filter((k) => /^(set|update|grant|activate|upgrade|start|save|create|insert)/i.test(k))).toEqual([]);
  });
});

describe("parseEntitlementRow", () => {
  it("accepts a single row or a one-row array", () => {
    expect(parseEntitlementRow(row({ r_tier: "premium", r_stored_tier: "premium" })).tier).toBe("premium");
    expect(parseEntitlementRow([row({ r_tier: "premium", r_stored_tier: "premium" })]).tier).toBe("premium");
  });
  it("anything missing or unrecognised is Free, never Premium", () => {
    for (const bad of [null, undefined, [], {}, "premium", 42, row({ r_tier: "gold" }), row({ r_tier: "PREMIUM" }), row({ r_tier: null })]) {
      expect(parseEntitlementRow(bad).tier).toBe("free");
    }
  });
  it("ignores unreadable dates", () => {
    const e = parseEntitlementRow(row({ r_trial_started_at: "not a date", r_trial_ends_at: 5 }));
    expect(e.trialStartedAt).toBeNull();
    expect(e.trialEndsAt).toBeNull();
  });
});

describe("isEntitlementsUnavailableError", () => {
  it("recognises a missing function or table but not other failures", () => {
    expect(isEntitlementsUnavailableError({ code: "42883", message: "x" })).toBe(true);
    expect(isEntitlementsUnavailableError({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isEntitlementsUnavailableError({ code: "42P01", message: "x" })).toBe(true);
    expect(isEntitlementsUnavailableError({ message: "Could not find the function public.x in the schema cache" })).toBe(true);
    expect(isEntitlementsUnavailableError({ code: "08006", message: "connection lost" })).toBe(false);
    expect(isEntitlementsUnavailableError(null)).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc } }));

import { DEFAULT_FEATURE_FLAGS, FEATURE_FLAGS, parseFeatureFlags, showCheckout, showPremiumPromotion, showTrialOffer } from "./featureFlags";
import { getFeatureFlags, resetFeatureFlagsCache } from "./supabase/featureFlags";
import { trialRefusalReason } from "./supabase/entitlements";

const on = (...keys: string[]) => keys.map((r_key) => ({ r_key, r_enabled: true }));

describe("flags", () => {
  it("are exactly the three, and every one defaults to false", () => {
    expect([...FEATURE_FLAGS]).toEqual(["premium_promotion_enabled", "premium_trial_activation_enabled", "billing_checkout_enabled"]);
    expect(Object.values(DEFAULT_FEATURE_FLAGS)).toEqual([false, false, false]);
  });
  it("parseFeatureFlags turns on only known keys with a literal true", () => {
    expect(parseFeatureFlags(on("premium_trial_activation_enabled"))).toEqual({ ...DEFAULT_FEATURE_FLAGS, premium_trial_activation_enabled: true });
    expect(parseFeatureFlags([{ r_key: "premium_promotion_enabled", r_enabled: "true" }, { r_key: "premium_promotion_enabled", r_enabled: 1 }])).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(parseFeatureFlags(on("some_other_flag"))).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(parseFeatureFlags([null, 3, "x", {}])).toEqual(DEFAULT_FEATURE_FLAGS);
  });
  it("anything that isn't a list of rows is all off", () => {
    for (const bad of [null, undefined, {}, "yes", 7]) expect(parseFeatureFlags(bad)).toEqual(DEFAULT_FEATURE_FLAGS);
  });
});

describe("what each flag shows", () => {
  const f = (o: Partial<Record<(typeof FEATURE_FLAGS)[number], boolean>>) => ({ ...DEFAULT_FEATURE_FLAGS, ...o });
  it("with everything off: no promotion, no trial offer, no checkout", () => {
    expect([showPremiumPromotion(DEFAULT_FEATURE_FLAGS), showTrialOffer(DEFAULT_FEATURE_FLAGS), showCheckout(DEFAULT_FEATURE_FLAGS)]).toEqual([false, false, false]);
  });
  it("each flag controls its own thing", () => {
    expect(showPremiumPromotion(f({ premium_promotion_enabled: true }))).toBe(true);
    expect(showTrialOffer(f({ premium_trial_activation_enabled: true }))).toBe(true);
    expect(showTrialOffer(f({ premium_promotion_enabled: true }))).toBe(false);
  });
  it("checkout needs BOTH its own flag and promotion: Premium can't be sold while it isn't being promoted", () => {
    expect(showCheckout(f({ billing_checkout_enabled: true }))).toBe(false);
    expect(showCheckout(f({ premium_promotion_enabled: true }))).toBe(false);
    expect(showCheckout(f({ billing_checkout_enabled: true, premium_promotion_enabled: true }))).toBe(true);
  });
});

describe("getFeatureFlags (data layer)", () => {
  beforeEach(() => {
    rpc.mockReset();
    resetFeatureFlagsCache();
  });
  it("asks the database's get_feature_flags and shapes the answer", async () => {
    rpc.mockResolvedValue({ data: on("premium_promotion_enabled"), error: null });
    expect(await getFeatureFlags()).toEqual({ ...DEFAULT_FEATURE_FLAGS, premium_promotion_enabled: true });
    expect(rpc).toHaveBeenCalledWith("get_feature_flags");
  });
  it("any error, including the function not being installed, is all off", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_feature_flags" } });
    expect(await getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });
  it("a thrown network failure is all off", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    expect(await getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });
  it("shares one call between components", async () => {
    rpc.mockResolvedValue({ data: on("billing_checkout_enabled"), error: null });
    await Promise.all([getFeatureFlags(), getFeatureFlags(), getFeatureFlags()]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("is read-only: the module has no way to write a flag", async () => {
    const mod = await import("./supabase/featureFlags");
    expect(Object.keys(mod).sort()).toEqual(["getFeatureFlags", "resetFeatureFlagsCache"]);
  });
});

describe("trial refusal", () => {
  it("the database's TRIAL_ACTIVATION_DISABLED is recognised", () => {
    expect(trialRefusalReason({ message: "TRIAL_ACTIVATION_DISABLED" })).toBe("activation_disabled");
    expect(trialRefusalReason({ message: "TRIAL_ALREADY_USED" })).toBe("already_used");
  });
});

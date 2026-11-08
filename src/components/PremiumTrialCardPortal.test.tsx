import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const api = vi.hoisted(() => ({ getMyEntitlement: vi.fn(), getMyTrialHistory: vi.fn() }));
vi.mock("@/lib/supabase/entitlements", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/entitlements")>()), ...api }));
const flagsApi = vi.hoisted(() => ({ getFeatureFlags: vi.fn() }));
vi.mock("@/lib/supabase/featureFlags", () => flagsApi);
const billing = vi.hoisted(() => ({ getMyBillingStatus: vi.fn() }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), ...billing }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { BillingStatus } from "@/lib/supabase/billingStatus";
import PremiumTrialCard from "./PremiumTrialCard";

const ALL_OFF = { premium_promotion_enabled: false, premium_trial_activation_enabled: false, billing_checkout_enabled: false };
const CHECKOUT_ON = { premium_promotion_enabled: true, premium_trial_activation_enabled: false, billing_checkout_enabled: true };
const mk = (o: Partial<BillingStatus> = {}): BillingStatus => ({ access: "free", source: "none", plan: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: false, trialEndsAt: null, ...o });
const sub = (o: Partial<BillingStatus> = {}) => mk({ access: "premium", source: "subscription", plan: "monthly", status: "active", periodEnd: "2026-12-01T12:00:00.000Z", subscriptionGrantsPremium: true, ...o });
const premium = { tier: "premium", storedTier: "free", trialStartedAt: null, trialEndsAt: null };
const free = { tier: "free", storedTier: "free", trialStartedAt: null, trialEndsAt: null };
const unused = { used: false, startedAt: null, endsAt: null };

async function mount(flags: object, ent: object, status: BillingStatus | null) {
  flagsApi.getFeatureFlags.mockResolvedValue(flags);
  api.getMyEntitlement.mockResolvedValue(ent);
  api.getMyTrialHistory.mockResolvedValue(unused);
  billing.getMyBillingStatus.mockResolvedValue(status);
  render(
    <LanguageProvider>
      <PremiumTrialCard />
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  flagsApi.getFeatureFlags.mockReset();
  billing.getMyBillingStatus.mockReset();
});
afterEach(cleanup);

describe("Settings > Premium: Manage subscription is independent of the Checkout flags", () => {
  it("with promotion, Checkout and the trial OFF, a paying subscriber still sees Manage subscription, and no Subscribe button or plan comparison", async () => {
    await mount(ALL_OFF, premium, sub());
    expect(screen.getByTestId("billing-manage-button")).toBeTruthy();
    expect(screen.queryByTestId("premium-subscribe-button")).toBeNull();
    expect(screen.queryByTestId("premium-plans")).toBeNull();
  });

  it("a past_due subscriber on a Free-limited view (Premium from the subscription ended) can still open the portal to fix the card, flags off", async () => {
    await mount(ALL_OFF, free, sub({ status: "past_due", subscriptionGrantsPremium: false, access: "free", source: "none", graceEndsAt: "2026-11-01T00:00:00.000Z" }));
    expect(screen.getByTestId("billing-manage-button")).toBeTruthy();
  });

  it("non-subscribers never see it, flags on or off: a plain Free account, and a canceled subscription", async () => {
    for (const flags of [ALL_OFF, CHECKOUT_ON]) {
      await mount(flags, free, mk());
      expect(screen.queryByTestId("billing-manage")).toBeNull();
      cleanup();
      await mount(flags, free, sub({ status: "canceled", subscriptionGrantsPremium: false, access: "free", source: "none", endedAt: "2026-11-01T00:00:00.000Z" }));
      expect(screen.queryByTestId("billing-manage")).toBeNull();
      cleanup();
    }
  });

  it("the Subscribe button is unchanged: still only for a non-subscriber with promotion AND Checkout on (never shown alongside an active subscription)", async () => {
    await mount(CHECKOUT_ON, free, mk());
    expect(screen.getByTestId("premium-subscribe-button")).toBeTruthy();
    expect(screen.queryByTestId("billing-manage")).toBeNull();
    cleanup();
    await mount(ALL_OFF, free, mk());
    expect(screen.queryByTestId("premium-subscribe-button")).toBeNull();
    cleanup();
    await mount({ ...CHECKOUT_ON, billing_checkout_enabled: false }, free, mk());
    expect(screen.queryByTestId("premium-subscribe-button")).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const m = vi.hoisted(() => ({
  startCheckout: vi.fn(),
  navigateTo: vi.fn(),
  getMyBillingStatus: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/startCheckout", () => ({ startCheckout: m.startCheckout }));
vi.mock("@/lib/navigate", () => ({ navigateTo: m.navigateTo }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), getMyBillingStatus: m.getMyBillingStatus }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: m.getSession } } }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { BillingStatus } from "@/lib/supabase/billingStatus";
import PremiumPlans from "./PremiumPlans";

const status = (o: Partial<BillingStatus> = {}): BillingStatus => ({ access: "free", source: "none", plan: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: false, trialEndsAt: null, ...o });
const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_abc";

async function mount(checkoutEnabled: boolean) {
  render(
    <LanguageProvider>
      <PremiumPlans checkoutEnabled={checkoutEnabled} />
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
const click = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("premium-subscribe-button"));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getMyBillingStatus.mockResolvedValue(null);
  m.getSession.mockResolvedValue({ data: { session: { access_token: "tok-abc" } } });
});
afterEach(cleanup);

describe("the Subscribe button follows the flags", () => {
  it("checkout not permitted: no button, and the 'not available yet' note stays; nothing is asked of the server", async () => {
    await mount(false);
    expect(screen.queryByTestId("premium-subscribe")).toBeNull();
    expect(screen.queryByTestId("premium-subscribe-button")).toBeNull();
    expect(screen.getByTestId("premium-not-available").textContent).toContain("aren't available yet");
    expect(m.getMyBillingStatus).not.toHaveBeenCalled();
    expect(m.startCheckout).not.toHaveBeenCalled();
  });
  it("checkout permitted: the button replaces the note, labelled with the chosen plan and price", async () => {
    await mount(true);
    expect(screen.queryByTestId("premium-not-available")).toBeNull();
    expect(screen.getByTestId("premium-subscribe-button").textContent).toBe("Subscribe (Annual)");
    expect(screen.getByTestId("premium-billing-annual").textContent).toContain("$49.99");
    fireEvent.click(screen.getByTestId("premium-billing-monthly"));
    expect(screen.getByTestId("premium-subscribe-button").textContent).toBe("Subscribe (Monthly)");
    expect(screen.getByTestId("premium-subscribe").textContent).toContain("Your card details never reach StandUp");
  });
  it("choosing a plan alone starts nothing", async () => {
    await mount(true);
    fireEvent.click(screen.getByTestId("premium-billing-monthly"));
    fireEvent.click(screen.getByTestId("premium-billing-annual"));
    expect(m.startCheckout).not.toHaveBeenCalled();
  });
});

describe("subscribing", () => {
  it("sends the chosen plan through the existing endpoint helper and follows the returned Stripe URL", async () => {
    m.startCheckout.mockResolvedValue({ kind: "redirect", url: STRIPE_URL });
    await mount(true);
    fireEvent.click(screen.getByTestId("premium-billing-monthly"));
    await click();
    expect(m.startCheckout).toHaveBeenCalledTimes(1);
    expect(m.startCheckout.mock.calls[0][0]).toBe("monthly");
    expect(m.navigateTo).toHaveBeenCalledWith(STRIPE_URL);
  });
  it("gives the helper the member's current access token (and none when there is no session)", async () => {
    m.startCheckout.mockResolvedValue({ kind: "redirect", url: STRIPE_URL });
    await mount(true);
    await click();
    const deps = m.startCheckout.mock.calls[0][1] as { getAccessToken(): Promise<string | null> };
    expect(await deps.getAccessToken()).toBe("tok-abc");
    m.getSession.mockResolvedValue({ data: { session: null } });
    expect(await deps.getAccessToken()).toBeNull();
  });
  it("is one request at a time: a second click while busy does nothing, and the button shows 'Opening checkout…'", async () => {
    let release!: (v: unknown) => void;
    m.startCheckout.mockReturnValue(new Promise((r) => (release = r)));
    await mount(true);
    await click();
    expect((screen.getByTestId("premium-subscribe-button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("premium-subscribe-button").textContent).toBe("Opening checkout…");
    await act(async () => fireEvent.click(screen.getByTestId("premium-subscribe-button")));
    expect(m.startCheckout).toHaveBeenCalledTimes(1);
    await act(async () => release({ kind: "redirect", url: STRIPE_URL }));
    expect(m.navigateTo).toHaveBeenCalledTimes(1);
  });
  it("an expired sign-in sends the member to sign in again, then straight back to Settings", async () => {
    m.startCheckout.mockResolvedValue({ kind: "login" });
    await mount(true);
    await click();
    expect(m.navigateTo).toHaveBeenCalledWith("/login?next=%2Fstandup%2Fsettings");
    expect(screen.getByTestId("premium-subscribe-error").textContent).toBe("Your session expired. Taking you to sign in…");
  });

  describe("refusals from the server", () => {
    it("already subscribed: says so, points to the status above, and removes the button", async () => {
      m.startCheckout.mockResolvedValue({ kind: "error", code: "already_subscribed" });
      await mount(true);
      await click();
      expect(screen.getByTestId("premium-subscribe-error").textContent).toContain("You already have a subscription");
      expect(screen.queryByTestId("premium-subscribe-button")).toBeNull();
      expect(screen.getByTestId("premium-have-subscription").textContent).toContain("see its status above");
      expect(m.navigateTo).not.toHaveBeenCalled();
    });
    it("checkout in progress: asks the member to wait and try again, and the button comes back", async () => {
      m.startCheckout.mockResolvedValue({ kind: "error", code: "checkout_in_progress" });
      await mount(true);
      await click();
      expect(screen.getByTestId("premium-subscribe-error").textContent).toContain("already being started");
      const b = screen.getByTestId("premium-subscribe-button") as HTMLButtonElement;
      expect(b.disabled).toBe(false);
      m.startCheckout.mockResolvedValue({ kind: "redirect", url: STRIPE_URL });
      await click();
      expect(m.navigateTo).toHaveBeenCalledWith(STRIPE_URL); // a retry works
    });
    it("checkout disabled (a flag turned off meanwhile) and a generic failure each get their own message and allow a retry", async () => {
      m.startCheckout.mockResolvedValue({ kind: "error", code: "checkout_disabled" });
      await mount(true);
      await click();
      expect(screen.getByTestId("premium-subscribe-error").textContent).toBe("Subscriptions aren't available right now.");
      m.startCheckout.mockResolvedValue({ kind: "error", code: "checkout_failed" });
      await click();
      expect(screen.getByTestId("premium-subscribe-error").textContent).toBe("We couldn't start checkout. Please try again.");
      expect((screen.getByTestId("premium-subscribe-button") as HTMLButtonElement).disabled).toBe(false);
    });
    it("shows nothing sensitive: no codes, URLs or Stripe identifiers", async () => {
      m.startCheckout.mockResolvedValue({ kind: "error", code: "checkout_failed" });
      await mount(true);
      await click();
      expect(screen.getByTestId("premium-subscribe").textContent).not.toMatch(/cs_|cus_|sub_|price_|evt_|checkout_failed|api\/billing/);
    });
  });
});

describe("a member who already has a subscription", () => {
  it("is not offered the button (a courtesy; the server refuses a second one regardless)", async () => {
    for (const s of ["active", "trialing", "past_due", "unpaid", "incomplete", "paused", "brand_new"]) {
      cleanup();
      m.getMyBillingStatus.mockResolvedValue(status({ status: s, plan: "monthly" }));
      await mount(true);
      expect(screen.queryByTestId("premium-subscribe-button")).toBeNull();
      expect(screen.getByTestId("premium-have-subscription")).toBeTruthy();
    }
  });
  it("is offered the button again once the subscription is over for good", async () => {
    for (const s of ["canceled", "incomplete_expired", null]) {
      cleanup();
      m.getMyBillingStatus.mockResolvedValue(status({ status: s, plan: s ? "monthly" : null }));
      await mount(true);
      expect(screen.getByTestId("premium-subscribe-button")).toBeTruthy();
    }
  });
});

describe("Spanish", () => {
  it("shows the button, the secure-checkout note and a refusal in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      m.startCheckout.mockResolvedValue({ kind: "error", code: "already_subscribed" });
      await mount(true);
      expect(screen.getByTestId("premium-subscribe-button").textContent).toBe("Suscribirme (Anual)");
      expect(screen.getByTestId("premium-subscribe").textContent).toContain("nunca llegan a StandUp");
      await click();
      expect(screen.getByTestId("premium-subscribe-error").textContent).toContain("Ya tienes una suscripción");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

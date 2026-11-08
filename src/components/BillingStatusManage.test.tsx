import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const m = vi.hoisted(() => ({
  startPortal: vi.fn(),
  navigateTo: vi.fn(),
  getMyBillingStatus: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/startPortal", () => ({ startPortal: m.startPortal }));
vi.mock("@/lib/navigate", () => ({ navigateTo: m.navigateTo }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), getMyBillingStatus: m.getMyBillingStatus }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: m.getSession } } }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { BillingStatus as Status } from "@/lib/supabase/billingStatus";
import BillingStatus from "./BillingStatus";

const PORTAL_URL = "https://billing.stripe.com/p/session/test_abc";
const mk = (o: Partial<Status> = {}): Status => ({ access: "free", source: "none", plan: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: false, trialEndsAt: null, ...o });
const sub = (o: Partial<Status> = {}) => mk({ access: "premium", source: "subscription", plan: "monthly", status: "active", periodEnd: "2026-12-01T12:00:00.000Z", subscriptionGrantsPremium: true, ...o });

async function mount(status: Status | null) {
  m.getMyBillingStatus.mockResolvedValue(status);
  render(
    <LanguageProvider>
      <BillingStatus />
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
const click = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("billing-manage-button"));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getSession.mockResolvedValue({ data: { session: { access_token: "tok-abc" } } });
});
afterEach(cleanup);

describe("who sees Manage subscription", () => {
  it("an eligible subscriber sees it (no flag is involved) with the explanatory note; opening the page asks the server for nothing", async () => {
    await mount(sub());
    expect(screen.getByTestId("billing-manage-button").textContent).toBe("Manage subscription");
    expect(screen.getByTestId("billing-manage").textContent).toContain("Opens Stripe's secure page, where you can cancel, update your payment method or see your invoices");
    expect(m.startPortal).not.toHaveBeenCalled();
  });

  it("is offered for every state that has something to manage, including past_due (to fix a card) and a subscription set to cancel", async () => {
    for (const s of [sub(), sub({ status: "trialing" }), sub({ status: "past_due", subscriptionGrantsPremium: true, graceEndsAt: "2026-12-08T12:00:00.000Z" }), sub({ status: "unpaid", subscriptionGrantsPremium: false }), sub({ status: "paused", subscriptionGrantsPremium: false }), sub({ cancelAtPeriodEnd: true })]) {
      await mount(s);
      expect(screen.queryByTestId("billing-manage-button"), String(s.status)).not.toBeNull();
      cleanup();
    }
  });

  it("does not depend on the monetization flags: the component takes no flag and never reads them, so it shows with promotion and Checkout OFF", async () => {
    const flagsApi = await import("@/lib/supabase/featureFlags");
    const spy = vi.spyOn(flagsApi, "getFeatureFlags");
    await mount(sub());
    expect(screen.getByTestId("billing-manage-button")).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    const code = (await import("fs")).readFileSync((await import("path")).join(process.cwd(), "src", "components", "BillingStatus.tsx"), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/featureFlags|useFeatureFlags|showCheckout|portalEnabled/);
  });

  it("is not offered when there is nothing to manage: a canceled or never-started subscription, a free account, an admin grant or a trial", async () => {
    for (const s of [sub({ status: "canceled", subscriptionGrantsPremium: false, access: "free", source: "none", endedAt: "2026-11-01T00:00:00.000Z" }), sub({ status: "incomplete", subscriptionGrantsPremium: false, access: "free", source: "none" }), sub({ status: "incomplete_expired", subscriptionGrantsPremium: false }), mk(), mk({ access: "premium", source: "manual" }), mk({ access: "premium", source: "trial", trialEndsAt: "2026-12-01T00:00:00.000Z" })]) {
      await mount(s);
      expect(screen.queryByTestId("billing-manage")).toBeNull();
      cleanup();
    }
  });

  it("is not offered when the status can't be read", async () => {
    await mount(null);
    expect(screen.queryByTestId("billing-manage")).toBeNull();
  });
});

describe("clicking it", () => {
  it("asks the server through the helper (with the member's token only) and leaves for the Stripe URL; while leaving the button is busy and a second click does nothing", async () => {
    m.startPortal.mockResolvedValue({ kind: "redirect", url: PORTAL_URL });
    await mount(sub());
    await click();
    expect(m.startPortal).toHaveBeenCalledTimes(1);
    expect(m.startPortal.mock.calls[0]).toHaveLength(1); // the deps only: no customer, subscription or account is passed
    expect(await (m.startPortal.mock.calls[0][0] as { getAccessToken(): Promise<string | null> }).getAccessToken()).toBe("tok-abc");
    expect(m.navigateTo).toHaveBeenCalledWith(PORTAL_URL);
    const b = screen.getByTestId("billing-manage-button") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe("Opening…");
    fireEvent.click(b);
    expect(m.startPortal).toHaveBeenCalledTimes(1);
  });

  it("an expired sign-in sends the member to sign in again and back to Settings", async () => {
    m.startPortal.mockResolvedValue({ kind: "login" });
    await mount(sub());
    await click();
    expect(m.navigateTo).toHaveBeenCalledWith("/login?next=%2Fstandup%2Fsettings");
    expect(screen.getByTestId("billing-manage-error").textContent).toBe("Your session expired. Taking you to sign in…");
  });

  it("each refusal shows its own plain message, the button comes back, and nothing is navigated", async () => {
    const cases: [string, string][] = [
      ["no_subscription", "We couldn't find a subscription to manage on your account."],
      ["portal_disabled", "We couldn't open the subscription page. Please try again."], // no longer produced by the server; an old code is just a generic failure
      ["billing_unavailable", "Managing subscriptions isn't available right now."],
      ["portal_failed", "We couldn't open the subscription page. Please try again."],
      ["weird_code", "We couldn't open the subscription page. Please try again."],
    ];
    for (const [code, text] of cases) {
      m.navigateTo.mockReset();
      m.startPortal.mockResolvedValue({ kind: "error", code });
      await mount(sub());
      await click();
      expect(screen.getByTestId("billing-manage-error").textContent, code).toBe(text);
      expect((screen.getByTestId("billing-manage-button") as HTMLButtonElement).disabled).toBe(false);
      expect(m.navigateTo).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("the Spanish page shows the Spanish button, note and messages", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      m.startPortal.mockResolvedValue({ kind: "error", code: "no_subscription" });
      await mount(sub());
      expect(screen.getByTestId("billing-manage-button").textContent).toBe("Gestionar suscripción");
      expect(screen.getByTestId("billing-manage").textContent).toContain("Abre la página segura de Stripe");
      await click();
      expect(screen.getByTestId("billing-manage-error").textContent).toBe("No encontramos ninguna suscripción que gestionar en tu cuenta.");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

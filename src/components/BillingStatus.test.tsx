import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const api = vi.hoisted(() => ({ getMyBillingStatus: vi.fn() }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { BillingStatus as Status } from "@/lib/supabase/billingStatus";
import BillingStatus from "./BillingStatus";

const END = "2026-12-01T12:00:00.000Z";
const GRACE_END = "2026-12-08T12:00:00.000Z";
const mk = (o: Partial<Status> = {}): Status => ({ access: "free", source: "none", plan: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: false, trialEndsAt: null, ...o });
const sub = (o: Partial<Status> = {}) => mk({ access: "premium", source: "subscription", plan: "monthly", status: "active", periodEnd: END, subscriptionGrantsPremium: true, ...o });

async function mount(status: Status | null) {
  api.getMyBillingStatus.mockResolvedValue(status);
  render(
    <LanguageProvider>
      <BillingStatus />
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
beforeEach(() => api.getMyBillingStatus.mockReset());
afterEach(cleanup);

describe("subscription status display", () => {
  it("an active subscription: plan, Active, renewal date, and Premium from the subscription is On", async () => {
    await mount(sub());
    expect(screen.getByTestId("billing-plan").textContent).toBe("Monthly");
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Active");
    expect(screen.getByTestId("billing-grants").textContent).toBe("On");
    expect(screen.getByTestId("billing-explain").textContent).toMatch(/^Renews on December 1, 2026\.$/);
    expect(screen.getByTestId("billing-access").textContent).toContain("Premium through your subscription");
  });
  it("set to cancel: it won't renew, and says when Premium ends", async () => {
    await mount(sub({ plan: "annual", cancelAtPeriodEnd: true }));
    expect(screen.getByTestId("billing-plan").textContent).toBe("Annual");
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Active, set to cancel");
    expect(screen.getByTestId("billing-explain").textContent).toContain("Cancels on December 1, 2026. It won't renew, and Premium from this subscription ends then");
  });
  it("failed payment inside the grace period: states the 7-day grace and its end date", async () => {
    await mount(sub({ status: "past_due", graceEndsAt: GRACE_END }));
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Payment failed, in the grace period");
    const t = screen.getByTestId("billing-explain").textContent!;
    expect(t).toContain("You keep Premium until December 8, 2026 (a 7-day grace period)");
    expect(t).toContain("returns to the Free plan");
    expect(t).toContain("Nothing you created is deleted");
    expect(screen.getByTestId("billing-grants").textContent).toBe("On");
  });
  it("after the grace period: Premium from the subscription is Off and the expiry date is stated", async () => {
    await mount(mk({ plan: "monthly", status: "past_due", periodEnd: END, graceEndsAt: GRACE_END }));
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Payment failed, grace period ended");
    expect(screen.getByTestId("billing-explain").textContent).toContain("the 7-day grace period ended on December 8, 2026");
    expect(screen.getByTestId("billing-grants").textContent).toBe("Off");
  });
  it("canceled: says it ended, with the date, and that nothing was deleted", async () => {
    await mount(mk({ plan: "monthly", status: "canceled", endedAt: "2026-11-20T12:00:00.000Z" }));
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Canceled");
    expect(screen.getByTestId("billing-explain").textContent).toBe("This subscription ended on November 20, 2026. Nothing you created is deleted.");
    expect(screen.getByTestId("billing-access").textContent).toBe("You're on the Free plan.");
  });
  it("other statuses are explained without claiming Premium", async () => {
    for (const [status, label] of [["unpaid", "Unpaid"], ["incomplete", "Not completed"], ["incomplete_expired", "Expired"], ["paused", "Paused"]] as const) {
      cleanup();
      await mount(mk({ plan: "monthly", status, periodEnd: END }));
      expect(screen.getByTestId("billing-status-label").textContent).toBe(label);
      expect(screen.getByTestId("billing-grants").textContent).toBe("Off");
    }
  });
  it("an unrecognised status shows 'Status unavailable', never Active", async () => {
    await mount(mk({ plan: "monthly", status: "brand_new_status", subscriptionGrantsPremium: true, access: "premium", source: "subscription" }));
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Status unavailable");
    expect(screen.getByTestId("billing-status-label").textContent).not.toMatch(/active/i);
  });
});

describe("how Premium is held, and never implying an active subscription", () => {
  it("an admin grant says so, with no subscription section", async () => {
    await mount(mk({ access: "premium", source: "manual" }));
    expect(screen.getByTestId("billing-access").textContent).toContain("granted by an admin");
    expect(screen.queryByTestId("billing-status-label")).toBeNull();
  });
  it("an admin grant plus a canceled subscription: Premium is the admin's, the subscription is Canceled and gives no Premium", async () => {
    await mount(mk({ access: "premium", source: "manual", plan: "monthly", status: "canceled", endedAt: END }));
    expect(screen.getByTestId("billing-access").textContent).toContain("granted by an admin");
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Canceled");
    expect(screen.getByTestId("billing-grants").textContent).toBe("Off");
  });
  it("a running trial plus a canceled subscription: Premium is explained as the trial, with its end date", async () => {
    await mount(mk({ access: "premium_trial", source: "trial", trialEndsAt: "2026-12-10T12:00:00.000Z", plan: "monthly", status: "canceled" }));
    expect(screen.getByTestId("billing-access").textContent).toBe("You have Premium through your free trial, which ends on December 10, 2026.");
    expect(screen.getByTestId("billing-grants").textContent).toBe("Off");
  });
  it("a Free account, a trial-only account, or no data renders nothing", async () => {
    for (const s of [mk(), mk({ access: "premium_trial", source: "trial", trialEndsAt: END }), null]) {
      cleanup();
      await mount(s);
      expect(screen.queryByTestId("billing-status")).toBeNull();
    }
  });
  it("shows no identifiers and offers no Checkout, cancel or payment action of its own: the only control is Manage subscription (Stripe's portal)", async () => {
    await mount(sub({ status: "past_due", graceEndsAt: GRACE_END }));
    const root = screen.getByTestId("billing-status");
    const controls = [...root.querySelectorAll("button, a, input, form, select")];
    expect(controls.map((c) => c.getAttribute("data-testid"))).toEqual(["billing-manage-button"]);
    const manage = screen.getByTestId("billing-manage");
    const rest = (root.textContent ?? "").replace(manage.textContent ?? "", "");
    expect(rest).not.toMatch(/cus_|sub_|price_|evt_|checkout|portal|cancel subscription|subscribe now|update payment/i);
    expect(root.textContent).not.toMatch(/cus_|sub_|price_|evt_/);
  });
});

describe("Spanish", () => {
  it("renders status, grace period and dates in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      await mount(sub({ plan: "annual", status: "past_due", graceEndsAt: GRACE_END }));
      expect(screen.getByTestId("billing-plan").textContent).toBe("Anual");
      expect(screen.getByTestId("billing-status-label").textContent).toBe("Pago fallido, en periodo de gracia");
      const t = screen.getByTestId("billing-explain").textContent!;
      expect(t).toContain("hasta el 8 de diciembre de 2026");
      expect(t).toContain("periodo de gracia de 7 días");
      expect(t).toContain("No se elimina nada de lo que creaste");
      expect(screen.getByTestId("billing-grants").textContent).toBe("Sí");
      expect(screen.getByTestId("billing-access").textContent).toBe("Tienes Premium por tu suscripción.");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

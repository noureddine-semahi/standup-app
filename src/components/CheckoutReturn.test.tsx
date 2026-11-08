import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const api = vi.hoisted(() => ({ getMyBillingStatus: vi.fn() }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { BillingStatus } from "@/lib/supabase/billingStatus";
import CheckoutReturn, { POLL_ATTEMPTS, POLL_INTERVAL_MS } from "./CheckoutReturn";

const status = (o: Partial<BillingStatus> = {}): BillingStatus => ({ access: "free", source: "none", plan: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: false, trialEndsAt: null, ...o });
const live = status({ access: "premium", source: "subscription", plan: "monthly", status: "active", subscriptionGrantsPremium: true });

const at = (search: string) => window.history.pushState({}, "", "/standup/settings" + search);
const mount = (onConfirmed?: () => void) =>
  render(
    <LanguageProvider>
      <CheckoutReturn onConfirmed={onConfirmed} />
    </LanguageProvider>
  );
const tick = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const phase = () => screen.queryByTestId("checkout-return")?.getAttribute("data-phase") ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  api.getMyBillingStatus.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  at("");
});

describe("returning from Stripe", () => {
  it("shows nothing at all without the parameter, and asks the server nothing", async () => {
    at("");
    mount();
    await tick(100);
    expect(phase()).toBeNull();
    expect(api.getMyBillingStatus).not.toHaveBeenCalled();
  });
  it("ignores any other value of the parameter", async () => {
    for (const v of ["?checkout=maybe", "?checkout=", "?checkout=SUCCESS", "?checkout=success%20"]) {
      cleanup();
      at(v);
      mount();
      await tick(100);
      expect(phase()).toBeNull();
    }
    expect(api.getMyBillingStatus).not.toHaveBeenCalled();
  });

  describe("cancelled", () => {
    it("only says the member left checkout and changed nothing: no claim about money, no server call", async () => {
      at("?checkout=cancelled");
      mount();
      await tick(0);
      expect(phase()).toBe("cancelled");
      const t = screen.getByTestId("checkout-return").textContent!;
      expect(t).toContain("You left checkout before finishing");
      expect(t).toContain("Nothing was changed on your account");
      expect(t).not.toMatch(/charged|paid|refund/i);
      expect(api.getMyBillingStatus).not.toHaveBeenCalled();
    });
  });

  describe("success: the URL is never proof of payment", () => {
    it("is confirmed only when the server's billing record says THIS SUBSCRIPTION gives Premium, and then refreshes the plan", async () => {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValueOnce(status()).mockResolvedValueOnce(status()).mockResolvedValue(live);
      const onConfirmed = vi.fn();
      mount(onConfirmed);
      await tick(0);
      expect(phase()).toBe("verifying");
      expect(screen.getByTestId("checkout-return").textContent).toContain("Checking your payment");
      expect(onConfirmed).not.toHaveBeenCalled();
      await tick(POLL_INTERVAL_MS);
      expect(phase()).toBe("verifying");
      await tick(POLL_INTERVAL_MS);
      expect(phase()).toBe("confirmed");
      expect(screen.getByTestId("checkout-return").textContent).toContain("Your subscription is confirmed and Premium is on");
      expect(onConfirmed).toHaveBeenCalledTimes(1);
    });
    it("a forged ?checkout=success with no payment is never 'confirmed': it ends at 'not received yet'", async () => {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValue(status());
      mount();
      await tick(POLL_INTERVAL_MS * (POLL_ATTEMPTS + 1));
      expect(phase()).toBe("pending");
      const t = screen.getByTestId("checkout-return").textContent!;
      expect(t).toContain("haven't received confirmation of a payment yet");
      expect(t).not.toContain("confirmed and Premium is on");
      expect(api.getMyBillingStatus).toHaveBeenCalledTimes(POLL_ATTEMPTS);
    });
    it("Premium from an admin grant or a trial is NOT mistaken for a confirmed payment", async () => {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValue(status({ access: "premium", source: "manual", subscriptionGrantsPremium: false }));
      mount();
      await tick(POLL_INTERVAL_MS * (POLL_ATTEMPTS + 1));
      expect(phase()).toBe("pending");
    });
    it("a subscription that exists but does not give Premium (canceled, unpaid) is not a confirmation either", async () => {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValue(status({ plan: "monthly", status: "canceled", subscriptionGrantsPremium: false }));
      mount();
      await tick(POLL_INTERVAL_MS * (POLL_ATTEMPTS + 1));
      expect(phase()).toBe("pending");
    });
    it("a payment still being completed (an 'incomplete' subscription) says so and keeps checking", async () => {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValueOnce(status({ plan: "monthly", status: "incomplete" })).mockResolvedValue(live);
      mount();
      await tick(0);
      expect(phase()).toBe("incomplete");
      expect(screen.getByTestId("checkout-return").textContent).toContain("still being completed");
      await tick(POLL_INTERVAL_MS);
      expect(phase()).toBe("confirmed");
    });
    it("if the webhook is slow, the pending state offers 'Check again', which verifies again and can then confirm", async () => {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValue(status());
      const onConfirmed = vi.fn();
      mount(onConfirmed);
      await tick(POLL_INTERVAL_MS * (POLL_ATTEMPTS + 1));
      expect(phase()).toBe("pending");
      api.getMyBillingStatus.mockResolvedValue(live);
      await act(async () => {
        fireEvent.click(screen.getByTestId("checkout-check-again"));
      });
      await tick(0);
      expect(phase()).toBe("confirmed");
      expect(onConfirmed).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("checkout-check-again")).toBeNull();
    });
    it("a failed status read (offline, function missing) is just 'not confirmed yet', never an error page or a false success", async () => {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValue(null);
      mount();
      await tick(POLL_INTERVAL_MS * (POLL_ATTEMPTS + 1));
      expect(phase()).toBe("pending");
    });
    it("stops checking when the member leaves the page", async () => {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValue(status());
      mount();
      await tick(0);
      const calls = api.getMyBillingStatus.mock.calls.length;
      cleanup();
      await tick(POLL_INTERVAL_MS * 5);
      expect(api.getMyBillingStatus.mock.calls.length).toBe(calls);
    });
  });

  it("consumes the parameter from the address bar, so a refresh doesn't replay it, and keeps other parameters", async () => {
    at("?checkout=cancelled&x=1#top");
    mount();
    await tick(0);
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("#top");
  });
});

describe("Spanish", () => {
  it("renders every state in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      at("?checkout=success");
      api.getMyBillingStatus.mockResolvedValue(status());
      mount();
      await tick(0);
      expect(screen.getByTestId("checkout-return").textContent).toContain("Comprobando tu pago");
      await tick(POLL_INTERVAL_MS * (POLL_ATTEMPTS + 1));
      expect(screen.getByTestId("checkout-return").textContent).toContain("Todavía no hemos recibido la confirmación de un pago");
      expect(screen.getByTestId("checkout-check-again").textContent).toBe("Comprobar de nuevo");
      cleanup();
      at("?checkout=cancelled");
      mount();
      await tick(0);
      expect(screen.getByTestId("checkout-return").textContent).toContain("Saliste del pago antes de terminar");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

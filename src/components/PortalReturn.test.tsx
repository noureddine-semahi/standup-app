import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const api = vi.hoisted(() => ({ getMyBillingStatus: vi.fn() }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import PortalReturn from "./PortalReturn";

const at = (search: string) => window.history.pushState({}, "", "/standup/settings" + search);
const mount = async () => {
  render(
    <LanguageProvider>
      <PortalReturn />
    </LanguageProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
};
afterEach(() => {
  cleanup();
  at("");
  api.getMyBillingStatus.mockReset();
});

describe("returning from the Customer Portal", () => {
  it("shows nothing without the parameter or with any other value", async () => {
    for (const q of ["", "?portal=", "?portal=success", "?portal=RETURN", "?checkout=success", "?portal=return2"]) {
      at(q);
      await mount();
      expect(screen.queryByTestId("portal-return"), q).toBeNull();
      cleanup();
    }
  });

  it("with ?portal=return it says changes can take a moment and that the plan updates only once Stripe confirms, then removes the parameter and keeps the rest of the URL", async () => {
    at("?portal=return&tab=premium#top");
    await mount();
    expect(screen.getByTestId("portal-return").textContent).toBe("You're back from managing your subscription. Changes you made can take a moment to appear here, and your plan only updates once Stripe confirms them to us.");
    expect(window.location.search).toBe("?tab=premium");
    expect(window.location.hash).toBe("#top");
  });

  it("is informational only: it never reads or changes billing, access or the plan", async () => {
    at("?portal=return");
    await mount();
    expect(api.getMyBillingStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is available in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      at("?portal=return");
      await mount();
      expect(screen.getByTestId("portal-return").textContent).toContain("Has vuelto de gestionar tu suscripción");
      expect(screen.getByTestId("portal-return").textContent).toContain("solo se actualiza cuando Stripe nos los confirma");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

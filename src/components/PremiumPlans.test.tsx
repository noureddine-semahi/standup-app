import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ getMyEntitlement: vi.fn(), getMyTrialHistory: vi.fn(), startMyTrial: vi.fn() }));
vi.mock("@/lib/supabase/entitlements", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/entitlements")>()), ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import PremiumPlans from "./PremiumPlans";

const mount = () =>
  render(
    <LanguageProvider>
      <PremiumPlans />
    </LanguageProvider>
  );
afterEach(() => {
  cleanup();
  Object.values(api).forEach((f) => f.mockReset());
});

describe("Free vs Premium", () => {
  it("lists the real Free caps and says the daily experience is always included", () => {
    mount();
    const free = screen.getByTestId("premium-plans-free").textContent!;
    expect(free).toContain("Up to 3 active structured Goals");
    expect(free).toContain("Up to 3 active routines");
    expect(free).toContain("Up to 10 saved notes");
    expect(free).toContain("always included");
  });
  it("Premium: unlimited Goals, routines and notes, plus future advanced features", () => {
    mount();
    const p = screen.getByTestId("premium-plans-premium").textContent!;
    for (const s of ["Unlimited structured Goals", "Unlimited routines", "Unlimited notes", "Future advanced features"]) expect(p).toContain(s);
  });
});

describe("pricing and billing choice", () => {
  it("shows both approved prices", () => {
    mount();
    expect(screen.getByTestId("premium-billing-monthly").textContent).toContain("$5.99 / month");
    expect(screen.getByTestId("premium-billing-annual").textContent).toContain("$49.99 / year");
  });
  it("Annual is preselected with its saving; Monthly can be chosen and back, a view choice only", () => {
    mount();
    const m = screen.getByTestId("premium-billing-monthly");
    const a = screen.getByTestId("premium-billing-annual");
    expect(a.getAttribute("aria-checked")).toBe("true");
    expect(m.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("premium-annual-hint").textContent).toBe("About $4.16 a month, save 30%");
    fireEvent.click(m);
    expect(m.getAttribute("aria-checked")).toBe("true");
    expect(a.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("premium-annual-hint")).toBeNull();
    fireEvent.click(a);
    expect(a.getAttribute("aria-checked")).toBe("true");
  });
  it("says paid subscriptions aren't available, and offers no Subscribe or Checkout button", () => {
    mount();
    expect(screen.getByTestId("premium-not-available").textContent).toContain("aren't available yet");
    expect(screen.getByTestId("premium-not-available").textContent).toContain("doesn't start a payment or change your plan");
    const labels = [...document.querySelectorAll("button, a, [role=button]")].map((b) => b.textContent!.toLowerCase());
    expect(labels.some((l) => /subscribe|checkout|pay|buy|upgrade/.test(l))).toBe(false);
    expect(within(screen.getByTestId("premium-plans")).getAllByRole("radio")).toHaveLength(2);
  });
  it("choosing a billing option never touches the entitlement or trial calls", () => {
    mount();
    fireEvent.click(screen.getByTestId("premium-billing-monthly"));
    fireEvent.click(screen.getByTestId("premium-billing-annual"));
    for (const f of Object.values(api)) expect(f).not.toHaveBeenCalled();
  });
});

describe("Spanish", () => {
  it("renders benefits, prices and the not-available notice in Spanish", () => {
    localStorage.setItem("standup-language", "es");
    try {
      mount();
      expect(screen.getByTestId("premium-plans").textContent).toContain("Gratis vs Premium");
      expect(screen.getByTestId("premium-plans-premium").textContent).toContain("Objetivos estructurados ilimitados");
      expect(screen.getByTestId("premium-billing-monthly").textContent).toContain("$5.99 / mes");
      expect(screen.getByTestId("premium-billing-annual").textContent).toContain("$49.99 / año");
      expect(screen.getByTestId("premium-not-available").textContent).toContain("aún no están disponibles");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

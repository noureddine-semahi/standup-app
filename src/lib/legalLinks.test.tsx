import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const m = vi.hoisted(() => ({ getMyBillingStatus: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), getMyBillingStatus: m.getMyBillingStatus }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: m.getSession } } }));
vi.mock("@/lib/startCheckout", () => ({ startCheckout: vi.fn() }));
vi.mock("@/lib/navigate", () => ({ navigateTo: vi.fn() }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";
import PremiumPlans from "@/components/PremiumPlans";

const src = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");

afterEach(() => {
  cleanup();
  localStorage.removeItem("standup-language");
});
beforeEach(() => {
  m.getMyBillingStatus.mockReset().mockResolvedValue(null);
  m.getSession.mockReset().mockResolvedValue({ data: { session: null } });
});

describe("the Terms are reachable from where people look for them (desktop and mobile share these links)", () => {
  it("the sign-in, sign-up, forgot-password and reset-password pages link to both the Privacy Policy and the Terms in their footer", () => {
    for (const page of ["login", "signup", "forgot-password", "reset-password"]) {
      const code = src("app", page, "page.tsx");
      expect(code, page).toContain('href="/privacy"');
      expect(code, page).toContain('href="/terms"');
      expect(code.indexOf('href="/terms"'), page).toBeGreaterThan(code.indexOf('href="/privacy"'));
    }
  });

  it("the About and FAQ pages show a Privacy · Terms line", () => {
    for (const page of ["about", "faq"]) {
      const code = src("app", page, "page.tsx");
      expect(code, page).toContain('href="/terms"');
      expect(code, page).toMatch(/data-testid="(about|faq)-legal-links"/);
    }
  });

  it("the Privacy Policy (page and signup consent modal share it) points to the Terms, in English and Spanish", () => {
    render(
      <LanguageProvider>
        <PrivacyPolicyContent />
      </LanguageProvider>
    );
    const link = screen.getByRole("link", { name: "Terms of Service" });
    expect(link.getAttribute("href")).toBe("/terms");
    expect(link.parentElement!.textContent).toContain("See also our Terms of Service.");
    cleanup();
    localStorage.setItem("standup-language", "es");
    render(
      <LanguageProvider>
        <PrivacyPolicyContent />
      </LanguageProvider>
    );
    const es = screen.getByRole("link", { name: "Términos de Servicio" });
    expect(es.getAttribute("href")).toBe("/terms");
    expect(es.parentElement!.textContent).toContain("Consulta también nuestros Términos de Servicio.");
  });

  it("the Terms page is a public route: it lives outside /standup, so the sign-in gate never wraps it", () => {
    expect(() => readFileSync(join(process.cwd(), "src", "app", "terms", "page.tsx"), "utf8")).not.toThrow();
    expect(src("app", "terms", "page.tsx")).not.toMatch(/AuthGate|getSession|redirect\(/);
  });
});

describe("the renewal disclosure beside the Subscribe button", () => {
  const mount = async (checkoutEnabled: boolean) => {
    render(
      <LanguageProvider>
        <PremiumPlans checkoutEnabled={checkoutEnabled} />
      </LanguageProvider>
    );
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  };

  it("is shown next to the Subscribe button, says plans renew automatically until canceled in Settings, and links to the Terms", async () => {
    await mount(true);
    const note = screen.getByTestId("premium-renewal-note");
    expect(note.textContent).toBe("Paid plans renew automatically until you cancel in Settings. Read the Terms of Service for the details.");
    expect(note.querySelector("a")!.getAttribute("href")).toBe("/terms");
    expect(screen.getByTestId("premium-subscribe-button")).toBeTruthy();
  });

  it("is in Spanish too", async () => {
    localStorage.setItem("standup-language", "es");
    await mount(true);
    expect(screen.getByTestId("premium-renewal-note").textContent).toBe("Los planes de pago se renuevan automáticamente hasta que canceles en Ajustes. Lee los Términos de Servicio para ver los detalles.");
  });

  it("appears only where a purchase is possible: with Checkout off (the whole beta) nothing about renewal is shown", async () => {
    await mount(false);
    expect(screen.queryByTestId("premium-renewal-note")).toBeNull();
    expect(screen.queryByTestId("premium-subscribe-button")).toBeNull();
  });
});

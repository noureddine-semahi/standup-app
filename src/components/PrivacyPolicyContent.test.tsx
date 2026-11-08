import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import PrivacyPolicyContent from "./PrivacyPolicyContent";

const mount = () =>
  render(
    <LanguageProvider>
      <PrivacyPolicyContent />
    </LanguageProvider>
  );
afterEach(cleanup);

describe("privacy policy: payments & billing", () => {
  it("says what is stored for a paid plan, that card details never reach StandUp, and that deleting content doesn't remove billing records", () => {
    mount();
    const t = screen.getByTestId("privacy-billing").textContent!;
    expect(t).toContain("free during the beta");
    expect(t).toContain("handled by Stripe");
    expect(t).toContain("card details go to Stripe and never reach StandUp");
    for (const stored of ["Stripe customer and subscription identifiers", "monthly or annual", "status", "billing period dates"]) expect(t).toContain(stored);
    expect(t).toContain("never shown to other members");
    expect(t).toContain("While a subscription is active your account has Premium");
    expect(t).toContain("short grace period");
    expect(t).toContain("returns to the Free plan and nothing you created is deleted");
    expect(t).toContain("see your plan, status and renewal date in Settings; we never show Stripe identifiers");
    expect(t).toContain("which plan you chose (monthly or annual) and when you started a checkout");
    expect(t).toContain("complete payment on Stripe's own secure page, and we only act on a payment after confirming it ourselves");
    expect(t).toContain("doesn't remove these billing records");
    expect(screen.getByText("Payments & billing")).toBeTruthy();
  });
  it("is available in Spanish with the same commitments", () => {
    localStorage.setItem("standup-language", "es");
    try {
      mount();
      const t = screen.getByTestId("privacy-billing").textContent!;
      for (const s of ["gratis durante la beta", "Stripe", "nunca llegan a StandUp", "identificadores de cliente y suscripción", "mensual o anual", "nunca se muestran a otros miembros", "no elimina estos registros de facturación", "Mientras una suscripción está activa, tu cuenta tiene Premium", "breve periodo de gracia", "vuelve al plan Gratis y no se elimina nada de lo que creaste", "nunca mostramos identificadores de Stripe", "cuándo iniciaste un pago", "solo actuamos sobre un pago después de confirmarlo nosotros"]) expect(t).toContain(s);
      expect(screen.getByText("Pagos y facturación")).toBeTruthy();
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

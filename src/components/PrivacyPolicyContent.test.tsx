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
  it("says what is stored for a paid plan, that card details never reach StandUp, and what deleting the account does to billing records", () => {
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
    expect(t).toContain("any active subscription is canceled immediately before anything is removed, and your billing records are deleted with the account");
    expect(t).toContain("We don't automatically refund payments; contact us if you think you're owed one");
    expect(t).toContain("Stripe and our accounting records keep payment records (such as invoices and charges) for as long as financial or legal rules require");
    expect(screen.getByText("Payments & billing")).toBeTruthy();
  });
  it("is available in Spanish with the same commitments", () => {
    localStorage.setItem("standup-language", "es");
    try {
      mount();
      const t = screen.getByTestId("privacy-billing").textContent!;
      for (const s of ["gratis durante la beta", "Stripe", "nunca llegan a StandUp", "identificadores de cliente y suscripción", "mensual o anual", "nunca se muestran a otros miembros", "cualquier suscripción activa se cancela de inmediato antes de borrar nada, y tus registros de facturación se eliminan con la cuenta", "No reembolsamos pagos automáticamente; contáctanos si crees que te corresponde uno", "el tiempo que exijan las normas financieras o legales", "Mientras una suscripción está activa, tu cuenta tiene Premium", "breve periodo de gracia", "vuelve al plan Gratis y no se elimina nada de lo que creaste", "nunca mostramos identificadores de Stripe", "cuándo iniciaste un pago", "solo actuamos sobre un pago después de confirmarlo nosotros"]) expect(t).toContain(s);
      expect(screen.getByText("Pagos y facturación")).toBeTruthy();
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const flagsApi = vi.hoisted(() => ({ getFeatureFlags: vi.fn() }));
vi.mock("@/lib/supabase/featureFlags", () => flagsApi);

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";
import FAQPage from "./page";

const flags = (promotion: boolean) => ({ premium_promotion_enabled: promotion, premium_trial_activation_enabled: false, billing_checkout_enabled: false });
async function mountFaq() {
  render(
    <LanguageProvider>
      <FAQPage />
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  flagsApi.getFeatureFlags.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem("standup-language");
});

describe("FAQ: managing a subscription", () => {
  it("is hidden during the free beta (promotion off): the FAQ carries no Premium messaging", async () => {
    flagsApi.getFeatureFlags.mockResolvedValue(flags(false));
    await mountFaq();
    expect(screen.queryByTestId("faq-manage-subscription")).toBeNull();
  });

  it("explains Manage subscription, Stripe's portal, keeping Premium until the paid period ends, nothing changing until Stripe confirms, and that plan switching isn't there yet", async () => {
    flagsApi.getFeatureFlags.mockResolvedValue(flags(true));
    await mountFaq();
    const t = screen.getByTestId("faq-manage-subscription").textContent!;
    expect(t).toContain("How do I cancel my subscription or update my card?");
    for (const s of ["choose Manage subscription", "Stripe's own secure customer portal", "cancel, update your payment method and see your invoices", "only open it for your own subscription", "card details never reach StandUp", "you keep Premium until the end of the period you already paid for", "nothing changes by itself", "only after Stripe confirms the change to us", "Switching between the monthly and annual plan isn't available in the portal yet"]) expect(t).toContain(s);
  });

  it("is available in Spanish with the same commitments", async () => {
    localStorage.setItem("standup-language", "es");
    flagsApi.getFeatureFlags.mockResolvedValue(flags(true));
    await mountFaq();
    const t = screen.getByTestId("faq-manage-subscription").textContent!;
    for (const s of ["¿Cómo cancelo mi suscripción o actualizo mi tarjeta?", "elige Gestionar suscripción", "portal de clientes seguro de Stripe", "Solo lo abrimos para tu propia suscripción", "nunca llegan a StandUp", "conservas Premium hasta el final del periodo que ya pagaste", "no cambia nada por sí solo", "cuando Stripe nos confirma el cambio", "todavía no está disponible en el portal"]) expect(t).toContain(s);
  });
});

describe("Privacy: the Customer Portal", () => {
  const mountPrivacy = () =>
    render(
      <LanguageProvider>
        <PrivacyPolicyContent />
      </LanguageProvider>
    );

  it("says managing a subscription happens on Stripe's portal, only for your own subscription, and that a change reaches the account only after Stripe confirms it", () => {
    mountPrivacy();
    const t = screen.getByTestId("privacy-billing").textContent!;
    expect(t).toContain("Stripe's own secure customer portal, opened from Settings");
    expect(t).toContain("we only open it for your own subscription");
    expect(t).toContain("reaches your account only after Stripe confirms it to us");
  });

  it("says the same in Spanish", () => {
    localStorage.setItem("standup-language", "es");
    mountPrivacy();
    const t = screen.getByTestId("privacy-billing").textContent!;
    for (const s of ["portal de clientes seguro de Stripe, que se abre desde Ajustes", "solo lo abrimos para tu propia suscripción", "llega a tu cuenta únicamente después de que Stripe nos lo confirme"]) expect(t).toContain(s);
  });
});

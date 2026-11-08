import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const flagsApi = vi.hoisted(() => ({ getFeatureFlags: vi.fn() }));
vi.mock("@/lib/supabase/featureFlags", () => flagsApi);

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import FAQPage from "./page";

const flags = (promotion: boolean) => ({ premium_promotion_enabled: promotion, premium_trial_activation_enabled: false, billing_checkout_enabled: false });
async function mount() {
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
});

describe("FAQ: plans and billing answer", () => {
  it("is hidden during the free beta (promotion off), so the FAQ carries no Premium messaging", async () => {
    flagsApi.getFeatureFlags.mockResolvedValue(flags(false));
    await mount();
    expect(screen.queryByTestId("faq-plans")).toBeNull();
    expect(document.body.textContent).not.toMatch(/grace period/i);
  });
  it("is shown when promotion is on, and states the implemented policy: nothing deleted, 7-day grace, Free limits, manual grants and trials unaffected", async () => {
    flagsApi.getFeatureFlags.mockResolvedValue(flags(true));
    await mount();
    const t = screen.getByTestId("faq-plans").textContent!;
    expect(t).toContain("Nothing you created is ever deleted");
    expect(t).toContain("7-day grace period");
    expect(t).toContain("3 active Goals, 3 active routines, 10 notes");
    expect(t).toContain("set to cancel at the end of the period stays Premium until that period ends");
    expect(t).toContain("an admin gave you directly, or an active free trial, isn't affected");
    expect(t).toContain("In Settings you can see your plan, your subscription's status, its renewal or end date, any grace period");
  });
  it("is available in Spanish with the same commitments", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      flagsApi.getFeatureFlags.mockResolvedValue(flags(true));
      await mount();
      const t = screen.getByTestId("faq-plans").textContent!;
      for (const s of ["Nada de lo que creaste se elimina nunca", "periodo de gracia de 7 días", "3 Objetivos activos, 3 rutinas activas, 10 notas", "un administrador, o una prueba gratuita activa", "En Ajustes puedes ver tu plan, el estado de tu suscripción"]) expect(t).toContain(s);
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

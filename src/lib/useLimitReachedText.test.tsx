import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const flagsApi = vi.hoisted(() => ({ getFeatureFlags: vi.fn() }));
vi.mock("@/lib/supabase/featureFlags", () => flagsApi);

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { useLimitReachedText } from "./useFeatureFlags";

function Probe() {
  const text = useLimitReachedText();
  return (
    <>
      <p data-testid="notes">{text("notes", 10)}</p>
      <p data-testid="goals">{text("goals", 3)}</p>
      <p data-testid="routines">{text("routines", 3)}</p>
    </>
  );
}
const flags = (promotion: boolean) => ({ premium_promotion_enabled: promotion, premium_trial_activation_enabled: false, billing_checkout_enabled: false });
async function mount() {
  render(
    <LanguageProvider>
      <Probe />
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
beforeEach(() => {
  cleanup();
  flagsApi.getFeatureFlags.mockReset();
});

describe("limit-reached messages", () => {
  it("with promotion off (the free beta) they state the limit and never mention Premium", async () => {
    flagsApi.getFeatureFlags.mockResolvedValue(flags(false));
    await mount();
    expect(screen.getByTestId("notes").textContent).toBe("You've reached the Free plan limit of 10 notes.");
    for (const id of ["notes", "goals", "routines"]) expect(screen.getByTestId(id).textContent).not.toMatch(/premium|upgrade/i);
    expect(screen.getByTestId("goals").textContent).toContain("3 active Goals");
  });
  it("with promotion on they point to Premium", async () => {
    flagsApi.getFeatureFlags.mockResolvedValue(flags(true));
    await mount();
    expect(screen.getByTestId("notes").textContent).toContain("Upgrade to Premium");
    expect(screen.getByTestId("goals").textContent).toContain("upgrade to Premium");
    expect(screen.getByTestId("routines").textContent).toContain("upgrade to Premium");
  });
  it("is plain (no Premium) before the flags have loaded", async () => {
    flagsApi.getFeatureFlags.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(screen.getByTestId("notes").textContent).not.toMatch(/premium/i);
  });
  it("is plain in Spanish too", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      flagsApi.getFeatureFlags.mockResolvedValue(flags(false));
      await mount();
      expect(screen.getByTestId("notes").textContent).toBe("Has alcanzado el límite del plan Gratis de 10 notas.");
      expect(screen.getByTestId("goals").textContent).not.toMatch(/premium/i);
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

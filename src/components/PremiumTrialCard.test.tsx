import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ getMyEntitlement: vi.fn(), getMyTrialHistory: vi.fn(), startMyTrial: vi.fn() }));
vi.mock("@/lib/supabase/entitlements", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/entitlements")>()), ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { TrialNotAvailableError } from "@/lib/supabase/entitlements";
import PremiumTrialCard from "./PremiumTrialCard";

const free = { tier: "free", storedTier: "free", trialStartedAt: null, trialEndsAt: null };
const trial = { tier: "premium_trial", storedTier: "premium_trial", trialStartedAt: new Date(Date.now() - 2 * 86400000).toISOString(), trialEndsAt: new Date(Date.now() + 12 * 86400000).toISOString() };
const expired = { tier: "free", storedTier: "premium_trial", trialStartedAt: "2026-09-01T00:00:00Z", trialEndsAt: "2026-09-15T00:00:00Z" };
const premium = { tier: "premium", storedTier: "premium", trialStartedAt: null, trialEndsAt: null };
const unused = { used: false, startedAt: null, endsAt: null };
const used = { used: true, startedAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-15T00:00:00Z" };

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};
async function mount(ent: unknown, hist: unknown = unused) {
  api.getMyEntitlement.mockResolvedValue(ent);
  api.getMyTrialHistory.mockResolvedValue(hist);
  render(
    <LanguageProvider>
      <PremiumTrialCard />
    </LanguageProvider>
  );
  await settle();
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
});
afterEach(cleanup);

describe("current plan", () => {
  it("shows Free with the offer: 14 days, no payment required", async () => {
    await mount(free);
    expect(screen.getByTestId("premium-tier").textContent).toBe("Free");
    expect(screen.getByTestId("premium-offer").textContent).toContain("14 days");
    expect(screen.getByTestId("premium-offer").textContent).toContain("No payment required");
    expect(screen.getByTestId("premium-start").textContent).toBe("Start 14-Day Free Trial");
  });
  it("shows an active trial with its expiration date and days left, and no start button", async () => {
    await mount(trial, used);
    expect(screen.getByTestId("premium-tier").textContent).toBe("Premium Trial");
    expect(screen.getByTestId("premium-trial-info").textContent).toMatch(/Your trial ends on .+ · 12 days left|Your trial ends on .+ · 13 days left/);
    expect(screen.queryByTestId("premium-start")).toBeNull();
  });
  it("shows Premium with no start button", async () => {
    await mount(premium);
    expect(screen.getByTestId("premium-tier").textContent).toBe("Premium");
    expect(screen.queryByTestId("premium-start")).toBeNull();
  });
  it("an ended trial says so, never offers another, and reassures that data is still there", async () => {
    await mount(expired, used);
    expect(screen.getByTestId("premium-tier").textContent).toBe("Free");
    expect(screen.getByTestId("premium-trial-ended").textContent).toContain("still here");
    expect(screen.queryByTestId("premium-start")).toBeNull();
  });
  it("a trial already used (history) is not offered even if the tier lookup says Free", async () => {
    await mount(free, used);
    expect(screen.queryByTestId("premium-start")).toBeNull();
  });
  it("shows a loading state, then a retryable error if the plan can't be read", async () => {
    api.getMyEntitlement.mockRejectedValueOnce(new Error("offline"));
    api.getMyTrialHistory.mockResolvedValue(unused);
    render(
      <LanguageProvider>
        <PremiumTrialCard />
      </LanguageProvider>
    );
    expect(screen.getByTestId("premium-loading")).toBeTruthy();
    await settle();
    expect(screen.getByTestId("premium-error")).toBeTruthy();
    api.getMyEntitlement.mockResolvedValue(free);
    await act(async () => fireEvent.click(screen.getByTestId("premium-retry")));
    await settle();
    expect(screen.getByTestId("premium-start")).toBeTruthy();
  });
});

describe("activation requires explicit confirmation", () => {
  it("never starts a trial on its own: nothing is activated by loading the page", async () => {
    await mount(free);
    expect(api.startMyTrial).not.toHaveBeenCalled();
  });
  it("clicking Start only opens a confirmation that says 14 days and no payment; cancelling starts nothing", async () => {
    await mount(free);
    fireEvent.click(screen.getByTestId("premium-start"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("14");
    expect(dialog.textContent).toContain("No payment is required");
    expect(dialog.textContent).toContain("nothing will be charged");
    expect(api.startMyTrial).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText("Cancel", { exact: false }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.startMyTrial).not.toHaveBeenCalled();
  });
  it("confirming starts the trial once and refreshes the plan: Premium Trial with the new end date", async () => {
    await mount(free);
    fireEvent.click(screen.getByTestId("premium-start"));
    api.startMyTrial.mockResolvedValue(trial);
    api.getMyEntitlement.mockResolvedValue(trial);
    api.getMyTrialHistory.mockResolvedValue(used);
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Start trial")));
    await settle();
    expect(api.startMyTrial).toHaveBeenCalledTimes(1);
    expect(api.getMyEntitlement.mock.calls.length).toBeGreaterThanOrEqual(2); // reloaded after activation
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("premium-tier").textContent).toBe("Premium Trial");
    expect(screen.getByTestId("premium-trial-info")).toBeTruthy();
    expect(screen.queryByTestId("premium-start")).toBeNull();
  });
});

describe("errors", () => {
  it("an already-used trial is explained, and the offer disappears after the refresh", async () => {
    await mount(free);
    fireEvent.click(screen.getByTestId("premium-start"));
    api.startMyTrial.mockRejectedValue(new TrialNotAvailableError("already_used"));
    api.getMyTrialHistory.mockResolvedValue(used);
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Start trial")));
    await settle();
    expect(screen.getByRole("alertdialog").textContent).toContain("already been used");
    expect(screen.queryByTestId("premium-start")).toBeNull();
  });
  it("an already-Premium account is told so", async () => {
    await mount(free);
    fireEvent.click(screen.getByTestId("premium-start"));
    api.startMyTrial.mockRejectedValue(new TrialNotAvailableError("already_premium"));
    api.getMyEntitlement.mockResolvedValue(premium);
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Start trial")));
    await settle();
    expect(screen.getByRole("alertdialog").textContent).toContain("already has Premium");
  });
  it("any other failure shows a friendly message, keeps the offer, and leaves the plan unchanged", async () => {
    await mount(free);
    fireEvent.click(screen.getByTestId("premium-start"));
    api.startMyTrial.mockRejectedValue({ code: "08006", message: "connection lost" });
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Start trial")));
    await settle();
    expect(screen.getByRole("alertdialog").textContent).toContain("Couldn't start the free trial");
    expect(screen.getByRole("alertdialog").textContent).not.toContain("connection lost");
    expect(screen.getByTestId("premium-tier").textContent).toBe("Free");
    expect(screen.getByTestId("premium-start")).toBeTruthy();
  });
  it("when the trial function isn't installed yet it says the trial isn't available", async () => {
    await mount(free);
    fireEvent.click(screen.getByTestId("premium-start"));
    api.startMyTrial.mockRejectedValue({ code: "PGRST202", message: "Could not find the function public.start_my_premium_trial" });
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Start trial")));
    await settle();
    expect(screen.getByRole("alertdialog").textContent).toContain("isn't available yet");
  });
});

describe("plans section", () => {
  it("is shown under the trial offer for a Free account, and the trial flow still works", async () => {
    await mount(free);
    expect(screen.getByTestId("premium-plans")).toBeTruthy();
    expect(screen.getByTestId("premium-start")).toBeTruthy();
    fireEvent.click(screen.getByTestId("premium-start"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(api.startMyTrial).not.toHaveBeenCalled();
  });
  it("is shown during a trial and after one ended, next to the accurate status", async () => {
    await mount(trial, used);
    expect(screen.getByTestId("premium-plans")).toBeTruthy();
    expect(screen.getByTestId("premium-tier").textContent).toBe("Premium Trial");
    cleanup();
    await mount(expired, used);
    expect(screen.getByTestId("premium-plans")).toBeTruthy();
    expect(screen.getByTestId("premium-trial-ended")).toBeTruthy();
  });
  it("is not shown to a Premium account, which has no upgrade to consider", async () => {
    await mount(premium);
    expect(screen.queryByTestId("premium-plans")).toBeNull();
  });
  it("picking a billing option changes neither the plan nor the entitlement calls", async () => {
    await mount(free);
    const calls = api.getMyEntitlement.mock.calls.length;
    fireEvent.click(screen.getByTestId("premium-billing-monthly"));
    expect(screen.getByTestId("premium-tier").textContent).toBe("Free");
    expect(api.getMyEntitlement.mock.calls.length).toBe(calls);
    expect(api.startMyTrial).not.toHaveBeenCalled();
  });
});

describe("Spanish", () => {
  it("renders the card, the offer and the confirmation in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      await mount(free);
      expect(screen.getByTestId("premium-tier").textContent).toBe("Gratis");
      expect(screen.getByTestId("premium-offer").textContent).toContain("No se requiere pago");
      expect(screen.getByTestId("premium-start").textContent).toBe("Iniciar prueba gratuita de 14 días");
      fireEvent.click(screen.getByTestId("premium-start"));
      expect(screen.getByRole("alertdialog").textContent).toContain("no se cobrará nada");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const api = vi.hoisted(() => ({ getMyBillingStatus: vi.fn() }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), ...api }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { BillingStatus as Status } from "@/lib/supabase/billingStatus";
import BillingStatus from "./BillingStatus";

const END = "2026-12-08T16:16:54.000Z";
const mk = (o: Partial<Status> = {}): Status => ({ access: "premium", source: "subscription", plan: "monthly", status: "active", periodEnd: END, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, graceEndsAt: null, subscriptionGrantsPremium: true, trialEndsAt: null, ...o });

async function mount(status: Status) {
  api.getMyBillingStatus.mockResolvedValue(status);
  render(
    <LanguageProvider>
      <BillingStatus />
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
const explain = () => screen.getByTestId("billing-explain").textContent;

beforeEach(() => api.getMyBillingStatus.mockReset());
afterEach(() => {
  cleanup();
  localStorage.removeItem("standup-language");
});

describe("English: renewal vs scheduled cancellation", () => {
  it("a renewing subscription says it renews on the date, and never says it cancels", async () => {
    await mount(mk());
    expect(explain()).toBe("Renews on December 8, 2026.");
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Active");
  });

  it("a subscription scheduled to cancel (as the Customer Portal now records it) says 'Cancels on [date]', never 'Renews', and Premium stays On", async () => {
    await mount(mk({ cancelAtPeriodEnd: true }));
    expect(explain()).toBe("Cancels on December 8, 2026. It won't renew, and Premium from this subscription ends then, when the period you paid for ends.");
    expect(explain()).not.toMatch(/Renews/);
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Active, set to cancel");
    expect(screen.getByTestId("billing-grants").textContent).toBe("On");
  });

  it("with no date it still says it is set to cancel, and invents no date", async () => {
    await mount(mk({ cancelAtPeriodEnd: true, periodEnd: null }));
    expect(explain()).toBe("Set to cancel. It won't renew, and Premium from this subscription ends when the period you paid for ends.");
  });

  it("the reversal (cancellation undone) returns to the renewal wording", async () => {
    await mount(mk({ cancelAtPeriodEnd: false }));
    expect(explain()).toMatch(/^Renews on/);
  });
});

describe("Spanish: renewal vs scheduled cancellation", () => {
  it("renewing: 'Se renueva el …'", async () => {
    localStorage.setItem("standup-language", "es");
    await mount(mk());
    expect(explain()).toBe("Se renueva el 8 de diciembre de 2026.");
  });

  it("scheduled to cancel: 'Se cancela el …', says it won't renew, Premium stays 'Sí'", async () => {
    localStorage.setItem("standup-language", "es");
    await mount(mk({ cancelAtPeriodEnd: true }));
    expect(explain()).toBe("Se cancela el 8 de diciembre de 2026. No se renovará, y el Premium de esta suscripción termina entonces, cuando acaba el periodo que pagaste.");
    expect(explain()).not.toMatch(/Se renueva/);
    expect(screen.getByTestId("billing-status-label").textContent).toBe("Activa, programada para cancelarse");
    expect(screen.getByTestId("billing-grants").textContent).toBe("Sí");
  });

  it("scheduled to cancel with no date", async () => {
    localStorage.setItem("standup-language", "es");
    await mount(mk({ cancelAtPeriodEnd: true, periodEnd: null }));
    expect(explain()).toBe("Programada para cancelarse. No se renovará, y el Premium de esta suscripción termina cuando acaba el periodo que pagaste.");
  });
});

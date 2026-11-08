import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

// Everything that could change something is replaced by a spy; the preview must never touch any of them.
const spies = vi.hoisted(() => ({ startCheckout: vi.fn(), startPortal: vi.fn(), navigateTo: vi.fn(), getSession: vi.fn(), rpc: vi.fn(), from: vi.fn(), startMyTrial: vi.fn(), getMyBillingStatus: vi.fn() }));
vi.mock("@/lib/startCheckout", () => ({ startCheckout: spies.startCheckout }));
vi.mock("@/lib/startPortal", () => ({ startPortal: spies.startPortal }));
vi.mock("@/lib/navigate", () => ({ navigateTo: spies.navigateTo }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: spies.getSession }, rpc: spies.rpc, from: spies.from } }));
vi.mock("@/lib/supabase/entitlements", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/entitlements")>()), startMyTrial: spies.startMyTrial }));
vi.mock("@/lib/supabase/billingStatus", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/billingStatus")>()), getMyBillingStatus: spies.getMyBillingStatus }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { PREVIEW_IDS } from "@/lib/admin/previewStates";
import AdminSubscriptionPreview from "./AdminSubscriptionPreview";

const NOW = Date.parse("2026-11-20T12:00:00Z");
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.values(spies).forEach((s) => s.mockReset());
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem("standup-language");
});
const mount = (lang: "en" | "es" = "en") => {
  if (lang === "es") localStorage.setItem("standup-language", "es");
  return render(
    <LanguageProvider>
      <AdminSubscriptionPreview now={NOW} />
    </LanguageProvider>
  );
};
const pick = (id: string) => fireEvent.click(screen.getByTestId(`adminbill-preview-${id}`));
const text = (id: string) => screen.getByTestId(id).textContent;
const has = (id: string) => !!screen.queryByTestId(id);

describe("it is clearly a preview", () => {
  it("shows a PREVIEW MODE banner and a sample-data badge, in both languages", () => {
    mount();
    expect(text("adminbill-preview-banner")).toContain("PREVIEW MODE");
    expect(text("adminbill-preview-banner")).toContain("nothing here starts a trial, creates a Checkout session, changes a plan or opens Stripe");
    expect(screen.getByTestId("adminbill-preview-panel").textContent).toContain("Preview, sample data");
    cleanup();
    mount("es");
    expect(text("adminbill-preview-banner")).toContain("MODO DE VISTA PREVIA");
    expect(screen.getByTestId("adminbill-preview-panel").textContent).toContain("Vista previa, datos de ejemplo");
  });

  it("offers exactly the seven situations as a labelled radio group, one selected at a time", () => {
    mount();
    const group = screen.getByRole("radiogroup", { name: "Choose a situation" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(7);
    expect([...PREVIEW_IDS]).toEqual(["free", "trialAvailable", "trialActive", "activePremium", "cancellationScheduled", "pastDue", "canceled"]);
    expect(screen.getByTestId("adminbill-preview-free").getAttribute("aria-checked")).toBe("true");
    pick("pastDue");
    expect(screen.getByTestId("adminbill-preview-pastDue").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("adminbill-preview-free").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("adminbill-preview-panel").getAttribute("data-state")).toBe("pastDue");
  });
});

describe("every member situation renders the way the real member screens do", () => {
  it("Free account: Free plan, trial already used and over, Subscribe available, no Manage, no trial offer", () => {
    mount();
    pick("free");
    expect(text("adminbill-preview-tier")).toBe("Free");
    expect(has("adminbill-preview-trial-ended")).toBe(true);
    expect(has("adminbill-preview-offer")).toBe(false);
    expect(has("adminbill-preview-subscription")).toBe(false);
    expect([has("adminbill-preview-action-trial"), has("adminbill-preview-action-subscribe"), has("adminbill-preview-action-manage")]).toEqual([false, true, false]);
  });

  it("Trial available: Free plan with the 14-day offer, Start trial + Subscribe, nothing to manage", () => {
    mount();
    pick("trialAvailable");
    expect(text("adminbill-preview-tier")).toBe("Free");
    expect(text("adminbill-preview-offer")).toContain("14");
    expect([has("adminbill-preview-action-trial"), has("adminbill-preview-action-subscribe"), has("adminbill-preview-action-manage")]).toEqual([true, true, false]);
    expect(text("adminbill-preview-action-trial")).toBe("Start 14-Day Free Trial");
  });

  it("Trial active: Premium Trial with an end date and days left; Subscribe offered; no billing section", () => {
    mount();
    pick("trialActive");
    expect(text("adminbill-preview-tier")).toBe("Premium Trial");
    expect(text("adminbill-preview-trial")).toMatch(/^Your trial ends on [A-Z][a-z]+ \d{1,2}, 20\d\d · \d+ days? left$/);
    expect(has("adminbill-preview-subscription")).toBe(false);
    expect([has("adminbill-preview-action-trial"), has("adminbill-preview-action-subscribe"), has("adminbill-preview-action-manage")]).toEqual([false, true, false]);
  });

  it("Active Premium: Premium, Monthly / Active, 'Renews on …', Manage subscription only", () => {
    mount();
    pick("activePremium");
    expect(text("adminbill-preview-tier")).toBe("Premium");
    expect(text("adminbill-preview-plan")).toBe("Monthly");
    expect(text("adminbill-preview-status")).toBe("Active");
    expect(text("adminbill-preview-explain")).toMatch(/^Renews on /);
    expect([has("adminbill-preview-action-trial"), has("adminbill-preview-action-subscribe"), has("adminbill-preview-action-manage")]).toEqual([false, false, true]);
  });

  it("Cancellation scheduled: 'Active, set to cancel' with 'Cancels on …' (not 'Renews'), Manage only", () => {
    mount();
    pick("cancellationScheduled");
    expect(text("adminbill-preview-tier")).toBe("Premium");
    expect(text("adminbill-preview-plan")).toBe("Annual");
    expect(text("adminbill-preview-status")).toBe("Active, set to cancel");
    expect(text("adminbill-preview-explain")).toMatch(/^Cancels on .*It won't renew/);
    expect(text("adminbill-preview-explain")).not.toMatch(/Renews/);
    expect([has("adminbill-preview-action-subscribe"), has("adminbill-preview-action-manage")]).toEqual([false, true]);
  });

  it("Past due: the 7-day grace wording and Manage subscription (to fix the card), no Subscribe", () => {
    mount();
    pick("pastDue");
    expect(text("adminbill-preview-tier")).toBe("Premium");
    expect(text("adminbill-preview-status")).toMatch(/grace/i);
    expect(text("adminbill-preview-explain")).toMatch(/7-day grace period/);
    expect([has("adminbill-preview-action-subscribe"), has("adminbill-preview-action-manage")]).toEqual([false, true]);
  });

  it("Canceled subscription: back to Free, 'This subscription ended on …', Subscribe available, no Manage", () => {
    mount();
    pick("canceled");
    expect(text("adminbill-preview-tier")).toBe("Free");
    expect(text("adminbill-preview-status")).toBe("Canceled");
    expect(text("adminbill-preview-explain")).toMatch(/^This subscription ended on /);
    expect([has("adminbill-preview-action-subscribe"), has("adminbill-preview-action-manage")]).toEqual([true, false]);
  });

  it("shows the real pricing in every state: $5.99 per month and $49.99 per year, and the Free limits", () => {
    mount();
    for (const id of PREVIEW_IDS) {
      pick(id);
      const p = text("adminbill-preview-pricing")!;
      expect(p, id).toContain("$5.99");
      expect(p, id).toContain("$49.99");
      expect(p, id).toContain("Up to 3 active structured Goals");
    }
  });

  it("every state works in Spanish too, with the Spanish wording from the member screens", () => {
    mount("es");
    pick("cancellationScheduled");
    expect(text("adminbill-preview-status")).toBe("Activa, programada para cancelarse");
    expect(text("adminbill-preview-explain")).toMatch(/^Se cancela el .*No se renovará/);
    pick("pastDue");
    expect(text("adminbill-preview-explain")).toMatch(/periodo de gracia de 7 días/);
    pick("trialAvailable");
    expect(text("adminbill-preview-action-trial")).toBe("Iniciar prueba gratuita de 14 días");
    pick("canceled");
    expect(text("adminbill-preview-status")).toBe("Cancelada");
    for (const id of PREVIEW_IDS) {
      pick(id);
      expect(text("adminbill-preview-tier")).toMatch(/Gratis|Premium|Prueba/);
    }
  });
});

describe("the preview cannot do anything", () => {
  it("every action button, in every state, is disabled, has no handler, and says it is preview only", () => {
    mount();
    let seen = 0;
    for (const id of PREVIEW_IDS) {
      pick(id);
      for (const b of screen.getByTestId("adminbill-preview-actions").querySelectorAll("button")) {
        seen++;
        expect((b as HTMLButtonElement).disabled).toBe(true);
        expect(b.getAttribute("aria-disabled")).toBe("true");
        expect(b.getAttribute("title")).toBe("Preview only");
        expect(b.getAttribute("type")).toBe("button");
      }
    }
    expect(seen).toBe(8); // free 1, trial available 2, trial active 1, active 1, canceling 1, past due 1, canceled 1
  });

  it("clicking every action button, in every state, creates no Checkout session, starts no trial, opens no Customer Portal, navigates nowhere, calls no server and no database", () => {
    mount();
    for (const id of PREVIEW_IDS) {
      pick(id);
      for (const b of screen.getByTestId("adminbill-preview-actions").querySelectorAll("button")) {
        fireEvent.click(b);
        fireEvent.keyDown(b, { key: "Enter" });
      }
    }
    for (const [name, spy] of Object.entries(spies)) expect(spy, name).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("merely rendering and switching states makes no call of any kind either", () => {
    mount();
    for (const id of PREVIEW_IDS) pick(id);
    for (const [name, spy] of Object.entries(spies)) expect(spy, name).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("by construction: the preview components and their data import no sign-in client, Checkout, Customer Portal, navigation, trial or network code", () => {
    for (const f of [["components", "AdminSubscriptionPreview.tsx"], ["lib", "admin", "previewStates.ts"]]) {
      const code = readFileSync(join(process.cwd(), "src", ...f), "utf8");
      const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const bad of ["startCheckout", "startPortal", "navigate", "supabase/client", "supabase/db", "supabase/entitlements", "billing/stripe", "billing/checkout", "billing/portal", "next/navigation"]) expect(imports.filter((i) => i.includes(bad)), `${f.join("/")} imports ${bad}`).toEqual([]);
      expect(code).not.toMatch(/\bfetch\(|XMLHttpRequest|window\.location|router\./);
      if (f[1] === "AdminSubscriptionPreview.tsx") {
        expect(code.match(/onClick=/g)).toHaveLength(1); // the ONLY handler is the situation picker
        expect(code).toMatch(/onClick=\{\(\) => setSelected\(id\)\}/);
      }
    }
  });
});

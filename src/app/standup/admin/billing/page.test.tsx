import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const m = vi.hoisted(() => ({ isSys: vi.fn(), getSession: vi.fn(), overview: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/supabase/db", () => ({ isCurrentUserSysAdmin: m.isSys }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: m.getSession } } }));
vi.mock("@/lib/admin/getBillingOverview", () => ({ getBillingOverview: m.overview }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/components/AdminBillingMembers", () => ({ default: () => <div data-testid="stub-members" /> }));
vi.mock("@/components/AdminBillingOperations", () => ({ default: () => <div data-testid="stub-ops" /> }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import AdminBillingPage from "./page";

const DATA = {
  generatedAt: "2026-11-20T12:00:00.000Z",
  accounts: { total: 10, free: 6, trial: 1, premium: 3, trialAvailable: 4 },
  subscriptions: { active: 2, scheduledCancellation: 1, pastDue: 0, canceled: 1, other: 0, total: 4 },
  premiumSources: { manualGrants: 1, stripeSubscriptions: 3, both: 0 },
  flags: { premium_promotion_enabled: false, premium_trial_activation_enabled: false, billing_checkout_enabled: false },
};
const mount = async (lang: "en" | "es" = "en") => {
  if (lang === "es") localStorage.setItem("standup-language", "es");
  render(
    <LanguageProvider>
      <AdminBillingPage />
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.isSys.mockResolvedValue(true);
  m.getSession.mockResolvedValue({ data: { session: { access_token: "tok-abc" } } });
  m.overview.mockResolvedValue({ kind: "ok", data: DATA });
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("standup-language");
});

describe("who can see the page", () => {
  it("a System Admin, once the server agrees, sees the dashboard AND the preview", async () => {
    await mount();
    expect(screen.getByTestId("adminbill-dashboard")).toBeTruthy();
    expect(screen.getByTestId("adminbill-preview")).toBeTruthy();
    expect(screen.getByTestId("adminbill-accounts-total").textContent).toBe("10");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Premium & Billing");
    expect(m.overview).toHaveBeenCalledTimes(1);
    const deps = m.overview.mock.calls[0][0] as { getAccessToken(): Promise<string | null> };
    expect(await deps.getAccessToken()).toBe("tok-abc"); // only the member's own token is forwarded
  });

  it("a member who is not a System Admin sees only a 'System Admins only' message: no data is requested, and neither the dashboard nor the preview exists", async () => {
    m.isSys.mockResolvedValue(false);
    await mount();
    expect(screen.getByTestId("adminbill-denied").textContent).toContain("System Admins only");
    expect(m.overview).not.toHaveBeenCalled();
    expect(screen.queryByTestId("adminbill-dashboard")).toBeNull();
    expect(screen.queryByTestId("adminbill-preview")).toBeNull();
  });

  it("if the page's own check can't be made, it fails closed (denied, nothing requested)", async () => {
    m.isSys.mockRejectedValue(new Error("rpc down"));
    await mount();
    expect(screen.getByTestId("adminbill-denied")).toBeTruthy();
    expect(m.overview).not.toHaveBeenCalled();
  });

  it("the SERVER is the authority: if the page thinks the member is a System Admin but the endpoint says 403, the data and the preview stay hidden", async () => {
    m.overview.mockResolvedValue({ kind: "forbidden" });
    await mount();
    expect(screen.getByTestId("adminbill-denied")).toBeTruthy();
    expect(screen.queryByTestId("adminbill-dashboard")).toBeNull();
    expect(screen.queryByTestId("adminbill-preview")).toBeNull();
  });

  it("a signed-out visitor (the server says login) is sent to sign in and brought back here, seeing nothing meanwhile", async () => {
    m.overview.mockResolvedValue({ kind: "login" });
    await mount();
    expect(m.push).toHaveBeenCalledWith("/login?next=%2Fstandup%2Fadmin%2Fbilling");
    expect(screen.queryByTestId("adminbill-dashboard")).toBeNull();
    expect(screen.queryByTestId("adminbill-preview")).toBeNull();
  });

  it("a load failure shows a retry (no data, no preview) and retrying works", async () => {
    m.overview.mockResolvedValueOnce({ kind: "error" });
    await mount();
    expect(screen.getByTestId("adminbill-error")).toBeTruthy();
    expect(screen.queryByTestId("adminbill-preview")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("adminbill-retry"));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(screen.getByTestId("adminbill-dashboard")).toBeTruthy();
  });

  it("has a link back to Admin", async () => {
    await mount();
    expect(screen.getByRole("link", { name: /Back to Admin/ }).getAttribute("href")).toBe("/standup/admin");
  });

  it("is in Spanish", async () => {
    await mount("es");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Premium y facturación");
    expect(screen.getByText("Vista previa del miembro")).toBeTruthy();
    cleanup();
    m.isSys.mockResolvedValue(false);
    await mount("es");
    expect(screen.getByTestId("adminbill-denied").textContent).toContain("Solo Administradores del Sistema");
  });
});

describe("entry point and wiring", () => {
  it("the Admin page shows the Premium & Billing button only to System Admins", () => {
    const code = readFileSync(join(process.cwd(), "src", "app", "standup", "admin", "page.tsx"), "utf8");
    const i = code.indexOf('data-testid="admin-billing-link"');
    expect(i).toBeGreaterThan(-1);
    expect(code.slice(Math.max(0, i - 400), i)).toContain("{sysAdmin && (");
    expect(code).toContain('href="/standup/admin/billing"');
  });

  it("the page sends nothing but a read request: no write, no Stripe, no flag toggle anywhere in the page or its two components", () => {
    for (const f of [["app", "standup", "admin", "billing", "page.tsx"], ["components", "AdminBillingDashboard.tsx"], ["components", "AdminSubscriptionPreview.tsx"]]) {
      const code = readFileSync(join(process.cwd(), "src", ...f), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(code, f.join("/")).not.toMatch(/getStripe|from\s+["']stripe|billing\/stripe|startCheckout|startPortal|setFeatureFlag|toggle|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/i);
    }
  });
});

describe("translations", () => {
  it("every adminBill key exists in English and Spanish, differs between them, and keeps the same placeholders", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("adminBill.")) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThanOrEqual(55);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) {
      const s = (es as Record<string, string>)[k];
      expect(typeof s, k).toBe("string");
      if (k !== "adminBill.accounts.premium") expect(s, `${k} still English`).not.toBe(en[k]); // "Premium" is the same word in both languages
      expect(ph(s), k).toBe(ph(en[k]));
    }
    expect(en["adminBill.flags.allOff"]).toContain("All three flags are OFF");
  });
});

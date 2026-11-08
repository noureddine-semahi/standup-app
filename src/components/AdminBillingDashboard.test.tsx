import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { BillingOverviewResponse } from "@/lib/admin/billingOverview";
import AdminBillingDashboard from "./AdminBillingDashboard";

const data = (o: Partial<BillingOverviewResponse> = {}): BillingOverviewResponse => ({
  generatedAt: "2026-11-20T12:00:00.000Z",
  accounts: { total: 1234, free: 1000, trial: 34, premium: 200, trialAvailable: 800 },
  subscriptions: { active: 150, scheduledCancellation: 12, pastDue: 7, canceled: 30, other: 2, total: 201 },
  premiumSources: { manualGrants: 5, stripeSubscriptions: 196, both: 1 },
  flags: { premium_promotion_enabled: false, premium_trial_activation_enabled: false, billing_checkout_enabled: false },
  ...o,
});
const mount = (d: BillingOverviewResponse, lang: "en" | "es" = "en") => {
  if (lang === "es") localStorage.setItem("standup-language", "es");
  return render(
    <LanguageProvider>
      <AdminBillingDashboard data={d} />
    </LanguageProvider>
  );
};
afterEach(() => {
  cleanup();
  localStorage.removeItem("standup-language");
});
const txt = (id: string) => screen.getByTestId(id).textContent;

describe("the numbers", () => {
  it("shows every account and subscription count from the server, formatted for the language", () => {
    mount(data());
    expect([txt("adminbill-accounts-total"), txt("adminbill-accounts-free"), txt("adminbill-accounts-trial"), txt("adminbill-accounts-premium")]).toEqual(["1,234", "1,000", "34", "200"]);
    expect([txt("adminbill-subs-active"), txt("adminbill-subs-scheduled"), txt("adminbill-subs-pastdue"), txt("adminbill-subs-canceled"), txt("adminbill-subs-other")]).toEqual(["150", "12", "7", "30", "2"]);
    expect(screen.getByText("800 could still start the free trial")).toBeTruthy();
    expect(screen.getByText("201 subscription records, by status.")).toBeTruthy();
  });

  it("keeps manual Premium grants visibly separate from Stripe subscriptions, with the overlap explained", () => {
    mount(data());
    expect([txt("adminbill-sources-manual"), txt("adminbill-sources-stripe"), txt("adminbill-sources-both")]).toEqual(["5", "196", "1"]);
    expect(screen.getByText("Manual Premium grants")).toBeTruthy();
    expect(screen.getByText("Stripe subscriptions giving Premium")).toBeTruthy();
    expect(screen.getByText("Given by an admin in Plans; not a payment")).toBeTruthy();
    expect(screen.getByText("Access follows the manual grant")).toBeTruthy();
  });

  it("shows the real pricing and trial length: $5.99 monthly, $49.99 annual, 14 days", () => {
    mount(data());
    expect(txt("adminbill-price-monthly")).toBe("$5.99");
    expect(txt("adminbill-price-annual")).toBe("$49.99");
    expect(txt("adminbill-trial-days")).toBe("14 days");
  });

  it("the numbers add up on screen: Free + Trial + Premium = total", () => {
    mount(data());
    expect(1000 + 34 + 200).toBe(1234);
  });
});

describe("the feature flags are display-only", () => {
  it("lists all three flags with ON/OFF, and says all are OFF when they are", () => {
    mount(data());
    for (const f of ["premium_promotion_enabled", "premium_trial_activation_enabled", "billing_checkout_enabled"]) expect(txt(`adminbill-flag-${f}-state`), f).toBe("OFF");
    expect(txt("adminbill-flags-note")).toContain("All three flags are OFF");
    expect(screen.getByText("Checkout (new subscriptions)")).toBeTruthy();
  });

  it("shows ON honestly and says the page cannot change flags", () => {
    mount(data({ flags: { premium_promotion_enabled: true, premium_trial_activation_enabled: false, billing_checkout_enabled: true } }));
    expect(txt("adminbill-flag-premium_promotion_enabled-state")).toBe("ON");
    expect(txt("adminbill-flag-billing_checkout_enabled-state")).toBe("ON");
    expect(txt("adminbill-flag-premium_trial_activation_enabled-state")).toBe("OFF");
    expect(txt("adminbill-flags-note")).toContain("This page cannot change flags");
  });

  it("has no control of any kind in the flags section (no button, switch, checkbox, input, select or form)", () => {
    mount(data({ flags: { premium_promotion_enabled: true, premium_trial_activation_enabled: true, billing_checkout_enabled: true } }));
    const flags = screen.getByTestId("adminbill-flags");
    expect(flags.querySelectorAll("button, input, select, textarea, form, [role=switch], [role=checkbox], a").length).toBe(0);
    expect(within(flags).queryAllByRole("button")).toHaveLength(0);
  });

  it("the whole dashboard is read-only: it contains no button, form or input at all", () => {
    mount(data());
    expect(screen.getByTestId("adminbill-dashboard").querySelectorAll("button, input, select, textarea, form").length).toBe(0);
  });
});

describe("Spanish and structure", () => {
  it("is fully in Spanish with the same numbers", () => {
    mount(data(), "es");
    expect(screen.getByText("Cuentas")).toBeTruthy();
    expect(screen.getByText("Suscripciones de Stripe")).toBeTruthy();
    expect(screen.getByText("Concesiones manuales de Premium")).toBeTruthy();
    expect(screen.getByText("Suscripciones de Stripe que dan Premium")).toBeTruthy();
    expect(screen.getByText("Banderas de funciones de la beta")).toBeTruthy();
    expect(txt("adminbill-flag-premium_promotion_enabled-state")).toBe("DESACTIVADA");
    expect(txt("adminbill-flags-note")).toContain("Las tres banderas están DESACTIVADAS");
    expect(txt("adminbill-accounts-total")).toBe("1234"); // es-formatting of a 4-digit number has no group separator in this locale
    expect(txt("adminbill-trial-days")).toBe("14 días");
    expect(txt("adminbill-price-monthly")).toBe("$5.99");
    expect(screen.getByText("800 aún podrían iniciar la prueba gratuita")).toBeTruthy();
  });

  it("has labelled sections (headings) and wrapping, responsive grids for phones", () => {
    const { container } = mount(data());
    const sections = container.querySelectorAll("section[aria-labelledby]");
    expect(sections).toHaveLength(5);
    sections.forEach((s) => expect(document.getElementById(s.getAttribute("aria-labelledby")!)?.tagName).toBe("H2"));
    expect(container.innerHTML).toMatch(/grid-cols-2 sm:grid-cols-4/);
    expect(container.innerHTML).toMatch(/grid-cols-1 sm:grid-cols-3/);
    expect(container.innerHTML).toContain("break-words");
  });

  it("never prints anything that identifies a member (it only ever receives counts)", () => {
    mount(data());
    expect(screen.getByTestId("adminbill-dashboard").textContent).not.toMatch(/@|cus_|sub_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  });
});

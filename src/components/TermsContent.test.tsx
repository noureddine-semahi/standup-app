import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { FREE_LIMITS, PRICING, TRIAL_DAYS, formatPriceCents } from "@/lib/entitlements";
import { TERMS_SECTIONS, TERMS_VARS } from "@/lib/terms";
import TermsContent from "./TermsContent";

const mount = (lang: "en" | "es") => {
  if (lang === "es") localStorage.setItem("standup-language", "es");
  return render(
    <LanguageProvider>
      <TermsContent />
    </LanguageProvider>
  );
};
afterEach(() => {
  cleanup();
  localStorage.removeItem("standup-language");
});
const body = (lang: "en" | "es") => {
  mount(lang);
  return screen.getByTestId("terms-content").textContent!.replace(/\s+/g, " ");
};

describe("the Terms cover everything required (English)", () => {
  it("has all sixteen sections, in order, each with a numbered heading", () => {
    mount("en");
    const h2 = within(screen.getByTestId("terms-content")).getAllByRole("heading", { level: 2 });
    expect(h2).toHaveLength(TERMS_SECTIONS.length + 1); // + the contents heading
    expect(h2[0].textContent).toBe("Contents");
    TERMS_SECTIONS.forEach((s, i) => expect(h2[i + 1].textContent).toBe(`${i + 1}. ${en[s.title]}`));
    expect(TERMS_SECTIONS.map((s) => en[s.title])).toEqual([
      "Agreement and who we are", "Eligibility and your account", "Free and Premium", "Free trial", "Prices", "Automatic renewal and billing authorization", "Canceling your subscription",
      "Refunds and your consumer rights", "Deleting your account", "Payments and Stripe", "Your data and privacy", "Acceptable use", "Availability of the Service",
      "Changes to the Service, subscriptions and these Terms", "Your legal rights", "Contact and support",
    ]);
  });

  it("states the real numbers, taken from the same constants the app uses: $5.99 monthly, $49.99 annual, a 14-day trial, and the Free limits", () => {
    expect(TERMS_VARS.monthly).toBe(formatPriceCents(PRICING.monthly.amountCents));
    expect(TERMS_VARS.annual).toBe(formatPriceCents(PRICING.yearly.amountCents));
    expect(TERMS_VARS).toMatchObject({ monthly: "$5.99", annual: "$49.99", days: TRIAL_DAYS, goals: FREE_LIMITS.structuredGoals, routines: FREE_LIMITS.routines, notes: FREE_LIMITS.notes });
    const t = body("en");
    expect(t).toContain("$5.99 per month (Monthly) or $49.99 per year (Annual)");
    expect(t).toContain("one free Premium trial of 14 days");
    expect(t).toContain("up to 3 active structured Goals, 3 active routines and 10 saved notes");
    expect(t).not.toMatch(/\{(monthly|annual|days|goals|routines|notes|version|date)\}/); // every placeholder was filled
  });

  it("covers the trial, automatic renewal and billing authorization, cancellation in Settings, deletion with immediate cancellation, refunds and consumer rights, Stripe, data, use, availability, changes and contact", () => {
    const t = body("en");
    for (const must of [
      "No payment details are needed to start it, and it does not turn into a paid subscription by itself",
      "deleting your account does not reset it", "24 months",
      "Subscriptions renew automatically", "you authorize us, through Stripe, to charge your chosen payment method now and again at the start of each billing period", "until you cancel",
      "7-day grace period",
      "cancel at any time in Settings, under Premium, by choosing Manage subscription", "you keep Premium until the end of the period you already paid for, and you will not be charged again",
      "we cancel any active subscription immediately", "your Premium access ends with it", "your account is not deleted", "cannot be undone",
      "does not automatically refund a payment you have already made", "contact us through the Contact page and we will review your request",
      "Nothing in these Terms limits any rights you have under the consumer-protection laws that apply where you live",
      "Payments are processed by Stripe", "card details go to Stripe and never reach StandUp",
      "Privacy Policy", "Acceptable use", "Community Guidelines", "StandUp is in beta", "We may change our plans, prices or these Terms",
      "paid plans are not available yet", "Nothing charges you until you choose to subscribe",
    ]) expect(t, must).toContain(must);
  });

  it("makes no claim it cannot support: no legal review, no invented company, address, jurisdiction, email or guaranteed refund", () => {
    const t = body("en");
    expect(t).not.toMatch(/legally reviewed|reviewed by (our )?(lawyers?|counsel)|approved by/i);
    expect(t).not.toMatch(/governed by the laws? of|jurisdiction of|courts? of|arbitration|class action/i);
    expect(t).not.toMatch(/\b(Inc|LLC|Ltd|GmbH|S\.A\.|Corp)\b\.?/);
    expect(t).not.toMatch(/@|mailto:|\bwww\./);
    expect(t).not.toMatch(/full refund|money[- ]back|guarantee|no refunds?\b|non-?refundable|refunds? (are|is) not available/i);
    expect(t).not.toMatch(/\b\d{1,5} [A-Z][a-z]+ (Street|St|Avenue|Ave|Road|Rd)\b/);
  });
});

describe("the Spanish version says the same thing", () => {
  it("has the same sixteen sections in the same order", () => {
    mount("es");
    const h2 = within(screen.getByTestId("terms-content")).getAllByRole("heading", { level: 2 });
    expect(h2).toHaveLength(TERMS_SECTIONS.length + 1);
    expect(h2[0].textContent).toBe("Contenido");
    TERMS_SECTIONS.forEach((s, i) => expect(h2[i + 1].textContent).toBe(`${i + 1}. ${es[s.title]}`));
  });

  it("states the same numbers and commitments in Spanish", () => {
    const t = body("es");
    for (const must of [
      "$5.99 al mes (Mensual) o $49.99 al año (Anual)", "prueba gratuita de Premium de 14 días", "hasta 3 Objetivos estructurados activos, 3 rutinas activas y 10 notas guardadas",
      "No se necesitan datos de pago para comenzarla", "no se convierte sola en una suscripción de pago", "24 meses",
      "Las suscripciones se renuevan automáticamente", "nos autorizas, a través de Stripe, a cobrar tu método de pago elegido ahora y de nuevo al inicio de cada periodo de facturación", "hasta que canceles",
      "periodo de gracia de 7 días",
      "Puedes cancelar en cualquier momento en Ajustes, en Premium, eligiendo Gestionar suscripción", "conservas Premium hasta el final del periodo que ya pagaste y no se te volverá a cobrar",
      "cancelamos de inmediato cualquier suscripción activa", "tu acceso Premium termina con ella", "tu cuenta no se elimina", "no se puede deshacer",
      "No reembolsa automáticamente un pago que ya hiciste", "revisaremos tu solicitud",
      "Nada en estos Términos limita los derechos que tengas según las leyes de protección al consumidor",
      "Los pagos los procesa Stripe", "nunca llegan a StandUp", "Política de Privacidad", "Uso aceptable", "Normas de la Comunidad", "StandUp está en beta",
      "todavía no hay planes de pago disponibles", "Nada te cobra hasta que decidas suscribirte",
    ]) expect(t, must).toContain(must);
    expect(t).not.toMatch(/\{(monthly|annual|days|goals|routines|notes|version|date)\}/);
    expect(t).not.toMatch(/revisado por un abogado|garantizamos|reembolso garantizado|sin reembolsos?\b|no reembolsable/i);
    expect(t).not.toMatch(/@|mailto:|\bwww\./);
  });

  it("every terms key exists in both languages, with the same placeholders, links and numbers (a mechanical equivalence check)", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("terms.")) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThanOrEqual(60);
    const sig = (s: string) => (s.match(/\{\w+\}|\d+(?:\.\d+)?/g) ?? []).sort().join("|");
    for (const k of keys) {
      const e = en[k];
      const s = (es as Record<string, string>)[k];
      expect(typeof s, k).toBe("string");
      expect(s.length, k).toBeGreaterThan(0);
      expect(s, `${k} is still English`).not.toBe(e);
      expect(sig(s), `${k}: placeholders/links/numbers differ`).toBe(sig(e));
      expect(s.split(/\s+/).length, `${k}: very different length`).toBeGreaterThan(e.split(/\s+/).length * 0.6);
    }
    // the two languages have the same number of paragraphs per section by construction (one key list), and nothing in the list is missing in either
    for (const s of TERMS_SECTIONS) for (const k of [s.title, ...s.paragraphs]) expect([k in en, k in es], k).toEqual([true, true]);
    const used = new Set(TERMS_SECTIONS.flatMap((s) => [s.title, ...s.paragraphs]));
    const unused = keys.filter((k) => /^terms\.[a-z]+\.(title|p\d)$/.test(k) && !used.has(k));
    expect(unused).toEqual([]);
  });
});

describe("consistency with the rest of the app's billing text", () => {
  it("agrees with the FAQ, Privacy Policy and Settings on the grace period, the trial marker retention, immediate cancellation on deletion, and 'no automatic refund'", () => {
    for (const [d, lang] of [[en, "en"], [es, "es"]] as const) {
      const terms = Object.entries(d).filter(([k]) => k.startsWith("terms.")).map(([, v]) => v as string).join(" ");
      const other = ["faq.q34.answer", "faq.q38.answer", "privacy.billingBody", "privacy.yourControlBody", "settings.dangerZoneBody", "settings.dangerZoneNote"].map((k) => (d as Record<string, string>)[k]).join(" ");
      if (lang === "en") {
        for (const [a, b] of [[/7-day grace period/, /7-day grace period/], [/24 months/, /24 months/], [/canceled? immediately|cancel any (active )?subscription immediately|canceled immediately/i, /immediately/i], [/not automatically refund|do not automatically refund/i, /automatically refund|automatically refunds/i]] as const) {
          expect(terms).toMatch(a);
          expect(other).toMatch(b);
        }
        expect(terms).toMatch(/3 active structured Goals|\{goals\} active structured Goals/);
        expect(en["faq.q34.answer"]).toContain("3 active Goals, 3 active routines, 10 notes");
      } else {
        for (const [a, b] of [[/periodo de gracia de 7 días/, /periodo de gracia de 7 días/], [/24 meses/, /24 meses/], [/de inmediato/, /de inmediato/], [/no reembolsa|no reembolsamos/i, /no reembolsamos|reembolsa un pago automáticamente/i]] as const) {
          expect(terms).toMatch(a);
          expect(other).toMatch(b);
        }
      }
    }
  });

  it("prices and the trial length shown in the Terms are the ones the Subscribe button and plans use", () => {
    const plans = readFileSync(join(process.cwd(), "src", "components", "PremiumPlans.tsx"), "utf8");
    expect(plans).toContain("PRICING.monthly.amountCents");
    expect(plans).toContain("PRICING.yearly.amountCents");
    expect(PRICING.monthly.amountCents).toBe(599);
    expect(PRICING.yearly.amountCents).toBe(4999);
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe("structure and accessibility", () => {
  it("has a labelled contents navigation whose every link points to a real section, plus a back-to-contents link in each section", () => {
    mount("en");
    const nav = screen.getByRole("navigation", { name: "Contents" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(TERMS_SECTIONS.length);
    const ids = new Set<string>();
    for (const s of TERMS_SECTIONS) {
      const section = document.getElementById(s.id)!;
      expect(section, s.id).toBeTruthy();
      expect(section.tagName).toBe("SECTION");
      expect(section.getAttribute("aria-labelledby")).toBe(`${s.id}-title`);
      expect(document.getElementById(`${s.id}-title`)?.tagName).toBe("H2");
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
    links.forEach((a, i) => {
      expect(a.getAttribute("href")).toBe(`#${TERMS_SECTIONS[i].id}`);
      expect(a.textContent!.trim().length).toBeGreaterThan(3);
    });
    const back = screen.getAllByRole("link", { name: "Back to contents" });
    expect(back).toHaveLength(TERMS_SECTIONS.length);
    back.forEach((a) => expect(document.getElementById(a.getAttribute("href")!.slice(1))).toBeTruthy());
  });

  it("every link inside the Terms has readable text and goes to a page that exists (Privacy, Contact, Settings)", () => {
    mount("en");
    const external = [...document.querySelectorAll("a")].filter((a) => !a.getAttribute("href")!.startsWith("#"));
    expect(external.length).toBeGreaterThan(8);
    for (const a of external) {
      expect(["/privacy", "/contact", "/standup/settings"], a.outerHTML).toContain(a.getAttribute("href"));
      expect(a.textContent!.trim().length).toBeGreaterThan(2);
      expect(a.getAttribute("target")).toBeNull(); // same-tab navigation, nothing that opens unexpected windows
    }
    expect(new Set(external.map((a) => a.getAttribute("href")))).toEqual(new Set(["/privacy", "/contact", "/standup/settings"]));
  });

  it("is built for narrow screens: wrapping text, no fixed widths, comfortable tap targets for the contents links", () => {
    const src = readFileSync(join(process.cwd(), "src", "components", "TermsContent.tsx"), "utf8");
    expect(src).toContain("break-words");
    expect(src).not.toMatch(/\bw-\[|\bmin-w-|whitespace-nowrap|overflow-x/);
    expect(src).toMatch(/inline-block py-0\.5/); // the contents links get vertical padding
    const page = readFileSync(join(process.cwd(), "src", "app", "terms", "page.tsx"), "utf8");
    expect(page).toContain("max-w-3xl mx-auto px-4");
    expect(page).toContain("text-4xl sm:text-5xl"); // the title shrinks on phones
  });
});

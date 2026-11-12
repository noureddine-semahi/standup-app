import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const flagsApi = vi.hoisted(() => ({ getFeatureFlags: vi.fn() }));
vi.mock("@/lib/supabase/featureFlags", () => flagsApi);
vi.mock("@/lib/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import AboutPage from "@/app/about/page";
import FAQPage from "@/app/faq/page";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
const mount = async (ui: React.ReactElement, lang: "en" | "es") => {
  localStorage.setItem("standup-language", lang);
  render(<LanguageProvider>{ui}</LanguageProvider>);
  await settle();
};
const text = () => document.body.textContent!.replace(/\s+/g, " ");

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  flagsApi.getFeatureFlags.mockReset();
  flagsApi.getFeatureFlags.mockResolvedValue({ premium_promotion_enabled: false, premium_trial_activation_enabled: false, billing_checkout_enabled: false });
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("standup-language");
  vi.unstubAllGlobals();
});

describe("About: an active beta, and what is in the app today", () => {
  it("says it is an active beta with no paid subscriptions, and lists Backlog, Routines, Lists, Notes, Calendar, Progress & Insights and Finances (English)", async () => {
    await mount(<AboutPage />, "en");
    const notice = screen.getByTestId("about-beta-notice");
    expect(notice.textContent).toContain("active beta");
    expect(notice.textContent).toContain("Paid subscriptions are not available yet");
    const tools = screen.getByTestId("about-tools").textContent!;
    for (const s of ["Backlog & Long-Term Goals", "Routines", "Lists & Notes", "Calendar", "Progress & Insights", "Finances", "doesn't connect to your bank or cards", "not financial, tax or legal advice"]) expect(tools, s).toContain(s);
  });
  it("says the same in Spanish", async () => {
    await mount(<AboutPage />, "es");
    expect(screen.getByTestId("about-beta-notice").textContent).toContain("beta activa");
    const tools = screen.getByTestId("about-tools").textContent!;
    for (const s of ["Backlog", "Rutinas", "Listas y notas", "Calendario", "Progreso y Perspectivas", "Finanzas", "no se conecta a tu banco ni a tus tarjetas", "no asesoría financiera, fiscal ni legal"]) expect(tools, s).toContain(s);
  });
});

describe("FAQ: beta answers are always shown, with no Premium messaging while promotion is off", () => {
  it("covers Routines, Notes, Finances, email verification, subscriptions not enabled, and age (English)", async () => {
    await mount(<FAQPage />, "en");
    const t = text();
    for (const q of ["What are Routines?", "What are Notes?", "What can I do in Finances?", "Do I need to confirm my email address?", "Are paid subscriptions available?", "Who can use StandUp?"]) expect(t, q).toContain(q);
    expect(t).toContain("Email verification is temporarily turned off during the beta");
    expect(t).toContain("Public subscriptions are not enabled");
    expect(t).toContain("intended for people aged 18 or older");
    expect(t).toContain("signup doesn't check your age");
    expect(t).toContain("one tab on the Tools page, alongside Goals, Routines, Lists and Notes");
    expect(t).toContain("Bills, Payments and Subscriptions tabs");
    expect(t).not.toMatch(/six tabs on the Tools page|Long-Term, Recurring, Lists, and Payments/);
    expect(t).not.toMatch(/grace period/i);
  });
  it("covers the same in Spanish", async () => {
    await mount(<FAQPage />, "es");
    const t = text();
    for (const q of ["¿Qué son las Rutinas?", "¿Qué son las Notas?", "¿Qué puedo hacer en Finanzas?", "¿Necesito confirmar mi correo electrónico?", "¿Hay suscripciones de pago disponibles?", "¿Quién puede usar StandUp?"]) expect(t, q).toContain(q);
    expect(t).toContain("verificación del correo está desactivada temporalmente durante la beta");
    expect(t).toContain("Las suscripciones públicas no están habilitadas");
    expect(t).toContain("no comprueba tu edad");
  });
  it("the Assistant answer discloses that requests go to a third-party AI provider", () => {
    expect(en["faq.q12.answer"]).toContain("Google's Gemini");
    expect(es["faq.q12.answer"]).toContain("Gemini de Google");
  });
});

describe("Privacy Policy: finance, providers, sign-in, age and deletion are described without unsupported promises", () => {
  it("English", async () => {
    await mount(<PrivacyPolicyContent />, "en");
    const t = text();
    expect(screen.getByTestId("privacy-finance").textContent).toContain("does not connect to your bank or card accounts and never asks for card or account numbers");
    expect(screen.getByTestId("privacy-providers").textContent).toContain("Google's Gemini");
    for (const p of ["Supabase", "Vercel", "Stripe"]) expect(screen.getByTestId("privacy-providers").textContent).toContain(p);
    expect(screen.getByTestId("privacy-auth").textContent).toContain("does not require you to confirm your email address");
    expect(screen.getByTestId("privacy-auth").textContent).toContain("no online service can guarantee perfect security");
    expect(screen.getByTestId("privacy-age").textContent).toContain("intended for people aged 18 or older");
    expect(screen.getByTestId("privacy-age").textContent).toContain("signup does not check your age");
    expect(t).toContain("one-way coded marker derived from your email address");
    expect(t).toContain("used only to decline a second free trial");
    expect(t).toContain("routine backups or logs for a period we don't control");
    expect(t).toContain("paid subscriptions are not available to the public yet");
    // no unsupported promises
    expect(t).not.toMatch(/age (is )?(verified|enforced)|we verify your age|unhackable|100% secure|completely secure|immediately and permanently erased|deleted from all (systems|backups)/i);
  });
  it("Spanish", async () => {
    await mount(<PrivacyPolicyContent />, "es");
    expect(screen.getByTestId("privacy-finance").textContent).toContain("no se conecta a tus cuentas bancarias ni de tarjeta");
    expect(screen.getByTestId("privacy-providers").textContent).toContain("Gemini de Google");
    expect(screen.getByTestId("privacy-auth").textContent).toContain("no exige confirmar tu correo electrónico");
    expect(screen.getByTestId("privacy-age").textContent).toContain("el registro no comprueba tu edad");
    expect(text()).toContain("copias de seguridad o registros de rutina");
  });
});

describe("EN/ES consistency for the new beta copy", () => {
  it("every new key exists in both languages with the same placeholders", () => {
    const keys = Object.keys(en).filter((k) => /^(about\.(betaNotice|tool)|faq\.q(39|4[0-4])\.|privacy\.(finance|providers|auth|age))/.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(30);
    for (const k of keys) {
      expect((es as Record<string, string>)[k], k).toBeTruthy();
      const ph = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join();
      expect(ph((es as Record<string, string>)[k]), k).toBe(ph((en as Record<string, string>)[k]));
    }
  });
});

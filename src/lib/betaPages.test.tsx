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

describe("About: Finances in depth, and Free versus Premium", () => {
  it("keeps the philosophy, vision, story, how-it-works and existing feature descriptions", async () => {
    await mount(<AboutPage />, "en");
    const t = text();
    for (const s of ["Our Philosophy", "Our Vision", "The Story", "How It Works", "Full Calendar History", "Growing Together", "Smart Rescheduling", "What's in StandUp today"]) expect(t, s).toContain(s);
  });

  it("explains the Finances features and states the beta limits plainly (English)", async () => {
    await mount(<AboutPage />, "en");
    const f = screen.getByTestId("about-finances").textContent!.replace(/\s+/g, " ");
    for (const s of ["Financial Planner", "Bills", "Personal subscriptions", "Payments & balances", "Recording payments", "Due dates become goals", "outstanding balance, the minimum payment and the due day", "estimates", "they are not StandUp Premium"]) expect(f, s).toContain(s);
    // behaviours verified in the code, described as they really work
    expect(f).toContain("a reminder goal is created for you when its reminder window starts");
    expect(f).toContain("confirm the amount you actually paid");
    expect(f).toContain("tap-to-add suggestions in Plan Tomorrow; they are never added automatically");
    expect(f).toContain("can be reversed, never silently deleted");
    expect(f).toContain("a setting on each account decides whether a recorded payment also reduces its tracked balance");
    const beta = screen.getByTestId("about-finance-beta").textContent!;
    expect(beta).toContain("still in beta");
    expect(beta).toContain("doesn't connect to your bank or cards");
    expect(beta).toContain("not by a background job");
    // nothing here claims what the app does not do
    expect(f).not.toMatch(/(?<!n't )connects? to your bank|automatically (pays|deducts|updates your bank)|bank (sync|feed)/i);
  });

  it("says the same in Spanish", async () => {
    await mount(<AboutPage />, "es");
    const f = screen.getByTestId("about-finances").textContent!.replace(/\s+/g, " ");
    for (const s of ["Plan financiero", "Facturas", "Suscripciones personales", "Pagos y saldos", "Registrar pagos", "Los vencimientos se vuelven objetivos", "no son StandUp Premium", "nunca se añaden automáticamente", "nunca se borra en silencio"]) expect(f, s).toContain(s);
    expect(screen.getByTestId("about-finance-beta").textContent).toContain("sigue en beta");
  });

  it("explains Free and Premium, separates tracked subscriptions from Premium, says public subscriptions are disabled, and offers no purchase (English)", async () => {
    await mount(<AboutPage />, "en");
    const section = screen.getByTestId("about-premium");
    const p = section.textContent!.replace(/\s+/g, " ");
    expect(p).toContain("StandUp has a Free plan and a planned Premium plan");
    expect(p).toContain("up to 3 active structured Goals, 3 active routines and 10 saved notes");
    expect(p).toContain("StandUp's own subscription");
    expect(p).toContain("The personal subscriptions you track in Finances are a different feature");
    expect(p).toContain("Public paid subscriptions are currently disabled");
    expect(p).toContain("nothing to buy yet");
    // no active purchase option: no button, no link, no price
    expect(section.querySelectorAll("button, a, input").length).toBe(0);
    expect(p).not.toMatch(/\$\s?\d|per month|per year|subscribe now|upgrade|buy now/i);
  });

  it("says the same in Spanish, with no purchase option", async () => {
    await mount(<AboutPage />, "es");
    const section = screen.getByTestId("about-premium");
    const p = section.textContent!.replace(/\s+/g, " ");
    expect(p).toContain("plan Gratis y un plan Premium planeado");
    expect(p).toContain("hasta 3 Objetivos estructurados activos, 3 rutinas activas y 10 notas guardadas");
    expect(p).toContain("La suscripción propia de StandUp");
    expect(p).toContain("son otra función");
    expect(p).toContain("suscripciones públicas de pago están desactivadas");
    expect(section.querySelectorAll("button, a, input").length).toBe(0);
    expect(p).not.toMatch(/\$\s?\d|al mes|al año|suscríbete|mejora tu plan/i);
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
    const keys = Object.keys(en).filter((k) => /^(about\.(betaNotice|tool|finance|premium)|faq\.q(39|4[0-4])\.|privacy\.(finance|providers|auth|age))/.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(30);
    for (const k of keys) {
      expect((es as Record<string, string>)[k], k).toBeTruthy();
      const ph = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join();
      expect(ph((es as Record<string, string>)[k]), k).toBe(ph((en as Record<string, string>)[k]));
    }
  });
});

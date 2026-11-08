import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { CURRENT_TERMS, TERMS_EFFECTIVE_DATE, TERMS_VERSION, termsStatusLine } from "@/lib/terms";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import TermsPage from "./page";

beforeEach(() => vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem("standup-language");
});
const mount = (lang: "en" | "es" = "en") => {
  if (lang === "es") localStorage.setItem("standup-language", "es");
  return render(
    <LanguageProvider>
      <TermsPage />
    </LanguageProvider>
  );
};

describe("the /terms page", () => {
  it("exists as a public page (outside /standup, so no sign-in is required) with a default export", () => {
    expect(existsSync(join(process.cwd(), "src", "app", "terms", "page.tsx"))).toBe(true);
    expect(typeof TermsPage).toBe("function");
  });

  it("has exactly one h1 (the title), shows the version and that it is a draft, and says plainly that no lawyer has reviewed it", () => {
    mount("en");
    const h1 = screen.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toBe("Terms of Service");
    expect(screen.getByTestId("terms-status").textContent).toBe(`Version ${TERMS_VERSION} · Draft, not yet in effect`);
    const note = screen.getByTestId("terms-draft-notice");
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toContain("have not been reviewed by a lawyer");
    expect(note.textContent).toContain("do not take effect until an effective date is published");
    expect(note.textContent).toContain("free during the beta");
  });

  it("is the same in Spanish", () => {
    mount("es");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Términos de Servicio");
    expect(screen.getByTestId("terms-status").textContent).toBe(`Versión ${TERMS_VERSION} · Borrador, aún no en vigor`);
    expect(screen.getByTestId("terms-draft-notice").textContent).toContain("No han sido revisados por un abogado");
    expect(screen.getByTestId("terms-draft-notice").textContent).toContain("no entran en vigor hasta que se publique una fecha de entrada en vigor");
  });

  it("does not nest a second <main> (the app layout already provides one) and keeps the heading order h1 -> h2", () => {
    mount("en");
    expect(document.querySelectorAll("main")).toHaveLength(0);
    const levels = [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1)).toBe(true);
    expect(levels.slice(1).every((l) => l === 2)).toBe(true);
  });

  it("links to the Privacy Policy and the Contact page at the bottom", () => {
    mount("en");
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/privacy");
    expect(hrefs).toContain("/contact");
  });
});

describe("version and effective date", () => {
  const fmt = (iso: string) => new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
  const t = (k: keyof typeof en, v?: Record<string, string | number>) => en[k].replace(/\{(\w+)\}/g, (m, n) => (v && n in v ? String(v[n]) : m));

  it("ships as a draft: no effective date is set until the owner publishes one", () => {
    expect(TERMS_EFFECTIVE_DATE).toBeNull();
    expect(CURRENT_TERMS).toEqual({ version: TERMS_VERSION, effectiveDate: null });
    expect(TERMS_VERSION).toMatch(/^\d+\.\d+$/);
  });

  it("with an effective date the status line shows the version and the date, in either language", () => {
    expect(termsStatusLine({ version: "1.0", effectiveDate: "2027-01-15" }, fmt, t)).toBe("Version 1.0 · Effective January 15, 2027");
    const fmtEs = (iso: string) => new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
    const tEs = (k: keyof typeof es, v?: Record<string, string | number>) => es[k].replace(/\{(\w+)\}/g, (m, n) => (v && n in v ? String(v[n]) : m));
    expect(termsStatusLine({ version: "1.0", effectiveDate: "2027-01-15" }, fmtEs, tEs)).toBe("Versión 1.0 · En vigor desde el 15 de enero de 2027");
  });

  it("anything that isn't a plain ISO date is treated as 'not yet in effect' (a typo can never publish the Terms)", () => {
    for (const d of [null, "", "January 15, 2027", "2027-1-5", "15/01/2027", "2027-01-15T00:00:00Z"]) expect(termsStatusLine({ version: "1.0", effectiveDate: d }, fmt, t), String(d)).toBe("Version 1.0 · Draft, not yet in effect");
  });
});

describe("once published: the draft notice goes away and the date appears", () => {
  it("(page rendered with a published date)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/terms", async (orig) => ({ ...(await orig<typeof import("@/lib/terms")>()), CURRENT_TERMS: { version: "1.0", effectiveDate: "2027-01-15" } }));
    const { default: Published } = await import("./page");
    const { LanguageProvider: LP } = await import("@/lib/i18n/LanguageProvider");
    render(
      <LP>
        <Published />
      </LP>
    );
    expect(screen.getByTestId("terms-status").textContent).toBe("Version 1.0 · Effective January 15, 2027");
    expect(screen.queryByTestId("terms-draft-notice")).toBeNull();
    vi.doUnmock("@/lib/terms");
    vi.resetModules();
  });
});

describe("the file that holds the owner's open decisions", () => {
  it("exists, and lists the things the Terms deliberately do not state", () => {
    const doc = readFileSync(join(process.cwd(), "docs", "terms-owner-decisions.md"), "utf8");
    for (const must of ["Operator identity", "Governing law", "Refund policy", "Taxes", "Minimum age", "has not been reviewed by a lawyer", "TERMS_EFFECTIVE_DATE", "legal review"]) expect(doc.toLowerCase(), must).toContain(must.toLowerCase());
  });
});

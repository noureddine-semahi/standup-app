import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

// The Tools page used to end with "← Plan Tomorrow" / "Dashboard →" buttons under every tab. The main navigation already
// goes to both places, so the row was removed for good; this keeps it from quietly coming back.
const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("Tools page bottom navigation", () => {
  it("renders no Plan Tomorrow / Dashboard link row", () => {
    expect(source).not.toContain("bottom-nav-btn");
    expect(source).not.toContain('href="/standup/tomorrow"');
    expect(source).not.toContain('href="/standup/dashboard"');
    expect(source).not.toContain("planTomorrowArrow");
    expect(source).not.toMatch(/from "next\/link"/);
  });
  it("drops the now-unused string in both languages (the other Plan Tomorrow strings stay)", () => {
    expect("backlog.planTomorrowArrow" in en).toBe(false);
    expect("backlog.planTomorrowArrow" in es).toBe(false);
    expect("nav.dashboard" in en).toBe(true);
    expect("today.planTomorrowArrow" in en).toBe(true);
  });
});

describe("Tools / Finances split", () => {
  const finances = readFileSync(join(__dirname, "..", "finances", "page.tsx"), "utf8");
  const header = readFileSync(join(__dirname, "..", "..", "..", "components", "Header.tsx"), "utf8");
  const dashboard = readFileSync(join(__dirname, "..", "dashboard", "page.tsx"), "utf8");

  it("Tools keeps only the productivity tabs", () => {
    for (const k of ["payments", "planner", "calculator", "salary"]) expect(source).not.toContain(`key: "${k}"`);
    for (const k of ["goals", "backlog", "routines", "lists", "notes"]) expect(source).toContain(`key: "${k}"`);
    // Long-Term and Recurring are no longer tabs of their own
    for (const k of ["longTerm", "recurring"]) expect(source).not.toContain(`key: "${k}"`);
    // final order: Goals | Backlog | Routines | Lists
    const order = [...source.matchAll(/{ key: "(goals|backlog|routines|lists|notes)", headingKey/g)].map((m) => m[1]);
    expect(order).toEqual(["goals", "backlog", "routines", "lists", "notes"]);
    expect(source).not.toContain("FinancesHub");
    expect(source).not.toContain("PlannerHome");
  });
  it("Finances hosts Overview, Bills, Payments, Subscriptions, Planner and Calculators", () => {
    for (const k of ["overview", "bills", "payments", "subscriptions", "planner", "calculators"]) expect(finances).toContain(`key: "${k}"`);
    expect(finances).toContain("PlannerHome");
    expect(finances).toContain("CalculatorTool");
    expect(finances).toContain("SalaryCalculatorTool");
  });
  it("Finances is the eighth header destination right after Tools (also in the menu), and the Dashboard links to it", () => {
    const hrefs = [...header.matchAll(/\{ href: "(\/standup\/[a-z]+)", labelKey: "nav\./g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/standup/dashboard", "/standup/social", "/standup/today", "/standup/tomorrow", "/standup/calendar", "/standup/history", "/standup/tools", "/standup/finances"]);
    expect(header).toContain('{ href: "/standup/finances", labelKey: "nav.finances", icon: Wallet, color: "#fbbf24" }');
    expect(header).not.toContain("FINANCES_NAV_ITEM"); // one list feeds the tab row and the menu, so it appears once in each
    expect(dashboard).toContain('href="/standup/finances"');
  });
  it("an old remembered Finances tab on Tools is redirected, not lost", () => {
    expect(source).toContain("FINANCE_TAB_REDIRECT");
    expect(source).toContain("/standup/finances?");
  });
});

describe("Goals + Long-Term and Recurring -> Routines", () => {
  const panel = readFileSync(join(__dirname, "..", "..", "..", "components", "GoalsManagementPanel.tsx"), "utf8");
  it("Goals offers Long-Term as a third view next to My Goals and Assigned, and Tools passes the existing screen in", () => {
    expect(panel).toContain(`"myGoals" | "assigned" | "longTerm"`);
    expect(panel).toContain("goals-view-longterm");
    expect(source).toContain("<GoalsManagementPanel longTermView={longTermView}");
    // the Long-Term screen keeps its own handlers: it can still add, push and delete long-term goals
    for (const fn of ["handleAddLongTerm", "handlePushLongTerm", "handleDeleteLongTerm"]) expect(source).toContain(fn);
  });
  it("shows the tab as Routines in both languages while the recurrence logic keeps its names", () => {
    expect(en["backlog.tabRecurring"]).toBe("Routines");
    expect(es["backlog.tabRecurring"]).toBe("Rutinas");
    expect(en["backlog.recurringTitle"]).toBe("Routines");
    expect(es["backlog.recurringTitle"]).toBe("Rutinas");
    expect(en["goalType.recurring.chip"]).toBeTruthy(); // the Recurring goal TYPE is unchanged
  });
});

describe("Tools page heading", () => {
  it("names the active section instead of a generic 'Tools' (every tab has its own heading, in both languages)", () => {
    expect(source).not.toContain('{t("nav.tools")}</h1>');
    expect(source).toContain("headingKey");
    const expected = { Goals: ["My Goals", "Mis Objetivos"], Backlog: ["My Backlog", "Mi Backlog"], Routines: ["My Routines", "Mis Rutinas"], Lists: ["My Lists", "Mis Listas"], Notes: ["My Notes", "Mis Notas"] };
    for (const [k, [enText, esText]] of Object.entries(expected)) {
      expect(source).toContain(`"tools.heading${k}"`);
      expect((en as Record<string, string>)[`tools.heading${k}`]).toBe(enText);
      expect((es as Record<string, string>)[`tools.heading${k}`]).toBe(esText);
    }
  });
  it("the Tools tab bar opts in to the fit-to-label active tab", () => {
    expect(source).toContain("folder-tabbar-tools tools-bar-fit");
  });
});

describe("Goals view switch on narrow phones", () => {
  const panelSrc = readFileSync(join(__dirname, "..", "..", "..", "components", "GoalsManagementPanel.tsx"), "utf8");
  it("the two longer labels have short forms (full labels everywhere else), and the row wraps rather than clipping", () => {
    expect(panelSrc).toContain("goals-view-full");
    expect(panelSrc).toContain("goals-view-short");
    expect(panelSrc).toContain("goals-view-row");
    expect(en["tools.goalsViewMyGoalsShort"]).toBe("Goals");
    expect(es["tools.goalsViewMyGoalsShort"]).toBe("Objetivos");
    expect(en["tools.goalsViewLongTermShort"]).toBe("Long-Term");
    expect(es["tools.goalsViewLongTermShort"]).toBe("Largo");
    // the full labels are untouched
    expect(en["tools.goalsViewMyGoals"]).toBe("My Goals");
    expect(es["tools.goalsViewMyGoals"]).toBe("Mis Objetivos");
    expect(es["backlog.tabLongTerm"]).toBe("Largo Plazo");
  });
});

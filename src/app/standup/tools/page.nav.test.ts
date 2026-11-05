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
    for (const k of ["goals", "backlog", "routines", "lists"]) expect(source).toContain(`key: "${k}"`);
    // Long-Term and Recurring are no longer tabs of their own
    for (const k of ["longTerm", "recurring"]) expect(source).not.toContain(`key: "${k}"`);
    // final order: Goals | Backlog | Routines | Lists
    const order = [...source.matchAll(/{ key: "(goals|backlog|routines|lists)", labelKey/g)].map((m) => m[1]);
    expect(order).toEqual(["goals", "backlog", "routines", "lists"]);
    expect(source).not.toContain("FinancesHub");
    expect(source).not.toContain("PlannerHome");
  });
  it("Finances hosts Overview, Bills, Payments, Subscriptions, Planner and Calculators", () => {
    for (const k of ["overview", "bills", "payments", "subscriptions", "planner", "calculators"]) expect(finances).toContain(`key: "${k}"`);
    expect(finances).toContain("PlannerHome");
    expect(finances).toContain("CalculatorTool");
    expect(finances).toContain("SalaryCalculatorTool");
  });
  it("the menu and the Dashboard link to Finances, and the hanging header row gains no icon", () => {
    expect(header).toContain('href: "/standup/finances"');
    expect(header).toContain("[...NAV_TABS, FINANCES_NAV_ITEM]");
    expect(header.match(/href: "\/standup\/[a-z]+", labelKey: "nav\./g)?.length).toBe(7); // NAV_TABS stays at its 7 destinations
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

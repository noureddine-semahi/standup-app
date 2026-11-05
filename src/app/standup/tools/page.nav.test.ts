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
    for (const k of ["goals", "backlog", "longTerm", "recurring", "lists"]) expect(source).toContain(`key: "${k}"`);
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

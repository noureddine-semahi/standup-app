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

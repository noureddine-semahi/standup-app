import { describe, it, expect } from "vitest";
import { matchesGoalFilters, isGoalQuickAddOn } from "./GoalsManagementPanel";

// Pure-function tests only, same style as db.test.ts -- no React render/
// browser harness needed, matching this phase's own "don't build a large
// testing harness solely for this" instruction.

describe("matchesGoalFilters (Tools -> Goals Phase 2: primary/secondary filters)", () => {
  const active = { status: "active" as const, goal_type: "one_time" as const };
  const completed = { status: "completed" as const, goal_type: "target" as const };
  const abandoned = { status: "abandoned" as const, goal_type: "recurring" as const };

  it("\"all\"/\"all\" matches every status and type", () => {
    expect(matchesGoalFilters(active, "all", "all")).toBe(true);
    expect(matchesGoalFilters(completed, "all", "all")).toBe(true);
    expect(matchesGoalFilters(abandoned, "all", "all")).toBe(true);
  });

  it("status filter: Active only matches status === \"active\"", () => {
    expect(matchesGoalFilters(active, "active", "all")).toBe(true);
    expect(matchesGoalFilters(completed, "active", "all")).toBe(false);
    expect(matchesGoalFilters(abandoned, "active", "all")).toBe(false);
  });

  it("status filter: Completed only matches status === \"completed\"", () => {
    expect(matchesGoalFilters(completed, "completed", "all")).toBe(true);
    expect(matchesGoalFilters(active, "completed", "all")).toBe(false);
  });

  it("status filter: Archived maps to status === \"abandoned\" (presentation wording only, no new status)", () => {
    expect(matchesGoalFilters(abandoned, "abandoned", "all")).toBe(true);
    expect(matchesGoalFilters(active, "abandoned", "all")).toBe(false);
  });

  it("type filter narrows within a status filter (both must match)", () => {
    expect(matchesGoalFilters(active, "active", "one_time")).toBe(true);
    expect(matchesGoalFilters(active, "active", "target")).toBe(false);
  });

  it("type filter alone (status \"all\") matches only the given goal_type", () => {
    expect(matchesGoalFilters(completed, "all", "target")).toBe(true);
    expect(matchesGoalFilters(completed, "all", "recurring")).toBe(false);
  });
});

describe("isGoalQuickAddOn (Tools -> Goals Phase 2: row-level Quick Add indicator)", () => {
  it("a default (not hidden) Goal reads as On", () => {
    expect(isGoalQuickAddOn({ hidden_from_quick_add: false })).toBe(true);
  });

  it("a hidden Goal reads as Off", () => {
    expect(isGoalQuickAddOn({ hidden_from_quick_add: true })).toBe(false);
  });
});

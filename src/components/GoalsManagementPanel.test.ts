import { describe, it, expect } from "vitest";
import { matchesGoalFilters, isGoalQuickAddOn, matchesGoalSearch, isGoalReadyToComplete } from "./GoalsManagementPanel";

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

describe("matchesGoalSearch (Tools -> Goals Phase 2B: client-side title search)", () => {
  it("is case-insensitive", () => {
    expect(matchesGoalSearch({ title: "Find a New Job" }, "JOB")).toBe(true);
    expect(matchesGoalSearch({ title: "Find a New Job" }, "job")).toBe(true);
  });

  it("matches a partial title substring", () => {
    expect(matchesGoalSearch({ title: "Find a New Job" }, "new")).toBe(true);
  });

  it("returns false when the title doesn't contain the search text", () => {
    expect(matchesGoalSearch({ title: "Find a New Job" }, "vacation")).toBe(false);
  });

  it("a whitespace-only search behaves exactly like no search (matches everything)", () => {
    expect(matchesGoalSearch({ title: "Find a New Job" }, "   ")).toBe(true);
    expect(matchesGoalSearch({ title: "" }, "   ")).toBe(true);
  });

  it("an empty search matches everything", () => {
    expect(matchesGoalSearch({ title: "Anything" }, "")).toBe(true);
  });

  it("combines correctly with matchesGoalFilters -- search \"job\" + Active + Target shows only active Target Goals titled with \"job\"", () => {
    type TestGoal = { status: "active" | "completed"; goal_type: "one_time" | "target"; title: string };
    const activeTargetJob: TestGoal = { status: "active", goal_type: "target", title: "Land a new job" };
    const activeTargetOther: TestGoal = { status: "active", goal_type: "target", title: "Save for a trip" };
    const activeOneTimeJob: TestGoal = { status: "active", goal_type: "one_time", title: "Apply for jobs" };
    const completedTargetJob: TestGoal = { status: "completed", goal_type: "target", title: "Got the job" };

    function shows(goal: TestGoal) {
      return matchesGoalFilters(goal, "active", "target") && matchesGoalSearch(goal, "job");
    }

    expect(shows(activeTargetJob)).toBe(true);
    expect(shows(activeTargetOther)).toBe(false); // right status/type, search doesn't match
    expect(shows(activeOneTimeJob)).toBe(false); // search matches, wrong type
    expect(shows(completedTargetJob)).toBe(false); // search+type match, wrong status
  });
});

describe("isGoalReadyToComplete (Tools -> Goals Phase 2B: informational-only indicator)", () => {
  it("an active one-time Goal with every conceptual Task completed is ready", () => {
    const goal = { status: "active" as const, goal_type: "one_time" as const };
    const tasks = [{ lifecycle: "completed" as const }, { lifecycle: "completed" as const }];
    expect(isGoalReadyToComplete(goal, tasks)).toBe(true);
  });

  it("zero conceptual Tasks is never ready", () => {
    const goal = { status: "active" as const, goal_type: "one_time" as const };
    expect(isGoalReadyToComplete(goal, [])).toBe(false);
  });

  it("one still-active (not completed) Task is not ready", () => {
    const goal = { status: "active" as const, goal_type: "one_time" as const };
    const tasks = [{ lifecycle: "completed" as const }, { lifecycle: "active" as const }];
    expect(isGoalReadyToComplete(goal, tasks)).toBe(false);
  });

  it("a canceled Task prevents readiness (canceled is never treated as completed)", () => {
    const goal = { status: "active" as const, goal_type: "one_time" as const };
    const tasks = [{ lifecycle: "completed" as const }, { lifecycle: "canceled" as const }];
    expect(isGoalReadyToComplete(goal, tasks)).toBe(false);
  });

  it("a broken Task prevents readiness (broken is never treated as completed)", () => {
    const goal = { status: "active" as const, goal_type: "one_time" as const };
    const tasks = [{ lifecycle: "completed" as const }, { lifecycle: "broken" as const }];
    expect(isGoalReadyToComplete(goal, tasks)).toBe(false);
  });

  it("an ongoing Goal is never ready, even with every Task completed", () => {
    const goal = { status: "active" as const, goal_type: "ongoing" as const };
    expect(isGoalReadyToComplete(goal, [{ lifecycle: "completed" as const }])).toBe(false);
  });

  it("a recurring Goal is never ready, even with every Task completed", () => {
    const goal = { status: "active" as const, goal_type: "recurring" as const };
    expect(isGoalReadyToComplete(goal, [{ lifecycle: "completed" as const }])).toBe(false);
  });

  it("a target Goal is never ready, even with every Task completed", () => {
    const goal = { status: "active" as const, goal_type: "target" as const };
    expect(isGoalReadyToComplete(goal, [{ lifecycle: "completed" as const }])).toBe(false);
  });

  it("an already-completed Goal is never ready", () => {
    const goal = { status: "completed" as const, goal_type: "one_time" as const };
    expect(isGoalReadyToComplete(goal, [{ lifecycle: "completed" as const }])).toBe(false);
  });

  it("an abandoned Goal is never ready", () => {
    const goal = { status: "abandoned" as const, goal_type: "one_time" as const };
    expect(isGoalReadyToComplete(goal, [{ lifecycle: "completed" as const }])).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { activeGoalCount, goalLimitReached, isGoalLimitError } from "./goalLimit";
import { FREE_LIMITS, canCreate, resolveTier } from "./entitlements";

const goals = (active: number, completed = 0, abandoned = 0) => [
  ...Array.from({ length: active }, () => ({ status: "active" })),
  ...Array.from({ length: completed }, () => ({ status: "completed" })),
  ...Array.from({ length: abandoned }, () => ({ status: "abandoned" })),
];

describe("activeGoalCount", () => {
  it("counts only active Goals; completed and archived (abandoned) ones never count", () => {
    expect(activeGoalCount([])).toBe(0);
    expect(activeGoalCount(goals(2, 5, 4))).toBe(2);
    expect(activeGoalCount(goals(0, 9, 9))).toBe(0);
  });
});

describe("goalLimitReached (the client's read of the Free cap of 3 active Goals)", () => {
  it("is below the cap at 0, 1 and 2 active Goals and at the cap from 3", () => {
    expect([0, 1, 2].map((n) => goalLimitReached("free", goals(n)))).toEqual([false, false, false]);
    expect(goalLimitReached("free", goals(3))).toBe(true);
    expect(FREE_LIMITS.structuredGoals).toBe(3);
  });
  it("completed and archived Goals do not push a Free account to the cap", () => {
    expect(goalLimitReached("free", goals(2, 30, 30))).toBe(false);
    expect(goalLimitReached("free", goals(3, 30, 30))).toBe(true);
  });
  it("Premium and an active Premium Trial are never at the cap", () => {
    for (const tier of ["premium", "premium_trial"] as const) expect(goalLimitReached(tier, goals(40))).toBe(false);
  });
  it("says nothing until the tier is known (the database still enforces it)", () => {
    expect(goalLimitReached(null, goals(10))).toBe(false);
  });
  it("a refusal from the database always counts as at the limit", () => {
    expect(goalLimitReached("premium", goals(0), true)).toBe(true);
  });
});

describe("downgrade behavior: nothing is removed, only increases are blocked", () => {
  const tier = resolveTier({ trialStartedAt: "2026-10-01T00:00:00Z" }, Date.parse("2026-11-20T00:00:00Z")); // expired trial
  it("an expired trial resolves to Free", () => {
    expect(tier).toBe("free");
  });
  it("with 6 active Goals it is over the cap: creating or reactivating is blocked and no Goal is touched", () => {
    const list = goals(6, 3, 2);
    expect(goalLimitReached(tier, list)).toBe(true);
    expect(canCreate(tier, "structuredGoals", activeGoalCount(list))).toBe(false);
    expect(list).toHaveLength(11);
    expect(activeGoalCount(list)).toBe(6);
  });
  it("completing or archiving one (6 -> 5 -> 4 -> 3) does not unblock until the count is under 3", () => {
    for (const active of [5, 4, 3]) expect(canCreate(tier, "structuredGoals", active)).toBe(false);
    expect(canCreate(tier, "structuredGoals", 2)).toBe(true);
  });
  it("reactivating a completed or archived Goal counts as adding an active Goal", () => {
    // 3 active + 1 completed: reactivating the completed one would make 4 active, so it is the same decision as creating one
    const before = activeGoalCount(goals(3, 1));
    expect(canCreate("free", "structuredGoals", before)).toBe(false);
    expect(canCreate("free", "structuredGoals", activeGoalCount(goals(2, 2)))).toBe(true);
  });
});

describe("isGoalLimitError", () => {
  it("recognises the database's GOAL_LIMIT_REACHED refusal", () => {
    expect(isGoalLimitError({ code: "53400", message: "GOAL_LIMIT_REACHED" })).toBe(true);
    expect(isGoalLimitError(new Error("GOAL_LIMIT_REACHED"))).toBe(true);
  });
  it("does not mistake other failures, including the notes or routines limit or an authorization error, for it", () => {
    expect(isGoalLimitError({ code: "53400", message: "NOTE_LIMIT_REACHED" })).toBe(false);
    expect(isGoalLimitError({ code: "53400", message: "ROUTINE_LIMIT_REACHED" })).toBe(false);
    expect(isGoalLimitError({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(isGoalLimitError(null)).toBe(false);
  });
});

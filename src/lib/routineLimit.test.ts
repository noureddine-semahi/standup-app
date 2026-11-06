import { describe, it, expect } from "vitest";
import { activeRoutineCount, isRoutineLimitError, routineLimitReached } from "./routineLimit";
import { FREE_LIMITS, canCreate, resolveTier } from "./entitlements";

const routines = (active: number, inactive = 0) => [...Array.from({ length: active }, () => ({ active: true })), ...Array.from({ length: inactive }, () => ({ active: false }))];

describe("activeRoutineCount", () => {
  it("counts only active routines; retired ones never count", () => {
    expect(activeRoutineCount([])).toBe(0);
    expect(activeRoutineCount(routines(2, 7))).toBe(2);
    expect(activeRoutineCount(routines(0, 10))).toBe(0);
  });
});

describe("routineLimitReached (the client's read of the Free cap of 3 active routines)", () => {
  it("is below the cap at 0, 1 and 2 active routines and at the cap from 3", () => {
    expect([0, 1, 2].map((n) => routineLimitReached("free", routines(n)))).toEqual([false, false, false]);
    expect(routineLimitReached("free", routines(3))).toBe(true);
    expect(FREE_LIMITS.routines).toBe(3);
  });
  it("retired routines do not push a Free account to the cap", () => {
    expect(routineLimitReached("free", routines(2, 20))).toBe(false);
    expect(routineLimitReached("free", routines(3, 20))).toBe(true);
  });
  it("Premium and an active Premium Trial are never at the cap", () => {
    for (const tier of ["premium", "premium_trial"] as const) {
      expect(routineLimitReached(tier, routines(40))).toBe(false);
    }
  });
  it("says nothing until the tier is known (the database still enforces it)", () => {
    expect(routineLimitReached(null, routines(10))).toBe(false);
  });
  it("a refusal from the database always counts as at the limit", () => {
    expect(routineLimitReached("premium", routines(0), true)).toBe(true);
  });
});

describe("downgrade behavior: nothing is removed, only increases are blocked", () => {
  // An account that had 6 active routines on Premium falls back to Free. These are the client's view of what the database allows.
  const downgraded = () => resolveTier({ premium: false, trialStartedAt: "2026-10-01T00:00:00Z" }, Date.parse("2026-11-20T00:00:00Z"));
  it("an expired trial resolves to Free, so the cap applies again", () => {
    expect(downgraded()).toBe("free");
  });
  it("with 6 active routines it is over the cap: creating or reactivating is blocked, and nothing is touched", () => {
    const tier = downgraded();
    const list = routines(6, 2);
    expect(routineLimitReached(tier, list)).toBe(true);
    expect(canCreate(tier, "routines", activeRoutineCount(list))).toBe(false);
    expect(list).toHaveLength(8); // every routine, active or retired, is still there
    expect(activeRoutineCount(list)).toBe(6); // none was deactivated
  });
  it("retiring one (6 -> 5, then 4, then 3) does not unblock until the count is under 3", () => {
    const tier = downgraded();
    for (const active of [5, 4, 3]) expect(canCreate(tier, "routines", active)).toBe(false);
    expect(canCreate(tier, "routines", 2)).toBe(true);
  });
  it("editing or retiring never needs a slot: only the count decides create/reactivate", () => {
    // the cap is a function of the ACTIVE count alone, so a rename or a retire (which cannot raise it) has nothing to check
    expect(activeRoutineCount(routines(6))).toBe(6);
    expect(activeRoutineCount(routines(5))).toBe(5);
  });
});

describe("isRoutineLimitError", () => {
  it("recognises the database's ROUTINE_LIMIT_REACHED refusal", () => {
    expect(isRoutineLimitError({ code: "53400", message: "ROUTINE_LIMIT_REACHED" })).toBe(true);
    expect(isRoutineLimitError({ message: "ROUTINE_LIMIT_REACHED" })).toBe(true);
  });
  it("does not mistake other failures, including the notes limit or an authorization error, for it", () => {
    expect(isRoutineLimitError({ code: "53400", message: "NOTE_LIMIT_REACHED" })).toBe(false);
    expect(isRoutineLimitError({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(isRoutineLimitError({ code: "08006", message: "connection lost" })).toBe(false);
    expect(isRoutineLimitError(null)).toBe(false);
  });
});

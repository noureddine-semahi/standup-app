import { describe, it, expect } from "vitest";
import {
  toISODate,
  addDays,
  computeStreak,
  computeClosurePoints,
  computeLongestStreak,
  formatDateDisplay,
  formatTimeOfDay,
  walkMaterializedChain,
  filterUnresolvedDescendants,
  collapseGoalLineages,
} from "./db";
import { getLevelInfo } from "@/lib/levels";

describe("toISODate", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("pads single-digit months and days", () => {
    expect(toISODate(new Date(2026, 2, 7))).toBe("2026-03-07");
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    const result = addDays(new Date(2026, 0, 1), 5);
    expect(toISODate(result)).toBe("2026-01-06");
  });

  it("subtracts with negative days", () => {
    const result = addDays(new Date(2026, 0, 10), -3);
    expect(toISODate(result)).toBe("2026-01-07");
  });

  it("does not mutate the input date", () => {
    const original = new Date(2026, 0, 1);
    addDays(original, 5);
    expect(toISODate(original)).toBe("2026-01-01");
  });
});

describe("formatDateDisplay", () => {
  it("converts YYYY-MM-DD to MM/DD/YYYY", () => {
    expect(formatDateDisplay("2026-08-06")).toBe("08/06/2026");
  });

  it("does not shift the date near a timezone boundary (pure string, no Date parsing)", () => {
    expect(formatDateDisplay("2026-01-01")).toBe("01/01/2026");
  });

  it("returns the input unchanged if it isn't a well-formed ISO date", () => {
    expect(formatDateDisplay("")).toBe("");
    expect(formatDateDisplay("2026-08")).toBe("2026-08");
  });
});

describe("formatTimeOfDay", () => {
  it("converts a 24h HH:MM to 12h with AM/PM", () => {
    expect(formatTimeOfDay("07:30")).toBe("7:30 AM");
    expect(formatTimeOfDay("15:05")).toBe("3:05 PM");
  });

  it("handles midnight and noon", () => {
    expect(formatTimeOfDay("00:00")).toBe("12:00 AM");
    expect(formatTimeOfDay("12:00")).toBe("12:00 PM");
  });

  it("ignores seconds if present (Postgres' time type comes back as HH:MM:SS)", () => {
    expect(formatTimeOfDay("09:15:00")).toBe("9:15 AM");
  });

  it("returns the input unchanged if it isn't well-formed", () => {
    expect(formatTimeOfDay("")).toBe("");
    expect(formatTimeOfDay("not-a-time")).toBe("not-a-time");
  });
});

describe("computeStreak", () => {
  it("returns 0 when nothing is closed", () => {
    expect(computeStreak(new Set(), "2026-01-10")).toBe(0);
  });

  it("counts today if today is closed", () => {
    const dates = new Set(["2026-01-10"]);
    expect(computeStreak(dates, "2026-01-10")).toBe(1);
  });

  it("counts consecutive closed days ending yesterday when today is not yet closed", () => {
    const dates = new Set(["2026-01-07", "2026-01-08", "2026-01-09"]);
    expect(computeStreak(dates, "2026-01-10")).toBe(3);
  });

  it("stops at the first gap", () => {
    const dates = new Set(["2026-01-05", "2026-01-08", "2026-01-09"]);
    expect(computeStreak(dates, "2026-01-10")).toBe(2);
  });

  it("counts today plus a consecutive run before it", () => {
    const dates = new Set(["2026-01-08", "2026-01-09", "2026-01-10"]);
    expect(computeStreak(dates, "2026-01-10")).toBe(3);
  });
});

describe("computeClosurePoints", () => {
  it("gives the base amount at a broken/zero streak — never zero", () => {
    expect(computeClosurePoints(0)).toBe(5);
  });

  it("adds one point per streak day", () => {
    expect(computeClosurePoints(1)).toBe(6);
    expect(computeClosurePoints(3)).toBe(8);
    expect(computeClosurePoints(5)).toBe(10);
  });

  it("caps the bonus at +10", () => {
    expect(computeClosurePoints(10)).toBe(15);
    expect(computeClosurePoints(20)).toBe(15);
    expect(computeClosurePoints(400)).toBe(15);
  });

  it("treats a negative streak as zero rather than subtracting", () => {
    expect(computeClosurePoints(-5)).toBe(5);
  });
});

describe("computeLongestStreak", () => {
  it("returns 0 for an empty list", () => {
    expect(computeLongestStreak([])).toBe(0);
  });

  it("returns 1 for a single date", () => {
    expect(computeLongestStreak(["2026-01-05"])).toBe(1);
  });

  it("finds the longest run of consecutive dates, not just the last one", () => {
    // 3-day run (1-3), gap, then a shorter 2-day run (7-8)
    expect(
      computeLongestStreak(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-07", "2026-01-08"])
    ).toBe(3);
  });

  it("ignores order and duplicates in the input", () => {
    expect(computeLongestStreak(["2026-01-03", "2026-01-01", "2026-01-02", "2026-01-02"])).toBe(3);
  });

  it("stays at the longest run even after a streak breaks and a shorter one follows", () => {
    expect(computeLongestStreak(["2026-01-01", "2026-01-02", "2026-01-10"])).toBe(2);
  });
});

describe("getLevelInfo", () => {
  it("starts at level 1 (Starter) with 0 points", () => {
    const info = getLevelInfo(0);
    expect(info.level).toBe(1);
    expect(info.nameKey).toBe("level.starter");
    expect(info.progressPct).toBe(0);
  });

  it("advances to the next level exactly at its point threshold", () => {
    const info = getLevelInfo(50);
    expect(info.level).toBe(2);
    expect(info.nameKey).toBe("level.committed");
  });

  it("computes points-to-next and progress within the current level", () => {
    const info = getLevelInfo(100); // Committed spans 50-149
    expect(info.pointsToNext).toBe(50);
    expect(info.progressPct).toBe(50);
  });

  it("caps at the max level with no next threshold", () => {
    const info = getLevelInfo(999999);
    expect(info.nextLevelPoints).toBeNull();
    expect(info.pointsToNext).toBeNull();
    expect(info.progressPct).toBe(100);
  });
});

describe("walkMaterializedChain", () => {
  // Real ids confirmed via the live-data P1 regression trace: 8732b169
  // ("Paint the hubcaps", 09-28, postponed) was rescheduled forward and
  // materialized onto 4528697c (09-29, not_started), which was never
  // itself rescheduled further.
  const SOURCE = "8732b169-dabb-4a47-9d72-ecb395951e4d";
  const CONTINUATION = "4528697c-3d7e-4a05-b52a-df0fb52829a9";

  it("returns the single continuation for a one-hop chain (confirmed regression case)", () => {
    const rows = [
      { from_goal_id: SOURCE, materialized_goal_id: CONTINUATION },
    ];
    expect(walkMaterializedChain(rows, SOURCE)).toEqual([CONTINUATION]);
  });

  it("returns an empty array when the source was never rescheduled", () => {
    expect(walkMaterializedChain([], SOURCE)).toEqual([]);
  });

  it("returns an empty array when the source's only continuation has no further reschedule", () => {
    const rows = [{ from_goal_id: SOURCE, materialized_goal_id: CONTINUATION }];
    expect(walkMaterializedChain(rows, CONTINUATION)).toEqual([]);
  });

  it("walks a multi-hop chain A -> B -> C -> D in order", () => {
    const rows = [
      { from_goal_id: "A", materialized_goal_id: "B" },
      { from_goal_id: "B", materialized_goal_id: "C" },
      { from_goal_id: "C", materialized_goal_id: "D" },
    ];
    expect(walkMaterializedChain(rows, "A")).toEqual(["B", "C", "D"]);
  });

  it("ignores rows for unrelated goals", () => {
    const rows = [
      { from_goal_id: SOURCE, materialized_goal_id: CONTINUATION },
      { from_goal_id: "unrelated-1", materialized_goal_id: "unrelated-2" },
    ];
    expect(walkMaterializedChain(rows, SOURCE)).toEqual([CONTINUATION]);
  });

  it("does not infinite-loop on a cycle (defensive guard)", () => {
    const rows = [
      { from_goal_id: "A", materialized_goal_id: "B" },
      { from_goal_id: "B", materialized_goal_id: "A" }, // malformed/impossible in practice
    ];
    expect(walkMaterializedChain(rows, "A")).toEqual(["B"]);
  });

  it("when a from_goal_id has multiple materialized rows, the most recently materialized one wins", () => {
    // Caller is expected to pass rows already sorted by materialized_at
    // ascending -- later entries in the array override earlier ones for
    // the same from_goal_id, matching an "order by materialized_at desc
    // limit 1" per-hop query.
    const rows = [
      { from_goal_id: "A", materialized_goal_id: "B-stale" },
      { from_goal_id: "A", materialized_goal_id: "B-latest" },
    ];
    expect(walkMaterializedChain(rows, "A")).toEqual(["B-latest"]);
  });

  it("ignores rows with a null materialized_goal_id", () => {
    const rows = [{ from_goal_id: "A", materialized_goal_id: null }];
    expect(walkMaterializedChain(rows, "A")).toEqual([]);
  });
});

describe("filterUnresolvedDescendants", () => {
  it("keeps not_started/in_progress/blocked/postponed descendants", () => {
    const descendants = [
      { id: "1", status: "not_started" },
      { id: "2", status: "in_progress" },
      { id: "3", status: "blocked" },
      { id: "4", status: "postponed" },
    ];
    expect(filterUnresolvedDescendants(descendants)).toEqual(descendants);
  });

  it("excludes already-completed descendants (idempotency: a real user decision survives)", () => {
    const descendants = [
      { id: "1", status: "not_started" },
      { id: "2", status: "completed" },
    ];
    expect(filterUnresolvedDescendants(descendants)).toEqual([
      { id: "1", status: "not_started" },
    ]);
  });

  it("excludes already-canceled descendants (idempotency: re-running finds nothing left to do)", () => {
    const descendants = [{ id: "1", status: "canceled" }];
    expect(filterUnresolvedDescendants(descendants)).toEqual([]);
  });

  it("returns an empty array when every descendant is already resolved", () => {
    const descendants = [
      { id: "1", status: "completed" },
      { id: "2", status: "canceled" },
    ];
    expect(filterUnresolvedDescendants(descendants)).toEqual([]);
  });
});

describe("collapseGoalLineages", () => {
  function edge(from: string, to: string | null) {
    return { from_goal_id: from, materialized_goal_id: to };
  }

  it("a Task with no reschedule lineage stands alone as its own conceptual Task", () => {
    const A = { id: "A", status: "not_started" };
    const tasks = collapseGoalLineages([A], []);
    expect(tasks).toEqual([{ terminal: A, chain: [A] }]);
  });

  it("A -> B where the continuation is still unresolved collapses to 1 Task, terminal = B", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "not_started" };
    const tasks = collapseGoalLineages([A, B], [edge("A", "B")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].terminal).toBe(B);
    expect(tasks[0].chain).toEqual([A, B]);
  });

  it("A -> B where B is Completed collapses to 1 Task reported Completed (A never fakes completion)", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "completed" };
    const tasks = collapseGoalLineages([A, B], [edge("A", "B")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].terminal.status).toBe("completed");
    expect(tasks[0].terminal).toBe(B);
  });

  it("A -> B -> C (multi-hop) where C is Completed collapses all 3 physical rows to 1 Task", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "postponed" };
    const C = { id: "C", status: "completed" };
    const tasks = collapseGoalLineages([A, B, C], [edge("A", "B"), edge("B", "C")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].terminal).toBe(C);
    expect(tasks[0].chain).toEqual([A, B, C]);
  });

  it("a canceled terminal collapses the Task to Canceled, not Completed or unresolved", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "canceled" };
    const tasks = collapseGoalLineages([A, B], [edge("A", "B")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].terminal.status).toBe("canceled");
  });

  it("multiple independent Tasks under the same Goal stay separate — one rescheduled chain plus two standalone Tasks", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "completed" };
    const D = { id: "D", status: "not_started" };
    const E = { id: "E", status: "completed" };
    const tasks = collapseGoalLineages([A, B, D, E], [edge("A", "B")]);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.terminal.id).sort()).toEqual(["B", "D", "E"]);
  });

  it("the House tasks regression: Wash the dishes (rescheduled, completed) + 2 standalone Tasks reports 3 conceptual Tasks, 3 completed — not 4/3", () => {
    const washOriginal = { id: "wash-1", status: "not_started" };
    const washContinuation = { id: "wash-2", status: "completed" };
    const cleanLivingRoom = { id: "clean-1", status: "completed" };
    const cutGrass = { id: "grass-1", status: "completed" };
    const tasks = collapseGoalLineages(
      [washOriginal, washContinuation, cleanLivingRoom, cutGrass],
      [edge("wash-1", "wash-2")]
    );
    expect(tasks).toHaveLength(3); // not 4 — the dead original row doesn't inflate the count
    const completed = tasks.filter((t) => t.terminal.status === "completed");
    expect(completed).toHaveLength(3); // Wash the dishes (via its continuation), Clean living room, Cut grass
  });

  it("ignores an edge with a null materialized_goal_id (unmaterialized reschedule intent) without crashing", () => {
    const A = { id: "A", status: "postponed" };
    const tasks = collapseGoalLineages([A], [edge("A", null)]);
    expect(tasks).toEqual([{ terminal: A, chain: [A] }]);
  });

  it("ignores an edge pointing outside the given set (dangling/unfetched target) — the source stands alone, nothing crashes", () => {
    const A = { id: "A", status: "postponed" };
    const tasks = collapseGoalLineages([A], [edge("A", "not-in-this-set")]);
    expect(tasks).toEqual([{ terminal: A, chain: [A] }]);
  });

  it("ignores an edge entirely unrelated to the given goals, leaving them untouched", () => {
    const A = { id: "A", status: "not_started" };
    const B = { id: "B", status: "completed" };
    const tasks = collapseGoalLineages([A, B], [edge("other-1", "other-2")]);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.terminal.id).sort()).toEqual(["A", "B"]);
  });

  it("a malformed duplicate edge (two different sources both claiming the same target) assigns the target once — no duplication, no drop", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "postponed" };
    const X = { id: "X", status: "completed" };
    const tasks = collapseGoalLineages([A, B, X], [edge("A", "X"), edge("B", "X")]);
    expect(tasks).toHaveLength(2); // X collapsed into exactly one chain, B stands alone
    const allTerminalIds = tasks.map((t) => t.terminal.id);
    expect(allTerminalIds.filter((id) => id === "X")).toHaveLength(1); // X appears exactly once across all chains
    const allRowIds = tasks.flatMap((t) => t.chain.map((g) => g.id));
    expect(allRowIds.sort()).toEqual(["A", "B", "X"]); // every input row is represented exactly once
  });
});

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
  resolveLineageOwners,
  findOrphanedContinuationIds,
  findGoalDeleteBlockReason,
  GoalDeleteBlockedError,
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

  // A confirmed materialization (materialized: true) whose target is
  // gone -- ON DELETE SET NULL already fired. Distinct from edge(from,
  // null), which represents an unmaterialized reschedule INTENT
  // (materialized: false implied) -- a normal, non-broken, transient
  // state, not lost history.
  function brokenEdge(from: string) {
    return { from_goal_id: from, materialized_goal_id: null, materialized: true };
  }

  it("a Task with no reschedule lineage stands alone as its own conceptual Task", () => {
    const A = { id: "A", status: "not_started" };
    const tasks = collapseGoalLineages([A], []);
    expect(tasks).toEqual([{ terminal: A, chain: [A], lifecycle: "active" }]);
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

  it("ignores an edge with a null materialized_goal_id (unmaterialized reschedule intent) without crashing — NOT broken, just not yet materialized", () => {
    const A = { id: "A", status: "postponed" };
    const tasks = collapseGoalLineages([A], [edge("A", null)]);
    expect(tasks).toEqual([{ terminal: A, chain: [A], lifecycle: "active" }]);
  });

  it("ignores an edge pointing outside the given set (dangling/unfetched target) — the source stands alone, nothing crashes, NOT reported broken (fetch-scope, not deletion, is the far more common cause -- see the function's own doc comment)", () => {
    const A = { id: "A", status: "postponed" };
    const tasks = collapseGoalLineages([A], [edge("A", "not-in-this-set")]);
    expect(tasks).toEqual([{ terminal: A, chain: [A], lifecycle: "active" }]);
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

  it("an earlier Completed row in the chain wins over a later auto-canceled continuation (the confirmed live Get healthy / Child test 3 regression: A completed -> B auto-canceled)", () => {
    // Real ids from the confirmed live controlled reproduction: A
    // (c8c06038, "Child test 3" 10/07) was rescheduled to 10/08,
    // materializing B (128aed6b, same title). A was later marked Completed
    // directly, which correctly triggered cancelOrphanedReschedules and
    // canceled B (confirmed live: A status=completed, B status=canceled).
    // The orphaned-continuation cancel is cleanup, not an independent
    // resolution -- it must never outrank A's real completion.
    const A = { id: "c8c06038-740c-4242-8969-a2dbc93ecf1c", status: "completed" };
    const B = { id: "128aed6b-4cd1-408a-a813-4769d5d1367a", status: "canceled" };
    const tasks = collapseGoalLineages([A, B], [edge(A.id, B.id)]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].terminal).toBe(A); // not B, despite B being the chain's last node
    expect(tasks[0].terminal.status).toBe("completed");
    expect(tasks[0].chain).toEqual([A, B]); // history/chain membership is untouched
  });

  it("a Completed row anywhere in a 3-hop chain wins, regardless of position", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "completed" }; // completed in the MIDDLE of the chain
    const C = { id: "C", status: "canceled" }; // later auto-canceled, same as above
    const tasks = collapseGoalLineages([A, B, C], [edge("A", "B"), edge("B", "C")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].terminal).toBe(B);
    expect(tasks[0].terminal.status).toBe("completed");
  });

  it("end-to-end: Review Today's / Dashboard's Goal aggregation counts the confirmed live regression lineage once, as Completed (3/3, not 3/4 or 2/3)", () => {
    const A = { id: "c8c06038-740c-4242-8969-a2dbc93ecf1c", status: "completed" };
    const B = { id: "128aed6b-4cd1-408a-a813-4769d5d1367a", status: "canceled" };
    const child1 = { id: "child-1", status: "completed" };
    const child2 = { id: "child-2", status: "completed" };
    const goals = [child1, child2, A, B];
    const edges = [{ from_goal_id: A.id, materialized_goal_id: B.id }];

    const conceptualTasks = collapseGoalLineages(goals, edges);
    expect(conceptualTasks).toHaveLength(3); // not 4 -- A and B collapse into one conceptual Task

    // Every consumer (Dashboard, Review Today) reads `.terminal` directly --
    // no separate per-consumer "which row represents this Task" logic needed.
    const total = conceptualTasks.length;
    const completed = conceptualTasks.filter((t) => t.terminal.status === "completed").length;
    expect(total).toBe(3);
    expect(completed).toBe(3); // Child 3's conceptual Task reports Completed via A, not Canceled via B
  });

  // Broken-lineage detection (the Share-1 / "Test sharing goal" regression):
  // a recorded materialized reschedule whose target no longer exists must
  // never silently resolve to the stale predecessor as if it were a normal
  // current Task.
  it("A -> B, B exists = normal active lineage, terminal B", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "not_started" };
    const tasks = collapseGoalLineages([A, B], [edge("A", "B")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].lifecycle).toBe("active");
    expect(tasks[0].terminal).toBe(B);
  });

  it("A -> B, B completed = completed terminal Task", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "completed" };
    const tasks = collapseGoalLineages([A, B], [edge("A", "B")]);
    expect(tasks[0].lifecycle).toBe("completed");
  });

  it("A -> B, B canceled = canceled terminal Task", () => {
    const A = { id: "A", status: "postponed" };
    const B = { id: "B", status: "canceled" };
    const tasks = collapseGoalLineages([A, B], [edge("A", "B")]);
    expect(tasks[0].lifecycle).toBe("canceled");
  });

  it("A has no reschedule = normal standalone Task, lifecycle active, never broken", () => {
    const A = { id: "A", status: "not_started" };
    const tasks = collapseGoalLineages([A], []);
    expect(tasks[0].lifecycle).toBe("active");
  });

  it("A -> missing B (materialized:true, materialized_goal_id now null) = broken lineage, terminal is the stale predecessor A, never resurrected as active/pending", () => {
    const A = { id: "A", status: "postponed" };
    const tasks = collapseGoalLineages([A], [brokenEdge("A")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].lifecycle).toBe("broken");
    expect(tasks[0].terminal).toBe(A); // the stale predecessor -- history, not fabricated
    expect(tasks[0].terminal.status).toBe("postponed"); // its own real status, untouched
  });

  it("the exact live Share-1 shape: A rescheduled+assigned, its materialization dangling — broken, not 'Rescheduled'/pending", () => {
    // Real id from the confirmed live investigation: the owner's original
    // "Share 1" row under "Test sharing goal", status postponed, whose
    // materialized continuation was later hard-deleted (ON DELETE SET
    // NULL already fired on the edge).
    const A = { id: "495476a5-ea49-4c29-b500-30a09fab5ef2", status: "postponed" };
    const tasks = collapseGoalLineages([A], [brokenEdge(A.id)]);
    expect(tasks[0].lifecycle).toBe("broken");
    expect(tasks[0].lifecycle).not.toBe("active"); // must never read as an ordinary pending/rescheduled Task
  });

  it("a completed row earlier in the chain still wins over a broken continuation further down the SAME lineage", () => {
    const A = { id: "A", status: "completed" };
    const B = { id: "B", status: "postponed" };
    // A -> B is a live, resolvable edge; B's OWN onward materialization
    // (to some C) is what's broken -- A's real completion must not be
    // downgraded to "broken" just because B's later continuation vanished.
    const tasks = collapseGoalLineages([A, B], [edge("A", "B"), brokenEdge("B")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].lifecycle).toBe("completed");
    expect(tasks[0].terminal).toBe(A);
  });

  it("Goal progress arithmetic built off conceptualTasks never confidently represents a broken Task as an ordinary pending one", () => {
    const A = { id: "A", status: "postponed" };
    const child1 = { id: "child-1", status: "completed" };
    const child2 = { id: "child-2", status: "completed" };
    const tasks = collapseGoalLineages([A, child1, child2], [brokenEdge("A")]);

    const total = tasks.length;
    const completed = tasks.filter((t) => t.lifecycle === "completed").length;
    const broken = tasks.filter((t) => t.lifecycle === "broken").length;
    expect(total).toBe(3);
    expect(completed).toBe(2); // the broken one is never counted completed
    expect(broken).toBe(1); // and is identifiable as needing review, not silently "pending"
  });
});

describe("resolveLineageOwners", () => {
  it("a root with no edges owns only itself", () => {
    const owners = resolveLineageOwners([{ id: "A", outcome_goal_id: "G" }], []);
    expect(Array.from(owners.entries())).toEqual([["A", "G"]]);
  });

  it("A -> B: B inherits A's owner even though B's own outcome_goal_id would otherwise be null (the real Get healthy / Sleep well regression)", () => {
    const owners = resolveLineageOwners(
      [{ id: "A", outcome_goal_id: "G" }],
      [{ from_goal_id: "A", materialized_goal_id: "B" }]
    );
    expect(owners.get("A")).toBe("G");
    expect(owners.get("B")).toBe("G");
  });

  it("A -> B -> C: ownership propagates transitively through a multi-hop chain", () => {
    const owners = resolveLineageOwners(
      [{ id: "A", outcome_goal_id: "G" }],
      [
        { from_goal_id: "A", materialized_goal_id: "B" },
        { from_goal_id: "B", materialized_goal_id: "C" },
      ]
    );
    expect(owners.get("A")).toBe("G");
    expect(owners.get("B")).toBe("G");
    expect(owners.get("C")).toBe("G");
  });

  it("two independent roots' chains never cross-contaminate each other's ownership", () => {
    const owners = resolveLineageOwners(
      [
        { id: "A", outcome_goal_id: "G" },
        { id: "X", outcome_goal_id: "H" },
      ],
      [
        { from_goal_id: "A", materialized_goal_id: "B" },
        { from_goal_id: "X", materialized_goal_id: "Y" },
      ]
    );
    expect(owners.get("B")).toBe("G");
    expect(owners.get("Y")).toBe("H");
  });

  it("a descendant's own direct, authoritative root membership always wins over another root's inherited claim (no double-counting across Goals)", () => {
    // B is itself a query-matched root for H (its own outcome_goal_id really
    // is H), but is ALSO reachable as A's continuation under G -- both Goals
    // were requested in the same batched call (e.g. Dashboard's up-to-3
    // shown Goals). B must end up owned by exactly one Goal, not both.
    const owners = resolveLineageOwners(
      [
        { id: "A", outcome_goal_id: "G" },
        { id: "B", outcome_goal_id: "H" },
      ],
      [{ from_goal_id: "A", materialized_goal_id: "B" }]
    );
    expect(owners.get("B")).toBe("H"); // B's own direct membership, not inherited from A
    expect(owners.get("A")).toBe("G");
  });

  it("an edge entirely unrelated to any given root has no effect", () => {
    const owners = resolveLineageOwners(
      [{ id: "A", outcome_goal_id: "G" }],
      [{ from_goal_id: "other-1", materialized_goal_id: "other-2" }]
    );
    expect(Array.from(owners.entries())).toEqual([["A", "G"]]);
  });

  it("does not infinite-loop on a malformed cycle", () => {
    const owners = resolveLineageOwners(
      [{ id: "A", outcome_goal_id: "G" }],
      [
        { from_goal_id: "A", materialized_goal_id: "B" },
        { from_goal_id: "B", materialized_goal_id: "A" },
      ]
    );
    expect(owners.get("A")).toBe("G");
    expect(owners.get("B")).toBe("G");
  });
});

describe("getConceptualTasksByOutcomeGoalIds pipeline (ownership resolution + normalization + collapse)", () => {
  // Exercises the exact in-memory pipeline getConceptualTasksByOutcomeGoalIds
  // runs after its DB fetches: resolveLineageOwners -> normalize each row's
  // outcome_goal_id to its resolved owner -> collapseGoalLineages. No
  // Supabase client involved, so this is testable the same way as every
  // other pure helper here, even though the real function does I/O.
  function runPipeline(
    rootGoals: { id: string; status: string; outcome_goal_id: string | null }[],
    continuations: { id: string; status: string; outcome_goal_id: string | null }[],
    edges: { from_goal_id: string; materialized_goal_id: string | null }[]
  ) {
    const roots = rootGoals
      .filter((g) => !!g.outcome_goal_id)
      .map((g) => ({ id: g.id, outcome_goal_id: g.outcome_goal_id as string }));
    const ownerById = resolveLineageOwners(roots, edges);
    const normalized = [...rootGoals, ...continuations].map((g) => {
      const owner = ownerById.get(g.id);
      return owner && owner !== g.outcome_goal_id ? { ...g, outcome_goal_id: owner } : g;
    });
    return collapseGoalLineages(normalized, edges);
  }

  it("A belongs to Goal G, B's outcome_goal_id is null, B is Completed => Goal G sees ONE conceptual Task, Completed (real Get healthy / Sleep well shape)", () => {
    const A = { id: "A", status: "postponed", outcome_goal_id: "G" };
    const B = { id: "B", status: "completed", outcome_goal_id: null };
    const tasks = runPipeline([A], [B], [{ from_goal_id: "A", materialized_goal_id: "B" }]);

    const gTasks = tasks.filter((t) => (t.terminal as any).outcome_goal_id === "G");
    expect(gTasks).toHaveLength(1);
    expect(gTasks[0].terminal.status).toBe("completed");
    expect(gTasks[0].terminal.id).toBe("B");
  });

  it("A belongs to G, B null, B -> C null, C Completed => ONE conceptual Task, Completed", () => {
    const A = { id: "A", status: "postponed", outcome_goal_id: "G" };
    const B = { id: "B", status: "postponed", outcome_goal_id: null };
    const C = { id: "C", status: "completed", outcome_goal_id: null };
    const tasks = runPipeline(
      [A],
      [B, C],
      [
        { from_goal_id: "A", materialized_goal_id: "B" },
        { from_goal_id: "B", materialized_goal_id: "C" },
      ]
    );

    const gTasks = tasks.filter((t) => (t.terminal as any).outcome_goal_id === "G");
    expect(gTasks).toHaveLength(1);
    expect(gTasks[0].terminal.status).toBe("completed");
    expect(gTasks[0].terminal.id).toBe("C");
  });

  it("a descendant with a conflicting non-null outcome_goal_id does not make the same lineage count under two Goals", () => {
    const A = { id: "A", status: "postponed", outcome_goal_id: "G" };
    // B is itself a root for H in this batched call, not just A's continuation.
    const B = { id: "B", status: "completed", outcome_goal_id: "H" };
    const tasks = runPipeline([A, B], [], [{ from_goal_id: "A", materialized_goal_id: "B" }]);

    const gTasks = tasks.filter((t) => (t.terminal as any).outcome_goal_id === "G");
    const hTasks = tasks.filter((t) => (t.terminal as any).outcome_goal_id === "H");
    // The lineage is attributed to exactly one Goal, never both.
    expect(gTasks.length + hTasks.length).toBe(tasks.length);
    expect(hTasks).toHaveLength(1); // B's own direct membership wins
    expect(hTasks[0].terminal.id).toBe("B");
  });

  it("an unrelated reschedule lineage for a Goal that wasn't requested is not pulled in", () => {
    const A = { id: "A", status: "postponed", outcome_goal_id: "G" };
    const B = { id: "B", status: "completed", outcome_goal_id: null };
    // A completely separate chain for a Goal nobody asked about in this call.
    const X = { id: "X", status: "postponed", outcome_goal_id: "UNREQUESTED" };
    const tasks = runPipeline(
      [A],
      [B],
      [
        { from_goal_id: "A", materialized_goal_id: "B" },
        { from_goal_id: "X", materialized_goal_id: "Y" }, // X/Y never passed in as a root or continuation
      ]
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].terminal.id).toBe("B");
  });
});

describe("findOrphanedContinuationIds", () => {
  it("B is flagged: A rescheduled to B, A later Completed, B auto-canceled by reconciliation (the real controlled-repro shape)", () => {
    const edges = [{ from_goal_id: "A", materialized_goal_id: "B" }];
    const sourceStatusById = new Map([["A", "completed"]]);
    const orphanIds = findOrphanedContinuationIds(edges, sourceStatusById);
    expect(orphanIds.has("B")).toBe(true);
  });

  it("B is flagged when its source A was itself canceled (not just completed)", () => {
    const edges = [{ from_goal_id: "A", materialized_goal_id: "B" }];
    const sourceStatusById = new Map([["A", "canceled"]]);
    const orphanIds = findOrphanedContinuationIds(edges, sourceStatusById);
    expect(orphanIds.has("B")).toBe(true);
  });

  it("an ordinary canceled Task that is nobody's materialized continuation is never flagged", () => {
    // No edges at all reference it -- the common case of a plain,
    // independently user-canceled Task.
    const orphanIds = findOrphanedContinuationIds([], new Map());
    expect(orphanIds.size).toBe(0);
  });

  it("a canceled continuation whose source is still unresolved is NOT flagged (nothing has actually orphaned it yet)", () => {
    const edges = [{ from_goal_id: "A", materialized_goal_id: "B" }];
    const sourceStatusById = new Map([["A", "postponed"]]); // A hasn't resolved
    const orphanIds = findOrphanedContinuationIds(edges, sourceStatusById);
    expect(orphanIds.has("B")).toBe(false);
  });

  it("ignores an edge with a null materialized_goal_id without crashing", () => {
    const edges = [{ from_goal_id: "A", materialized_goal_id: null }];
    const orphanIds = findOrphanedContinuationIds(edges, new Map([["A", "completed"]]));
    expect(orphanIds.size).toBe(0);
  });

  it("flags every reachable continuation across multiple independent chains", () => {
    const edges = [
      { from_goal_id: "A", materialized_goal_id: "B" },
      { from_goal_id: "X", materialized_goal_id: "Y" },
    ];
    const sourceStatusById = new Map([
      ["A", "completed"],
      ["X", "postponed"], // X hasn't resolved, so Y is not an orphan
    ]);
    const orphanIds = findOrphanedContinuationIds(edges, sourceStatusById);
    expect(orphanIds.has("B")).toBe(true);
    expect(orphanIds.has("Y")).toBe(false);
  });

  it("the Month Calendar's batched shape: several unrelated days/plans processed together still resolve correctly (Calendar/date-detail reuse the same function, not a second definition)", () => {
    // Simulates loadMonthData's single batched pass across every goal in
    // the visible month: day 1's auto-canceled orphan, day 2's ordinary
    // (independently) canceled Task with no lineage at all, and day 3's
    // still-unresolved source whose continuation must NOT be excluded yet.
    const edges = [
      { from_goal_id: "day1-source", materialized_goal_id: "day1-continuation" },
      { from_goal_id: "day3-source", materialized_goal_id: "day3-continuation" },
    ];
    const sourceStatusById = new Map([
      ["day1-source", "completed"],
      ["day3-source", "in_progress"],
    ]);
    const orphanIds = findOrphanedContinuationIds(edges, sourceStatusById);
    expect(orphanIds.has("day1-continuation")).toBe(true); // excluded from that day's active count
    expect(orphanIds.has("day3-continuation")).toBe(false); // source unresolved -- still a real, active Task
    expect(orphanIds.has("day2-ordinary-canceled")).toBe(false); // never referenced by any edge, untouched
  });
});

describe("findGoalDeleteBlockReason", () => {
  it("allows deletion of an ordinary, disposable Task with no reschedule/assignment links", () => {
    const reason = findGoalDeleteBlockReason({
      isRescheduleSource: false,
      isRescheduleTarget: false,
      isAssignmentSource: false,
      isAssignmentRecipient: false,
    });
    expect(reason).toBeNull();
  });

  it("blocks a reschedule SOURCE (from_goal_id) -- deleting it would CASCADE the whole edge row away", () => {
    const reason = findGoalDeleteBlockReason({
      isRescheduleSource: true,
      isRescheduleTarget: false,
      isAssignmentSource: false,
      isAssignmentRecipient: false,
    });
    expect(reason).toBe("reschedule");
  });

  it("blocks a materialized reschedule TARGET -- deleting it would null materialized_goal_id and resurrect its predecessor as current", () => {
    const reason = findGoalDeleteBlockReason({
      isRescheduleSource: false,
      isRescheduleTarget: true,
      isAssignmentSource: false,
      isAssignmentRecipient: false,
    });
    expect(reason).toBe("reschedule");
  });

  it("blocks an assignment SOURCE (assigner_goal_id)", () => {
    const reason = findGoalDeleteBlockReason({
      isRescheduleSource: false,
      isRescheduleTarget: false,
      isAssignmentSource: true,
      isAssignmentRecipient: false,
    });
    expect(reason).toBe("assignment");
  });

  it("blocks an assignment RECIPIENT (recipient_goal_id) -- the exact Share-1 failure mode from the investigation", () => {
    const reason = findGoalDeleteBlockReason({
      isRescheduleSource: false,
      isRescheduleTarget: false,
      isAssignmentSource: false,
      isAssignmentRecipient: true,
    });
    expect(reason).toBe("assignment");
  });

  it("prefers 'reschedule' when a Task is somehow both reschedule- and assignment-linked (reason is informational only; both relationships still exist regardless of which one is named)", () => {
    const reason = findGoalDeleteBlockReason({
      isRescheduleSource: true,
      isRescheduleTarget: false,
      isAssignmentSource: true,
      isAssignmentRecipient: false,
    });
    expect(reason).toBe("reschedule");
  });
});

describe("GoalDeleteBlockedError", () => {
  it("carries the reason and a matching human-readable message for 'reschedule'", () => {
    const err = new GoalDeleteBlockedError("reschedule");
    expect(err.reason).toBe("reschedule");
    expect(err.message).toMatch(/reschedule history/i);
  });

  it("carries the reason and a matching human-readable message for 'assignment'", () => {
    const err = new GoalDeleteBlockedError("assignment");
    expect(err.reason).toBe("assignment");
    expect(err.message).toMatch(/assignment/i);
  });
});

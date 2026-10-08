import { describe, it, expect } from "vitest";
import { applyPriorityChange, compactForSave, compactForUI, sortGoalsForDisplay, MAX_GOALS, type DraftGoal } from "./goalLogic";
import type { Goal } from "@/lib/supabase/db";

function goal(title: string, priority: number, sort_order: number, outcome_goal_id?: string | null): DraftGoal {
  return { title, priority, sort_order, outcome_goal_id };
}

describe("applyPriorityChange", () => {
  it("sets the chosen goal's priority", () => {
    const prev = [goal("A", 3, 0), goal("B", 3, 1)];
    const next = applyPriorityChange(prev, 1, 2);
    expect(next[1].priority).toBe(2);
  });

  it("demotes an existing P1 when a new one is chosen", () => {
    const prev = [goal("A", 1, 0), goal("B", 2, 1), goal("C", 3, 2)];
    const next = applyPriorityChange(prev, 1, 1);
    expect(next[1].priority).toBe(1);
    expect(next[0].priority).toBe(2);
  });

  it("demotes an existing P1 regardless of how far apart the two rows are in the array (no position is special)", () => {
    // Regression test: applyPriorityChange used to only scan indices 0-2,
    // so a P1 set on a row at index >= 3 wouldn't demote an earlier P1.
    // Under the locked 3-10 model no index is special at all, so this
    // must hold for every position, not just a "first 3" boundary.
    const prev = [goal("A", 1, 0), goal("B", 3, 1), goal("C", 3, 2), goal("D", 3, 3)];
    const next = applyPriorityChange(prev, 3, 1);
    expect(next[3].priority).toBe(1);
    expect(next[0].priority).toBe(2);
  });

  it("does not touch other goals when the new priority isn't 1", () => {
    const prev = [goal("A", 1, 0), goal("B", 3, 1)];
    const next = applyPriorityChange(prev, 1, 2);
    expect(next[0].priority).toBe(1);
    expect(next[1].priority).toBe(2);
  });
});

describe("compactForSave — locked 3-10 commitment model (position-agnostic)", () => {
  it("does not pad to a minimum — a single Task stays a single Task", () => {
    // The 3-commitment minimum is a submission rule each page checks
    // directly (total non-empty count); compactForSave itself only
    // reflects real draft state, never pads by shape.
    const result = compactForSave([goal("Only one", 1, 0)]);
    expect(result.length).toBe(1);
  });

  it("keeps a non-empty Task at ANY position, not just the first three", () => {
    const input = [
      goal("", 3, 0),
      goal("", 3, 1),
      goal("", 3, 2),
      goal("Filled at position 3", 4, 3),
      goal("Filled at position 4", 5, 4),
    ];
    const result = compactForSave(input);
    expect(result.map((g) => g.title)).toEqual(["Filled at position 3", "Filled at position 4"]);
  });

  it("drops an empty Task at ANY position, including within the first three", () => {
    const input = [goal("A", 1, 0), goal("", 3, 1), goal("C", 3, 2)];
    const result = compactForSave(input);
    expect(result.map((g) => g.title)).toEqual(["A", "C"]);
  });

  it("reindexes sort_order for whatever survives, regardless of original position", () => {
    const input = [goal("A", 1, 0), goal("B", 2, 1), goal("C", 3, 2), goal("D", 3, 3), goal("E", 3, 4)];
    const result = compactForSave(input);
    expect(result.length).toBe(5);
    expect(result.map((g) => g.sort_order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("3 P4/P5 Tasks alone are enough to meet the 3-commitment minimum — priority never gates eligibility", () => {
    const input = [goal("Low A", 4, 0), goal("Low B", 5, 1), goal("Low C", 4, 2)];
    const result = compactForSave(input);
    expect(result.length).toBe(3); // the page's canSubmit checks `.length >= 3`, unaffected by priority
  });

  it("mixed P1-P5 Tasks all count equally toward the total", () => {
    const input = [goal("A", 1, 0), goal("B", 2, 1), goal("C", 3, 2), goal("D", 4, 3), goal("E", 5, 4)];
    const result = compactForSave(input);
    expect(result.length).toBe(5);
  });

  it("exactly 2 non-empty Tasks cannot meet the minimum", () => {
    const input = [goal("A", 1, 0), goal("B", 5, 1)];
    const result = compactForSave(input);
    expect(result.length).toBe(2); // below 3 -- the page's canSubmit/submit check blocks this
  });

  it("exactly 3 non-empty Tasks meet the minimum", () => {
    const input = [goal("A", 1, 0), goal("B", 3, 1), goal("C", 5, 2)];
    const result = compactForSave(input);
    expect(result.length).toBe(3);
  });

  it("7 non-empty Tasks all survive", () => {
    const input = Array.from({ length: 7 }, (_, i) => goal(`Task ${i}`, (i % 5) + 1, i));
    const result = compactForSave(input);
    expect(result.length).toBe(7);
  });

  it("10 non-empty Tasks all survive (exactly at MAX_GOALS)", () => {
    const input = Array.from({ length: 10 }, (_, i) => goal(`Task ${i}`, (i % 5) + 1, i));
    const result = compactForSave(input);
    expect(result.length).toBe(10);
  });

  it("an 11th Task beyond MAX_GOALS is dropped by compaction", () => {
    const input = Array.from({ length: MAX_GOALS + 5 }, (_, i) => goal(`Goal ${i}`, 3, i));
    const result = compactForSave(input);
    expect(result.length).toBe(MAX_GOALS);
  });

  it("removing any position yields the same compaction result — no position is treated specially", () => {
    const base = [goal("A", 1, 0), goal("B", 2, 1), goal("C", 3, 2), goal("D", 4, 3), goal("E", 5, 4)];

    const removeFirst = base.filter((_, i) => i !== 0); // simulates removeGoal(0)
    const removeLast = base.filter((_, i) => i !== 4); // simulates removeGoal(4)

    expect(compactForSave(removeFirst).length).toBe(4);
    expect(compactForSave(removeLast).length).toBe(4);
    expect(compactForSave(removeFirst).map((g) => g.title)).toEqual(["B", "C", "D", "E"]);
    expect(compactForSave(removeLast).map((g) => g.title)).toEqual(["A", "B", "C", "D"]);
  });

  it("a Goal-linked Task counts identically to a standalone Task — the Goal itself is never a separate row", () => {
    const input = [
      goal("Standalone Task", 3, 0, null),
      goal("Goal-linked Task 1", 3, 1, "outcome-goal-id"),
      goal("Goal-linked Task 2", 3, 2, "outcome-goal-id"),
    ];
    const result = compactForSave(input);
    // 3 Tasks in, 3 Tasks out -- compactForSave has no concept of a
    // "Goal row" to add or a Goal-linked Task to weight differently.
    expect(result.length).toBe(3);
    expect(result.filter((g) => g.outcome_goal_id === "outcome-goal-id")).toHaveLength(2);
  });
});

describe("compactForUI", () => {
  it("pads with blank rows up to a minimum of 3 for display/entry purposes only", () => {
    const dbGoals = [{ id: "1", title: "Only one", sort_order: 0, priority: 1 } as unknown as Goal];
    const result = compactForUI(dbGoals);
    expect(result.length).toBe(3);
    expect(result[1].title).toBe("");
    expect(result[2].title).toBe("");
  });

  it("does not pad when 3 or more real Tasks already exist, regardless of their positions/priorities", () => {
    const dbGoals = Array.from(
      { length: 5 },
      (_, i) => ({ id: String(i), title: `Task ${i}`, sort_order: i, priority: (i % 5) + 1 } as unknown as Goal)
    );
    const result = compactForUI(dbGoals);
    expect(result.length).toBe(5);
    expect(result.every((g) => (g.title ?? "").length > 0)).toBe(true);
  });

  it("every row's priority is a valid number regardless of position (no index is special-cased)", () => {
    const dbGoals = [
      { id: "1", title: "A", sort_order: 0, priority: 1 },
      { id: "2", title: "B", sort_order: 1, priority: null },
      { id: "3", title: "C", sort_order: 2, priority: 5 },
      { id: "4", title: "D", sort_order: 3, priority: undefined },
    ] as unknown as Goal[];
    const result = compactForUI(dbGoals);
    expect(result.every((g) => typeof g.priority === "number" && Number.isFinite(g.priority))).toBe(true);
  });
});

describe("sortGoalsForDisplay", () => {
  it("puts P1 first regardless of array position", () => {
    const input = [goal("A", 3, 0), goal("B", 5, 1), goal("C", 1, 2)];
    const result = sortGoalsForDisplay(input);
    expect(result.map((r) => r.g.title)).toEqual(["C", "A", "B"]);
  });

  it("keeps tied priorities in their original relative order", () => {
    const input = [goal("A", 2, 0), goal("B", 1, 1), goal("C", 2, 2)];
    const result = sortGoalsForDisplay(input);
    expect(result.map((r) => r.g.title)).toEqual(["B", "A", "C"]);
  });

  it("reports the true original index for every goal, not its sorted position", () => {
    const input = [goal("A", 3, 0), goal("B", 1, 1)];
    const result = sortGoalsForDisplay(input);
    // B (originally index 1) now sorts first, but a caller driving a
    // handler off this result must still target the real array position.
    expect(result[0]).toMatchObject({ originalIdx: 1 });
    expect(result[1]).toMatchObject({ originalIdx: 0 });
  });

  it("treats a missing/invalid priority as the default (3)", () => {
    const input = [{ title: "No priority", sort_order: 0 }, goal("P1", 1, 1)];
    const result = sortGoalsForDisplay(input);
    expect(result.map((r) => r.g.title)).toEqual(["P1", "No priority"]);
  });

  it("never mutates the input array", () => {
    const input = [goal("A", 3, 0), goal("B", 1, 1)];
    const copy = [...input];
    sortGoalsForDisplay(input);
    expect(input).toEqual(copy);
  });
});

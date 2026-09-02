import { describe, it, expect } from "vitest";
import { applyPriorityChange, compactForSave, MAX_GOALS, type DraftGoal } from "./goalLogic";

function goal(title: string, priority: number, sort_order: number): DraftGoal {
  return { title, priority, sort_order };
}

describe("applyPriorityChange", () => {
  it("sets the chosen goal's priority", () => {
    const prev = [goal("A", 3, 0), goal("B", 3, 1)];
    const next = applyPriorityChange(prev, 1, 2);
    expect(next[1].priority).toBe(2);
  });

  it("demotes an existing P1 among the first three when a new one is chosen", () => {
    const prev = [goal("A", 1, 0), goal("B", 2, 1), goal("C", 3, 2)];
    const next = applyPriorityChange(prev, 1, 1);
    expect(next[1].priority).toBe(1);
    expect(next[0].priority).toBe(2);
  });

  it("demotes an existing P1 even when the new P1 is an optional goal beyond the first three", () => {
    // Regression test: applyPriorityChange used to only scan indices 0-2,
    // so a P1 set on an "optional" goal (index >= 3) wouldn't demote an
    // earlier P1 in the main three.
    const prev = [goal("A", 1, 0), goal("B", 3, 1), goal("C", 3, 2), goal("Optional", 3, 3)];
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

describe("compactForSave", () => {
  it("always pads to at least 3 goals", () => {
    const result = compactForSave([goal("Only one", 1, 0)]);
    expect(result.length).toBe(3);
  });

  it("drops empty optional goals beyond the first three", () => {
    const input = [
      goal("A", 1, 0),
      goal("B", 2, 1),
      goal("C", 3, 2),
      goal("", 3, 3),
      goal("", 3, 4),
    ];
    const result = compactForSave(input);
    expect(result.length).toBe(3);
  });

  it("keeps non-empty optional goals and reindexes sort_order", () => {
    const input = [
      goal("A", 1, 0),
      goal("B", 2, 1),
      goal("C", 3, 2),
      goal("Optional 1", 3, 3),
      goal("Optional 2", 3, 4),
    ];
    const result = compactForSave(input);
    expect(result.length).toBe(5);
    expect(result.map((g) => g.sort_order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("respects the MAX_GOALS cap", () => {
    const input = Array.from({ length: MAX_GOALS + 5 }, (_, i) => goal(`Goal ${i}`, 3, i));
    const result = compactForSave(input);
    expect(result.length).toBe(MAX_GOALS);
  });
});

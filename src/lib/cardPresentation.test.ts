import { describe, it, expect } from "vitest";
import { isStandaloneCardCollapsed, toggleId } from "./cardPresentation";

const none = new Set<string>();

describe("standalone card presentation", () => {
  it("defaults: resolved cards collapsed, pending / not-started cards expanded", () => {
    expect(isStandaloneCardCollapsed({ resolved: true, id: "a", expandedDone: none, collapsedPending: none })).toBe(true);
    expect(isStandaloneCardCollapsed({ resolved: false, id: "a", expandedDone: none, collapsedPending: none })).toBe(false);
  });

  it("a pending-review / not-started card can be collapsed and restored (green toggle)", () => {
    let collapsedPending: Set<string> = new Set();
    const collapsed = () => isStandaloneCardCollapsed({ resolved: false, id: "p1", expandedDone: none, collapsedPending });
    expect(collapsed()).toBe(false);
    collapsedPending = toggleId(collapsedPending, "p1"); // green on an expanded card
    expect(collapsed()).toBe(true);
    collapsedPending = toggleId(collapsedPending, "p1"); // green on the collapsed row
    expect(collapsed()).toBe(false);
  });

  it("a resolved card still collapses / restores through its original set", () => {
    let expandedDone: Set<string> = new Set();
    const collapsed = () => isStandaloneCardCollapsed({ resolved: true, id: "r1", expandedDone, collapsedPending: none });
    expect(collapsed()).toBe(true);
    expandedDone = toggleId(expandedDone, "r1"); // restore
    expect(collapsed()).toBe(false);
    expandedDone = toggleId(expandedDone, "r1"); // collapse again
    expect(collapsed()).toBe(true);
  });

  it("collapsing one card never touches another card or the input sets", () => {
    const before = new Set(["x"]);
    const after = toggleId(before, "p1");
    expect([...before]).toEqual(["x"]);
    expect(after.has("x")).toBe(true);
    expect(isStandaloneCardCollapsed({ resolved: false, id: "other", expandedDone: none, collapsedPending: after })).toBe(false);
  });

  it("a status change does not carry a stale collapse onto the other mechanism", () => {
    // collapsed by hand while pending...
    const collapsedPending = new Set(["g"]);
    // ...then resolved: the resolved rule applies (collapsed by default), not the stale hand-collapse set
    expect(isStandaloneCardCollapsed({ resolved: true, id: "g", expandedDone: new Set(["g"]), collapsedPending })).toBe(false);
  });
});

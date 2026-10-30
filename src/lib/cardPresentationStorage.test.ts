import { describe, it, expect, beforeEach } from "vitest";
import { loadCardPresentation, saveCardPresentation } from "./cardPresentationStorage";

beforeEach(() => window.localStorage.clear());

describe("cardPresentationStorage", () => {
  it("round-trips a user's collapsed / opened cards (survives refresh and re-login)", () => {
    saveCardPresentation("u1", { collapsedPending: ["a", "b"], expandedDone: ["c"] });
    expect(loadCardPresentation("u1")).toEqual({ collapsedPending: ["a", "b"], expandedDone: ["c"] });
  });

  it("is per user", () => {
    saveCardPresentation("u1", { collapsedPending: ["a"], expandedDone: [] });
    expect(loadCardPresentation("u2")).toEqual({ collapsedPending: [], expandedDone: [] });
  });

  it("defaults when nothing is stored, and ignores corrupt or wrongly-shaped data", () => {
    expect(loadCardPresentation("u1")).toEqual({ collapsedPending: [], expandedDone: [] });
    window.localStorage.setItem("standup:card-presentation:v1:u1", "{not json");
    expect(loadCardPresentation("u1")).toEqual({ collapsedPending: [], expandedDone: [] });
    window.localStorage.setItem("standup:card-presentation:v1:u1", JSON.stringify({ collapsedPending: "x", expandedDone: [1, "ok"] }));
    expect(loadCardPresentation("u1")).toEqual({ collapsedPending: [], expandedDone: ["ok"] });
  });

  it("drops ids of goals that no longer exist, and removes an empty entry", () => {
    saveCardPresentation("u1", { collapsedPending: ["a", "gone"], expandedDone: ["c", "old"] }, new Set(["a", "c"]));
    expect(loadCardPresentation("u1")).toEqual({ collapsedPending: ["a"], expandedDone: ["c"] });
    saveCardPresentation("u1", { collapsedPending: [], expandedDone: [] });
    expect(window.localStorage.getItem("standup:card-presentation:v1:u1")).toBeNull();
  });

  it("does not prune when the known-goal list is empty (goals still loading)", () => {
    saveCardPresentation("u1", { collapsedPending: ["a"], expandedDone: [] }, new Set());
    expect(loadCardPresentation("u1").collapsedPending).toEqual(["a"]);
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { TOOLS_TAB_STORAGE_KEY, parseStoredTab, readStoredTab, writeStoredTab, FINANCE_TAB_REDIRECT, FINANCES_TAB_STORAGE_KEY, LEGACY_TOOLS_TAB } from "./toolsTabStorage";

const TABS = ["goals", "backlog", "routines", "lists", "payments", "calculator", "salary"] as const;

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("parseStoredTab", () => {
  it("accepts any tab that exists", () => {
    for (const t of TABS) expect(parseStoredTab(t, TABS)).toBe(t);
  });
  it("rejects missing, empty, unknown or tampered values so the page falls back to its default", () => {
    for (const bad of [null, undefined, "", "Payments", "finances", "goals ", "__proto__", "<script>"]) {
      expect(parseStoredTab(bad as string, TABS), String(bad)).toBeNull();
    }
  });
});

describe("remembering the tab", () => {
  it("what was written is what a refresh reads back", () => {
    writeStoredTab("payments");
    expect(window.localStorage.getItem(TOOLS_TAB_STORAGE_KEY)).toBe("payments");
    expect(readStoredTab(TABS)).toBe("payments");
    writeStoredTab("salary");
    expect(readStoredTab(TABS)).toBe("salary");
  });
  it("nothing saved yet -> null (stay on the default tab)", () => {
    expect(readStoredTab(TABS)).toBeNull();
  });
  it("a saved tab that no longer exists is ignored", () => {
    window.localStorage.setItem(TOOLS_TAB_STORAGE_KEY, "retiredTab");
    expect(readStoredTab(TABS)).toBeNull();
  });
  it("blocked storage never throws, on read or write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readStoredTab(TABS)).toBeNull();
    expect(() => writeStoredTab("lists")).not.toThrow();
  });
});

describe("former Finances tabs", () => {
  it("each old Tools tab maps to a Finances destination, so a remembered tab or old link still lands somewhere sensible", () => {
    expect(FINANCE_TAB_REDIRECT).toEqual({
      payments: "tab=payments",
      planner: "tab=planner",
      calculator: "tab=calculators",
      salary: "tab=calculators&calc=salary",
    });
  });
  it("none of the moved tabs is still a Tools tab, and the two sections remember their tab under different keys", () => {
    expect(FINANCES_TAB_STORAGE_KEY).not.toBe(TOOLS_TAB_STORAGE_KEY);
    for (const k of Object.keys(FINANCE_TAB_REDIRECT)) expect(["goals", "backlog", "routines", "lists"]).not.toContain(k);
  });
});

describe("renamed and folded Tools tabs", () => {
  it("Recurring is now Routines, and Long-Term opens Goals on its Long-Term view", () => {
    expect(LEGACY_TOOLS_TAB).toEqual({ recurring: { tab: "routines" }, longTerm: { tab: "goals", view: "longTerm" } });
  });
  it("the legacy names are no longer current tabs, so a remembered one is mapped rather than dropped", () => {
    const current = ["goals", "backlog", "routines", "lists"];
    for (const k of Object.keys(LEGACY_TOOLS_TAB)) expect(current).not.toContain(k);
    for (const v of Object.values(LEGACY_TOOLS_TAB)) expect(current).toContain(v.tab);
  });
});

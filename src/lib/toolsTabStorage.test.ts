import { describe, it, expect, afterEach, vi } from "vitest";
import { TOOLS_TAB_STORAGE_KEY, parseStoredTab, readStoredTab, writeStoredTab } from "./toolsTabStorage";

const TABS = ["goals", "backlog", "longTerm", "recurring", "lists", "payments", "calculator", "salary"] as const;

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

import { describe, it, expect } from "vitest";
import { showToolsIntro, valueLenStyle } from "./toolsLayout";

describe("showToolsIntro", () => {
  it("hides the redundant Tools intro on Finances only (its tab key is 'payments')", () => {
    expect(showToolsIntro("payments")).toBe(false);
    for (const tab of ["goals", "backlog", "longTerm", "recurring", "lists", "calculator", "salary"]) {
      expect(showToolsIntro(tab), tab).toBe(true);
    }
  });
});

describe("valueLenStyle", () => {
  it("exposes the character count so a summary tile can size its value to fit on one line", () => {
    expect(valueLenStyle("$63,354.00")).toEqual({ "--len": 10 });
    expect(valueLenStyle("$0.00")).toEqual({ "--len": 5 });
    expect(valueLenStyle("$1,234,567.89")).toEqual({ "--len": 13 });
  });
  it("never reports zero (empty text still sizes sensibly)", () => {
    expect(valueLenStyle("")["--len"]).toBe(1);
  });
});

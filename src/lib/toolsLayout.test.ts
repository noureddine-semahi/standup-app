import { describe, it, expect } from "vitest";
import { valueLenStyle } from "./toolsLayout";

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

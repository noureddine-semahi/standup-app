import { describe, it, expect } from "vitest";
import { getTargetProgress, formatTargetProgress } from "./goalProgress";

describe("getTargetProgress", () => {
  it("computes a normal percentage", () => {
    const p = getTargetProgress({ currentValue: 1750, targetValue: 5000 });
    expect(p.configured).toBe(true);
    if (p.configured) {
      expect(p.roundedPct).toBe(35);
      expect(p.barPct).toBe(35);
    }
  });

  it("null current_value displays as 0, without mutating the input", () => {
    const input = { currentValue: null, targetValue: 50 };
    const p = getTargetProgress(input);
    expect(p.configured).toBe(true);
    if (p.configured) {
      expect(p.currentValue).toBe(0);
      expect(p.roundedPct).toBe(0);
    }
    expect(input.currentValue).toBeNull(); // stored value untouched
  });

  it("missing target_value (null) is unconfigured", () => {
    const p = getTargetProgress({ currentValue: 10, targetValue: null });
    expect(p.configured).toBe(false);
  });

  it("zero target_value is unconfigured", () => {
    const p = getTargetProgress({ currentValue: 10, targetValue: 0 });
    expect(p.configured).toBe(false);
  });

  it("negative/invalid target_value is unconfigured", () => {
    const p = getTargetProgress({ currentValue: 10, targetValue: -5 });
    expect(p.configured).toBe(false);
  });

  it("current_value exceeding target_value is NOT clamped textually (over 100%)", () => {
    const p = getTargetProgress({ currentValue: 60, targetValue: 50 });
    expect(p.configured).toBe(true);
    if (p.configured) {
      expect(p.roundedPct).toBe(120);
    }
  });

  it("the visual bar clamps at 100 even when the textual percentage exceeds it", () => {
    const p = getTargetProgress({ currentValue: 60, targetValue: 50 });
    expect(p.configured).toBe(true);
    if (p.configured) {
      expect(p.barPct).toBe(100);
    }
  });

  it("the visual bar is protected from negative width when current_value is negative", () => {
    const p = getTargetProgress({ currentValue: -10, targetValue: 50 });
    expect(p.configured).toBe(true);
    if (p.configured) {
      expect(p.roundedPct).toBe(-20); // textual percentage still unclamped
      expect(p.barPct).toBe(0); // bar never goes negative
    }
  });
});

describe("formatTargetProgress", () => {
  it("prefixes $ with no space", () => {
    expect(formatTargetProgress(1750, 5000, "$")).toBe("$1,750 / $5,000");
  });

  it("prefixes € with no space", () => {
    expect(formatTargetProgress(1750, 5000, "€")).toBe("€1,750 / €5,000");
  });

  it("prefixes £ with no space", () => {
    expect(formatTargetProgress(1750, 5000, "£")).toBe("£1,750 / £5,000");
  });

  it("prefixes ¥ with no space", () => {
    expect(formatTargetProgress(1750, 5000, "¥")).toBe("¥1,750 / ¥5,000");
  });

  it("suffixes an ordinary text unit with one space, on the last number only", () => {
    expect(formatTargetProgress(18, 50, "jobs")).toBe("18 / 50 jobs");
    expect(formatTargetProgress(6, 20, "books")).toBe("6 / 20 books");
  });

  it("suffixes % with no space", () => {
    expect(formatTargetProgress(35, 100, "%")).toBe("35 / 100%");
  });

  it("omits the unit entirely when null", () => {
    expect(formatTargetProgress(18, 50, null)).toBe("18 / 50");
  });

  it("treats a blank/whitespace-only unit the same as null", () => {
    expect(formatTargetProgress(18, 50, "   ")).toBe("18 / 50");
  });

  it("formats decimals with a readable thousands separator and no padded trailing zeros", () => {
    expect(formatTargetProgress(1750.5, 5000, "$")).toBe("$1,750.5 / $5,000");
    expect(formatTargetProgress(20.1, 100.25, null)).toBe("20.1 / 100.25");
  });
});

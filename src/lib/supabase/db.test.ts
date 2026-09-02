import { describe, it, expect } from "vitest";
import { toISODate, addDays, computeStreak, formatDateDisplay } from "./db";

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

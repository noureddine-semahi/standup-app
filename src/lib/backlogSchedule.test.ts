import { describe, it, expect } from "vitest";
import { isSchedulableDate } from "./backlogSchedule";

const TODAY = "2026-11-18";

describe("isSchedulableDate", () => {
  it("accepts today and any later real day", () => {
    for (const ok of ["2026-11-18", "2026-11-19", "2027-02-28", "2028-02-29"]) expect(isSchedulableDate(ok, TODAY), ok).toBe(true);
  });
  it("refuses a past day", () => {
    for (const past of ["2026-11-17", "2026-01-01", "2025-12-31"]) expect(isSchedulableDate(past, TODAY), past).toBe(false);
  });
  it("refuses empty, missing and malformed values", () => {
    for (const bad of ["", null, undefined, "tomorrow", "2026-11", "11/25/2026", "2026-1-5", "2026-11-25T10:00", " 2026-11-25"]) expect(isSchedulableDate(bad as string, TODAY), String(bad)).toBe(false);
  });
  it("refuses impossible calendar days instead of letting them roll over", () => {
    for (const bad of ["2026-02-30", "2026-04-31", "2027-02-29", "2026-13-01", "2026-00-10", "2026-11-00"]) expect(isSchedulableDate(bad, TODAY), bad).toBe(false);
  });
  it("is a plain string comparison across month and year boundaries", () => {
    expect(isSchedulableDate("2027-01-01", "2026-12-31")).toBe(true);
    expect(isSchedulableDate("2026-12-31", "2027-01-01")).toBe(false);
  });
});

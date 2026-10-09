import { describe, it, expect } from "vitest";
import { computeCycleRange, CycleBeforeRecurrenceStartError } from "./recurringGoalCycle";

describe("computeCycleRange — daily", () => {
  it("targetDate is its own one-day cycle", () => {
    const range = computeCycleRange({
      frequency: "daily",
      recurrenceStartDate: "2026-10-05",
      targetDate: "2026-10-12",
    });
    expect(range).toEqual({ cycleStart: "2026-10-12", cycleEnd: "2026-10-12" });
  });
});

describe("computeCycleRange — weekly", () => {
  const recurrenceStartDate = "2026-10-05"; // Monday

  it("anchor day itself is the start of the first window", () => {
    const range = computeCycleRange({ frequency: "weekly", recurrenceStartDate, targetDate: "2026-10-05" });
    expect(range).toEqual({ cycleStart: "2026-10-05", cycleEnd: "2026-10-11" });
  });

  it("middle of the first cycle resolves to the same window", () => {
    const range = computeCycleRange({ frequency: "weekly", recurrenceStartDate, targetDate: "2026-10-08" });
    expect(range).toEqual({ cycleStart: "2026-10-05", cycleEnd: "2026-10-11" });
  });

  it("last day of the first cycle resolves to the same window", () => {
    const range = computeCycleRange({ frequency: "weekly", recurrenceStartDate, targetDate: "2026-10-11" });
    expect(range).toEqual({ cycleStart: "2026-10-05", cycleEnd: "2026-10-11" });
  });

  it("first day of the second cycle starts a new window", () => {
    const range = computeCycleRange({ frequency: "weekly", recurrenceStartDate, targetDate: "2026-10-12" });
    expect(range).toEqual({ cycleStart: "2026-10-12", cycleEnd: "2026-10-18" });
  });

  it("a later cycle several weeks out resolves correctly", () => {
    const range = computeCycleRange({ frequency: "weekly", recurrenceStartDate, targetDate: "2026-11-02" });
    // 2026-11-02 is 28 days after the anchor -> window index 4 -> starts 2026-11-02
    expect(range).toEqual({ cycleStart: "2026-11-02", cycleEnd: "2026-11-08" });
  });
});

describe("computeCycleRange — monthly", () => {
  it("mid-month start produces a short first cycle through month-end", () => {
    const range = computeCycleRange({
      frequency: "monthly",
      recurrenceStartDate: "2026-10-20",
      targetDate: "2026-10-20",
    });
    expect(range).toEqual({ cycleStart: "2026-10-20", cycleEnd: "2026-10-31" });
  });

  it("the first following month is a full calendar month", () => {
    const range = computeCycleRange({
      frequency: "monthly",
      recurrenceStartDate: "2026-10-20",
      targetDate: "2026-11-15",
    });
    expect(range).toEqual({ cycleStart: "2026-11-01", cycleEnd: "2026-11-30" });
  });

  it("a 30-day month resolves to its own correct end date", () => {
    const range = computeCycleRange({
      frequency: "monthly",
      recurrenceStartDate: "2026-01-01",
      targetDate: "2026-04-15",
    });
    expect(range).toEqual({ cycleStart: "2026-04-01", cycleEnd: "2026-04-30" });
  });

  it("February in a non-leap year resolves to the 28th", () => {
    const range = computeCycleRange({
      frequency: "monthly",
      recurrenceStartDate: "2026-01-01",
      targetDate: "2026-02-10",
    });
    expect(range).toEqual({ cycleStart: "2026-02-01", cycleEnd: "2026-02-28" });
  });

  it("February in a leap year resolves to the 29th", () => {
    const range = computeCycleRange({
      frequency: "monthly",
      recurrenceStartDate: "2028-01-01",
      targetDate: "2028-02-10",
    });
    expect(range).toEqual({ cycleStart: "2028-02-01", cycleEnd: "2028-02-29" });
  });
});

describe("computeCycleRange — before recurrence start", () => {
  it("rejects a targetDate earlier than recurrenceStartDate (daily)", () => {
    expect(() =>
      computeCycleRange({ frequency: "daily", recurrenceStartDate: "2026-10-05", targetDate: "2026-10-04" })
    ).toThrow(CycleBeforeRecurrenceStartError);
  });

  it("rejects a targetDate earlier than recurrenceStartDate (weekly)", () => {
    expect(() =>
      computeCycleRange({ frequency: "weekly", recurrenceStartDate: "2026-10-05", targetDate: "2026-09-28" })
    ).toThrow(CycleBeforeRecurrenceStartError);
  });

  it("rejects a targetDate earlier than recurrenceStartDate (monthly)", () => {
    expect(() =>
      computeCycleRange({ frequency: "monthly", recurrenceStartDate: "2026-10-20", targetDate: "2026-09-30" })
    ).toThrow(CycleBeforeRecurrenceStartError);
  });
});

describe("computeCycleRange — local date consistency", () => {
  it("parses YYYY-MM-DD the same way regardless of calendar month length (no UTC drift)", () => {
    // 2026-03-01, anchored a day earlier -- exercises a month boundary
    // (Feb 28 2026 -> Mar 1 2026) to confirm day-counting isn't off by
    // one across month-length differences.
    const range = computeCycleRange({
      frequency: "weekly",
      recurrenceStartDate: "2026-02-23",
      targetDate: "2026-03-01",
    });
    expect(range).toEqual({ cycleStart: "2026-02-23", cycleEnd: "2026-03-01" });
  });
});

import { describe, it, expect } from "vitest";
import {
  getTargetProgress,
  formatTargetProgress,
  findCurrentCycle,
  getRecurringCurrentCycleView,
  isCycleFinished,
  type RecurringCycleSummary,
} from "./goalProgress";

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

describe("findCurrentCycle (Goal Engine Phase 2D-5E)", () => {
  it("finds the cycle whose range contains today", () => {
    const cycles = [
      { cycle_start: "2026-09-28", cycle_end: "2026-10-04" },
      { cycle_start: "2026-10-05", cycle_end: "2026-10-11" },
      { cycle_start: "2026-10-12", cycle_end: "2026-10-18" },
    ];
    expect(findCurrentCycle(cycles, "2026-10-09")).toBe(cycles[1]);
  });

  it("matches a single-day (daily) cycle exactly", () => {
    const cycles = [{ cycle_start: "2026-10-09", cycle_end: "2026-10-09" }];
    expect(findCurrentCycle(cycles, "2026-10-09")).toBe(cycles[0]);
  });

  it("matches today at the exact boundary (cycle_start or cycle_end)", () => {
    const cycle = { cycle_start: "2026-10-05", cycle_end: "2026-10-11" };
    expect(findCurrentCycle([cycle], "2026-10-05")).toBe(cycle);
    expect(findCurrentCycle([cycle], "2026-10-11")).toBe(cycle);
  });

  it("returns undefined when the newest cycle is in the past -- never assumes 'newest is current'", () => {
    const cycles = [
      { cycle_start: "2026-09-21", cycle_end: "2026-09-27" },
      { cycle_start: "2026-09-28", cycle_end: "2026-10-04" },
    ];
    expect(findCurrentCycle(cycles, "2026-10-09")).toBeUndefined();
  });

  it("returns undefined for an empty cycle list", () => {
    expect(findCurrentCycle([], "2026-10-09")).toBeUndefined();
  });

  it("returns undefined when today falls in a gap between cycles", () => {
    const cycles = [
      { cycle_start: "2026-10-01", cycle_end: "2026-10-05" },
      { cycle_start: "2026-10-10", cycle_end: "2026-10-15" },
    ];
    expect(findCurrentCycle(cycles, "2026-10-07")).toBeUndefined();
  });
});

describe("getRecurringCurrentCycleView (Goal Engine Phase 2D-5E: display-only current-cycle fallback)", () => {
  const persistedCycle: RecurringCycleSummary = {
    cycle_start: "2026-10-05",
    cycle_end: "2026-10-11",
    committed: 2,
    completed: 1,
    canceled: 0,
    rescheduledOut: 0,
    open: 1,
    targetCountSnapshot: 5, // deliberately different from the Goal's CURRENT config below
    result: "partial",
  };

  it("a persisted current cycle always wins over derivation", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [persistedCycle],
      recurrenceFrequency: "weekly",
      recurrenceStartDate: "2026-10-05",
      recurrenceTargetCount: 3,
      todayISO: "2026-10-09",
    });
    // Same cycle data, but `result` is re-derived for display (active-cycle
    // correction below) -- never the stored "partial" while still active.
    expect(view).toEqual({ kind: "persisted", cycle: { ...persistedCycle, result: "in_progress" } });
  });

  it("does NOT mutate the persisted cycle object from the caller's own cycleHistory array", () => {
    const original = { ...persistedCycle };
    getRecurringCurrentCycleView({
      persistedCycles: [persistedCycle],
      recurrenceFrequency: "weekly",
      recurrenceStartDate: "2026-10-05",
      recurrenceTargetCount: 3,
      todayISO: "2026-10-09",
    });
    expect(persistedCycle).toEqual(original);
    expect(persistedCycle.result).toBe("partial"); // untouched
  });

  it("persisted cycle's own frozen target_count_snapshot wins even when the Goal's CURRENT target differs", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [persistedCycle],
      recurrenceFrequency: "weekly",
      recurrenceStartDate: "2026-10-05",
      recurrenceTargetCount: 99, // current config says 99 -- must NOT override the persisted 5
      todayISO: "2026-10-09",
    });
    expect(view.kind).toBe("persisted");
    if (view.kind === "persisted") {
      expect(view.cycle.targetCountSnapshot).toBe(5);
    }
  });

  it("no persisted cycle, recurrence already started -> derived empty daily cycle", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [],
      recurrenceFrequency: "daily",
      recurrenceStartDate: "2026-10-01",
      recurrenceTargetCount: null,
      todayISO: "2026-10-09",
    });
    expect(view).toEqual({
      kind: "derived",
      cycle: {
        cycle_start: "2026-10-09",
        cycle_end: "2026-10-09",
        committed: 0,
        completed: 0,
        canceled: 0,
        rescheduledOut: 0,
        open: 0,
        targetCountSnapshot: null,
        result: "unconfigured",
      },
    });
  });

  it("derives correct weekly boundaries when no persisted cycle covers today", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [],
      recurrenceFrequency: "weekly",
      recurrenceStartDate: "2026-10-05",
      recurrenceTargetCount: null,
      todayISO: "2026-10-09",
    });
    expect(view.kind).toBe("derived");
    if (view.kind === "derived") {
      expect(view.cycle.cycle_start).toBe("2026-10-05");
      expect(view.cycle.cycle_end).toBe("2026-10-11");
    }
  });

  it("derives correct monthly boundaries when no persisted cycle covers today", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [],
      recurrenceFrequency: "monthly",
      recurrenceStartDate: "2026-10-20",
      recurrenceTargetCount: null,
      todayISO: "2026-11-15",
    });
    expect(view.kind).toBe("derived");
    if (view.kind === "derived") {
      expect(view.cycle.cycle_start).toBe("2026-11-01");
      expect(view.cycle.cycle_end).toBe("2026-11-30");
    }
  });

  it("derived + configured target -> in_progress (never no_commitments/missed while active), target still available for display", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [],
      recurrenceFrequency: "daily",
      recurrenceStartDate: "2026-10-01",
      recurrenceTargetCount: 3,
      todayISO: "2026-10-09",
    });
    expect(view.kind).toBe("derived");
    if (view.kind === "derived") {
      expect(view.cycle.result).toBe("in_progress");
      expect(view.cycle.targetCountSnapshot).toBe(3);
      expect(view.cycle.completed).toBe(0);
    }
  });

  it("derived + null target -> raw zero activity, no achieved/partial/missed judgment", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [],
      recurrenceFrequency: "daily",
      recurrenceStartDate: "2026-10-01",
      recurrenceTargetCount: null,
      todayISO: "2026-10-09",
    });
    expect(view.kind).toBe("derived");
    if (view.kind === "derived") {
      expect(view.cycle.result).toBe("unconfigured");
      expect(view.cycle.targetCountSnapshot).toBeNull();
    }
  });

  it("today before recurrence_start_date -> not_started, without calling computeCycleRange as control flow", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [],
      recurrenceFrequency: "weekly",
      recurrenceStartDate: "2026-11-01",
      recurrenceTargetCount: null,
      todayISO: "2026-10-09",
    });
    expect(view).toEqual({ kind: "not_started", recurrenceStartDate: "2026-11-01" });
  });

  it("missing recurrence config (frequency or start date null) -> unconfigured, not a crash", () => {
    expect(
      getRecurringCurrentCycleView({
        persistedCycles: [],
        recurrenceFrequency: null,
        recurrenceStartDate: "2026-10-01",
        recurrenceTargetCount: null,
        todayISO: "2026-10-09",
      })
    ).toEqual({ kind: "unconfigured" });
    expect(
      getRecurringCurrentCycleView({
        persistedCycles: [],
        recurrenceFrequency: "daily",
        recurrenceStartDate: null,
        recurrenceTargetCount: null,
        todayISO: "2026-10-09",
      })
    ).toEqual({ kind: "unconfigured" });
  });
});

describe("getRecurringCurrentCycleView -- active-cycle result correction", () => {
  // Real-phone bug: an active cycle with 0/3 completed was showing
  // "Missed" (classifyCycleCommitments' own closed-cycle judgment, read
  // through unmodified). An active cycle must only ever show
  // "in_progress" or "achieved", regardless of committed/canceled/
  // rescheduledOut counts -- those stay exactly as persisted/derived.
  function cycleWith(completed: number): RecurringCycleSummary {
    return {
      cycle_start: "2026-10-10",
      cycle_end: "2026-10-10",
      committed: 3,
      completed,
      canceled: 0,
      rescheduledOut: 0,
      open: 3 - completed,
      targetCountSnapshot: 3,
      result: completed === 0 ? "missed" : completed < 3 ? "partial" : "achieved", // what classifyCycleCommitments would have stored
    };
  }

  it("persisted 0/3 -> in_progress, not missed", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [cycleWith(0)],
      recurrenceFrequency: "daily",
      recurrenceStartDate: "2026-10-01",
      recurrenceTargetCount: 3,
      todayISO: "2026-10-10",
    });
    expect(view.kind).toBe("persisted");
    if (view.kind === "persisted") expect(view.cycle.result).toBe("in_progress");
  });

  it("persisted 1/3 -> in_progress, not partial", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [cycleWith(1)],
      recurrenceFrequency: "daily",
      recurrenceStartDate: "2026-10-01",
      recurrenceTargetCount: 3,
      todayISO: "2026-10-10",
    });
    expect(view.kind).toBe("persisted");
    if (view.kind === "persisted") expect(view.cycle.result).toBe("in_progress");
  });

  it("persisted 2/3 -> in_progress, not partial", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [cycleWith(2)],
      recurrenceFrequency: "daily",
      recurrenceStartDate: "2026-10-01",
      recurrenceTargetCount: 3,
      todayISO: "2026-10-10",
    });
    expect(view.kind).toBe("persisted");
    if (view.kind === "persisted") expect(view.cycle.result).toBe("in_progress");
  });

  it("persisted 3/3 -> achieved, shown immediately even while the cycle is still active", () => {
    const view = getRecurringCurrentCycleView({
      persistedCycles: [cycleWith(3)],
      recurrenceFrequency: "daily",
      recurrenceStartDate: "2026-10-01",
      recurrenceTargetCount: 3,
      todayISO: "2026-10-10",
    });
    expect(view.kind).toBe("persisted");
    if (view.kind === "persisted") expect(view.cycle.result).toBe("achieved");
  });

  it("persisted with no target configured -> unconfigured, regardless of completed count", () => {
    const cycle: RecurringCycleSummary = { ...cycleWith(0), targetCountSnapshot: null, result: "no_commitments" };
    const view = getRecurringCurrentCycleView({
      persistedCycles: [cycle],
      recurrenceFrequency: "daily",
      recurrenceStartDate: "2026-10-01",
      recurrenceTargetCount: null,
      todayISO: "2026-10-10",
    });
    expect(view.kind).toBe("persisted");
    if (view.kind === "persisted") expect(view.cycle.result).toBe("unconfigured");
  });
});

describe("isCycleFinished (Goal Engine Phase 2D-5E)", () => {
  it("cycle_end before today -> finished", () => {
    expect(isCycleFinished({ cycle_end: "2026-10-09" }, "2026-10-10")).toBe(true);
  });

  it("cycle_end equal to today -> not finished (still active, e.g. a same-day Daily cycle)", () => {
    expect(isCycleFinished({ cycle_end: "2026-10-10" }, "2026-10-10")).toBe(false);
  });

  it("cycle_end after today -> not finished", () => {
    expect(isCycleFinished({ cycle_end: "2026-10-18" }, "2026-10-10")).toBe(false);
  });
});

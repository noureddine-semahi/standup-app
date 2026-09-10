import { describe, it, expect } from "vitest";
import { computeUsageState, remainingUses, hasUsesRemaining, ASSISTANT_FREE_CAP } from "./usage";

describe("computeUsageState", () => {
  it("keeps the existing count when still inside the window", () => {
    const now = new Date("2026-09-11T12:00:00Z");
    const row = { assistant_uses_this_period: 5, assistant_period_reset_at: "2026-09-20T00:00:00Z" };
    const result = computeUsageState(row, now);
    expect(result).toEqual({ uses: 5, resetAt: row.assistant_period_reset_at, didReset: false });
  });

  it("resets to 0 and starts a new 30-day window once the reset time has passed", () => {
    const now = new Date("2026-09-11T12:00:00Z");
    const row = { assistant_uses_this_period: 20, assistant_period_reset_at: "2026-09-01T00:00:00Z" };
    const result = computeUsageState(row, now);
    expect(result.uses).toBe(0);
    expect(result.didReset).toBe(true);
    const expectedNextReset = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(new Date(result.resetAt).getTime()).toBe(expectedNextReset.getTime());
  });

  it("treats the reset boundary itself as not yet expired", () => {
    const resetAt = "2026-09-11T12:00:00.000Z";
    const now = new Date(resetAt);
    const row = { assistant_uses_this_period: 3, assistant_period_reset_at: resetAt };
    const result = computeUsageState(row, now);
    expect(result.didReset).toBe(false);
    expect(result.uses).toBe(3);
  });
});

describe("remainingUses", () => {
  it("subtracts uses from the cap", () => {
    expect(remainingUses(5)).toBe(ASSISTANT_FREE_CAP - 5);
  });

  it("never goes negative even if uses somehow exceed the cap", () => {
    expect(remainingUses(ASSISTANT_FREE_CAP + 10)).toBe(0);
  });
});

describe("hasUsesRemaining", () => {
  it("is true below the cap", () => {
    expect(hasUsesRemaining(ASSISTANT_FREE_CAP - 1)).toBe(true);
  });

  it("is false at or above the cap", () => {
    expect(hasUsesRemaining(ASSISTANT_FREE_CAP)).toBe(false);
    expect(hasUsesRemaining(ASSISTANT_FREE_CAP + 1)).toBe(false);
  });
});

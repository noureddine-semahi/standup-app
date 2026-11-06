import { describe, it, expect } from "vitest";
import {
  ACCOUNT_TIERS,
  ALWAYS_AVAILABLE,
  FREE_LIMITS,
  LIMITED_RESOURCES,
  PRICING,
  TRIAL_DAYS,
  canCreate,
  formatPriceCents,
  hasPremiumAccess,
  isAtLimit,
  isTrialActive,
  isUnlimited,
  limitFor,
  remaining,
  resolveTier,
  trialDaysLeft,
  trialEndsAt,
  usageFor,
  yearlyPerMonthCents,
  yearlySavingsPercent,
  type AccountTier,
} from "./entitlements";

const DAY = 24 * 60 * 60 * 1000;
const START = "2026-11-01T12:00:00.000Z";
const startMs = Date.parse(START);

describe("definitions", () => {
  it("has exactly the three account states", () => {
    expect([...ACCOUNT_TIERS]).toEqual(["free", "premium_trial", "premium"]);
  });
  it("Free limits: 3 active structured goals, 3 active routines, 10 saved notes", () => {
    expect(FREE_LIMITS).toEqual({ structuredGoals: 3, routines: 3, notes: 10 });
    expect([...LIMITED_RESOURCES].sort()).toEqual(["notes", "routines", "structuredGoals"]);
  });
  it("the trial is 14 days", () => {
    expect(TRIAL_DAYS).toBe(14);
  });
  it("pricing metadata: $5.99 a month, $49.99 a year, in USD cents", () => {
    expect(PRICING.currency).toBe("USD");
    expect(PRICING.monthly.amountCents).toBe(599);
    expect(PRICING.yearly.amountCents).toBe(4999);
    expect(formatPriceCents(PRICING.monthly.amountCents)).toBe("$5.99");
    expect(formatPriceCents(PRICING.yearly.amountCents)).toBe("$49.99");
    expect(formatPriceCents(500)).toBe("$5.00");
    expect(formatPriceCents(5)).toBe("$0.05");
  });
  it("derived yearly figures", () => {
    expect(yearlyPerMonthCents()).toBe(416); // 4999 / 12, rounded down
    expect(yearlySavingsPercent()).toBe(30); // 12 x 5.99 = 71.88 vs 49.99
  });
  it("the daily commitment and review experience is not a limited resource at all", () => {
    for (const daily of ALWAYS_AVAILABLE) expect((LIMITED_RESOURCES as readonly string[]).includes(daily)).toBe(false);
    expect([...ALWAYS_AVAILABLE]).toEqual(["dailyCommitments", "dailyReview"]);
  });
});

describe("resolveTier", () => {
  it("is free with no facts at all (no account record yet)", () => {
    expect(resolveTier(undefined)).toBe("free");
    expect(resolveTier(null)).toBe("free");
    expect(resolveTier({})).toBe("free");
    expect(resolveTier({ premium: null, trialStartedAt: null })).toBe("free");
  });
  it("is premium when subscribed, whatever the trial says", () => {
    expect(resolveTier({ premium: true }, startMs)).toBe("premium");
    expect(resolveTier({ premium: true, trialStartedAt: START }, startMs + DAY)).toBe("premium");
    expect(resolveTier({ premium: true, trialStartedAt: START }, startMs + 100 * DAY)).toBe("premium");
  });
  it("is premium_trial from the start for 14 days, and free from the 14th day's end", () => {
    expect(resolveTier({ trialStartedAt: START }, startMs)).toBe("premium_trial");
    expect(resolveTier({ trialStartedAt: START }, startMs + 13 * DAY + 23 * 60 * 60 * 1000)).toBe("premium_trial");
    expect(resolveTier({ trialStartedAt: START }, startMs + TRIAL_DAYS * DAY - 1)).toBe("premium_trial");
    expect(resolveTier({ trialStartedAt: START }, startMs + TRIAL_DAYS * DAY)).toBe("free");
    expect(resolveTier({ trialStartedAt: START }, startMs + 60 * DAY)).toBe("free");
  });
  it("a trial that has not started yet (or an unreadable start) is free, never trial", () => {
    expect(resolveTier({ trialStartedAt: START }, startMs - 1)).toBe("free");
    expect(resolveTier({ trialStartedAt: "not a date" }, startMs)).toBe("free");
    expect(resolveTier({ trialStartedAt: "" }, startMs)).toBe("free");
  });
  it("accepts a Date or a millisecond timestamp for now", () => {
    expect(resolveTier({ trialStartedAt: START }, new Date(startMs + DAY))).toBe("premium_trial");
    expect(resolveTier({ trialStartedAt: START }, startMs + DAY)).toBe("premium_trial");
  });
});

describe("trial dates", () => {
  it("ends exactly 14 days after it starts", () => {
    expect(trialEndsAt(START)).toBe(new Date(startMs + 14 * DAY).toISOString());
    expect(trialEndsAt(null)).toBeNull();
    expect(trialEndsAt("nope")).toBeNull();
  });
  it("counts whole days left, rounding the last partial day up, and 0 outside a trial", () => {
    expect(trialDaysLeft(START, startMs)).toBe(14);
    expect(trialDaysLeft(START, startMs + 1)).toBe(14);
    expect(trialDaysLeft(START, startMs + DAY)).toBe(13);
    expect(trialDaysLeft(START, startMs + 13 * DAY + 1)).toBe(1);
    expect(trialDaysLeft(START, startMs + 14 * DAY)).toBe(0);
    expect(trialDaysLeft(START, startMs - DAY)).toBe(0);
    expect(trialDaysLeft(null, startMs)).toBe(0);
  });
  it("isTrialActive matches resolveTier", () => {
    for (const offset of [-DAY, 0, 5 * DAY, 14 * DAY - 1, 14 * DAY, 30 * DAY]) {
      expect(isTrialActive(START, startMs + offset)).toBe(resolveTier({ trialStartedAt: START }, startMs + offset) === "premium_trial");
    }
  });
});

describe("limits by tier", () => {
  it("Free is capped on every limited resource", () => {
    expect(limitFor("free", "structuredGoals")).toBe(3);
    expect(limitFor("free", "routines")).toBe(3);
    expect(limitFor("free", "notes")).toBe(10);
    for (const r of LIMITED_RESOURCES) expect(isUnlimited("free", r)).toBe(false);
  });
  it("Premium Trial and Premium are unlimited on every limited resource", () => {
    for (const tier of ["premium_trial", "premium"] as AccountTier[]) {
      for (const r of LIMITED_RESOURCES) {
        expect(limitFor(tier, r)).toBeNull();
        expect(isUnlimited(tier, r)).toBe(true);
        expect(remaining(tier, r, 9999)).toBeNull();
        expect(canCreate(tier, r, 9999)).toBe(true);
        expect(isAtLimit(tier, r, 9999)).toBe(false);
      }
    }
  });
  it("hasPremiumAccess is true for trial and premium only", () => {
    expect(hasPremiumAccess("free")).toBe(false);
    expect(hasPremiumAccess("premium_trial")).toBe(true);
    expect(hasPremiumAccess("premium")).toBe(true);
  });
});

describe("canCreate / remaining on the Free tier", () => {
  it("allows creating up to the cap and not beyond it", () => {
    expect([0, 1, 2].map((n) => canCreate("free", "structuredGoals", n))).toEqual([true, true, true]);
    expect(canCreate("free", "structuredGoals", 3)).toBe(false);
    expect(canCreate("free", "routines", 2)).toBe(true);
    expect(canCreate("free", "routines", 3)).toBe(false);
    expect(canCreate("free", "notes", 9)).toBe(true);
    expect(canCreate("free", "notes", 10)).toBe(false);
  });
  it("reports how many are left, never below zero (an account already over a cap has none)", () => {
    expect(remaining("free", "structuredGoals", 0)).toBe(3);
    expect(remaining("free", "structuredGoals", 2)).toBe(1);
    expect(remaining("free", "structuredGoals", 3)).toBe(0);
    expect(remaining("free", "notes", 25)).toBe(0);
    expect(isAtLimit("free", "notes", 25)).toBe(true);
  });
  it("treats an unreadable count as zero instead of blocking or crashing", () => {
    expect(canCreate("free", "notes", Number.NaN)).toBe(true);
    expect(canCreate("free", "notes", -5)).toBe(true);
    expect(remaining("free", "notes", -5)).toBe(10);
  });
  it("usageFor bundles the figures for an 'n of limit used' display", () => {
    expect(usageFor("free", "routines", 2)).toEqual({ resource: "routines", count: 2, limit: 3, remaining: 1, atLimit: false });
    expect(usageFor("free", "routines", 3)).toEqual({ resource: "routines", count: 3, limit: 3, remaining: 0, atLimit: true });
    expect(usageFor("premium", "routines", 40)).toEqual({ resource: "routines", count: 40, limit: null, remaining: null, atLimit: false });
  });
});

describe("tier and limits together", () => {
  it("an account moves from free caps to no caps when its trial starts, and back when the trial lapses", () => {
    const facts = { trialStartedAt: START };
    expect(canCreate(resolveTier({}, startMs), "notes", 10)).toBe(false);
    expect(canCreate(resolveTier(facts, startMs + DAY), "notes", 10)).toBe(true);
    expect(canCreate(resolveTier(facts, startMs + 15 * DAY), "notes", 10)).toBe(false);
  });
});

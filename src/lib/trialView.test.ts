import { describe, it, expect } from "vitest";
import { trialView } from "./trialView";

const DAY = 24 * 60 * 60 * 1000;
const start = "2026-11-01T12:00:00.000Z";
const startMs = Date.parse(start);
const ends = new Date(startMs + 14 * DAY).toISOString();

describe("trialView", () => {
  it("a Free account that never had a trial is offered the trial", () => {
    expect(trialView({ tier: "free", trialStartedAt: null, trialEndsAt: null, trialUsed: false })).toEqual({ tier: "free", canStart: true, endsAt: null, daysLeft: 0, trialEnded: false });
  });
  it("an active trial shows its end date and the whole days left, and is not offered again", () => {
    const v = trialView({ tier: "premium_trial", trialStartedAt: start, trialEndsAt: ends, trialUsed: true }, startMs + 3 * DAY);
    expect(v).toEqual({ tier: "premium_trial", canStart: false, endsAt: ends, daysLeft: 11, trialEnded: false });
  });
  it("counts the last partial day as a day left", () => {
    expect(trialView({ tier: "premium_trial", trialStartedAt: start, trialEndsAt: ends, trialUsed: true }, startMs + 14 * DAY - 1000).daysLeft).toBe(1);
  });
  it("an ended trial (the database resolved the account to Free) is not offered again and says it ended", () => {
    const v = trialView({ tier: "free", trialStartedAt: start, trialEndsAt: ends, trialUsed: true });
    expect(v.canStart).toBe(false);
    expect(v.trialEnded).toBe(true);
    expect(v.endsAt).toBeNull();
    expect(v.daysLeft).toBe(0);
  });
  it("a Premium account is never offered a trial and shows no trial info", () => {
    expect(trialView({ tier: "premium", trialStartedAt: null, trialEndsAt: null, trialUsed: false })).toEqual({ tier: "premium", canStart: false, endsAt: null, daysLeft: 0, trialEnded: false });
  });
});

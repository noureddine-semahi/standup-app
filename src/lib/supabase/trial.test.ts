import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  rpcCalls: [] as string[],
  fromCalls: [] as { table: string; op: string; args: unknown[] }[],
  rpcData: null as unknown,
  rpcError: null as unknown,
  historyRow: null as Record<string, unknown> | null,
  historyError: null as unknown,
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string) => {
      state.rpcCalls.push(fn);
      return { data: state.rpcError ? null : state.rpcData, error: state.rpcError };
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: (...a: unknown[]) => (state.fromCalls.push({ table, op: "select", args: a }), chain),
        eq: (...a: unknown[]) => (state.fromCalls.push({ table, op: "eq", args: a }), chain),
        maybeSingle: async () => ({ data: state.historyError ? null : state.historyRow, error: state.historyError }),
      });
      return chain;
    },
  },
}));
vi.mock("@/lib/supabase/db", () => ({ getCurrentUserId: async () => "u1" }));

import { TrialNotAvailableError, getMyTrialHistory, startMyTrial, trialRefusalReason } from "./entitlements";
import { TRIAL_DAYS, canStartTrial, isTrialActive, resolveTier } from "@/lib/entitlements";

beforeEach(() => {
  state.rpcCalls = [];
  state.fromCalls = [];
  state.rpcData = null;
  state.rpcError = null;
  state.historyRow = null;
  state.historyError = null;
});

const started = "2026-11-01T12:00:00.000Z";
const ends = new Date(Date.parse(started) + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
const trialRow = { r_tier: "premium_trial", r_stored_tier: "premium_trial", r_trial_started_at: started, r_trial_ends_at: ends };

describe("startMyTrial", () => {
  it("calls only the database's trial function (no arguments, nothing written directly) and returns the premium_trial entitlement", async () => {
    state.rpcData = [trialRow];
    const e = await startMyTrial();
    expect(state.rpcCalls).toEqual(["start_my_premium_trial"]);
    expect(state.fromCalls).toEqual([]);
    expect(e).toEqual({ tier: "premium_trial", storedTier: "premium_trial", trialStartedAt: started, trialEndsAt: ends });
  });
  it("the returned window is exactly 14 days, and the trial is active inside it and Free the instant it ends", async () => {
    state.rpcData = [trialRow];
    const e = await startMyTrial();
    expect(Date.parse(e.trialEndsAt!) - Date.parse(e.trialStartedAt!)).toBe(14 * 24 * 60 * 60 * 1000);
    const s = Date.parse(started);
    expect(resolveTier({ trialStartedAt: e.trialStartedAt }, s + 1)).toBe("premium_trial");
    expect(isTrialActive(e.trialStartedAt, s + 14 * 24 * 60 * 60 * 1000 - 1)).toBe(true);
    expect(resolveTier({ trialStartedAt: e.trialStartedAt }, s + 14 * 24 * 60 * 60 * 1000)).toBe("free");
  });
  it("a second trial is refused with a typed reason (already used), including after expiry or downgrade", async () => {
    state.rpcError = { code: "P0001", message: "TRIAL_ALREADY_USED", details: "Each account can have one Premium trial." };
    await expect(startMyTrial()).rejects.toBeInstanceOf(TrialNotAvailableError);
    await expect(startMyTrial()).rejects.toMatchObject({ reason: "already_used" });
  });
  it("a Premium account is refused with its own reason", async () => {
    state.rpcError = { code: "P0001", message: "ALREADY_PREMIUM" };
    await expect(startMyTrial()).rejects.toMatchObject({ reason: "already_premium" });
  });
  it("a signed-out caller is refused", async () => {
    state.rpcError = { code: "28000", message: "NOT_SIGNED_IN" };
    await expect(startMyTrial()).rejects.toMatchObject({ reason: "not_signed_in" });
  });
  it("any other failure is thrown as is, never turned into a trial", async () => {
    state.rpcError = { code: "08006", message: "connection lost" };
    await expect(startMyTrial()).rejects.toMatchObject({ message: "connection lost" });
    state.rpcError = { code: "PGRST202", message: "Could not find the function" };
    await expect(startMyTrial()).rejects.not.toBeInstanceOf(TrialNotAvailableError);
  });
  it("a response that is not a started trial is rejected, never treated as success or Premium", async () => {
    for (const data of [null, [], [{ r_tier: "free", r_stored_tier: "free" }], [{ r_tier: "premium", r_stored_tier: "premium" }]]) {
      state.rpcData = data;
      await expect(startMyTrial()).rejects.toThrow("Unexpected response");
    }
  });
});

describe("trialRefusalReason", () => {
  it("maps the three refusals and ignores everything else", () => {
    expect(trialRefusalReason({ message: "TRIAL_ALREADY_USED" })).toBe("already_used");
    expect(trialRefusalReason({ message: "ALREADY_PREMIUM" })).toBe("already_premium");
    expect(trialRefusalReason({ message: "NOT_SIGNED_IN" })).toBe("not_signed_in");
    expect(trialRefusalReason({ message: "NOTE_LIMIT_REACHED" })).toBeNull();
    expect(trialRefusalReason({ code: "42501", message: "permission denied" })).toBeNull();
    expect(trialRefusalReason(null)).toBeNull();
  });
});

describe("getMyTrialHistory (read-only)", () => {
  it("reads only the signed-in user's own row", async () => {
    state.historyRow = { started_at: started, ends_at: ends };
    const h = await getMyTrialHistory();
    expect(h).toEqual({ used: true, startedAt: started, endsAt: ends });
    expect(state.fromCalls.every((c) => c.table === "account_trial_history")).toBe(true);
    expect(state.fromCalls).toContainEqual({ table: "account_trial_history", op: "eq", args: ["user_id", "u1"] });
  });
  it("is 'not used' when there is no row, and when the migration isn't applied yet", async () => {
    await expect(getMyTrialHistory()).resolves.toEqual({ used: false, startedAt: null, endsAt: null });
    state.historyError = { code: "42P01", message: "relation does not exist" };
    await expect(getMyTrialHistory()).resolves.toEqual({ used: false, startedAt: null, endsAt: null });
  });
  it("surfaces other errors", async () => {
    state.historyError = { code: "08006", message: "connection lost" };
    await expect(getMyTrialHistory()).rejects.toMatchObject({ message: "connection lost" });
  });
});

describe("canStartTrial", () => {
  it("is offered only to a non-Premium account that has never had a trial", () => {
    expect(canStartTrial({ tier: "free", trialUsed: false })).toBe(true);
    expect(canStartTrial({ tier: "free", trialUsed: true })).toBe(false); // expired / downgraded: never again
    expect(canStartTrial({ tier: "premium_trial", trialUsed: true })).toBe(false);
    expect(canStartTrial({ tier: "premium", trialUsed: false })).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { table: string; op: string; args: unknown[] };
const state = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; args: unknown[] }[],
  member: null as Record<string, unknown> | null,
  household: { id: "h1" } as Record<string, unknown> | null,
  error: null as unknown,
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const rec = (op: string, ...args: unknown[]) => state.calls.push({ table, op, args });
      const result = (data: unknown) => ({ data: state.error ? null : data, error: state.error });
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: (...a: unknown[]) => (rec("select", ...a), chain),
        eq: (...a: unknown[]) => (rec("eq", ...a), chain),
        maybeSingle: async () => result(table === "household_members" ? state.member : state.household),
        single: async () => result(table === "households" ? state.household : { ...(state.member ?? {}), ...lastWrite() }),
        upsert: (...a: unknown[]) => (rec("upsert", ...a), chain),
        insert: (...a: unknown[]) => (rec("insert", ...a), chain),
        update: (...a: unknown[]) => (rec("update", ...a), chain),
        delete: (...a: unknown[]) => (rec("delete", ...a), chain),
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: state.error }),
      });
      void self;
      return chain;
    },
  },
}));

function lastWrite(): Record<string, unknown> {
  const w = [...state.calls].reverse().find((c) => c.op === "insert" || c.op === "update");
  return (w?.args[0] as Record<string, unknown>) ?? {};
}

vi.mock("@/lib/supabase/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase/db")>()),
  getCurrentUserId: async () => "u1",
}));

import { emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import { createPartner, getPartner, isHouseholdUnavailableError, partnerColumns, removePartner, renamePartner, savePartnerProfile } from "./household";

const tablesTouched = () => [...new Set(state.calls.map((c: Call) => c.table))];

beforeEach(() => {
  state.calls = [];
  state.member = null;
  state.household = { id: "h1" };
  state.error = null;
});

const full = (): FinancialProfile => ({
  ...emptyProfile(),
  currentStep: 3,
  skippedSteps: [2],
  payFrequency: "monthly",
  takeHome: 3100.5,
  incomeBasis: "actual",
  country: "US",
  region: "CA",
  adults: 2,
  dependents: 1,
  expenses: { housing: { amount: 900, basis: "estimate" } },
  debts: [{ id: "d", name: "Loan", balance: 100, monthlyPayment: 10, basis: "actual", accountId: null }],
  savingsMonthly: 25,
  goals: [{ id: "g", name: "Trip", targetAmount: null, targetDate: null }],
  useBills: true,
  useAccounts: true,
  useSubscriptions: true,
});

describe("availability", () => {
  it("a missing household table (migration not applied) reads as 'unavailable'", () => {
    expect(isHouseholdUnavailableError({ code: "PGRST205" })).toBe(true);
    expect(isHouseholdUnavailableError({ code: "42P01" })).toBe(true);
    expect(isHouseholdUnavailableError({ code: "23505" })).toBe(false);
  });
});

describe("partner columns (isolation from the personal profile)", () => {
  it("carries the partner's own answers but none of my records-consent flags or household-size answers", () => {
    const cols = partnerColumns(full());
    for (const k of ["use_bills", "use_accounts", "use_subscriptions", "adults", "dependents"]) expect(cols, k).not.toHaveProperty(k);
    expect(cols).toMatchObject({ current_step: 3, skipped_steps: [2], pay_frequency: "monthly", take_home: 3100.5, income_basis: "actual", country: "US", savings_monthly: 25 });
    expect(cols).toHaveProperty("expenses");
    expect(cols).toHaveProperty("debts");
    expect(cols).toHaveProperty("goals");
  });
  it("unanswered amounts stay null (never 0)", () => {
    const cols = partnerColumns(emptyProfile());
    for (const k of ["take_home", "income_typical", "income_low", "savings_balance", "savings_monthly", "pay_frequency"]) expect(cols[k], k).toBeNull();
  });
});

describe("reading", () => {
  it("no partner -> null (nothing invented), reading only household_members for the signed-in user", async () => {
    expect(await getPartner()).toBeNull();
    expect(tablesTouched()).toEqual(["household_members"]);
    expect(state.calls.filter((c) => c.op === "eq").map((c) => c.args)).toEqual([["owner_id", "u1"], ["role", "partner"]]);
  });
  it("maps a saved partner row to a name and a profile with no personal records flags", async () => {
    state.member = { id: "m1", display_name: "Alex", current_step: 2, skipped_steps: [1], pay_frequency: "weekly", take_home: "600.00", income_basis: "actual", country: null, region: null, expenses: { housing: { amount: 500, basis: "actual" } }, debts: [], no_debts: true, savings_basis: "estimate", goals: [], updated_at: "2026-11-04T00:00:00Z" };
    const p = await getPartner();
    expect(p).toMatchObject({ id: "m1", name: "Alex" });
    expect(p!.profile).toMatchObject({ currentStep: 2, skippedSteps: [1], payFrequency: "weekly", takeHome: 600, noDebts: true, useBills: false, useAccounts: false, useSubscriptions: false, adults: null });
  });
});

describe("writing", () => {
  it("creating a partner upserts the household for the user, then inserts a member tied to that household and owner", async () => {
    const p = await createPartner("Sam");
    const up = state.calls.find((c) => c.op === "upsert")!;
    expect(up.table).toBe("households");
    expect(up.args).toEqual([{ owner_id: "u1" }, { onConflict: "owner_id" }]);
    const ins = state.calls.find((c) => c.op === "insert")!;
    expect(ins.table).toBe("household_members");
    expect(ins.args[0]).toMatchObject({ household_id: "h1", owner_id: "u1", role: "partner", display_name: "Sam", current_step: 1, skipped_steps: [] });
    expect(p.name).toBe("Sam");
  });
  it("a blank name falls back to the default 'Partner'", async () => {
    await createPartner("");
    expect(state.calls.find((c) => c.op === "insert")!.args[0]).toMatchObject({ display_name: "Partner" });
  });
  it("saving updates only that member row, scoped to the owner, and sends no consent flags", async () => {
    await savePartnerProfile("m1", full());
    const up = state.calls.find((c) => c.op === "update")!;
    expect(up.table).toBe("household_members");
    expect(up.args[0]).not.toHaveProperty("use_bills");
    expect(state.calls.filter((c) => c.op === "eq").map((c) => c.args)).toEqual([["id", "m1"], ["owner_id", "u1"]]);
  });
  it("renaming changes only the display name", async () => {
    await renamePartner("m1", "Jo");
    expect(state.calls.find((c) => c.op === "update")!.args[0]).toEqual({ display_name: "Jo" });
  });
  it("removing deletes that one member row (scoped to the owner) and nothing else", async () => {
    await removePartner("m1");
    expect(state.calls.map((c) => [c.table, c.op])).toEqual([["household_members", "delete"], ["household_members", "eq"], ["household_members", "eq"]]);
  });
  it("a failed write throws, so the screen only changes after a successful save", async () => {
    state.error = { message: "boom" };
    await expect(savePartnerProfile("m1", full())).rejects.toMatchObject({ message: "boom" });
    await expect(removePartner("m1")).rejects.toMatchObject({ message: "boom" });
  });
});

describe("data isolation", () => {
  it("no household operation ever touches financial_profiles, Bills, Payments or Subscriptions", async () => {
    await getPartner();
    await createPartner("A");
    await savePartnerProfile("m1", full());
    await renamePartner("m1", "B");
    await removePartner("m1");
    expect(tablesTouched().sort()).toEqual(["household_members", "households"]);
    expect(tablesTouched().some((t) => /financial_profiles|bills|subscription|payment/.test(t))).toBe(false);
  });
});

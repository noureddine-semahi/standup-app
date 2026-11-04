import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  error: null as unknown,
  tables: [] as string[],
  upserts: [] as { row: Record<string, unknown>; opts: unknown }[],
  eqs: [] as [string, unknown][],
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      state.tables.push(table);
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            state.eqs.push([col, val]);
            return { maybeSingle: async () => ({ data: state.row, error: state.error }) };
          },
        }),
        upsert: (row: Record<string, unknown>, opts: unknown) => {
          state.upserts.push({ row, opts });
          return {
            select: () => ({
              single: async () => ({ data: state.error ? null : { ...(state.row ?? {}), ...row, updated_at: "2026-11-04T10:00:00Z" }, error: state.error }),
            }),
          };
        },
      };
    },
  },
}));

vi.mock("@/lib/supabase/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase/db")>()),
  getCurrentUserId: async () => "u1",
}));

import { emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import { getFinancialProfile, isPlannerUnavailableError, profileToColumns, rowToProfile, saveFinancialProfile } from "./financialProfile";

beforeEach(() => {
  state.row = null;
  state.error = null;
  state.tables = [];
  state.upserts = [];
  state.eqs = [];
});

const full = (): FinancialProfile => ({
  ...emptyProfile(),
  currentStep: 4,
  skippedSteps: [2],
  payFrequency: "biweekly",
  takeHome: 1850.5,
  incomeBasis: "actual",
  country: "US",
  region: "TX",
  adults: 2,
  dependents: 1,
  expenses: { housing: { amount: 1400, basis: "actual", covered: true }, groceries: { amount: 600, basis: "estimate" } },
  debts: [{ id: "d1", name: "Car", balance: 9000, monthlyPayment: 300, basis: "actual", accountId: "acc-1" }],
  savingsBalance: 2500,
  savingsMonthly: 150,
  savingsBasis: "estimate",
  goals: [{ id: "g1", name: "Trip", targetAmount: 2000, targetDate: "2027-06-01" }],
  useBills: true,
  useAccounts: false,
  useSubscriptions: true,
});

describe("availability", () => {
  it("a missing table (migration not applied) reads as 'unavailable'; ordinary errors don't", () => {
    expect(isPlannerUnavailableError({ code: "42P01" })).toBe(true);
    expect(isPlannerUnavailableError({ code: "PGRST205" })).toBe(true);
    expect(isPlannerUnavailableError({ code: "23505" })).toBe(false);
  });
});

describe("loading", () => {
  it("returns an EMPTY profile when the user hasn't started (nothing is invented)", async () => {
    expect(await getFinancialProfile()).toEqual(emptyProfile());
    expect(state.tables).toEqual(["financial_profiles"]);
    expect(state.eqs).toEqual([["user_id", "u1"]]);
  });

  it("maps a saved row: numeric strings become numbers, nulls stay null", async () => {
    state.row = { current_step: 3, skipped_steps: [2], pay_frequency: "monthly", take_home: "4200.00", income_typical: null, income_low: null, income_basis: "actual", country: null, region: null, adults: 2, dependents: null, expenses: {}, debts: [], no_debts: true, savings_balance: null, savings_monthly: "75.5", savings_basis: "estimate", goals: [], use_bills: true, use_accounts: false, use_subscriptions: false, updated_at: "2026-11-01T00:00:00Z" };
    const p = await getFinancialProfile();
    expect(p).toMatchObject({ currentStep: 3, skippedSteps: [2], payFrequency: "monthly", takeHome: 4200, incomeBasis: "actual", adults: 2, dependents: null, noDebts: true, savingsBalance: null, savingsMonthly: 75.5, useBills: true });
  });

  it("malformed jsonb entries and unknown values are dropped instead of crashing the planner", () => {
    const p = rowToProfile({
      current_step: 99,
      skipped_steps: [1, 9, 2],
      pay_frequency: "fortnightly",
      take_home: null, income_typical: null, income_low: null, income_basis: "weird", country: null, region: null, adults: null, dependents: null,
      expenses: { housing: { amount: 100, basis: "actual" }, groceries: { amount: -5, basis: "actual" }, bogus: { amount: 1, basis: "actual" }, utilities: "x" },
      debts: [{ id: "1", name: "ok", balance: 5, monthlyPayment: null, basis: "actual" }, { id: 2 }, "junk"],
      no_debts: false, savings_balance: null, savings_monthly: null, savings_basis: "estimate",
      goals: [{ id: "g", name: "Trip" }, { name: "no id" }],
      use_bills: false, use_accounts: false, use_subscriptions: false, updated_at: null,
    });
    expect(p.currentStep).toBe(1);
    expect(p.skippedSteps).toEqual([1, 2]);
    expect(p.payFrequency).toBeNull();
    expect(p.incomeBasis).toBe("estimate");
    expect(p.expenses).toEqual({ housing: { amount: 100, basis: "actual" } });
    expect(p.debts).toEqual([{ id: "1", name: "ok", balance: 5, monthlyPayment: null, basis: "actual", accountId: null }]);
    expect(p.goals).toEqual([{ id: "g", name: "Trip", targetAmount: null, targetDate: null }]);
  });
});

describe("saving (profile persistence between sessions)", () => {
  it("upserts ONE row keyed by the signed-in user, and only the financial_profiles table is touched", async () => {
    await saveFinancialProfile(full());
    expect(state.tables).toEqual(["financial_profiles"]);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].opts).toEqual({ onConflict: "user_id" });
    expect(state.upserts[0].row).toMatchObject({ user_id: "u1", pay_frequency: "biweekly", take_home: 1850.5, current_step: 4, use_bills: true });
  });

  it("what is saved is what is loaded back (round trip), including estimates, links and consent", async () => {
    const original = full();
    const saved = await saveFinancialProfile(original);
    expect(saved).toEqual({ ...original, updatedAt: "2026-11-04T10:00:00Z" });
    expect(rowToProfile(profileToColumns(original) as never)).toEqual({ ...original, updatedAt: null });
  });

  it("unanswered amounts are saved as null, never 0", () => {
    const cols = profileToColumns(emptyProfile());
    for (const k of ["take_home", "income_typical", "income_low", "savings_balance", "savings_monthly", "adults", "dependents", "pay_frequency"]) expect(cols[k], k).toBeNull();
    expect(cols).toMatchObject({ expenses: {}, debts: [], goals: [], use_bills: false, use_accounts: false, use_subscriptions: false });
  });

  it("a failed save throws (the screen only updates after a successful save)", async () => {
    state.error = { message: "boom" };
    await expect(saveFinancialProfile(full())).rejects.toMatchObject({ message: "boom" });
  });
});

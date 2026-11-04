import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/db";
import { isBillsUnavailableError } from "@/lib/supabase/bills";
import {
  EXPENSE_CATEGORIES,
  PAY_FREQUENCIES,
  emptyProfile,
  type Basis,
  type DebtEntry,
  type ExpenseEntry,
  type FinancialProfile,
  type GoalEntry,
  type PayFrequency,
  type PlannerStep,
} from "@/lib/financialPlanner";

// Data access for Tools > Planner. One row per user, scoped by RLS to auth.uid(); the app also filters on the
// signed-in user id. Only the profile row is ever written: the planner never changes Bills, Payments or
// Subscriptions. Requires supabase/migrations/20261106000100_financial_profiles.sql.

/** True when the error means the table doesn't exist yet (migration not applied). */
export const isPlannerUnavailableError = isBillsUnavailableError;

type ProfileRow = {
  current_step: number;
  skipped_steps: number[] | null;
  pay_frequency: string | null;
  take_home: string | number | null;
  income_typical: string | number | null;
  income_low: string | number | null;
  income_basis: string;
  country: string | null;
  region: string | null;
  adults: number | null;
  dependents: number | null;
  expenses: unknown;
  debts: unknown;
  no_debts: boolean;
  savings_balance: string | number | null;
  savings_monthly: string | number | null;
  savings_basis: string;
  goals: unknown;
  use_bills: boolean;
  use_accounts: boolean;
  use_subscriptions: boolean;
  updated_at: string | null;
};

const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const basis = (v: unknown): Basis => (v === "actual" ? "actual" : "estimate");
const step = (v: unknown): PlannerStep => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5 ? (v as PlannerStep) : 1);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The jsonb lists are validated again on the way in, so a malformed row can't crash the planner. */
function readExpenses(raw: unknown): FinancialProfile["expenses"] {
  const out: FinancialProfile["expenses"] = {};
  if (!isObj(raw)) return out;
  for (const cat of EXPENSE_CATEGORIES) {
    const e = raw[cat];
    if (isObj(e) && finite(e.amount)) {
      const entry: ExpenseEntry = { amount: e.amount, basis: basis(e.basis) };
      if (e.covered === true) entry.covered = true;
      out[cat] = entry;
    }
  }
  return out;
}

function readDebts(raw: unknown): DebtEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((d): DebtEntry[] => {
    if (!isObj(d) || typeof d.id !== "string" || typeof d.name !== "string") return [];
    return [
      {
        id: d.id,
        name: d.name,
        balance: finite(d.balance) ? d.balance : null,
        monthlyPayment: finite(d.monthlyPayment) ? d.monthlyPayment : null,
        basis: basis(d.basis),
        accountId: typeof d.accountId === "string" ? d.accountId : null,
      },
    ];
  });
}

function readGoals(raw: unknown): GoalEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((g): GoalEntry[] => {
    if (!isObj(g) || typeof g.id !== "string" || typeof g.name !== "string") return [];
    return [{ id: g.id, name: g.name, targetAmount: finite(g.targetAmount) ? g.targetAmount : null, targetDate: typeof g.targetDate === "string" ? g.targetDate : null }];
  });
}

export function rowToProfile(r: ProfileRow): FinancialProfile {
  return {
    currentStep: step(r.current_step),
    skippedSteps: (r.skipped_steps ?? []).filter((s): s is PlannerStep => Number.isInteger(s) && s >= 1 && s <= 5),
    payFrequency: (PAY_FREQUENCIES as readonly string[]).includes(r.pay_frequency ?? "") ? (r.pay_frequency as PayFrequency) : null,
    takeHome: num(r.take_home),
    incomeTypical: num(r.income_typical),
    incomeLow: num(r.income_low),
    incomeBasis: basis(r.income_basis),
    country: r.country ?? null,
    region: r.region ?? null,
    adults: r.adults ?? null,
    dependents: r.dependents ?? null,
    expenses: readExpenses(r.expenses),
    debts: readDebts(r.debts),
    noDebts: !!r.no_debts,
    savingsBalance: num(r.savings_balance),
    savingsMonthly: num(r.savings_monthly),
    savingsBasis: basis(r.savings_basis),
    goals: readGoals(r.goals),
    useBills: !!r.use_bills,
    useAccounts: !!r.use_accounts,
    useSubscriptions: !!r.use_subscriptions,
    updatedAt: r.updated_at ?? null,
  };
}

export function profileToColumns(p: FinancialProfile): Record<string, unknown> {
  return {
    current_step: p.currentStep,
    skipped_steps: p.skippedSteps,
    pay_frequency: p.payFrequency,
    take_home: p.takeHome,
    income_typical: p.incomeTypical,
    income_low: p.incomeLow,
    income_basis: p.incomeBasis,
    country: p.country,
    region: p.region,
    adults: p.adults,
    dependents: p.dependents,
    expenses: p.expenses,
    debts: p.debts,
    no_debts: p.noDebts,
    savings_balance: p.savingsBalance,
    savings_monthly: p.savingsMonthly,
    savings_basis: p.savingsBasis,
    goals: p.goals,
    use_bills: p.useBills,
    use_accounts: p.useAccounts,
    use_subscriptions: p.useSubscriptions,
  };
}

/** The saved profile, or an empty one when the user hasn't started (nothing is invented). */
export async function getFinancialProfile(): Promise<FinancialProfile> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase.from("financial_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? rowToProfile(data as ProfileRow) : emptyProfile();
}

/** Saves the whole profile (one row per user). Safe to call after every step so progress is never lost. */
export async function saveFinancialProfile(profile: FinancialProfile): Promise<FinancialProfile> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("financial_profiles")
    .upsert({ user_id: userId, ...profileToColumns(profile) }, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return rowToProfile(data as ProfileRow);
}

import { describe, it, expect } from "vitest";
import type { Bill } from "./bills";
import { EXPENSE_CATEGORIES, buildPlan, emptyProfile, type DebtEntry, type FinancialProfile } from "./financialPlanner";
import type { Subscription } from "./subscriptions";
import type { PaymentAccount } from "./supabase/db";
import {
  GOAL_TIMING_RULE,
  HOUSEHOLD_CURRENCY,
  accountingInvariantViolations,
  allocate,
  applyContributionSuggestion,
  buildHouseholdPlan,
  compositionErrors,
  contributionError,
  emptyComposition,
  emptyShared,
  goalProgress,
  householdSize,
  monthsUntil,
  type Composition,
  type Contributions,
  type HouseholdInputs,
  type HouseholdPlan,
  type SharedDebt,
  type SharedExpense,
  type SharedGoal,
  type SharedHousehold,
} from "./householdPlan";

const TODAY = "2026-11-04";
const NONE: Contributions = { me: null, partner: null };

// ── fixtures ─────────────────────────────────────────────────────────────
const profile = (over: Partial<FinancialProfile> = {}): FinancialProfile => ({ ...emptyProfile(), ...over });
/** A personal profile whose plan is COMPLETE: income given, all 8 expenses given, "no debts", subscriptions included. */
const complete = (takeHome: number | null, perCategory: number, over: Partial<FinancialProfile> = {}): FinancialProfile =>
  profile({
    payFrequency: takeHome === null ? null : "monthly",
    takeHome,
    incomeBasis: "actual",
    noDebts: true,
    useSubscriptions: true,
    expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: perCategory, basis: "actual" as const }])),
    ...over,
  });
const bill = (over: Partial<Bill> = {}): Bill => ({
  id: "b1", name: "Rent", amountType: "fixed", expectedAmount: 1800, recurrence: "monthly", firstDueDate: "2026-01-01",
  remindDaysBefore: 3, category: "Rent / Mortgage", notes: null, archivedAt: null, createdAt: "2026-01-01T00:00:00Z", ...over,
});
const account = (over: Partial<PaymentAccount> = {}): PaymentAccount => ({
  id: "a1", name: "Visa", balance: 900, minimumPayment: 35, dueDay: 15, remindDaysBefore: 3, lastReminderDueDate: null,
  createdAt: "2026-01-01T00:00:00Z", balanceMode: "auto", ...over,
});
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1", name: "Netflix", provider: null, category: null, planName: null, amount: 15, currency: "USD", frequency: "monthly",
  customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null,
  remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "x", updatedAt: "x", ...over,
});
const debt = (over: Partial<DebtEntry> = {}): DebtEntry => ({ id: "d1", name: "Car loan", balance: 12000, monthlyPayment: 350, basis: "actual", accountId: null, ...over });
const expense = (over: Partial<SharedExpense> = {}): SharedExpense => ({ id: "e1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const jdebt = (over: Partial<SharedDebt> = {}): SharedDebt => ({ id: "j1", name: "Mortgage", balance: 250000, monthlyPayment: 1400, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const goal = (over: Partial<SharedGoal> = {}): SharedGoal => ({ id: "g1", name: "House", targetAmount: 12000, targetDate: "2027-11-04", savedAmount: 0, contributions: { ...NONE }, countedInSavings: { me: false, partner: false }, ...over });
const shared = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), noSharedExpenses: true, noSharedDebts: true, ...over });

/** Me earns 5,000 and spends 800; the partner earns 3,000 and spends 400; no shared items yet (explicitly none). */
function inputs(over: Partial<HouseholdInputs> = {}): HouseholdInputs {
  return {
    me: { profile: complete(5000, 100) },
    partner: { profile: complete(3000, 50), name: "Alex", included: true },
    shared: shared(),
    composition: emptyComposition(),
    records: { bills: [], accounts: [], subscriptions: [] },
    todayISO: TODAY,
    ...over,
  };
}
const run = (over: Partial<HouseholdInputs> = {}): HouseholdPlan => buildHouseholdPlan(inputs(over));
const sound = (p: HouseholdPlan) => expect(accountingInvariantViolations(p)).toEqual([]);
const issueCodes = (p: HouseholdPlan) => p.issues.map((i) => i.code);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

// ── allocation: nothing is ever assumed ──────────────────────────────────
describe("allocate: only what was stated, never 50/50", () => {
  it("no payer stated -> the whole amount is 'not yet assigned'", () => {
    expect(allocate(180000, NONE)).toEqual({ meCents: 0, partnerCents: 0, unassignedCents: 180000, status: "unassigned" });
  });
  it("one person pays it all, either person", () => {
    expect(allocate(180000, { me: 1800, partner: null })).toMatchObject({ meCents: 180000, partnerCents: 0, unassignedCents: 0, status: "assigned" });
    expect(allocate(180000, { me: null, partner: 1800 })).toMatchObject({ meCents: 0, partnerCents: 180000, unassignedCents: 0, status: "assigned" });
  });
  it("custom amounts that add up", () => {
    expect(allocate(180000, { me: 1000, partner: 800 })).toMatchObject({ meCents: 100000, partnerCents: 80000, unassignedCents: 0, status: "assigned" });
  });
  it("amounts that fall short leave the rest unassigned (not split between the two)", () => {
    expect(allocate(180000, { me: 1000, partner: null })).toMatchObject({ meCents: 100000, partnerCents: 0, unassignedCents: 80000, status: "partial" });
    expect(allocate(180000, { me: 500, partner: 300 })).toMatchObject({ unassignedCents: 100000, status: "partial" });
  });
  it("over-assigned or negative amounts are invalid and treated as not stated", () => {
    expect(allocate(180000, { me: 1000, partner: 900 })).toEqual({ meCents: 0, partnerCents: 0, unassignedCents: 180000, status: "invalid" });
    expect(allocate(180000, { me: -5, partner: null }).status).toBe("invalid");
    expect(allocate(180000, { me: Number.NaN, partner: null }).status).toBe("invalid");
  });
  it("an explicit $0 payer is a stated value; a $0 item has nothing to assign", () => {
    expect(allocate(180000, { me: 1800, partner: 0 })).toMatchObject({ partnerCents: 0, status: "assigned" });
    expect(allocate(0, NONE).status).toBe("assigned");
  });
  it("is exact to the cent (no floating-point drift)", () => {
    expect(allocate(30, { me: 0.1, partner: 0.2 })).toMatchObject({ meCents: 10, partnerCents: 20, unassignedCents: 0, status: "assigned" });
    expect(allocate(1999, { me: 19.99, partner: null }).unassignedCents).toBe(0);
  });
  it("form validation: at most 2 decimals, not negative, not above the total", () => {
    expect(contributionError(1800, { me: 1000, partner: 800 })).toBeNull();
    expect(contributionError(1800, { me: 1000, partner: 800.01 })).toBe("overAssigned");
    expect(contributionError(1800, { me: 12.345, partner: null })).toBe("invalid");
    expect(contributionError(1800, { me: -1, partner: null })).toBe("invalid");
    expect(contributionError(1800, NONE)).toBeNull();
  });
});

// ── income ───────────────────────────────────────────────────────────────
describe("combined income: unknown is not $0", () => {
  it("both people included and known: complete, summed", () => {
    const p = run();
    expect(p.income).toMatchObject({ status: "complete", cents: 800000, knownCents: 800000 });
    sound(p);
  });
  it("a partner whose income is not entered makes the household income PARTIAL, and withholds available cash", () => {
    const p = run({ partner: { profile: complete(null, 50), name: "Alex", included: true } });
    expect(p.income).toMatchObject({ status: "partial", cents: null, knownCents: 500000 });
    expect(p.income.missing).toEqual([{ scope: "partner", key: "income" }]);
    expect(p.available.status).toBe("unknown");
    expect(p.available.cents).toBeNull();
    expect(issueCodes(p)).toContain("partnerIncomeUnknown");
    sound(p);
  });
  it("an explicitly entered $0 income is a real zero (complete), unlike blank", () => {
    const p = run({ partner: { profile: complete(0, 50), name: "Alex", included: true } });
    expect(p.income).toMatchObject({ status: "complete", cents: 500000 });
    expect(p.partner!.income.monthlyCents).toBe(0);
    expect(issueCodes(p)).not.toContain("partnerIncomeUnknown");
  });
  it("Me unknown with the partner known is partial; both unknown is unknown (nothing known, no value)", () => {
    const a = run({ me: { profile: complete(null, 100) } });
    expect(a.income).toMatchObject({ status: "partial", cents: null, knownCents: 300000 });
    expect(issueCodes(a)).toContain("meIncomeUnknown");
    const b = run({ me: { profile: complete(null, 100) }, partner: { profile: complete(null, 50), name: "Alex", included: true } });
    expect(b.income).toMatchObject({ status: "unknown", cents: null, knownCents: 0 });
  });
  it("an excluded partner's income (even unknown) does not affect the household income", () => {
    const p = run({ partner: { profile: complete(null, 50), name: "Alex", included: false } });
    expect(p.income).toMatchObject({ status: "complete", cents: 500000 });
    expect(issueCodes(p)).not.toContain("partnerIncomeUnknown");
  });
  it("the lowest month is the sum of lowest months, and unknown if any irregular earner has none", () => {
    const irregular = (typical: number, low: number | null) => complete(null, 50, { payFrequency: "irregular", incomeTypical: typical, incomeLow: low });
    expect(run({ partner: { profile: irregular(3000, 1500), name: "Alex", included: true } }).income.lowCents).toBe(500000 + 150000);
    expect(run({ partner: { profile: irregular(3000, null), name: "Alex", included: true } }).income.lowCents).toBeNull();
  });
  it("flags when any included income is only an estimate", () => {
    expect(run().income.includesEstimates).toBe(false);
    expect(run({ partner: { profile: complete(3000, 50, { incomeBasis: "estimate" }), name: "Alex", included: true } }).income.includesEstimates).toBe(true);
  });
});

// ── total spending vs spending funded by included members ────────────────
describe("total household spending is separate from responsibility assigned to members", () => {
  const rent = (c: Contributions) => expense({ amount: 1800, contributions: c });

  it("both included: total = both people's personal + shared; nothing is externally funded", () => {
    const p = run({ shared: shared({ expenses: [rent({ me: 800, partner: 1000 })] }) });
    expect(p.spending.components).toEqual({ mePersonalCents: 80000, partnerPersonalCents: 40000, sharedCostsCents: 180000, jointDebtPaymentsCents: 0 });
    expect(p.spending.totalHousehold).toMatchObject({ status: "complete", cents: 300000 });
    expect(p.spending.assignedToIncluded.cents).toBe(300000);
    expect(p.spending.assignedToExcludedPartnerCents).toBe(0);
    expect(p.spending.unassignedCents).toBe(0);
    expect(p.available).toMatchObject({ status: "complete", cents: 500000 });
    sound(p);
  });

  it("partner EXCLUDED: their income and personal costs leave, but the shared rent stays in the household total", () => {
    const p = run({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [rent({ me: 800, partner: 1000 })] }) });
    expect(p.spending.components.sharedCostsCents).toBe(180000); // actual shared cost is NOT silently removed
    expect(p.spending.components.partnerPersonalCents).toBe(0);
    expect(p.spending.totalHousehold.cents).toBe(80000 + 180000);
    expect(p.spending.assignedToExcludedPartnerCents).toBe(100000); // what the excluded partner pays
    expect(p.spending.assignedToIncluded.cents).toBe(160000);
    expect(p.available.cents).toBe(500000 - 160000);
    expect(issueCodes(p)).toContain("partnerExcludedFundsSharedCosts");
    sound(p);
  });

  it("the shared total does not change when the partner is toggled in or out (only the funding does)", () => {
    const sh = shared({ expenses: [rent({ me: 800, partner: 1000 }), expense({ id: "e2", category: "utilities", label: "Power", amount: 300, contributions: { me: null, partner: 300 } })], debts: [jdebt({ contributions: { me: 1400, partner: null } })] });
    const inn = run({ shared: sh });
    const out = run({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: sh });
    expect(out.spending.components.sharedCostsCents).toBe(inn.spending.components.sharedCostsCents);
    expect(out.spending.components.jointDebtPaymentsCents).toBe(inn.spending.components.jointDebtPaymentsCents);
    expect(out.spending.assignedToExcludedPartnerCents).toBe(100000 + 30000);
    expect(inn.spending.assignedToExcludedPartnerCents).toBe(0);
    sound(inn);
    sound(out);
  });

  it("an unassigned remainder stays explicitly unassigned when the partner is excluded (never attributed to Me)", () => {
    const p = run({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [rent({ me: null, partner: 1000 })] }) });
    expect(p.spending.unassignedCents).toBe(80000);
    expect(p.ledger.unassignedCents).toBe(80000);
    expect(p.spending.assignedToExcludedPartnerCents).toBe(100000);
    expect(p.spending.assignedToIncluded.cents).toBe(80000); // only Me's own personal costs
    expect(p.ledger.me.contributionsCents).toBe(0);
    expect(p.spending.totalHousehold.cents).toBe(80000 + 180000);
    expect(issueCodes(p)).toContain("unassignedWithExcludedPartner");
    sound(p);
  });

  it("with an unassigned remainder and an excluded partner, definitive available is withheld and a provisional figure is labeled", () => {
    const p = run({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [rent({ me: null, partner: 1000 })] }) });
    expect(p.available.status).toBe("partial");
    expect(p.available.cents).toBeNull();
    expect(p.available.provisional).toEqual({ cents: 500000 - 80000 - 80000, assumptions: ["unassignedCoveredByHouseholdIncome"] });
    expect(p.shortfall).toBe("unknown");
    sound(p);
  });

  it("with the partner excluded and everything assigned, available is definitive", () => {
    const p = run({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [rent({ me: 800, partner: 1000 })] }) });
    expect(p.available).toMatchObject({ status: "complete", cents: 340000, provisional: null });
    sound(p);
  });

  it("a shared cost nobody is stated to pay is fully unassigned and fully counted (no 50/50)", () => {
    const p = run({ shared: shared({ expenses: [rent(NONE)] }) });
    expect(p.ledger.unassignedCents).toBe(180000);
    expect(p.ledger.me.contributionsCents).toBe(0);
    expect(p.ledger.partner!.contributionsCents).toBe(0);
    expect(p.spending.totalHousehold.cents).toBe(80000 + 40000 + 180000);
    expect(issueCodes(p)).toContain("payerNotSet");
    sound(p);
  });
});

// ── unknown / partial / complete ─────────────────────────────────────────
describe("totals are complete, partial or unknown; a blank is never zero", () => {
  it("shared costs not yet answered keep household spending PARTIAL (not $0, not complete)", () => {
    const p = run({ shared: emptyShared() });
    expect(p.spending.totalHousehold).toMatchObject({ status: "partial", cents: null, knownCents: 120000 });
    expect(p.spending.totalHousehold.missing).toEqual(expect.arrayContaining([{ scope: "shared", key: "sharedCosts" }, { scope: "shared", key: "sharedDebts" }]));
    expect(issueCodes(p)).toEqual(expect.arrayContaining(["sharedCostsUnanswered", "sharedDebtsUnanswered"]));
    expect(p.available).toMatchObject({ status: "partial", cents: null, knownCents: 800000 - 120000 });
    sound(p);
  });
  it("saying 'no shared costs / no joint debts' makes them a real, complete zero", () => {
    expect(run({ shared: shared() }).spending.totalHousehold.status).toBe("complete");
    expect(run({ shared: shared({ noSharedExpenses: false }) }).spending.totalHousehold.status).toBe("partial");
  });
  it("an explicit $0 shared cost is a known zero", () => {
    const p = run({ shared: shared({ noSharedExpenses: false, expenses: [expense({ amount: 0 })] }) });
    expect(p.spending.totalHousehold.status).toBe("complete");
    expect(p.sharedItems[0].allocation.status).toBe("assigned");
    expect(issueCodes(p)).not.toContain("payerNotSet");
  });
  it("a person with missing answers makes the household spending partial and names what is missing", () => {
    const p = run({ me: { profile: complete(5000, 100, { expenses: { housing: { amount: 100, basis: "actual" } } }) } });
    expect(p.spending.totalHousehold.status).toBe("partial");
    expect(p.spending.totalHousehold.missing).toContainEqual({ scope: "me", key: "expenses" });
    expect(p.spending.totalHousehold.cents).toBeNull();
  });
  it("nothing known at all is UNKNOWN, with no value (never $0)", () => {
    const p = run({ me: { profile: profile() }, partner: null, shared: emptyShared() });
    expect(p.spending.totalHousehold).toMatchObject({ status: "unknown", cents: null, knownCents: 0 });
    expect(p.income.status).toBe("unknown");
    expect(p.available).toMatchObject({ status: "unknown", cents: null });
    sound(p);
  });
  it("a person's unknown INCOME does not make their SPENDING look incomplete", () => {
    const p = run({ me: { profile: complete(null, 100) } });
    expect(p.me.spendingStatus).toBe("complete");
    expect(p.spending.totalHousehold.missing).toEqual([]);
    expect(p.income.missing).toEqual([{ scope: "me", key: "income" }]);
  });
  it("contributions naming a partner who does not exist stay unassigned and are flagged (the ledger still balances)", () => {
    const p = run({ partner: null, shared: shared({ expenses: [expense({ contributions: { me: 500, partner: 700 } })] }) });
    expect(p.ledger.partner).toBeNull();
    expect(p.sharedItems[0].allocation).toMatchObject({ meCents: 50000, partnerCents: 0, unassignedCents: 130000 });
    expect(p.issues.find((i) => i.code === "contributionsInvalid")).toMatchObject({ reason: "noPartner" });
    sound(p);
  });
  it("unknown income withholds available cash even when spending is complete", () => {
    const p = run({ me: { profile: complete(null, 100) } });
    expect(p.spending.totalHousehold.status).toBe("complete");
    expect(p.available.cents).toBeNull();
    expect(p.available.status).toBe("unknown");
  });
  it("a joint debt with no monthly payment is partial, not $0", () => {
    const p = run({ shared: shared({ noSharedDebts: false, debts: [jdebt({ monthlyPayment: null })] }) });
    expect(p.spending.totalHousehold.status).toBe("partial");
    expect(p.spending.totalHousehold.missing).toContainEqual({ scope: "shared", key: "jointDebtPayments" });
    expect(p.spending.components.jointDebtPaymentsCents).toBe(0);
  });
  it("a shortfall can be DEFINITE even with unknown costs (unknown costs can only add), otherwise it stays unknown", () => {
    const poor = run({ me: { profile: complete(500, 100) }, partner: { profile: complete(100, 50), name: "Alex", included: true }, shared: emptyShared() });
    expect(poor.shortfall).toBe("definite"); // known spending already exceeds known income
    const ok = run({ shared: emptyShared() });
    expect(ok.shortfall).toBe("unknown");
    expect(run().shortfall).toBe("none");
    expect(run({ shared: shared({ expenses: [expense({ amount: 9000 })] }) }).shortfall).toBe("definite");
  });
});

// ── Phase 1 parity ───────────────────────────────────────────────────────
describe("Phase 1 parity: the household layer reuses the personal calculations", () => {
  it("with no partner and nothing shared, the household equals Me's own plan", () => {
    const me = complete(5000, 100, { useBills: true, useAccounts: true });
    const records = { bills: [bill()], accounts: [account()], subscriptions: [sub()] };
    const own = buildPlan({ profile: me, ...records, todayISO: TODAY });
    const p = buildHouseholdPlan({ ...inputs(), me: { profile: me }, partner: null, records });
    expect(p.spending.totalHousehold.knownCents).toBe(own.outflowCents);
    expect(p.income.cents).toBe(own.income.monthlyCents);
    expect(p.available.cents).toBe(own.availableCents);
    sound(p);
  });
  it("the partner's personal figures equal the partner plan the Partner tab shows", () => {
    const pp = complete(3000, 50, { savingsMonthly: 40 });
    const own = buildPlan({ profile: { ...pp, useBills: false, useAccounts: false, useSubscriptions: true }, bills: [], accounts: [], subscriptions: [], todayISO: TODAY });
    const p = run({ partner: { profile: pp, name: "Alex", included: true } });
    expect(p.partner!.planOutflowCents).toBe(own.outflowCents);
    expect(p.partner!.plan.availableCents).toBe(own.availableCents);
  });
  it("Finances records are counted once and attributed to Me; the partner has none", () => {
    const me = complete(5000, 100, { useBills: true, useSubscriptions: true });
    const p = run({ me: { profile: me }, records: { bills: [bill()], accounts: [], subscriptions: [sub()] } });
    expect(p.me.personalSpendingCents).toBe(80000 + 180000 + 1500);
    expect(p.partner!.personalSpendingCents).toBe(40000);
    sound(p);
  });
  it("a subscription tied to a counted bill is not counted twice (the Phase 1 rule still holds)", () => {
    const me = complete(5000, 100, { useBills: true, useSubscriptions: true });
    const p = run({ me: { profile: me }, records: { bills: [bill({ id: "b2", name: "Streaming", amountType: "fixed", expectedAmount: 15, category: "Memberships" })], accounts: [], subscriptions: [sub({ billId: "b2" })] } });
    expect(p.me.personalSpendingCents).toBe(80000 + 1500);
  });
});

// ── reconciliation ───────────────────────────────────────────────────────
describe("reconciliation: one cost, counted once, nothing deleted or merged", () => {
  const meWithBills = complete(5000, 100, { useBills: true });

  it("a shared rent linked to a counted Bill is counted ONCE, through the Bill (Finances is authoritative)", () => {
    const rentBill = { bills: [bill()], accounts: [], subscriptions: [] };
    const linked = run({ me: { profile: meWithBills }, records: rentBill, shared: shared({ expenses: [expense({ links: [{ kind: "bill", id: "b1" }] })] }) });
    const unlinked = run({ me: { profile: meWithBills }, records: rentBill, shared: shared({ expenses: [expense()] }) });
    expect(linked.sharedItems[0]).toMatchObject({ counted: false, excludedReason: "record", representedBy: { kind: "bill", id: "b1" }, totalCents: 0 });
    expect(linked.spending.components.sharedCostsCents).toBe(0);
    expect(linked.spending.totalHousehold.cents).toBe(80000 + 180000 + 40000);
    // removing the link adds exactly the duplicate amount (conservation)
    expect(unlinked.spending.totalHousehold.cents! - linked.spending.totalHousehold.cents!).toBe(180000);
    sound(linked);
    sound(unlinked);
  });

  it("contributions entered on a Finances-linked cost are informational only: preserved, never counted twice", () => {
    const withIt = run({ me: { profile: meWithBills }, records: { bills: [bill()], accounts: [], subscriptions: [] }, shared: shared({ expenses: [expense({ contributions: { me: 900, partner: 900 }, links: [{ kind: "bill", id: "b1" }] })] }) });
    const without = run({ me: { profile: meWithBills }, records: { bills: [bill()], accounts: [], subscriptions: [] }, shared: shared({ expenses: [expense({ links: [{ kind: "bill", id: "b1" }] })] }) });
    const item = withIt.sharedItems[0];
    expect(item).toMatchObject({ counted: false, excludedReason: "record", enteredCents: 180000, informational: { meCents: 90000, partnerCents: 90000 } });
    expect(withIt.ledger.me.contributionsCents).toBe(0);
    expect(withIt.ledger.partner!.contributionsCents).toBe(0);
    expect(withIt.spending).toEqual(without.spending); // identical totals: the record is the single authoritative count
    expect(withIt.available).toEqual(without.available);
    expect(issueCodes(withIt)).toContain("contributionsInformationalOnLinked");
    sound(withIt);
  });

  it("informational contributions that exceed the entered amount are flagged invalid, not kept", () => {
    const p = run({ me: { profile: meWithBills }, records: { bills: [bill()], accounts: [], subscriptions: [] }, shared: shared({ expenses: [expense({ contributions: { me: 1500, partner: 1500 }, links: [{ kind: "bill", id: "b1" }] })] }) });
    expect(p.sharedItems[0].informational).toBeNull();
    expect(issueCodes(p)).toContain("contributionsInvalid");
    sound(p);
  });

  it("a link only wins when its record is REALLY counted, so a cost never silently disappears", () => {
    const e = (id: string, kind: "bill" | "subscription" | "account") => shared({ expenses: [expense({ links: [{ kind, id }] })] });
    const cases: [string, Partial<HouseholdInputs>, string][] = [
      ["bills not included", { me: { profile: complete(5000, 100, { useBills: false }) }, records: { bills: [bill()], accounts: [], subscriptions: [] }, shared: e("b1", "bill") }, "notIncluded"],
      ["missing bill", { me: { profile: meWithBills }, shared: e("nope", "bill") }, "missing"],
      ["archived bill", { me: { profile: meWithBills }, records: { bills: [bill({ archivedAt: "2026-01-02T00:00:00Z" })], accounts: [], subscriptions: [] }, shared: e("b1", "bill") }, "missing"],
      ["bill with no amount", { me: { profile: meWithBills }, records: { bills: [bill({ amountType: "variable", expectedAmount: null })], accounts: [], subscriptions: [] }, shared: e("b1", "bill") }, "noAmount"],
      ["subscriptions not included", { me: { profile: complete(5000, 100, { useSubscriptions: false }) }, records: { bills: [], accounts: [], subscriptions: [sub()] }, shared: e("s1", "subscription") }, "notIncluded"],
      ["paused subscription", { me: { profile: complete(5000, 100) }, records: { bills: [], accounts: [], subscriptions: [sub({ status: "paused" })] }, shared: e("s1", "subscription") }, "noAmount"],
      ["accounts not included", { me: { profile: complete(5000, 100) }, records: { bills: [], accounts: [account()], subscriptions: [] }, shared: e("a1", "account") }, "notIncluded"],
    ];
    for (const [name, over, reason] of cases) {
      const p = run(over);
      expect(p.sharedItems[0], name).toMatchObject({ counted: true, totalCents: 180000, excludedReason: null });
      expect(p.links[0], name).toMatchObject({ active: false, reason });
      expect(p.spending.components.sharedCostsCents, name).toBe(180000);
      sound(p);
    }
  });

  it("subscription and account links work when the record is counted", () => {
    const sp = run({ me: { profile: complete(5000, 100) }, records: { bills: [], accounts: [], subscriptions: [sub()] }, shared: shared({ expenses: [expense({ category: "other", label: "Netflix", amount: 15, links: [{ kind: "subscription", id: "s1" }] })] }) });
    expect(sp.sharedItems[0]).toMatchObject({ counted: false, excludedReason: "record" });
    expect(sp.me.personalSpendingCents).toBe(80000 + 1500); // the subscription is counted once, in Me's plan
    const ap = run({ me: { profile: complete(5000, 100, { useAccounts: true }) }, records: { bills: [], accounts: [account()], subscriptions: [] }, shared: shared({ expenses: [expense({ category: "other", label: "Card", amount: 35, links: [{ kind: "account", id: "a1" }] })] }) });
    expect(ap.sharedItems[0]).toMatchObject({ counted: false });
    expect(ap.me.personalSpendingCents).toBe(80000 + 3500);
  });

  it("a subscription that is counted through its linked bill is a valid link target", () => {
    const me = complete(5000, 100, { useBills: true, useSubscriptions: true });
    const p = run({
      me: { profile: me },
      records: { bills: [bill({ id: "b2", expectedAmount: 15, category: "Memberships" })], accounts: [], subscriptions: [sub({ billId: "b2" })] },
      shared: shared({ expenses: [expense({ category: "other", label: "Stream", amount: 15, links: [{ kind: "subscription", id: "s1" }] })] }),
    });
    expect(p.links[0].active).toBe(true);
    expect(p.sharedItems[0].counted).toBe(false);
    expect(p.me.personalSpendingCents).toBe(80000 + 1500);
  });

  it("a personal expense row linked to a shared cost is excluded from that person's household spending, never deleted", () => {
    const me = complete(5000, 100, { expenses: { ...complete(5000, 100).expenses, housing: { amount: 1800, basis: "actual" } } });
    const frozen = deepFreeze(inputs({ me: { profile: me }, shared: shared({ expenses: [expense({ links: [{ kind: "personalExpense", person: "me", category: "housing" }] })] }) }));
    const before = JSON.stringify(frozen);
    const p = buildHouseholdPlan(frozen);
    expect(JSON.stringify(frozen)).toBe(before); // inputs untouched
    expect(frozen.me.profile.expenses.housing?.amount).toBe(1800);
    expect(p.me.planOutflowCents).toBe(70000 + 180000); // Me's own plan still shows the row
    expect(p.me.reconciledAwayCents).toBe(180000);
    expect(p.me.personalSpendingCents).toBe(70000);
    expect(p.spending.totalHousehold.cents).toBe(70000 + 40000 + 180000);
    // Me's row is linked, so it is not flagged; the partner's own (unlinked) housing row legitimately still is.
    expect(p.issues.filter((i) => i.code === "possibleSharedPersonalOverlap").map((i) => i.person)).toEqual(["partner"]);
    sound(p);
    // without the link the same cost would be counted twice, and is flagged (not silently merged)
    const un = run({ me: { profile: me }, shared: shared({ expenses: [expense()] }) });
    expect(un.spending.totalHousehold.cents).toBe(250000 + 40000 + 180000);
    expect(un.issues.find((i) => i.code === "possibleSharedPersonalOverlap")).toMatchObject({ person: "me", cents: 180000 });
  });

  it("the partner's personal row can be linked too; an excluded partner's rows need no adjustment", () => {
    const pt = complete(3000, 50, { expenses: { ...complete(3000, 50).expenses, housing: { amount: 1800, basis: "actual" } } });
    const link = shared({ expenses: [expense({ links: [{ kind: "personalExpense", person: "partner", category: "housing" }] })] });
    const inn = run({ partner: { profile: pt, name: "Alex", included: true }, shared: link });
    expect(inn.partner!.personalSpendingCents).toBe(35000);
    const out = run({ partner: { profile: pt, name: "Alex", included: false }, shared: link });
    expect(out.spending.components.partnerPersonalCents).toBe(0);
    expect(out.spending.components.sharedCostsCents).toBe(180000);
    sound(inn);
    sound(out);
  });

  it("a personal row already covered by Bills (Phase 1) makes a shared cost linked to it a duplicate of the Bill, not a new cost", () => {
    const me = complete(5000, 100, { useBills: true, expenses: { ...complete(5000, 100).expenses, housing: { amount: 1800, basis: "actual", covered: true } } });
    const p = run({
      me: { profile: me },
      records: { bills: [bill()], accounts: [], subscriptions: [] },
      shared: shared({ expenses: [expense({ links: [{ kind: "personalExpense", person: "me", category: "housing" }] })] }),
    });
    expect(p.sharedItems[0]).toMatchObject({ counted: false, excludedReason: "personalRowViaFinances" });
    expect(p.spending.totalHousehold.cents).toBe(70000 + 180000 + 40000); // the rent exists once: in the Bill
    sound(p);
  });

  it("two shared costs linked to the same personal row subtract it only once", () => {
    const me = complete(5000, 100, { expenses: { ...complete(5000, 100).expenses, housing: { amount: 1800, basis: "actual" } } });
    const link = { kind: "personalExpense" as const, person: "me" as const, category: "housing" as const };
    const p = run({ me: { profile: me }, shared: shared({ expenses: [expense({ id: "e1", links: [link] }), expense({ id: "e2", label: "Rent again", links: [link] })] }) });
    expect(p.me.reconciledAwayCents).toBe(180000);
    expect(p.links.find((l) => l.reason === "duplicate")).toBeTruthy();
    expect(issueCodes(p)).toContain("duplicateLink");
  });

  it("a link to a personal row that does not exist does nothing", () => {
    const p = run({ shared: shared({ expenses: [expense({ links: [{ kind: "personalExpense", person: "me", category: "healthcare" }] })].map((e) => ({ ...e })) }) });
    const me = complete(5000, 100, { expenses: {} });
    const q = run({ me: { profile: me }, shared: shared({ expenses: [expense({ links: [{ kind: "personalExpense", person: "me", category: "housing" }] })] }) });
    expect(q.links[0]).toMatchObject({ active: false, reason: "missing" });
    expect(q.me.reconciledAwayCents).toBe(0);
    expect(p.sharedItems[0].counted).toBe(true);
  });
});

describe("debts: counted once, balances kept apart", () => {
  it("a joint debt counts its payment once, and its balance separately from every monthly figure", () => {
    const p = run({ shared: shared({ noSharedDebts: false, debts: [jdebt({ contributions: { me: 1400, partner: null } })] }) });
    expect(p.spending.components.jointDebtPaymentsCents).toBe(140000);
    expect(p.debtBalances).toMatchObject({ jointCents: 25000000, personalCents: 0, totalCents: 25000000 });
    expect(p.spending.totalHousehold.cents).toBe(80000 + 40000 + 140000); // the $250,000 balance is not spending
    expect(p.ledger.me.contributionsCents).toBe(140000);
    sound(p);
  });
  it("a joint debt linked to a counted Payments account is counted through the account, once", () => {
    const me = complete(5000, 100, { useAccounts: true });
    const p = run({ me: { profile: me }, records: { bills: [], accounts: [account({ balance: 5000, minimumPayment: 200 })], subscriptions: [] }, shared: shared({ noSharedDebts: false, debts: [jdebt({ monthlyPayment: 200, balance: 5000, links: [{ kind: "account", id: "a1" }] })] }) });
    expect(p.sharedItems[0]).toMatchObject({ counted: false, excludedReason: "record" });
    expect(p.spending.components.jointDebtPaymentsCents).toBe(0);
    expect(p.me.personalSpendingCents).toBe(80000 + 20000);
    expect(p.debtBalances.jointCents).toBe(0);
    expect(p.debtBalances.personalCents).toBe(500000); // the account's balance, once
    sound(p);
  });
  it("a joint debt linked to a personal debt entry replaces it (payment and balance counted once)", () => {
    const me = complete(5000, 100, { noDebts: false, debts: [debt({ id: "d1", name: "Car loan", balance: 12000, monthlyPayment: 350 })] });
    const linked = run({ me: { profile: me }, shared: shared({ noSharedDebts: false, debts: [jdebt({ name: "Car loan", balance: 12000, monthlyPayment: 350, links: [{ kind: "personalDebt", person: "me", debtId: "d1" }] })] }) });
    const alone = run({ me: { profile: me } });
    expect(linked.spending.totalHousehold.cents).toBe(alone.spending.totalHousehold.cents); // same $350, once
    expect(linked.debtBalances.totalCents).toBe(alone.debtBalances.totalCents + 0);
    expect(linked.me.reconciledAwayCents).toBe(35000);
    expect(issueCodes(linked)).not.toContain("possibleDuplicateJointDebt");
    sound(linked);
  });
  it("without the link, a joint debt that looks like a personal one is flagged, and both still count (nothing is merged)", () => {
    const me = complete(5000, 100, { noDebts: false, debts: [debt({ id: "d1", name: "Car loan" })] });
    const p = run({ me: { profile: me }, shared: shared({ noSharedDebts: false, debts: [jdebt({ name: "Car loan", monthlyPayment: 350, balance: 12000 })] }) });
    expect(issueCodes(p)).toContain("possibleDuplicateJointDebt");
    expect(p.spending.totalHousehold.cents).toBe(80000 + 35000 + 40000 + 35000);
  });
  it("a personal debt already tracked by a Payments account makes a joint debt linked to it a duplicate", () => {
    const me = complete(5000, 100, { useAccounts: true, noDebts: false, debts: [debt({ id: "d2", name: "Visa", balance: 900, monthlyPayment: 35, accountId: "a1" })] });
    const p = run({ me: { profile: me }, records: { bills: [], accounts: [account()], subscriptions: [] }, shared: shared({ noSharedDebts: false, debts: [jdebt({ name: "Visa", monthlyPayment: 35, balance: 900, links: [{ kind: "personalDebt", person: "me", debtId: "d2" }] })] }) });
    expect(p.sharedItems[0]).toMatchObject({ counted: false, excludedReason: "personalRowViaFinances" });
    expect(p.spending.components.jointDebtPaymentsCents).toBe(0);
    expect(p.debtBalances.jointCents).toBe(0);
    sound(p);
  });
  it("a joint debt with no balance is counted as a missing balance, not $0", () => {
    const p = run({ shared: shared({ noSharedDebts: false, debts: [jdebt({ balance: null })] }) });
    expect(p.debtBalances.missingJointBalances).toBe(1);
    expect(p.debtBalances.jointCents).toBe(0);
  });
  it("the partner's own debts and balances are counted when included, and not when excluded", () => {
    const pt = complete(3000, 50, { noDebts: false, debts: [debt({ id: "p1", name: "Student loan", balance: 20000, monthlyPayment: 200 })] });
    const inn = run({ partner: { profile: pt, name: "Alex", included: true } });
    const out = run({ partner: { profile: pt, name: "Alex", included: false } });
    expect(inn.debtBalances.personalCents).toBe(2000000);
    expect(out.debtBalances.personalCents).toBe(0);
    expect(inn.partner!.personalSpendingCents).toBe(40000 + 20000);
  });
});

describe("possible overlaps are reported, never auto-resolved", () => {
  it("shared cost vs the same category in a personal profile", () => {
    const base = run({ shared: shared({ expenses: [expense({ amount: 1800 })] }) });
    const flagged = base.issues.filter((i) => i.code === "possibleSharedPersonalOverlap");
    expect(flagged.map((i) => i.person).sort()).toEqual(["me", "partner"]);
    expect(base.spending.components.sharedCostsCents).toBe(180000); // still counted: nothing was removed
  });
  it("shared cost vs an included Bill of the same category, and vs a counted subscription name", () => {
    const me = complete(5000, 100, { useBills: true, useSubscriptions: true });
    const p = run({ me: { profile: me }, records: { bills: [bill()], accounts: [], subscriptions: [sub()] }, shared: shared({ expenses: [expense({ id: "r" }), expense({ id: "n", category: "other", label: "Netflix", amount: 15 })] }) });
    expect(issueCodes(p)).toEqual(expect.arrayContaining(["possibleBillOverlap", "possibleSubscriptionOverlap"]));
    expect(p.spending.components.sharedCostsCents).toBe(180000 + 1500);
  });
  it("these heuristics change no totals: the totals equal the plain sums", () => {
    const sh = shared({ expenses: [expense({ amount: 1800 })] });
    const p = run({ shared: sh });
    expect(p.spending.totalHousehold.cents).toBe(80000 + 40000 + 180000);
    sound(p);
  });
});

// ── savings and goals ────────────────────────────────────────────────────
describe("goals: deterministic arithmetic only", () => {
  it("months until the target are calendar months (a later day this month counts as 1; the past is 0)", () => {
    expect(monthsUntil("2026-11-04", "2026-11-20")).toBe(1);
    expect(monthsUntil("2026-11-04", "2026-12-04")).toBe(1);
    expect(monthsUntil("2026-11-04", "2027-11-04")).toBe(12);
    expect(monthsUntil("2026-11-04", "2026-11-04")).toBe(0);
    expect(monthsUntil("2026-11-04", "2026-01-01")).toBe(0);
  });
  it("statuses: missing target, missing date, achieved, past due, no contributions, on track, short", () => {
    const g = (over: Partial<SharedGoal>, planned: number) => goalProgress(goal(over), TODAY, planned);
    expect(g({ targetAmount: null }, 0).status).toBe("noTarget");
    expect(g({ targetDate: null }, 0).status).toBe("noDate");
    expect(g({ savedAmount: 12000 }, 0).status).toBe("achieved");
    expect(g({ targetDate: "2026-10-01" }, 0)).toMatchObject({ status: "pastDue", monthsLeft: 0 });
    expect(g({}, 0)).toMatchObject({ status: "noContributions", requiredMonthlyCents: 100000, shortByMonthlyCents: 100000 });
    expect(g({}, 100000)).toMatchObject({ status: "onTrack", shortByMonthlyCents: 0 });
    expect(g({}, 60000)).toMatchObject({ status: "short", shortByMonthlyCents: 40000, plannedMonthlyCents: 60000 });
    expect(g({ savedAmount: 2000 }, 0).requiredMonthlyCents).toBe(Math.ceil(1000000 / 12));
  });
  it("planned contributions feed household savings, unless flagged as already inside a person's monthly savings", () => {
    const sh = shared({ goals: [goal({ contributions: { me: 300, partner: 200 } }), goal({ id: "g2", name: "Trip", contributions: { me: 100, partner: 50 }, countedInSavings: { me: true, partner: false } })] });
    const p = run({ me: { profile: complete(5000, 100, { savingsMonthly: 400 }) }, shared: sh });
    expect(p.savings.goalContributionsCents).toBe(30000 + 20000 + 0 + 5000);
    expect(p.savings.plannedCents).toBe(40000 + 55000);
    expect(p.savings.capacityCents).toBe(800000 - 120000 - 95000);
    expect(p.goals.map((x) => x.plannedMonthlyCents)).toEqual([50000, 15000]);
  });
  it("an excluded partner's goal contribution still counts toward the goal, but not toward household savings", () => {
    const p = run({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ goals: [goal({ contributions: { me: 100, partner: 200 } })] }) });
    expect(p.goals[0].plannedMonthlyCents).toBe(30000);
    expect(p.savings.goalContributionsCents).toBe(10000);
  });
  it("savings capacity needs a complete available figure, and a shortfall after savings is flagged", () => {
    expect(run({ shared: emptyShared() }).savings.capacityCents).toBeNull();
    const tight = run({ me: { profile: complete(900, 100, { savingsMonthly: 200 }) }, partner: { profile: complete(100, 0), name: "Alex", included: false } });
    expect(tight.available.cents).toBe(10000);
    expect(tight.savings).toMatchObject({ capacityCents: 0, shortfallAfterSavings: true });
  });
});

describe("household composition (size is not tax-dependent eligibility)", () => {
  const c = (over: Partial<Composition>): Composition => ({ ...emptyComposition(), ...over });
  it("size is complete only when adults, children and other members are all stated", () => {
    expect(householdSize(c({}))).toEqual({ status: "unknown", total: null, knownTotal: 0 });
    expect(householdSize(c({ adults: 2 }))).toEqual({ status: "partial", total: null, knownTotal: 2 });
    expect(householdSize(c({ adults: 2, children: 0, otherMembers: 1 }))).toEqual({ status: "complete", total: 3, knownTotal: 3 });
  });
  it("an explicit 0 children is an answer, blank is not", () => {
    expect(householdSize(c({ adults: 2, children: 0 })).status).toBe("partial");
    expect(householdSize(c({ adults: 2, children: 0, otherMembers: 0 })).total).toBe(2);
  });
  it("validates ranges and whole numbers", () => {
    expect(compositionErrors(c({ adults: 0, children: 16, otherMembers: 2.5 }))).toEqual({ adults: "range", children: "range", otherMembers: "integer" });
    expect(compositionErrors(c({ adults: 2, children: 0, otherMembers: 0 }))).toEqual({});
  });
  it("is carried into the plan, with a note when a partner exists but fewer than two adults are stated", () => {
    const p = run({ composition: c({ adults: 1, children: 2, otherMembers: 0 }) });
    expect(p.composition.size).toEqual({ status: "complete", total: 3, knownTotal: 3 });
    expect(issueCodes(p)).toContain("compositionAdultsBelowEarners");
    expect(issueCodes(run({ composition: c({ adults: 2 }) }))).not.toContain("compositionAdultsBelowEarners");
  });
});

// ── accounting invariants ────────────────────────────────────────────────
describe("accounting invariants", () => {
  const scenarios: [string, Partial<HouseholdInputs>][] = [
    ["both included, nothing shared", {}],
    ["both included, custom split", { shared: shared({ expenses: [expense({ contributions: { me: 1000, partner: 800 } })] }) }],
    ["both included, unassigned remainder", { shared: shared({ expenses: [expense({ contributions: { me: 1000, partner: null } })] }) }],
    ["both included, payer not set", { shared: shared({ expenses: [expense()] }) }],
    ["partner excluded, paying part", { partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [expense({ contributions: { me: 800, partner: 1000 } })] }) }],
    ["partner excluded, nothing stated", { partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [expense()] }) }],
    ["partner income unknown", { partner: { profile: complete(null, 50), name: "Alex", included: true }, shared: shared({ expenses: [expense({ contributions: { me: 1800, partner: null } })] }) }],
    ["my income unknown", { me: { profile: complete(null, 100) } }],
    ["no partner", { partner: null }],
    ["shared costs unanswered", { shared: emptyShared() }],
    ["joint debt + shared cost", { shared: shared({ noSharedDebts: false, expenses: [expense({ contributions: { me: 900, partner: 900 } })], debts: [jdebt({ contributions: { me: 700, partner: 700 } })] }) }],
    ["linked to a Bill", { me: { profile: complete(5000, 100, { useBills: true }) }, records: { bills: [bill()], accounts: [], subscriptions: [] }, shared: shared({ expenses: [expense({ links: [{ kind: "bill", id: "b1" }] })] }) }],
  ];
  for (const [name, over] of scenarios) {
    it(`holds: ${name}`, () => {
      const p = run(over);
      expect(accountingInvariantViolations(p)).toEqual([]);
    });
  }

  it("INV-4 (ledger): everyone's remaining minus 'not yet assigned' equals household available", () => {
    const p = run({ shared: shared({ expenses: [expense({ contributions: { me: 1000, partner: 500 } })] }) });
    expect(p.ledger.me.remainingCents).toBe(500000 - 80000 - 100000);
    expect(p.ledger.partner!.remainingCents).toBe(300000 - 40000 - 50000);
    expect(p.ledger.unassignedCents).toBe(30000);
    expect(p.ledger.me.remainingCents! + p.ledger.partner!.remainingCents! - p.ledger.unassignedCents).toBe(p.available.cents);
    expect(p.available.cents).toBe(800000 - 120000 - 180000);
  });

  it("holds across many generated scenarios, and agrees with a first-principles recomputation", () => {
    let seed = 20261107;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const money = () => pick([0, 10, 33.33, 120, 450.5, 1800, 2500]);
    const contrib = (): Contributions => ({ me: rnd() < 0.5 ? null : pick([0, 100, 450.5, 1000]), partner: rnd() < 0.5 ? null : pick([0, 100, 450.5, 800]) });
    let checked = 0;
    for (let n = 0; n < 400; n++) {
      const mkProfile = (): FinancialProfile =>
        complete(pick([null, 0, 1500, 4200.5, 5000]), pick([0, 10, 50, 100]), {
          expenses: Object.fromEntries(EXPENSE_CATEGORIES.filter(() => rnd() < 0.85).map((c) => [c, { amount: money() / 10, basis: "actual" as const }])),
          savingsMonthly: rnd() < 0.3 ? 50 : null,
        });
      const items: SharedExpense[] = Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => expense({ id: "e" + i, category: pick([...EXPENSE_CATEGORIES]), amount: money(), contributions: contrib() }));
      const debts: SharedDebt[] = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => jdebt({ id: "j" + i, name: "Debt " + i + "x" + n, monthlyPayment: rnd() < 0.2 ? null : money(), balance: money(), contributions: contrib() }));
      const included = rnd() < 0.6;
      const p = run({
        me: { profile: mkProfile() },
        partner: rnd() < 0.1 ? null : { profile: mkProfile(), name: "Alex", included },
        shared: { expenses: items, noSharedExpenses: rnd() < 0.5, debts, noSharedDebts: rnd() < 0.5, goals: [] },
      });
      expect(accountingInvariantViolations(p).join(" | "), `scenario ${n}`).toBe("");
      // first-principles recomputation of the headline numbers
      const counted = p.sharedItems.filter((i) => i.counted);
      const sharedTotal = counted.reduce((s, i) => s + i.totalCents, 0);
      const personal = p.me.personalSpendingCents + (p.partner && p.partnerIncluded ? p.partner.personalSpendingCents : 0);
      expect(p.spending.totalHousehold.knownCents).toBe(personal + sharedTotal);
      const external = p.partner && !p.partnerIncluded ? counted.reduce((s, i) => s + i.allocation.partnerCents, 0) : 0;
      const meStated = counted.reduce((s, i) => s + i.allocation.meCents, 0);
      const unassignedSum = counted.reduce((s, i) => s + i.allocation.unassignedCents, 0);
      expect(p.spending.assignedToIncluded.knownCents).toBe(personal + meStated + (p.partner && p.partnerIncluded ? counted.reduce((s, i) => s + i.allocation.partnerCents, 0) : 0));
      expect(p.spending.assignedToExcludedPartnerCents).toBe(external);
      expect(p.spending.unassignedCents).toBe(unassignedSum);
      if (p.available.status === "complete") expect(p.available.cents).toBe(p.income.cents! - p.spending.assignedToIncluded.cents! - p.spending.unassignedCents);
      if (p.income.status !== "complete") expect(p.available.cents).toBeNull();
      for (const i of counted) expect(i.allocation.meCents + i.allocation.partnerCents + i.allocation.unassignedCents).toBe(i.totalCents);
      checked++;
    }
    expect(checked).toBe(400);
  });

  it("detects a broken plan (the checker is not vacuous)", () => {
    const good = run({ shared: shared({ expenses: [expense({ contributions: { me: 1000, partner: 800 } })] }) });
    expect(accountingInvariantViolations(good)).toEqual([]);
    const a = structuredClone(good);
    a.spending.components.sharedCostsCents += 1;
    expect(accountingInvariantViolations(a).join()).toMatch(/INV-1/);
    const b = structuredClone(good);
    b.sharedItems[0].allocation.meCents += 5;
    expect(accountingInvariantViolations(b).join()).toMatch(/INV-3/);
    const c = structuredClone(good);
    c.ledger.me.remainingCents = (c.ledger.me.remainingCents as number) + 1;
    expect(accountingInvariantViolations(c).join()).toMatch(/INV-4/);
    const d = structuredClone(good);
    d.available.cents = 123;
    d.income.status = "partial";
    expect(accountingInvariantViolations(d).join()).toMatch(/INV-6/);
    const e = structuredClone(good);
    e.spending.assignedToExcludedPartnerCents = 5;
    expect(accountingInvariantViolations(e).join()).toMatch(/INV-2/);
    const f = structuredClone(good);
    f.sharedItems[0].allocation = { meCents: 100, partnerCents: 100, unassignedCents: 0, status: "unassigned" };
    expect(accountingInvariantViolations(f).join()).toMatch(/INV-11/);
  });

  it("is a pure function: same inputs, same output; inputs are never modified", () => {
    const i = deepFreeze(inputs({ shared: shared({ expenses: [expense({ contributions: { me: 900, partner: 900 }, links: [{ kind: "personalExpense", person: "me", category: "housing" }] })], debts: [jdebt()] }), records: { bills: [bill()], accounts: [account()], subscriptions: [sub()] } }));
    expect(buildHouseholdPlan(i)).toEqual(buildHouseholdPlan(i));
  });
});

describe("Step 1 refinements: suggestions, provisional figures, timing, overlaps, Me, USD", () => {
  const meRow = [{ kind: "personalExpense" as const, person: "me" as const, category: "housing" as const }];
  const partnerRow = [{ kind: "personalExpense" as const, person: "partner" as const, category: "housing" as const }];

  it("a linked personal row produces a SUGGESTION only; nothing is applied", () => {
    const p = run({ shared: shared({ expenses: [expense({ links: [...meRow, ...partnerRow] })] }) });
    const item = p.sharedItems[0];
    expect(item.suggestions).toEqual([
      { person: "me", cents: 10000, sourceCents: 10000, capped: false, source: "linkedPersonalRow" },
      { person: "partner", cents: 5000, sourceCents: 5000, capped: false, source: "linkedPersonalRow" },
    ]);
    expect(item.allocation.meCents).toBe(0);
    expect(item.allocation.partnerCents).toBe(0);
    expect(item.allocation.unassignedCents).toBe(180000);
    expect(p.ledger.me.contributionsCents).toBe(0);
    sound(p);
  });

  it("a suggestion is capped at what is still unassigned and skips people who already stated a contribution", () => {
    const small = run({ shared: shared({ expenses: [expense({ amount: 60, links: meRow })] }) });
    expect(small.sharedItems[0].suggestions).toEqual([{ person: "me", cents: 6000, sourceCents: 10000, capped: true, source: "linkedPersonalRow" }]);
    const stated = run({ shared: shared({ expenses: [expense({ contributions: { me: 500, partner: null }, links: [...meRow, ...partnerRow] })] }) });
    expect(stated.sharedItems[0].suggestions.map((x) => x.person)).toEqual(["partner"]);
  });

  it("when both rows exceed what is unassigned, neither person is prioritized: they are scaled by their own share", () => {
    const p = run({ shared: shared({ expenses: [expense({ amount: 100, links: [...meRow, ...partnerRow] })] }) });
    const sug = p.sharedItems[0].suggestions;
    expect(sug.map((x) => x.person)).toEqual(["me", "partner"]);
    expect(sug.reduce((x, y) => x + y.cents, 0)).toBe(10000); // exactly what is unassigned
    expect(sug[0].cents).toBe(6667); // 10000/15000 of 10000, remainder cent goes to the larger fraction
    expect(sug[1].cents).toBe(3333);
    expect(sug.every((x) => x.capped)).toBe(true);
    const swapped = run({ shared: shared({ expenses: [expense({ amount: 100, links: [...partnerRow, ...meRow] })] }) });
    expect(swapped.sharedItems[0].suggestions.map((x) => [x.person, x.cents]).sort()).toEqual(sug.map((x) => [x.person, x.cents]).sort());
  });

  it("applyContributionSuggestion returns new contributions, never overwrites, never mutates", () => {
    const c = deepFreeze({ me: null, partner: 100 }) as Contributions;
    const sug = { person: "me" as const, cents: 10000, sourceCents: 10000, capped: false, source: "linkedPersonalRow" as const };
    expect(applyContributionSuggestion(c, sug)).toEqual({ me: 100, partner: 100 });
    expect(applyContributionSuggestion(c, { ...sug, person: "partner" })).toEqual({ me: null, partner: 100 });
    const p = run({ shared: shared({ expenses: [expense({ contributions: { me: 100, partner: null }, links: meRow })] }) });
    sound(p);
  });

  it("an incomplete personal plan gives a PROVISIONAL available figure with its assumption; the definitive value stays null", () => {
    const { groceries: _g, ...rest } = complete(5000, 100).expenses; void _g;
    const partial = complete(5000, 100, { expenses: rest });
    const p = run({ me: { profile: partial } });
    expect(p.available.cents).toBeNull();
    expect(p.available.provisional?.assumptions).toContain("spendingIncomplete");
    sound(p);
  });

  it("with no known income there is no provisional figure at all", () => {
    const p = run({ me: { profile: complete(null, 100) }, partner: null });
    expect(p.available.cents).toBeNull();
    expect(p.available.provisional).toBeNull();
    sound(p);
  });

  it("goals expose their calendar-month timing assumption", () => {
    const p = run({ shared: shared({ goals: [goal({ targetDate: "2027-11-04" }), goal({ id: "g2", targetDate: "2026-11-28" })] }) });
    expect(p.goals[0].timing).toEqual({ rule: GOAL_TIMING_RULE, fromMonth: "2026-11", toMonth: "2027-11", monthsLeft: 12, laterDayThisMonthCountsAsOne: false });
    expect(p.goals[1].timing?.laterDayThisMonthCountsAsOne).toBe(true);
    expect(p.goals[1].monthsLeft).toBe(1);
    expect(GOAL_TIMING_RULE).toBe("calendarMonths");
  });

  it("a subscription match by provider warns with the related id and excludes nothing", () => {
    const me = complete(5000, 100, { useSubscriptions: true });
    const records = { bills: [], accounts: [], subscriptions: [sub({ name: "Prime", provider: "Amazon" })] };
    const p = run({ me: { profile: me }, records, shared: shared({ expenses: [expense({ id: "n", category: "other", label: "Amazon", amount: 15 })] }) });
    const w = p.issues.find((i) => i.code === "possibleSubscriptionOverlap");
    expect(w).toMatchObject({ ref: "n", related: "s1", severity: "warning" });
    expect(p.sharedItems[0].counted).toBe(true);
    expect(p.spending.components.sharedCostsCents).toBe(1500);
  });

  it("short names only match exactly, never as a substring", () => {
    const me = complete(5000, 100, { useSubscriptions: true });
    const records = { bills: [], accounts: [], subscriptions: [sub({ id: "s9", name: "Max", provider: null }), sub({ id: "s8", name: "Spotify Premium", provider: null })] };
    const maxy = run({ me: { profile: me }, records, shared: shared({ expenses: [expense({ category: "other", label: "Maximum coverage", amount: 15 })] }) });
    expect(issueCodes(maxy)).not.toContain("possibleSubscriptionOverlap");
    const exact = run({ me: { profile: me }, records, shared: shared({ expenses: [expense({ category: "other", label: "max", amount: 15 })] }) });
    expect(issueCodes(exact)).toContain("possibleSubscriptionOverlap");
    const longer = run({ me: { profile: me }, records, shared: shared({ expenses: [expense({ category: "other", label: "Spotify", amount: 15 })] }) });
    expect(issueCodes(longer)).toContain("possibleSubscriptionOverlap");
  });

  it("an explicit subscription link (not a name match) is what excludes the cost", () => {
    const me = complete(5000, 100, { useSubscriptions: true });
    const records = { bills: [], accounts: [], subscriptions: [sub()] };
    const named = run({ me: { profile: me }, records, shared: shared({ expenses: [expense({ category: "other", label: "Netflix", amount: 15 })] }) });
    const linked = run({ me: { profile: me }, records, shared: shared({ expenses: [expense({ category: "other", label: "Netflix", amount: 15, links: [{ kind: "subscription", id: "s1" }] })] }) });
    expect(named.sharedItems[0].counted).toBe(true);
    expect(linked.sharedItems[0].counted).toBe(false);
  });

  it("Me is always included; the household is USD only", () => {
    const p = run({ partner: { profile: complete(3000, 50), name: "Alex", included: false } });
    expect(p.me.included).toBe(true);
    expect(p.ledger.me.included).toBe(true);
    expect(HOUSEHOLD_CURRENCY).toBe("USD");
    const me = complete(5000, 100, { useSubscriptions: true });
    const eur = run({ me: { profile: me }, records: { bills: [], accounts: [], subscriptions: [sub({ currency: "EUR" })] } });
    expect(eur.me.personalSpendingCents).toBe(run({ me: { profile: me } }).me.personalSpendingCents);
  });
});

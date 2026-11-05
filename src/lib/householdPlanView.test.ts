import { describe, it, expect } from "vitest";
import { EXPENSE_CATEGORIES, emptyProfile, type FinancialProfile } from "./financialPlanner";
import { buildHouseholdPlan, emptyComposition, emptyShared, type HouseholdInputs, type SharedDebt, type SharedExpense, type SharedGoal, type SharedHousehold } from "./householdPlan";
import type { SharedIntegrity } from "./householdShared";
import { buildOverview } from "./householdOverview";
import { buildPlanView, type PlanView } from "./householdPlanView";

const TODAY = "2026-11-04";
const NONE = { me: null, partner: null };
const OK: SharedIntegrity = { ok: true, issues: [], fingerprint: "ok" };
const BAD: SharedIntegrity = { ok: false, issues: [{ code: "malformedItem", list: "expenses", index: 1 }], fingerprint: "bad" };

const complete = (takeHome: number | null, perCategory: number, over: Partial<FinancialProfile> = {}): FinancialProfile => ({
  ...emptyProfile(), payFrequency: takeHome === null ? null : "monthly", takeHome, incomeBasis: "actual", noDebts: true, useSubscriptions: true,
  expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: perCategory, basis: "actual" as const }])), ...over,
});
const expense = (over: Partial<SharedExpense> = {}): SharedExpense => ({ id: "e1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const debt = (over: Partial<SharedDebt> = {}): SharedDebt => ({ id: "d1", name: "Mortgage", balance: 250000, monthlyPayment: 1400, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const goal = (over: Partial<SharedGoal> = {}): SharedGoal => ({ id: "g1", name: "Vacation", targetAmount: 12000, targetDate: "2027-11-04", savedAmount: 2000, contributions: { me: 500, partner: 300 }, countedInSavings: { me: false, partner: false }, ...over });
const shared = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), noSharedExpenses: true, noSharedDebts: true, ...over });

type Over = Partial<HouseholdInputs> & { integrity?: SharedIntegrity };
function view(over: Over = {}): PlanView {
  const { integrity, ...rest } = over;
  const inp: HouseholdInputs = {
    me: { profile: complete(5000, 100) },
    partner: { profile: complete(3000, 50), name: "Alex", included: true },
    shared: shared(), composition: emptyComposition(), records: { bills: [], accounts: [], subscriptions: [] }, todayISO: TODAY, ...rest,
  };
  const plan = buildHouseholdPlan(inp);
  const model = buildOverview({ plan, shared: inp.shared, integrity: integrity ?? OK, droppedItems: integrity ? 1 : 0, meName: "Me", partnerName: inp.partner ? inp.partner.name : null, subscriptions: [] });
  return buildPlanView({ plan, model, shared: inp.shared, profiles: { me: inp.me.profile, partner: inp.partner ? inp.partner.profile : null }, unreadable: !!integrity && !integrity.ok });
}

describe("charts are drawn only when they are complete", () => {
  it("complete: the spending breakdown shows every part, adds up to the total, with percentages summing to 100", () => {
    const v = view({ shared: shared({ expenses: [expense()], debts: [debt()] }) });
    expect(v.breakdown.shown).toBe(true);
    expect(v.breakdown.totalCents).toBe(80000 + 40000 + 180000 + 140000);
    expect(v.breakdown.segments.map((s) => [s.key, s.cents])).toEqual([["mePersonal", 80000], ["partnerPersonal", 40000], ["shared", 180000], ["debtPayments", 140000]]);
    expect(v.breakdown.segments.reduce((s, x) => s + x.percent, 0)).toBe(100);
    expect(v.breakdown.segments.reduce((s, x) => s + x.cents, 0)).toBe(v.breakdown.totalCents);
  });
  it("an explicit $0 part stays in the legend as 0, not hidden or merged", () => {
    const v = view();
    expect(v.breakdown.segments.find((s) => s.key === "shared")).toMatchObject({ cents: 0, percent: 0 });
    expect(v.breakdown.segments.find((s) => s.key === "debtPayments")).toMatchObject({ cents: 0 });
  });
  it("incomplete spending hides the chart (it never guesses): shared costs unanswered, a person's spending unknown", () => {
    const unanswered = view({ shared: emptyShared() });
    expect(unanswered.breakdown).toMatchObject({ shown: false, hiddenReason: "incomplete" });
    const blank = view({ partner: { profile: complete(3000, 0, { expenses: {} }), name: "Alex", included: true } });
    expect(blank.breakdown).toMatchObject({ shown: false, hiddenReason: "incomplete" });
    expect(blank.distribution.shown).toBe(false);
  });
  it("unreadable stored data hides both charts", () => {
    const v = view({ shared: shared({ expenses: [expense()] }), integrity: BAD });
    expect(v.breakdown.shown).toBe(false);
    expect(v.distribution.shown).toBe(false);
  });
  it("a household with nothing to spend has nothing to chart", () => {
    const v = view({ me: { profile: complete(5000, 0) }, partner: null });
    expect(v.breakdown).toMatchObject({ shown: false, hiddenReason: "empty" });
  });
  it("a partner who is excluded leaves the personal parts, but the shared costs they cover stay in", () => {
    const v = view({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [expense({ contributions: { me: 800, partner: 1000 } })] }) });
    expect(v.breakdown.segments.map((s) => s.key)).toEqual(["mePersonal", "shared", "debtPayments"]);
    expect(v.breakdown.totalCents).toBe(80000 + 180000);
  });
});

describe("responsibility distribution: assigned, excluded and unassigned stay separate", () => {
  it("stated contributions only: Me, Partner and the unassigned remainder add up to the total", () => {
    const v = view({ shared: shared({ expenses: [expense({ contributions: { me: 800, partner: 500 } })] }) });
    expect(v.distribution.shown).toBe(true);
    expect(v.distribution.segments.map((s) => [s.key, s.cents])).toEqual([["me", 80000 + 80000], ["partner", 40000 + 50000], ["unassigned", 50000]]);
    expect(v.distribution.segments.reduce((s, x) => s + x.cents, 0)).toBe(v.distribution.totalCents);
  });
  it("nothing is split 50/50: with nobody stated the whole cost is the 'unassigned' segment", () => {
    const v = view({ shared: shared({ expenses: [expense()] }) });
    expect(v.distribution.segments.find((s) => s.key === "unassigned")!.cents).toBe(180000);
    expect(v.distribution.segments.find((s) => s.key === "me")!.cents).toBe(80000);
  });
  it("an excluded partner is a segment of their own and unassigned is not attributed to anyone", () => {
    const v = view({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [expense({ contributions: { me: null, partner: 1000 } })] }) });
    expect(v.distribution.segments.map((s) => [s.key, s.cents])).toEqual([["me", 80000], ["excludedPartner", 100000], ["unassigned", 80000]]);
  });
  it("no shared items: there is no 'unassigned' segment at all", () => {
    expect(view().distribution.segments.map((s) => s.key)).toEqual(["me", "partner"]);
  });
});

describe("cash flow rows keep unknown and zero apart", () => {
  it("a stated 'none' is $0; an unanswered list is unknown, not $0", () => {
    const none = view();
    expect(none.flow.rows.find((r) => r.key === "shared")!.figure).toEqual({ kind: "amount", cents: 0, estimate: false });
    expect(none.flow.rows.find((r) => r.key === "debtPayments")!.figure).toEqual({ kind: "amount", cents: 0, estimate: false });
    const blank = view({ shared: emptyShared() });
    expect(blank.flow.rows.find((r) => r.key === "shared")!.figure).toEqual({ kind: "unknown" });
    expect(blank.flow.rows.find((r) => r.key === "debtPayments")!.figure).toEqual({ kind: "unknown" });
  });
  it("a joint debt without a payment makes the payments row 'at least', never complete", () => {
    const v = view({ shared: shared({ debts: [debt({ id: "a" }), debt({ id: "b", name: "Loan", monthlyPayment: null })] }) });
    expect(v.flow.rows.find((r) => r.key === "debtPayments")!.figure).toEqual({ kind: "atLeast", cents: 140000, estimate: false });
  });
  it("a person with no spending entered is unknown, not $0", () => {
    const v = view({ partner: { profile: complete(3000, 0, { expenses: {} }), name: "Alex", included: true } });
    expect(v.flow.rows.find((r) => r.key === "partnerPersonal")!.figure).toEqual({ kind: "unknown" });
  });
});

describe("available cash is never presented as final when it isn't", () => {
  it("definitive when complete; savings left over is then known", () => {
    const v = view({ shared: shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }) });
    expect(v.provisional).toBe(false);
    expect(v.available.kind).toBe("definitive");
    expect(v.savings.afterSavings).toEqual({ kind: "amount", cents: 800000 - 80000 - 40000 - 180000 });
  });
  it("provisional (unassigned with an excluded partner): flagged, and 'left after savings' stays unknown", () => {
    const v = view({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [expense({ contributions: { me: null, partner: 1000 } })] }) });
    expect(v.provisional).toBe(true);
    expect(v.available.kind).toBe("provisional");
    expect(v.savings.afterSavings).toEqual({ kind: "unknown" });
    expect(v.savings.shortfallAfterSavings).toBe(false);
  });
  it("unreadable data downgrades a definitive figure and 'left after savings' to unknown", () => {
    const v = view({ shared: shared({ expenses: [expense()] }), integrity: BAD });
    expect(v.provisional).toBe(true);
    expect(v.savings.afterSavings).toEqual({ kind: "unknown" });
  });
  it("income unknown: available is unknown too", () => {
    const v = view({ me: { profile: complete(null, 100) }, partner: null });
    expect(v.available).toEqual({ kind: "unknown" });
    expect(v.provisional).toBe(true);
  });
});

describe("savings and goals are kept apart from spending", () => {
  it("goal contributions never change spending or the breakdown", () => {
    const without = view({ shared: shared({ expenses: [expense()] }) });
    const withGoal = view({ shared: shared({ expenses: [expense()], goals: [goal()] }) });
    expect(withGoal.flow.spending).toEqual(without.flow.spending);
    expect(withGoal.breakdown).toEqual(without.breakdown);
    expect(withGoal.flow.rows).toEqual(without.flow.rows);
  });
  it("planned goal money vs what is new to household savings (the 'already in their savings' flag)", () => {
    const v = view({ shared: shared({ goals: [goal({ countedInSavings: { me: true, partner: false } })] }) });
    expect(v.savings.goalsPlanned).toEqual({ kind: "amount", cents: 80000, estimate: false });
    expect(v.savings.goalsCounted).toEqual({ kind: "amount", cents: 30000, estimate: false });
  });
  it("planner savings: unknown when nobody entered any, known (including an explicit 0) otherwise, 'at least' when only some did", () => {
    expect(view().savings.inPlanners).toEqual({ kind: "unknown" });
    expect(view({ me: { profile: complete(5000, 100, { savingsMonthly: 0 }) }, partner: { profile: complete(3000, 50, { savingsMonthly: 0 }), name: "Alex", included: true } }).savings.inPlanners).toEqual({ kind: "amount", cents: 0, estimate: false });
    expect(view({ me: { profile: complete(5000, 100, { savingsMonthly: 200 }) } }).savings.inPlanners).toEqual({ kind: "atLeast", cents: 20000, estimate: false });
    expect(view({ me: { profile: complete(5000, 100, { savingsMonthly: 200 }) }, partner: null }).savings.inPlanners).toEqual({ kind: "amount", cents: 20000, estimate: false });
  });
  it("planned savings above available cash is reported as a shortfall after savings", () => {
    const v = view({ me: { profile: complete(1000, 100) }, partner: null, shared: shared({ goals: [goal({ contributions: { me: 500, partner: null } })] }) });
    expect(v.savings.shortfallAfterSavings).toBe(true);
  });
});

describe("shared goals", () => {
  const row = (g: Partial<SharedGoal>, today = TODAY) => {
    const inp = { me: { profile: complete(5000, 100) }, partner: { profile: complete(3000, 50), name: "Alex", included: true }, shared: shared({ goals: [goal(g)] }), composition: emptyComposition(), records: { bills: [], accounts: [], subscriptions: [] }, todayISO: today };
    const plan = buildHouseholdPlan(inp);
    const model = buildOverview({ plan, shared: inp.shared, integrity: OK, droppedItems: 0, meName: "Me", partnerName: "Alex", subscriptions: [] });
    return buildPlanView({ plan, model, shared: inp.shared, profiles: { me: inp.me.profile, partner: inp.partner.profile }, unreadable: false }).goals[0];
  };
  it("status, required per month, planned and shortfall come from the plan's goal calculation (calendar months)", () => {
    expect(row({})).toMatchObject({ status: "short", tone: "partial", requiredCents: 83334, plannedCents: 80000, shortByCents: 3334, aheadByCents: 0 });
    expect(row({}).timing).toMatchObject({ rule: "calendarMonths", monthsLeft: 12 });
  });
  it("planned above what is needed is flagged as ahead, never blocked", () => {
    const g = row({ contributions: { me: 900, partner: 300 } });
    expect(g).toMatchObject({ status: "onTrack", tone: "complete", requiredCents: 83334, plannedCents: 120000, aheadByCents: 120000 - 83334 });
  });
  it("exactly on the amount needed is on track and not 'ahead'", () => {
    expect(row({ targetAmount: 12000, savedAmount: 2000, contributions: { me: 833.34, partner: null } })).toMatchObject({ status: "onTrack", aheadByCents: 0 });
  });
  it("completed, past due, no contributions and missing-information statuses", () => {
    expect(row({ savedAmount: 12000 })).toMatchObject({ status: "achieved", tone: "complete", requiredCents: null });
    expect(row({ targetDate: "2026-10-01" })).toMatchObject({ status: "pastDue", hint: "pastDue" });
    expect(row({ contributions: { me: null, partner: null } })).toMatchObject({ status: "noContributions", aheadByCents: 0 });
    expect(row({ targetDate: null })).toMatchObject({ status: "noDate", hint: "noDate", tone: "todo" });
    expect(row({ targetAmount: null })).toMatchObject({ status: "noTarget", hint: "noTarget", percent: null });
  });
  it("percent is display-only: capped at 100, absent unless both amounts are known, and a real 0 is 0", () => {
    expect(row({ savedAmount: 3000 }).percent).toBe(25);
    expect(row({ savedAmount: 99999 }).percent).toBe(100);
    expect(row({ savedAmount: 0 }).percent).toBe(0);
    expect(row({ savedAmount: null }).percent).toBeNull();
    expect(row({ targetAmount: null }).percent).toBeNull();
  });
  it("keeps the assumption warning when the amount saved is unknown, and not when it is an explicit $0", () => {
    expect(row({ savedAmount: null }).savedUnknownAssumption).toBe(true);
    expect(row({ savedAmount: 0 }).savedUnknownAssumption).toBe(false);
    expect(row({ savedAmount: null, targetAmount: null }).savedUnknownAssumption).toBe(false);
    expect(row({ savedAmount: null }).requiredCents).toBe(100000); // assumes nothing saved
  });
  it("carries the 'already in their savings' flags", () => {
    expect(row({ countedInSavings: { me: true, partner: false } }).counted).toEqual({ me: true, partner: false });
  });
});

describe("debt balances never enter spending", () => {
  it("a $250,000 balance is shown apart; only the monthly payment is in the flow and the breakdown", () => {
    const v = view({ shared: shared({ debts: [debt()] }) });
    expect(v.debts.joint).toEqual({ kind: "amount", cents: 25000000, estimate: false });
    expect(v.flow.rows.find((r) => r.key === "debtPayments")!.figure).toEqual({ kind: "amount", cents: 140000, estimate: false });
    expect(v.breakdown.totalCents).toBe(80000 + 40000 + 140000);
    expect(JSON.stringify(v.flow)).not.toContain("25000000");
    expect(JSON.stringify(v.breakdown)).not.toContain("25000000");
  });
  it("a positive balance with a $0 payment is still owed (balance shown, payment $0)", () => {
    const v = view({ shared: shared({ debts: [debt({ monthlyPayment: 0 })] }) });
    expect(v.debts.joint).toEqual({ kind: "amount", cents: 25000000, estimate: false });
    expect(v.flow.rows.find((r) => r.key === "debtPayments")!.figure).toEqual({ kind: "amount", cents: 0, estimate: false });
  });
  it("unknown balances are 'at least'/unknown, a stated 'none' is $0, an unanswered list is unknown", () => {
    expect(view({ shared: shared({ debts: [debt({ balance: null })] }) }).debts.joint).toEqual({ kind: "unknown" });
    expect(view({ shared: shared({ debts: [debt({ id: "a" }), debt({ id: "b", name: "L", balance: null })] }) }).debts.joint).toEqual({ kind: "atLeast", cents: 25000000, estimate: false });
    expect(view().debts.joint).toEqual({ kind: "amount", cents: 0, estimate: false });
    expect(view({ shared: emptyShared() }).debts.joint).toEqual({ kind: "unknown" });
  });
  it("planner debts are counted separately; an unentered personal balance makes the figure 'at least'", () => {
    const withDebt = complete(5000, 100, { noDebts: false, debts: [{ id: "p", name: "Student loan", balance: 9000, monthlyPayment: 200, basis: "actual", accountId: null }] });
    expect(view({ me: { profile: withDebt }, partner: null }).debts.personal).toEqual({ kind: "amount", cents: 900000, estimate: false });
    const unknownBal = complete(5000, 100, { noDebts: false, debts: [{ id: "p", name: "Loan", balance: null, monthlyPayment: 200, basis: "actual", accountId: null }] });
    expect(view({ me: { profile: unknownBal }, partner: null }).debts.someUnknown).toBe(true);
  });
  it("unreadable stored data makes the joint balance only 'at least'", () => {
    expect(view({ shared: shared({ debts: [debt()] }), integrity: BAD }).debts.joint.kind).toBe("atLeast");
  });
});

describe("the view-model is a pure function", () => {
  it("same inputs, same output", () => {
    const o = { shared: shared({ expenses: [expense({ contributions: { me: 800, partner: null } })], debts: [debt()], goals: [goal()] }) };
    expect(view(o)).toEqual(view(o));
  });
});

describe("estimate metadata on the cash-flow figures", () => {
  const est = (v: PlanView) => ({ income: v.flow.income.kind !== "unknown" && v.flow.income.estimate, spending: v.flow.spending.kind !== "unknown" && v.flow.spending.estimate, rows: Object.fromEntries(v.flow.rows.map((r) => [r.key, r.figure.kind !== "unknown" && r.figure.estimate])) });
  it("no estimates anywhere: nothing is flagged", () => {
    const v = view({ shared: shared({ expenses: [expense()], debts: [debt()] }) });
    expect(est(v)).toEqual({ income: false, spending: false, rows: { mePersonal: false, partnerPersonal: false, shared: false, debtPayments: false } });
    expect(v.available.kind === "definitive" && v.available.estimate).toBe(false);
  });
  it("an estimated shared expense flags the shared row and the total, not the joint-debt row", () => {
    const v = view({ shared: shared({ expenses: [expense({ basis: "estimate" })], debts: [debt()] }) });
    expect(est(v).rows).toMatchObject({ shared: true, debtPayments: false, mePersonal: false });
    expect(est(v).spending).toBe(true);
    expect(v.available.kind === "definitive" && v.available.estimate).toBe(true);
  });
  it("an estimated joint debt flags the debt-payment row, not the shared-expense row", () => {
    const v = view({ shared: shared({ expenses: [expense()], debts: [debt({ basis: "estimate" })] }) });
    expect(est(v).rows).toMatchObject({ shared: false, debtPayments: true });
    expect(est(v).spending).toBe(true);
  });
  it("estimates in a personal planner flag that person's row; an estimated income flags income", () => {
    const meEst = complete(5000, 100, { incomeBasis: "estimate", expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 100, basis: "estimate" as const }])) });
    const v = view({ me: { profile: meEst } });
    expect(est(v).rows).toMatchObject({ mePersonal: true, partnerPersonal: false });
    expect(est(v).income).toBe(true);
  });
  it("a figure that is unknown never carries an estimate flag", () => {
    const v = view({ shared: emptyShared() });
    expect(v.flow.rows.find((r) => r.key === "shared")!.figure).toEqual({ kind: "unknown" });
  });
  it("the flag is metadata only: the amounts are identical with or without estimates", () => {
    const a = view({ shared: shared({ expenses: [expense({ basis: "estimate" })] }) });
    const b = view({ shared: shared({ expenses: [expense()] }) });
    expect(a.flow.rows.map((r) => (r.figure.kind === "unknown" ? null : r.figure.cents))).toEqual(b.flow.rows.map((r) => (r.figure.kind === "unknown" ? null : r.figure.cents)));
    expect(a.breakdown.totalCents).toBe(b.breakdown.totalCents);
  });
});

describe("responsibility chart with an excluded partner who has stated nothing", () => {
  const excluded = { profile: complete(3000, 50), name: "Alex", included: false };
  it("stays visible: the known amounts are drawn, the partner is listed as omitted, not drawn as $0", () => {
    const v = view({ partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: 1800, partner: null } })] }) });
    expect(v.distribution.shown).toBe(true);
    // Me covers everything stated; "unassigned" is an explicit, known $0 (the cost is fully assigned); the partner is not drawn at all
    expect(v.distribution.segments.map((s) => [s.key, s.cents])).toEqual([["me", 80000 + 180000], ["unassigned", 0]]);
    expect(v.distribution.omitted).toEqual(["excludedPartner"]);
    expect(v.distribution.segments.some((s) => s.key === "excludedPartner")).toBe(false);
    expect(v.distribution.segments.reduce((s, x) => s + x.percent, 0)).toBe(100);
    expect(v.distribution.segments.reduce((s, x) => s + x.cents, 0)).toBe(v.distribution.totalCents);
  });
  it("an unassigned remainder is still its own segment next to the omitted partner", () => {
    const v = view({ partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: 1000, partner: null } })] }) });
    expect(v.distribution.segments.map((s) => [s.key, s.cents])).toEqual([["me", 80000 + 100000], ["unassigned", 80000]]);
    expect(v.distribution.omitted).toEqual(["excludedPartner"]);
  });
  it("an EXPLICIT $0 is different: it is drawn as a $0 / 0% segment and nothing is omitted", () => {
    const v = view({ partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }) });
    expect(v.distribution.segments.find((s) => s.key === "excludedPartner")).toMatchObject({ cents: 0, percent: 0 });
    expect(v.distribution.omitted).toEqual([]);
  });
  it("a stated amount is a normal segment", () => {
    const v = view({ partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: 800, partner: 1000 } })] }) });
    expect(v.distribution.segments.find((s) => s.key === "excludedPartner")!.cents).toBe(100000);
    expect(v.distribution.omitted).toEqual([]);
  });
  it("no shared items at all: nothing stated, still visible with Me alone", () => {
    const v = view({ partner: excluded });
    expect(v.distribution.shown).toBe(true);
    expect(v.distribution.segments.map((s) => s.key)).toEqual(["me"]);
    expect(v.distribution.omitted).toEqual(["excludedPartner"]);
  });
  it("only an unstated EXCLUDED partner is tolerated: an unknown spending total still hides the chart", () => {
    const blank = view({ partner: excluded, me: { profile: complete(5000, 0, { expenses: {} }) }, shared: shared({ expenses: [expense({ contributions: { me: 1800, partner: null } })] }) });
    expect(blank.distribution.shown).toBe(false);
    expect(blank.distribution.omitted).toEqual([]);
    expect(view({ partner: excluded, shared: emptyShared() }).distribution.shown).toBe(false);
  });
  it("a contribution entered only on a cost that a record already counts does not count as 'stated'", () => {
    const meBills = complete(5000, 100, { useBills: true });
    const bill = { id: "b1", name: "Rent", amountType: "fixed" as const, expectedAmount: 1800, recurrence: "monthly" as const, firstDueDate: "2026-01-01", remindDaysBefore: 3, category: "Rent / Mortgage", notes: null, archivedAt: null, createdAt: "x" };
    const inp = { me: { profile: meBills }, partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: 900, partner: 900 }, links: [{ kind: "bill" as const, id: "b1" }] })] }), composition: emptyComposition(), records: { bills: [bill], accounts: [], subscriptions: [] }, todayISO: TODAY };
    const plan = buildHouseholdPlan(inp);
    const model = buildOverview({ plan, shared: inp.shared, integrity: OK, droppedItems: 0, meName: "Me", partnerName: "Alex", subscriptions: [] });
    expect(model.responsibility.rows.find((r) => r.key === "excludedPartner")).toMatchObject({ stated: false, figure: { kind: "unknown" } });
  });
});

import { describe, it, expect } from "vitest";
import type { Bill } from "./bills";
import { en } from "./i18n/en";
import { es } from "./i18n/es";
import { EXPENSE_CATEGORIES, emptyProfile, type FinancialProfile } from "./financialPlanner";
import type { Subscription } from "./subscriptions";
import { buildHouseholdPlan, emptyComposition, emptyShared, type HouseholdInputs, type SharedExpense, type SharedHousehold } from "./householdPlan";
import type { SharedIntegrity } from "./householdShared";
import { EXPORT_FORMAT, buildExportJson, buildOverview, figureFrom, figureOf, type OverviewModel } from "./householdOverview";

const TODAY = "2026-11-04";
const NONE = { me: null, partner: null };
const OK: SharedIntegrity = { ok: true, issues: [], fingerprint: "ok" };
const BAD: SharedIntegrity = { ok: false, issues: [{ code: "malformedItem", list: "expenses", index: 1 }], fingerprint: "bad" };

const complete = (takeHome: number | null, perCategory: number, over: Partial<FinancialProfile> = {}): FinancialProfile => ({
  ...emptyProfile(),
  payFrequency: takeHome === null ? null : "monthly",
  takeHome,
  incomeBasis: "actual",
  noDebts: true,
  useSubscriptions: true,
  expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: perCategory, basis: "actual" as const }])),
  ...over,
});
const expense = (over: Partial<SharedExpense> = {}): SharedExpense => ({ id: "e1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const shared = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), noSharedExpenses: true, noSharedDebts: true, ...over });
const bill = (): Bill => ({ id: "b1", name: "Rent", amountType: "fixed", expectedAmount: 1800, recurrence: "monthly", firstDueDate: "2026-01-01", remindDaysBefore: 3, category: "Rent / Mortgage", notes: null, archivedAt: null, createdAt: "2026-01-01T00:00:00Z" });
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1", name: "Netflix", provider: null, category: null, planName: null, amount: 15, currency: "USD", frequency: "monthly",
  customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null,
  remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "x", updatedAt: "x", ...over,
});

type Over = Partial<HouseholdInputs> & { integrity?: SharedIntegrity; dropped?: number };
function model(over: Over = {}): OverviewModel {
  const { integrity, dropped, ...rest } = over;
  const inp: HouseholdInputs = {
    me: { profile: complete(5000, 100) },
    partner: { profile: complete(3000, 50), name: "Alex", included: true },
    shared: shared(),
    composition: emptyComposition(),
    records: { bills: [], accounts: [], subscriptions: [] },
    todayISO: TODAY,
    ...rest,
  };
  const plan = buildHouseholdPlan(inp);
  return buildOverview({ plan, shared: inp.shared, integrity: integrity ?? OK, droppedItems: dropped ?? 0, meName: "Me", partnerName: inp.partner ? inp.partner.name : null, subscriptions: inp.records.subscriptions });
}

describe("figures: unknown is never $0, partial is 'at least'", () => {
  it("complete -> amount; partial with something known -> atLeast; partial with nothing known or unknown -> unknown", () => {
    expect(figureOf({ status: "complete", cents: 1000, knownCents: 1000, includesEstimates: false })).toEqual({ kind: "amount", cents: 1000, estimate: false });
    expect(figureOf({ status: "partial", cents: null, knownCents: 700, includesEstimates: true })).toEqual({ kind: "atLeast", cents: 700, estimate: true });
    expect(figureOf({ status: "partial", cents: null, knownCents: 0, includesEstimates: false })).toEqual({ kind: "unknown" });
    expect(figureOf({ status: "unknown", cents: null, knownCents: 0, includesEstimates: false })).toEqual({ kind: "unknown" });
    expect(figureFrom("unknown", 0)).toEqual({ kind: "unknown" });
  });
  it("a genuine zero is an amount (a stated 'none' is an answer), not unknown", () => {
    expect(figureOf({ status: "complete", cents: 0, knownCents: 0, includesEstimates: false })).toEqual({ kind: "amount", cents: 0, estimate: false });
  });
});

describe("income, spending and available cash", () => {
  it("both complete: amounts, definitive available, no warnings", () => {
    const m = model();
    expect(m.income.figure).toEqual({ kind: "amount", cents: 800000, estimate: false });
    expect(m.spending.figure).toMatchObject({ kind: "amount", cents: 120000 });
    expect(m.available).toMatchObject({ kind: "definitive", cents: 680000, tone: "positive" });
    expect(m.warnings).toEqual([]);
    expect(m.duplicates).toEqual([]);
  });

  it("the partner's income missing: household income is 'at least' Me's, available is withheld, and it is flagged", () => {
    const m = model({ partner: { profile: complete(null, 50), name: "Alex", included: true } });
    expect(m.income.figure).toEqual({ kind: "atLeast", cents: 500000, estimate: false });
    expect(m.available.kind).not.toBe("definitive");
    expect(m.warnings.map((w) => w.code)).toContain("partnerIncomeUnknown");
    expect(m.warnings.find((w) => w.code === "partnerIncomeUnknown")!.name).toBe("Alex");
  });

  it("Me and partner incomes both missing: income and available are unknown (never $0)", () => {
    const m = model({ me: { profile: complete(null, 100) }, partner: { profile: complete(null, 50), name: "Alex", included: true } });
    expect(m.income.figure).toEqual({ kind: "unknown" });
    expect(m.available).toEqual({ kind: "unknown" });
  });

  it("negative available is a definitive shortfall (tone only affects colour)", () => {
    const m = model({ me: { profile: complete(500, 100) }, partner: null });
    expect(m.available).toMatchObject({ kind: "definitive", cents: -30000, tone: "negative" });
    expect(m.shortfall).toBe("definite");
  });

  it("estimates are carried through so the screen can say so", () => {
    const m = model({ me: { profile: complete(5000, 100, { incomeBasis: "estimate" }) } });
    expect(m.income.figure).toMatchObject({ kind: "amount", estimate: true });
  });
});

describe("provisional available cash is labelled with its assumptions", () => {
  const excluded = { profile: complete(3000, 50), name: "Alex", included: false };

  it("an unassigned remainder while the partner is excluded -> provisional, never definitive", () => {
    const m = model({ partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: null, partner: 1000 } })] }) });
    expect(m.available).toEqual({ kind: "provisional", cents: 500000 - 80000 - 80000, assumptions: ["unassignedCoveredByHouseholdIncome"], estimate: false });
    expect(m.warnings.map((w) => w.code)).toContain("unassignedWithExcludedPartner");
  });

  it("incomplete spending -> provisional with the spending assumption", () => {
    const { housing: _h, ...rest } = complete(5000, 100).expenses;
    void _h;
    const m = model({ me: { profile: complete(5000, 100, { expenses: rest }) }, partner: null });
    expect(m.available.kind).toBe("provisional");
    expect(m.available.kind === "provisional" && m.available.assumptions).toContain("spendingIncomplete");
    expect(m.warnings.map((w) => w.code)).toContain("spendingIncomplete");
  });

  it("unreadable stored data downgrades a definitive figure to provisional and adds that assumption", () => {
    const m = model({ integrity: BAD, dropped: 1 });
    expect(m.available).toMatchObject({ kind: "provisional", cents: 680000 });
    expect(m.available.kind === "provisional" && m.available.assumptions).toContain("storedDataUnreadable");
    expect(m.integrity).toMatchObject({ ok: false, unreadableCount: 1 });
    expect(m.warnings[0].code).toBe("storedDataUnreadable");
  });
});

describe("responsibility: assigned, not paid; never an assumed split", () => {
  const sum = (m: OverviewModel) =>
    m.responsibility.rows.reduce((s, r) => s + (r.figure.kind === "unknown" ? 0 : r.figure.cents), 0) + (m.responsibility.unassigned?.cents ?? 0);

  it("only stated contributions are assigned: 800 + 1,000 of an 1,800 rent", () => {
    const m = model({ shared: shared({ expenses: [expense({ contributions: { me: 800, partner: 1000 } })] }) });
    const me = m.responsibility.rows.find((r) => r.key === "me")!;
    const pt = m.responsibility.rows.find((r) => r.key === "partner")!;
    expect(me.towardSharedCents).toBe(80000);
    expect(pt.towardSharedCents).toBe(100000);
    expect(me.figure).toEqual({ kind: "amount", cents: 80000 + 80000, estimate: false });
    expect(pt.figure).toEqual({ kind: "amount", cents: 40000 + 100000, estimate: false });
    expect(m.responsibility.unassigned).toEqual({ cents: 0, itemCount: 0 });
    expect(sum(m)).toBe((m.spending.figure as { cents: number }).cents); // the parts add up to the total
  });

  it("with no one stated to pay, nothing is split: the whole cost is 'not yet assigned'", () => {
    const m = model({ shared: shared({ expenses: [expense()] }) });
    expect(m.responsibility.rows.every((r) => r.towardSharedCents === 0)).toBe(true);
    expect(m.responsibility.unassigned).toEqual({ cents: 180000, itemCount: 1 });
    expect(m.warnings.find((w) => w.code === "payerNotSet")).toMatchObject({ count: 1, cents: 180000 });
    expect(sum(m)).toBe((m.spending.figure as { cents: number }).cents);
  });

  it("unassigned is never attributed to Me", () => {
    const m = model({ shared: shared({ expenses: [expense({ contributions: { me: null, partner: 500 } })] }) });
    expect(m.responsibility.rows.find((r) => r.key === "me")!.towardSharedCents).toBe(0);
    expect(m.responsibility.unassigned!.cents).toBe(130000);
  });

  it("no shared items at all -> nothing to assign (null, not $0 assigned)", () => {
    expect(model().responsibility.unassigned).toBeNull();
  });

  it("an excluded partner appears as a separate, labelled row; their personal costs stay out", () => {
    const m = model({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [expense({ contributions: { me: 800, partner: 1000 } })] }) });
    expect(m.responsibility.rows.map((r) => r.key)).toEqual(["me", "excludedPartner"]);
    const ex = m.responsibility.rows[1];
    expect(ex).toMatchObject({ excluded: true, towardSharedCents: 100000, figure: { kind: "amount", cents: 100000 } });
    expect(sum(m)).toBe((m.spending.figure as { cents: number }).cents);
    expect(m.warnings.map((w) => w.code)).toContain("partnerExcludedFundsSharedCosts");
  });

  it("a person whose own spending is unknown is 'unknown', not $0; stated contributions alone are 'at least'", () => {
    const blank = complete(3000, 0, { expenses: {} });
    const none = model({ partner: { profile: blank, name: "Alex", included: true } });
    expect(none.responsibility.rows.find((r) => r.key === "partner")!.figure).toEqual({ kind: "unknown" });
    const some = model({ partner: { profile: blank, name: "Alex", included: true }, shared: shared({ expenses: [expense({ contributions: { me: null, partner: 900 } })] }) });
    expect(some.responsibility.rows.find((r) => r.key === "partner")!.figure).toEqual({ kind: "atLeast", cents: 90000, estimate: false });
  });
});

describe("shared expenses summary", () => {
  it("unanswered -> unknown (not $0); 'none' -> a real $0; one list answered with items -> at least", () => {
    expect(model({ shared: emptyShared() }).shared.figure).toEqual({ kind: "unknown" });
    expect(model({ shared: shared() }).shared.figure).toEqual({ kind: "amount", cents: 0, estimate: false });
    const onlyExpenses = model({ shared: { ...emptyShared(), expenses: [expense({ contributions: { me: 1800, partner: null } })] } });
    expect(onlyExpenses.shared.figure).toEqual({ kind: "atLeast", cents: 180000, estimate: false });
    const both = model({ shared: shared({ expenses: [expense()] }) });
    expect(both.shared.figure).toEqual({ kind: "amount", cents: 180000, estimate: false });
    expect(both.shared.expenseCount).toBe(1);
  });
  it("a joint debt without a payment makes the shared figure partial, not complete", () => {
    const m = model({ shared: shared({ debts: [{ id: "d", name: "Mortgage", balance: 100, monthlyPayment: null, basis: "actual", contributions: { ...NONE }, links: [] }], expenses: [expense()] }) });
    expect(m.shared.figure.kind).toBe("atLeast");
  });
  it("unreadable stored data means the shared figure is never shown as complete", () => {
    expect(model({ shared: shared({ expenses: [expense()] }), integrity: BAD, dropped: 1 }).shared.figure.kind).toBe("atLeast");
  });
});

describe("informational contributions are shown without entering any total", () => {
  it("entered on a Bill-linked cost: listed, and the totals equal the same plan without them", () => {
    const meBills = complete(5000, 100, { useBills: true });
    const records = { bills: [bill()], accounts: [], subscriptions: [] };
    const link = [{ kind: "bill" as const, id: "b1" }];
    const withInfo = model({ me: { profile: meBills }, records, shared: shared({ expenses: [expense({ contributions: { me: 900, partner: 900 }, links: link })] }) });
    const without = model({ me: { profile: meBills }, records, shared: shared({ expenses: [expense({ links: link })] }) });
    expect(withInfo.informational).toEqual([{ id: "e1", label: "Rent", meCents: 90000, partnerCents: 90000 }]);
    expect(without.informational).toEqual([]);
    expect(withInfo.spending).toEqual(without.spending);
    expect(withInfo.available).toEqual(without.available);
    expect(withInfo.responsibility.rows.map((r) => r.towardSharedCents)).toEqual([0, 0]);
    expect(withInfo.shared.representedCount).toBe(1);
  });
});

describe("possible duplicates: warned, never removed", () => {
  it("a subscription match names the subscription and changes no total", () => {
    const me = complete(5000, 100, { useSubscriptions: true });
    const records = { bills: [], accounts: [], subscriptions: [sub()] };
    const withDup = model({ me: { profile: me }, records, shared: shared({ expenses: [expense({ id: "n", category: "other", label: "Netflix", amount: 15 })] }) });
    expect(withDup.duplicates.filter((d) => d.code === "possibleSubscriptionOverlap")).toEqual([{ code: "possibleSubscriptionOverlap", itemId: "n", label: "Netflix", relatedName: "Netflix", personName: undefined, cents: undefined }]);
    expect(withDup.shared.figure).toEqual({ kind: "amount", cents: 1500, estimate: false });
  });
  it("a bill-category overlap and a shared-vs-personal overlap are both reported with the item's label", () => {
    const meBills = complete(5000, 100, { useBills: true });
    const m = model({ me: { profile: meBills }, records: { bills: [bill()], accounts: [], subscriptions: [] }, shared: shared({ expenses: [expense()] }) });
    expect(m.duplicates.map((d) => d.code).sort()).toEqual(["possibleBillOverlap", "possibleSharedPersonalOverlap", "possibleSharedPersonalOverlap"]);
    expect(m.duplicates.every((d) => d.label === "Rent")).toBe(true);
    expect(m.duplicates.filter((d) => d.code === "possibleSharedPersonalOverlap").map((d) => d.personName).sort()).toEqual(["Alex", "Me"]);
  });
});

describe("export of the original stored data", () => {
  const stored = { shared_expenses: [{ id: "a", label: "Rent" }, "junk"], shared_debts: [], shared_goals: [], no_shared_expenses: false, no_shared_debts: false, adults: 2, children: null, other_members: null, revision: 7 };
  it("contains the stored columns exactly as read, the findings and a fingerprint", () => {
    const parsed = JSON.parse(buildExportJson(stored, BAD));
    expect(parsed).toMatchObject({ format: EXPORT_FORMAT, version: 1, fingerprint: "bad", stored });
    expect(parsed.stored.shared_expenses[1]).toBe("junk"); // nothing is cleaned up on the way out
    expect(parsed.integrityIssues).toEqual(BAD.issues);
  });
  it("carries no credentials, tokens, ids or other tables", () => {
    const text = buildExportJson(stored, BAD);
    for (const word of ["password", "token", "email", "owner_id", "user_id", "access_token", "refresh_token", "financial_profiles", "household_members"]) expect(text).not.toContain(word);
  });
});

describe("the model is a pure function", () => {
  it("same inputs, same output; inputs are not modified", () => {
    const inp: HouseholdInputs = JSON.parse(JSON.stringify({
      me: { profile: complete(5000, 100) }, partner: { profile: complete(3000, 50), name: "Alex", included: true },
      shared: shared({ expenses: [expense({ contributions: { me: 800, partner: null } })] }), composition: emptyComposition(), records: { bills: [], accounts: [], subscriptions: [] }, todayISO: TODAY,
    }));
    const before = JSON.stringify(inp);
    const a = buildOverview({ plan: buildHouseholdPlan(inp), shared: inp.shared, integrity: OK, droppedItems: 0, meName: "Me", partnerName: "Alex", subscriptions: [] });
    const b = buildOverview({ plan: buildHouseholdPlan(inp), shared: inp.shared, integrity: OK, droppedItems: 0, meName: "Me", partnerName: "Alex", subscriptions: [] });
    expect(a).toEqual(b);
    expect(JSON.stringify(inp)).toBe(before);
  });
});

describe("partly assigned items (the remainder is explicit, the accounting is unchanged)", () => {
  it("lists only partly assigned counted costs, with assigned + remainder = total", () => {
    const m = model({ shared: shared({ expenses: [expense({ contributions: { me: 800, partner: 100 } }), expense({ id: "full", label: "Full", amount: 100, contributions: { me: 100, partner: null } }), expense({ id: "none", label: "None", amount: 50 })] }) });
    expect(m.partial).toEqual([{ id: "e1", label: "Rent", totalCents: 180000, assignedCents: 90000, unassignedCents: 90000 }]);
    for (const p of m.partial) expect(p.assignedCents + p.unassignedCents).toBe(p.totalCents);
    expect(m.responsibility.unassigned).toEqual({ cents: 90000 + 5000, itemCount: 2 }); // partly + nobody-stated
  });
  it("changes no figure: totals, available cash and responsibility rows equal the plan's own numbers", () => {
    const sh = shared({ expenses: [expense({ contributions: { me: 800, partner: null } })] });
    const inp = { me: { profile: complete(5000, 100) }, partner: { profile: complete(3000, 50), name: "Alex", included: true }, shared: sh, composition: emptyComposition(), records: { bills: [], accounts: [], subscriptions: [] }, todayISO: TODAY };
    const plan = buildHouseholdPlan(inp);
    const m = buildOverview({ plan, shared: sh, integrity: OK, droppedItems: 0, meName: "Me", partnerName: "Alex", subscriptions: [] });
    expect(m.spending.figure).toEqual({ kind: "amount", cents: plan.spending.totalHousehold.cents!, estimate: false });
    expect(m.responsibility.unassigned!.cents).toBe(plan.spending.unassignedCents);
    expect(m.partial[0].unassignedCents).toBe(plan.sharedItems[0].allocation.unassignedCents);
  });
  it("an excluded partner's stated share counts as assigned; nothing is attributed to Me", () => {
    const m = model({ partner: { profile: complete(3000, 50), name: "Alex", included: false }, shared: shared({ expenses: [expense({ contributions: { me: null, partner: 600 } })] }) });
    expect(m.partial).toEqual([{ id: "e1", label: "Rent", totalCents: 180000, assignedCents: 60000, unassignedCents: 120000 }]);
    expect(m.responsibility.rows.find((r) => r.key === "me")!.towardSharedCents).toBe(0);
  });
  it("none when nothing is partly assigned", () => {
    expect(model().partial).toEqual([]);
    expect(model({ shared: shared({ expenses: [expense({ contributions: { me: 1800, partner: null } })] }) }).partial).toEqual([]);
  });
  it("size carries its parts for the composition note", () => {
    expect(model().size.parts).toEqual({ adults: null, children: null, otherMembers: null });
    expect(model({ composition: { adults: 2, children: 1, otherMembers: null } }).size).toMatchObject({ status: "partial", knownTotal: 3, parts: { adults: 2, children: 1, otherMembers: null } });
  });
});

describe("household wording (English and Spanish)", () => {
  const hh = (Object.keys(en) as (keyof typeof en)[]).filter((k) => k.startsWith("hh."));
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it("every Household string exists in both languages with the same placeholders", () => {
    expect(hh.length).toBeGreaterThan(90);
    for (const k of hh) {
      expect(es[k], k).toBeTruthy();
      expect(holes(es[k]), k).toEqual(holes(en[k]));
    }
  });
  it("one term for a partner who is not in the totals: 'excluded' / 'excluido', never 'left out'", () => {
    const enText = hh.map((k) => en[k]).join(" ");
    const esText = hh.map((k) => es[k]).join(" ");
    expect(enText).not.toMatch(/left out|leave .* out/i);
    expect(esText).not.toMatch(/dejar fuera|dejado fuera/i);
    expect(en["hh.headingExcluded"]).toContain("excluded");
    expect(es["hh.headingExcluded"]).toContain("excluido");
  });
  it("Me is addressed as 'your' / 'tus' where a name would read oddly, and the partner by name", () => {
    expect(en["hh.w.spendingIncompleteMe"]).toMatch(/^Your /);
    expect(es["hh.w.spendingIncompleteMe"]).toMatch(/^Tus /);
    expect(en["hh.w.spendingIncomplete"]).toContain("{name}");
    expect(en["hh.headingMe"]).toBe(en["plan.personMe"]);
    expect(es["hh.headingMe"]).toBe(es["plan.personMe"]);
    expect(es["hh.addPartner"]).toBe(es["plan.partnerAdd"]);
    expect(en["hh.addPartner"]).toBe(en["plan.partnerAdd"]);
  });
  it("assigned amounts are never described as paid or funded in the responsibility wording", () => {
    for (const k of ["hh.partialLine", "hh.unassignedNote", "hh.respShared", "hh.partialTitle"] as const) {
      expect(en[k], k).not.toMatch(/\bpaid\b|funded/i);
      expect(es[k], k).not.toMatch(/\bpagad|financiad/i);
    }
  });
});

describe("an excluded partner: nothing stated is unknown, an explicit $0 is zero", () => {
  const excluded = { profile: complete(3000, 50), name: "Alex", included: false };
  const rowOf = (m: OverviewModel) => m.responsibility.rows.find((r) => r.key === "excludedPartner")!;
  it("nothing stated -> unknown and not 'stated'", () => {
    const r = rowOf(model({ partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: 1800, partner: null } })] }) }));
    expect(r).toMatchObject({ stated: false, figure: { kind: "unknown" }, towardSharedCents: 0 });
  });
  it("an explicit $0 -> a real zero amount that is 'stated'", () => {
    const r = rowOf(model({ partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }) }));
    expect(r).toMatchObject({ stated: true, figure: { kind: "amount", cents: 0 } });
  });
  it("a positive amount -> that amount", () => {
    const r = rowOf(model({ partner: excluded, shared: shared({ expenses: [expense({ contributions: { me: 800, partner: 1000 } })] }) }));
    expect(r).toMatchObject({ stated: true, figure: { kind: "amount", cents: 100000 } });
  });
  it("included people are always 'stated'", () => {
    expect(model().responsibility.rows.every((r) => r.stated)).toBe(true);
  });
});

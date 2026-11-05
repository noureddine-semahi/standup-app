import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { EXPENSE_CATEGORIES, emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import { emptyShared, type SharedDebt, type SharedExpense, type SharedGoal, type SharedHousehold } from "@/lib/householdPlan";
import type { PartnerRecord } from "@/lib/supabase/household";
import HouseholdOverview from "./HouseholdOverview";
import type { FinancialProfileController } from "./useFinancialProfile";
import type { HouseholdController } from "./useHousehold";

const TODAY = "2026-11-04";
const NONE = { me: null, partner: null };

type Composition = { adults: number | null; children: number | null; otherMembers: number | null };
type StoreState = { status?: string; householdId?: string | null; revision: number; shared: SharedHousehold; composition: Composition; droppedItems: number; integrity: { ok: boolean; issues: unknown[]; fingerprint: string }; stored: Record<string, unknown> };

// The dashboard only READS: the data layer stand-in records any save so a test can prove none happens.
const h = vi.hoisted(() => ({ state: null as unknown as StoreState, included: true, saves: 0 }));

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/householdShared", () => ({
  HouseholdConflictError: class extends Error {},
  HouseholdIntegrityError: class extends Error {},
  HouseholdValidationError: class extends Error {},
  isHouseholdSharedUnavailableError: () => false,
  getHouseholdShared: async () => h.state,
  getPartnerIncluded: async () => h.included,
  setPartnerIncluded: async (_id: string, v: boolean) => ((h.included = v), v),
  saveHouseholdShared: async () => {
    h.saves++;
    throw new Error("the Plan dashboard must not save");
  },
}));

const complete = (takeHome: number | null, perCategory: number, over: Partial<FinancialProfile> = {}): FinancialProfile => ({
  ...emptyProfile(), payFrequency: takeHome === null ? null : "monthly", takeHome, incomeBasis: "actual", noDebts: true, useSubscriptions: true,
  expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: perCategory, basis: "actual" as const }])), ...over,
});
const expense = (over: Partial<SharedExpense> = {}): SharedExpense => ({ id: "e1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const debt = (over: Partial<SharedDebt> = {}): SharedDebt => ({ id: "d1", name: "Mortgage", balance: 250000, monthlyPayment: 1400, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const goal = (over: Partial<SharedGoal> = {}): SharedGoal => ({ id: "g1", name: "Vacation", targetAmount: 12000, targetDate: "2027-11-04", savedAmount: 2000, contributions: { me: 500, partner: 300 }, countedInSavings: { me: false, partner: false }, ...over });
const shared = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), noSharedExpenses: true, noSharedDebts: true, ...over });
const ready = (s: SharedHousehold, extra: Record<string, unknown> = {}): StoreState => ({
  status: "ready", householdId: "h1", revision: 1, shared: s, composition: { adults: 2, children: 0, otherMembers: null }, droppedItems: 0,
  integrity: { ok: true, issues: [], fingerprint: "ok" }, stored: { revision: 1 }, ...extra,
});
const alex = (profile: FinancialProfile = complete(3000, 50)): PartnerRecord => ({ id: "m1", name: "Alex", profile });

function mount(opts: { me?: FinancialProfile; partner?: PartnerRecord | null } = {}) {
  const me: FinancialProfileController = { state: "ready", loadError: null, profile: opts.me ?? complete(5000, 100), save: async () => null };
  const household: HouseholdController = { state: "ready", loadError: null, partner: opts.partner === undefined ? alex() : opts.partner, addPartner: async () => null, renamePartner: async () => null, removePartner: async () => null, savePartner: async () => null };
  return render(
    <LanguageProvider>
      <div className="plan-root">
        <HouseholdOverview me={me} household={household} bills={[]} accounts={[]} subscriptions={[]} todayISO={TODAY} onAddPartner={() => {}} />
      </div>
    </LanguageProvider>
  );
}
async function openPlan() {
  await screen.findByTestId("hh-income");
  fireEvent.click(screen.getByTestId("hh-nav-plan"));
  return screen.findByTestId("hp-root");
}
const txt = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  h.state = ready(shared());
  h.included = true;
  h.saves = 0;
});
afterEach(cleanup);

describe("household plan: cash flow from the single calculation engine", () => {
  it("shows household income, spending with its parts, and a final available figure", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })], debts: [debt({ contributions: { me: 1400, partner: 0 } })] }));
    mount();
    await openPlan();
    expect(txt("hp-income")).toBe("$8,000.00");
    expect(txt("hp-spending")).toBe("$4,400.00"); // 800 + 400 + 1,800 + 1,400
    expect(txt("hp-row-mePersonal-value")).toBe("$800.00");
    expect(txt("hp-row-partnerPersonal-value")).toBe("$400.00");
    expect(txt("hp-row-shared-value")).toBe("$1,800.00");
    expect(txt("hp-row-debtPayments-value")).toBe("$1,400.00");
    expect(txt("hp-available")).toBe("$3,600.00"); // 8,000 - 4,400
    expect(screen.getByTestId("hp-available").getAttribute("data-kind")).toBe("definitive");
    expect(screen.queryByTestId("hp-provisional")).toBeNull();
    expect(screen.queryByTestId("hp-available-provisional")).toBeNull();
  });

  it("matches the Overview exactly (one engine: the same plan feeds both tabs)", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 800, partner: 700 } })], debts: [debt({ contributions: { me: 700, partner: null } })], goals: [goal()] }));
    mount();
    await screen.findByTestId("hh-income");
    const over = { income: txt("hh-income"), spending: txt("hh-spending"), available: txt("hh-available") };
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    await screen.findByTestId("hp-root");
    expect(txt("hp-income")).toBe(over.income);
    expect(txt("hp-spending")).toBe(over.spending);
    expect(txt("hp-available")).toBe(over.available);
    fireEvent.click(screen.getByTestId("hh-nav-overview"));
    await screen.findByTestId("hh-income");
    expect(txt("hh-spending")).toBe(over.spending);
  });

  it("opening the plan never saves anything", async () => {
    h.state = ready(shared({ expenses: [expense()], goals: [goal()] }));
    mount();
    await openPlan();
    fireEvent.click(screen.getByTestId("hh-nav-shared"));
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    expect(h.saves).toBe(0);
  });
});

describe("unknown is not zero; explicit zero stays zero", () => {
  it("shared costs and joint debts unanswered are dashes, a stated 'none' is $0.00", async () => {
    h.state = ready(emptyShared());
    mount();
    await openPlan();
    expect(txt("hp-row-shared-value")).toBe("—");
    expect(txt("hp-row-debtPayments-value")).toBe("—");
    cleanup();
    h.state = ready(shared());
    mount();
    await openPlan();
    expect(txt("hp-row-shared-value")).toBe("$0.00");
    expect(txt("hp-row-debtPayments-value")).toBe("$0.00");
  });
  it("a person with no spending entered is a dash, never $0", async () => {
    mount({ partner: alex(complete(3000, 0, { expenses: {} })) });
    await openPlan();
    expect(txt("hp-row-partnerPersonal-value")).toBe("—");
    expect(screen.getByTestId("hp-row-partnerPersonal-value").getAttribute("data-kind")).toBe("unknown");
  });
  it("income not entered: income and available cash are dashes, with an explanation", async () => {
    mount({ me: complete(null, 100), partner: null });
    await openPlan();
    expect(txt("hp-income")).toBe("—");
    expect(txt("hp-available")).toBe("—");
    expect(txt("hp-provisional")).toContain("can't be worked out yet");
    expect(txt("hp-after-savings")).toBe("—");
  });
  it("the partner's income missing: household income is 'at least', never the whole", async () => {
    mount({ partner: alex(complete(null, 50)) });
    await openPlan();
    expect(screen.getByTestId("hp-income").getAttribute("data-kind")).toBe("atLeast");
    expect(txt("hp-flow")).toContain("At least");
  });
});

describe("provisional figures are never presented as final", () => {
  it("names what is missing and says it is not guaranteed savings", async () => {
    h.state = ready(emptyShared());
    mount({ me: complete(null, 50) });
    await openPlan();
    expect(txt("hp-provisional")).toContain("Provisional — not guaranteed savings");
    expect(txt("hp-provisional")).toContain("Missing information");
    expect(txt("hp-missing")).toBeTruthy();
    // the warnings card does not list the same missing items a second time
    expect(txt("hp-missing")).toContain("income");
    expect(screen.queryByTestId("hh-warnings")?.textContent ?? "").not.toContain("income");
  });
  const excludedWithUnassigned = () => {
    h.included = false;
    h.state = ready(shared({ expenses: [expense({ contributions: { me: null, partner: 1000 } })] }));
  };
  it("is labelled Provisional with every assumption, and 'left after savings' stays unknown", async () => {
    excludedWithUnassigned();
    mount();
    await openPlan();
    expect(txt("hp-provisional")).toContain("Provisional");
    expect(txt("hp-provisional")).toContain("not guaranteed savings");
    expect(txt("hp-provisional")).toContain("not money you can count on saving");
    expect(txt("hp-assumptions")).toContain("Costs nobody is assigned to are counted against the household's income.");
    expect(screen.getByTestId("hp-available").getAttribute("data-kind")).toBe("provisional");
    expect(txt("hp-available-provisional")).toBe("Provisional");
    expect(txt("hp-after-savings")).toBe("—");
    expect(txt("hp-after-unknown")).toContain("Not known until available cash is final");
  });
  it("unreadable stored data also makes it provisional", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }), { droppedItems: 1, integrity: { ok: false, issues: [{ code: "malformedItem", list: "expenses", index: 1 }], fingerprint: "abc" }, stored: { revision: 1 } });
    mount();
    await openPlan();
    expect(screen.getByTestId("hp-available").getAttribute("data-kind")).toBe("provisional");
    expect(txt("hp-assumptions")).toContain("Some saved household data could not be read.");
    expect(screen.getByTestId("hh-integrity")).toBeTruthy();
    expect(screen.getByTestId("hh-export")).toBeTruthy();
  });
});

describe("charts are honest", () => {
  it("spending breakdown: every part, amounts and percentages that add up to 100, with an accessible description", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })], debts: [debt({ contributions: { me: 1400, partner: 0 } })] }));
    mount();
    await openPlan();
    const bar = screen.getByTestId("hp-spend-bar");
    expect(bar.getAttribute("role")).toBe("img");
    expect(bar.getAttribute("aria-label")).toContain("Where the spending goes");
    expect(bar.getAttribute("aria-label")).toMatch(/Shared expenses \d+%/);
    expect(bar.querySelectorAll("span")).toHaveLength(4);
    const pcts = ["mePersonal", "partnerPersonal", "shared", "debtPayments"].map((k) => Number(txt(`hp-spend-pct-${k}`).replace("%", "")));
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(txt("hp-spend-amt-shared")).toBe("$1,800.00");
    expect(txt("hp-spend-amt-debtPayments")).toBe("$1,400.00");
    expect(screen.queryByTestId("hp-spend-hidden")).toBeNull();
  });
  it("an explicit $0 part stays in the legend as $0.00 / 0%, but is not drawn", async () => {
    mount();
    await openPlan();
    expect(txt("hp-spend-amt-shared")).toBe("$0.00");
    expect(txt("hp-spend-pct-shared")).toBe("0%");
    expect(screen.getByTestId("hp-spend-bar").querySelector('[data-seg="shared"]')).toBeNull();
  });
  it("a real but tiny slice reads <1% (never 0% or a rounded-up 1%), while the underlying cents and the bar stay exact", async () => {
    h.state = ready(shared({ expenses: [expense({ amount: 1, contributions: { me: 1, partner: 0 } })] }));
    mount();
    await openPlan();
    expect(txt("hp-spend-amt-shared")).toBe("$1.00");
    expect(txt("hp-spend-pct-shared")).toBe("<1%");
    expect(screen.getByTestId("hp-spend-bar").getAttribute("aria-label")).toContain("Shared expenses <1%");
    expect(screen.getByTestId("hp-spend-bar").querySelector('[data-seg="shared"]')).toBeTruthy();
    expect(txt("hp-spend-pct-debtPayments")).not.toContain("<");
  });
  it("incomplete totals hide the chart and say why (nothing is guessed)", async () => {
    h.state = ready(emptyShared());
    mount();
    await openPlan();
    expect(screen.queryByTestId("hp-spend-bar")).toBeNull();
    expect(txt("hp-spend-hidden")).toContain("hidden because the totals are incomplete");
    expect(screen.getByTestId("hp-spend-hidden").getAttribute("data-reason")).toBe("incomplete");
    expect(screen.queryByTestId("hp-resp-bar")).toBeNull();
  });
  it("responsibility distribution: me, partner and the hatched unassigned part, never an even split", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 800, partner: 500 } })] }));
    mount();
    await openPlan();
    expect(txt("hp-resp-amt-me")).toBe("$1,600.00");
    expect(txt("hp-resp-amt-partner")).toBe("$900.00");
    expect(txt("hp-resp-amt-unassigned")).toBe("$500.00");
    expect(screen.getByTestId("hp-resp-bar").querySelector('[data-seg="unassigned"]')!.getAttribute("data-hatch")).toBe("true");
    expect(txt("hp-resp-chart")).toContain("Assigned responsibility, not payments made");
    expect(txt("hp-resp-chart")).toContain("hatched part is not assigned to anyone");
  });
  it("an excluded partner has their own segment, and the unassigned part is still its own", async () => {
    h.included = false;
    h.state = ready(shared({ expenses: [expense({ contributions: { me: null, partner: 1000 } })] }));
    mount();
    await openPlan();
    expect(txt("hp-resp-amt-me")).toBe("$800.00");
    expect(txt("hp-resp-amt-excludedPartner")).toBe("$1,000.00");
    expect(txt("hp-resp-amt-unassigned")).toBe("$800.00");
    expect(txt("hp-excluded-note")).toContain("Alex is excluded");
    expect(txt("hp-resp-legend")).toContain("Alex (excluded)");
  });
  it("unreadable data hides the charts", async () => {
    h.state = ready(shared({ expenses: [expense()] }), { droppedItems: 1, integrity: { ok: false, issues: [{ code: "malformedItem", list: "expenses", index: 1 }], fingerprint: "abc" }, stored: { revision: 1 } });
    mount();
    await openPlan();
    expect(screen.queryByTestId("hp-spend-bar")).toBeNull();
    expect(screen.queryByTestId("hp-resp-bar")).toBeNull();
  });
  it("a household with nothing to spend shows the 'nothing yet' text, not an empty chart", async () => {
    mount({ me: complete(5000, 0), partner: null });
    await openPlan();
    expect(screen.getByTestId("hp-spend-hidden").getAttribute("data-reason")).toBe("empty");
    expect(txt("hp-spend-hidden")).toContain("There is nothing to show yet.");
  });
});

describe("who covers what, unassigned and warnings", () => {
  it("reuses the responsibility breakdown (assigned, not paid; unassigned separate; partly assigned listed)", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 800, partner: 100 } })] }));
    mount();
    await openPlan();
    // the chart carries each person's share and the unassigned remainder; the per-person card is the Overview's
    expect(screen.queryByTestId("hh-responsibility")).toBeNull();
    expect(txt("hp-resp-chart")).toContain("not payments made");
    expect(txt("hp-resp-amt-unassigned")).toBe("$900.00");
    expect(txt("hh-partial-e1")).toBe("Rent: $900.00 of $1,800.00 assigned. $900.00 not yet assigned.");
  });
  it("completeness and duplicate warnings appear", async () => {
    h.state = ready(shared({ expenses: [expense({ id: "n", category: "other", label: "Netflix", amount: 15, contributions: { me: 15, partner: null } })] }));
    mount({ me: complete(5000, 100, { useSubscriptions: true }) });
    await openPlan();
    expect(txt("hh-warnings")).toBeTruthy();
    // possible duplicates are guesses that live in the Overview; the Plan only points at them
    expect(screen.queryByTestId("hh-duplicates")).toBeNull();
    expect(txt("hp-duplicates-pointer")).toContain("Possible duplicates: 2");
  });
  it("the per-person responsibility card comes back when the chart cannot be drawn", async () => {
    h.state = ready(emptyShared());
    mount();
    await openPlan();
    expect(screen.getByTestId("hp-resp-chart").getAttribute("data-shown")).toBe("false");
    expect(screen.getByTestId("hh-responsibility")).toBeTruthy();
  });
});

describe("savings and shared goals", () => {
  it("kept apart from spending: goal money never changes spending, and is labelled as plans not payments", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }));
    mount();
    await openPlan();
    const before = { spending: txt("hp-spending"), available: txt("hp-available") };
    cleanup();
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })], goals: [goal()] }));
    mount();
    await openPlan();
    expect(txt("hp-spending")).toBe(before.spending);
    expect(txt("hp-savings")).toContain("none of this is added to spending");
    expect(txt("hp-savings")).toContain("Planned contributions, not payments made.");
  });
  it("planned vs new household savings (the 'already in their savings' flag), and what is left after savings", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })], goals: [goal({ countedInSavings: { me: true, partner: false } })] }));
    mount({ me: complete(5000, 100, { savingsMonthly: 200 }), partner: alex(complete(3000, 50, { savingsMonthly: 100 })) });
    await openPlan();
    expect(txt("hp-savings-planners")).toBe("$300.00");
    expect(txt("hp-savings-goals-planned")).toBe("$800.00");
    expect(txt("hp-savings-goals-counted")).toBe("$300.00");
    expect(screen.getByTestId("hp-after-savings").getAttribute("data-kind")).toBe("amount");
    expect(txt("hp-after-savings")).toBe("$4,400.00"); // 5,000 available - (200 + 100 in the planners + 300 new goal money; Me's 500 is already inside the 200)
  });
  it("planned savings above available cash is flagged", async () => {
    h.state = ready(shared({ goals: [goal({ contributions: { me: 5000, partner: null } })] }));
    mount({ me: complete(1000, 100), partner: null });
    await openPlan();
    expect(txt("hp-savings-short")).toContain("more than the available cash");
  });
  it("each goal: status, required per month, planned, timing and capped progress", async () => {
    h.state = ready(shared({ goals: [goal()] }));
    mount();
    await openPlan();
    expect(txt("hp-goal-chip-g1")).toBe("Short by $33.34 a month");
    expect(txt("hp-goal-required-g1")).toBe("Needed per month: $833.34");
    expect(txt("hp-goal-planned-g1")).toBe("Planned per month: $800.00");
    expect(txt("hp-goal-timing-g1")).toBe("Counted in calendar months from 2026-11 to 2027-11: 12.");
    expect(screen.getByTestId("hp-goal-bar-g1").getAttribute("aria-label")).toBe("16%");
    expect(txt("hp-goal-pct-g1")).toBe("16%");
  });
  it("on track, completed, past due and ahead-of-plan (flagged, not blocked)", async () => {
    h.state = ready(shared({ goals: [goal({ id: "a", contributions: { me: 900, partner: 300 } }), goal({ id: "b", savedAmount: 12000 }), goal({ id: "c", targetDate: "2026-10-01" })] }));
    mount();
    await openPlan();
    expect(txt("hp-goal-chip-a")).toBe("On track");
    expect(txt("hp-goal-ahead-a")).toBe("Planned is $366.66 a month more than needed. That's fine and nothing is blocked.");
    expect(txt("hp-goal-chip-b")).toBe("Goal reached");
    expect(txt("hp-goal-chip-c")).toBe("Past due");
    expect(txt("hp-goal-hint-c")).toContain("The target date has passed.");
    expect(screen.queryByTestId("hp-goal-ahead-b")).toBeNull();
  });
  it("a goal exactly on target is on track with no 'ahead' note", async () => {
    h.state = ready(shared({ goals: [goal({ contributions: { me: 833.34, partner: null } })] }));
    mount();
    await openPlan();
    expect(txt("hp-goal-chip-g1")).toBe("On track");
    expect(screen.queryByTestId("hp-goal-ahead-g1")).toBeNull();
  });
  it("the progress bar is capped at 100% when more is saved than the target", async () => {
    h.state = ready(shared({ goals: [goal({ savedAmount: 50000 })] }));
    mount();
    await openPlan();
    expect(screen.getByTestId("hp-goal-bar-g1").getAttribute("aria-label")).toBe("100%");
    expect((screen.getByTestId("hp-goal-bar-g1").firstElementChild as HTMLElement).style.width).toBe("100%");
  });
  it("keeps the assumption warning when the amount saved is unknown, and has no bar; an explicit $0 saved has neither warning nor missing bar", async () => {
    h.state = ready(shared({ goals: [goal({ id: "u", savedAmount: null }), goal({ id: "z", savedAmount: 0 })] }));
    mount();
    await openPlan();
    expect(txt("hp-goal-saved-unknown-u")).toContain("assumes nothing is saved yet");
    expect(screen.queryByTestId("hp-goal-bar-u")).toBeNull();
    expect(txt("hp-goal-nopct-u")).toContain("needs a target and an amount saved");
    expect(screen.queryByTestId("hp-goal-saved-unknown-z")).toBeNull();
    expect(screen.getByTestId("hp-goal-bar-z").getAttribute("aria-label")).toBe("0%");
  });
  it("missing information is explained, and 'nothing stated' is not shown as $0 planned", async () => {
    h.state = ready(shared({ goals: [goal({ id: "a", targetDate: null, contributions: { me: null, partner: null } }), goal({ id: "b", targetAmount: null })] }));
    mount();
    await openPlan();
    expect(txt("hp-goal-hint-a")).toContain("Add a target date");
    expect(txt("hp-goal-planned-a")).toBe("Planned per month: nothing stated");
    expect(txt("hp-goal-hint-b")).toContain("Add a target amount");
  });
  it("no goals yet: says so and points to Shared", async () => {
    mount();
    await openPlan();
    expect(txt("hp-goals-none")).toContain("No shared goals yet");
  });
});

describe("debt balances are separate from cash flow", () => {
  it("a $250,000 balance appears only in the debt section; the payment is in the flow", async () => {
    h.state = ready(shared({ debts: [debt()] }));
    mount();
    await openPlan();
    expect(txt("hp-debt-joint")).toBe("$250,000.00");
    expect(txt("hp-debt-total")).toBe("$250,000.00");
    expect(txt("hp-row-debtPayments-value")).toBe("$1,400.00");
    expect(txt("hp-flow")).not.toContain("250,000");
    expect(txt("hp-spend-chart")).not.toContain("250,000");
    expect(txt("hp-debts")).toContain("never counted as expenses or taken from available cash");
  });
  it("a $0 payment with a balance still owed: the balance stays, the payment is $0.00", async () => {
    h.state = ready(shared({ debts: [debt({ monthlyPayment: 0, balance: 8000 })] }));
    mount();
    await openPlan();
    expect(txt("hp-debt-joint")).toBe("$8,000.00");
    expect(txt("hp-row-debtPayments-value")).toBe("$0.00");
    expect(txt("hp-debts")).not.toMatch(/paid off/i);
  });
  it("unknown balances are 'at least' with a warning; unanswered debts are unknown", async () => {
    h.state = ready(shared({ debts: [debt({ id: "a" }), debt({ id: "b", name: "Loan", balance: null })] }));
    mount();
    await openPlan();
    expect(screen.getByTestId("hp-debt-joint").getAttribute("data-kind")).toBe("atLeast");
    expect(txt("hp-debt-unknown")).toContain("at least the amounts shown");
    cleanup();
    h.state = ready(emptyShared());
    mount();
    await openPlan();
    expect(txt("hp-debt-joint")).toBe("—");
  });
  it("planner debts are shown separately", async () => {
    mount({ me: complete(5000, 100, { noDebts: false, debts: [{ id: "p", name: "Student loan", balance: 9000, monthlyPayment: 200, basis: "actual", accountId: null }] }), partner: null });
    await openPlan();
    expect(txt("hp-debt-personal")).toBe("$9,000.00");
  });
});

describe("availability, language, accessibility and layout", () => {
  it("shared columns not available: a clear note, and the plan still shows what it can", async () => {
    h.state = { status: "unavailable" } as unknown as StoreState;
    mount();
    await screen.findByTestId("hh-income");
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    await screen.findByTestId("hp-root");
    expect(txt("hp-shared-unavailable")).toContain("database update");
    expect(screen.getByTestId("hp-available").getAttribute("data-kind")).not.toBe("definitive");
  });
  it("renders the dashboard in Spanish, including statuses, chart legends and warnings", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      h.state = ready(shared({ expenses: [expense({ contributions: { me: 800, partner: 500 } })], goals: [goal(), goal({ id: "u", savedAmount: null })] }));
      mount();
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await screen.findByTestId("hh-income");
      fireEvent.click(screen.getByTestId("hh-nav-plan"));
      await screen.findByTestId("hp-root");
      expect(txt("hp-root")).toContain("Plan del hogar");
      expect(txt("hp-flow")).toContain("Flujo de efectivo mensual");
      expect(txt("hp-resp-chart")).toContain("Responsabilidad asignada, no pagos realizados");
      expect(txt("hp-resp-legend")).toContain("Sin asignar");
      expect(txt("hp-goal-chip-g1")).toBe("Faltan $33.34 al mes");
      expect(txt("hp-goal-saved-unknown-u")).toContain("supone que aún no hay nada ahorrado");
      expect(txt("hp-savings")).toContain("El ahorro no son facturas");
      expect(txt("hp-debts")).toContain("Saldos de deuda");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
  it("accessible structure: labelled sections, chart images with descriptions, and the tab buttons are keyboard-focusable", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })], goals: [goal()] }));
    mount();
    await openPlan();
    const labelled = screen.getByTestId("hp-root").querySelectorAll("section[aria-label]");
    expect(labelled.length).toBeGreaterThanOrEqual(6);
    for (const img of screen.getByTestId("hp-root").querySelectorAll('[role="img"]')) expect((img.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
    const tab = screen.getByTestId("hh-nav-plan");
    tab.focus();
    expect(document.activeElement).toBe(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("tablist", { name: "Household sections" })).getAllByRole("tab")).toHaveLength(3);
  });
  it("Overview and Shared are unchanged when navigating back and forth", async () => {
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }));
    mount();
    await openPlan();
    fireEvent.click(screen.getByTestId("hh-nav-shared"));
    expect(await screen.findByTestId("se-root")).toBeTruthy();
    expect(screen.getByTestId("jd-root")).toBeTruthy();
    expect(screen.getByTestId("sg-root")).toBeTruthy();
    fireEvent.click(screen.getByTestId("hh-nav-overview"));
    await screen.findByTestId("hh-income");
    expect(txt("hh-income")).toBe("$8,000.00");
    expect(h.saves).toBe(0);
  });
  it("chart and goal styles are contained: nothing wraps in the legend amounts, bars are bounded", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const block = (sel: string) => css.slice(css.lastIndexOf(sel)).split("}")[0];
    expect(block(".plan-root .hp-amt {")).toContain("white-space: nowrap");
    expect(block(".plan-root .hp-name {")).toContain("overflow-wrap: anywhere");
    expect(block(".plan-root .hp-bar {")).toContain("overflow: hidden");
    expect(block(".plan-root .hp-legend li {")).toContain("minmax(0, 1fr)");
    expect(css).toContain('.plan-root .hp-bar > span[data-hatch="true"]');
  });
});

describe("estimate labels on the Plan cash flow (same wording as the Overview)", () => {
  it("an estimated shared expense labels the shared row, the spending total and available cash; the joint-debt row stays unlabelled", async () => {
    h.state = ready(shared({ expenses: [expense({ basis: "estimate", contributions: { me: 1800, partner: 0 } })], debts: [debt({ contributions: { me: 1400, partner: 0 } })] }));
    mount();
    await openPlan();
    expect(txt("hp-est-row-shared")).toBe("Includes estimates");
    expect(txt("hp-est-spending")).toBe("Includes estimates");
    expect(txt("hp-est-available")).toBe("Includes estimates");
    expect(screen.queryByTestId("hp-est-row-debtPayments")).toBeNull();
    expect(screen.queryByTestId("hp-est-row-mePersonal")).toBeNull();
    expect(screen.queryByTestId("hp-est-income")).toBeNull();
  });
  it("an estimated joint debt labels the debt-payment row only", async () => {
    h.state = ready(shared({ debts: [debt({ basis: "estimate", contributions: { me: 1400, partner: 0 } })] }));
    mount();
    await openPlan();
    expect(txt("hp-est-row-debtPayments")).toBe("Includes estimates");
    expect(screen.queryByTestId("hp-est-row-shared")).toBeNull();
  });
  it("estimates in a personal planner label that person's row and income", async () => {
    mount({ me: complete(5000, 100, { incomeBasis: "estimate", expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 100, basis: "estimate" as const }])) }) });
    await openPlan();
    expect(txt("hp-est-income")).toBe("Includes estimates");
    expect(txt("hp-est-row-mePersonal")).toBe("Includes estimates");
    expect(screen.queryByTestId("hp-est-row-partnerPersonal")).toBeNull();
  });
  it("no estimates: no label anywhere in the cash flow", async () => {
    mount();
    await openPlan();
    expect(screen.getByTestId("hp-flow").querySelectorAll('[data-testid^="hp-est-"]')).toHaveLength(0);
    expect(txt("hp-flow")).not.toMatch(/estimate/i);
  });
  it("consistent with the Overview: whenever the Overview says 'Includes estimates', so does the Plan", async () => {
    h.state = ready(shared({ expenses: [expense({ basis: "estimate", contributions: { me: 1800, partner: 0 } })] }));
    mount();
    await screen.findByTestId("hh-income");
    const overviewSays = /Includes estimates/.test(txt("hh-root")!);
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    await screen.findByTestId("hp-root");
    expect(overviewSays).toBe(true);
    expect(/Includes estimates/.test(txt("hp-flow")!)).toBe(true);
  });
  it("the label is metadata only: the amounts do not change", async () => {
    h.state = ready(shared({ expenses: [expense({ basis: "estimate", contributions: { me: 1800, partner: 0 } })] }));
    mount();
    await openPlan();
    const withEst = { s: txt("hp-spending"), a: txt("hp-available"), r: txt("hp-row-shared-value") };
    cleanup();
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }));
    mount();
    await openPlan();
    expect({ s: txt("hp-spending"), a: txt("hp-available"), r: txt("hp-row-shared-value") }).toEqual(withEst);
  });
  it("Spanish uses the Overview's Spanish wording", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      h.state = ready(shared({ expenses: [expense({ basis: "estimate", contributions: { me: 1800, partner: 0 } })] }));
      mount();
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await screen.findByTestId("hh-income");
      fireEvent.click(screen.getByTestId("hh-nav-plan"));
      await screen.findByTestId("hp-root");
      expect(txt("hp-est-row-shared")).toBe("Incluye estimaciones");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

describe("responsibility chart with an excluded partner who has stated nothing", () => {
  const withNothing = () => {
    h.included = false;
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: null } })] }));
  };
  it("the chart stays visible, draws only what is known, and lists the partner as 'Nothing stated' (no amount, no percent)", async () => {
    withNothing();
    mount();
    await openPlan();
    expect(screen.getByTestId("hp-resp-bar")).toBeTruthy();
    expect(screen.queryByTestId("hp-resp-hidden")).toBeNull();
    expect(screen.getByTestId("hp-resp-bar").querySelector('[data-seg="excludedPartner"]')).toBeNull();
    const li = screen.getByTestId("hp-resp-omitted-excludedPartner");
    expect(li.textContent).toBe("Alex (excluded)Nothing stated");
    expect(li.textContent).not.toMatch(/\$|%/);
    expect(txt("hp-resp-amt-me")).toBe("$2,600.00");
    expect(txt("hp-resp-pct-me")).toBe("100%");
    expect(txt("hp-resp-omitted-note")).toContain("nothing is stated for their share");
    expect(txt("hp-resp-omitted-note")).toContain("unknown, not $0");
  });
  it("it is described accessibly, including the omitted partner, without relying on colour", async () => {
    withNothing();
    mount();
    await openPlan();
    const label = screen.getByTestId("hp-resp-bar").getAttribute("aria-label")!;
    expect(label).toContain("Who covers the spending");
    expect(label).toContain("Alex (excluded): Nothing stated");
    expect(label).toMatch(/100%/);
  });
  it("an explicit $0 is different: drawn in the legend as $0.00 / 0%, with no 'omitted' entry", async () => {
    h.included = false;
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }));
    mount();
    await openPlan();
    expect(txt("hp-resp-amt-excludedPartner")).toBe("$0.00");
    expect(txt("hp-resp-pct-excludedPartner")).toBe("0%");
    expect(screen.queryByTestId("hp-resp-omitted-excludedPartner")).toBeNull();
    expect(screen.queryByTestId("hp-resp-omitted-note")).toBeNull();
  });
  it("a stated amount is a normal segment; nothing is omitted", async () => {
    h.included = false;
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 800, partner: 1000 } })] }));
    mount();
    await openPlan();
    expect(txt("hp-resp-amt-excludedPartner")).toBe("$1,000.00");
    expect(screen.queryByTestId("hp-resp-omitted-excludedPartner")).toBeNull();
  });
  it("the Overview no longer calls an unstated excluded partner '$0.00'", async () => {
    withNothing();
    mount();
    await screen.findByTestId("hh-income");
    expect(txt("hh-resp-excludedPartner")).toContain("Nothing is stated for shared costs");
    expect(txt("hh-resp-excludedPartner")).not.toContain("$0.00");
    expect(txt("hh-resp-excludedPartner-value")).toBe("—");
  });
  it("an explicit $0 in the Overview is a real $0.00", async () => {
    h.included = false;
    h.state = ready(shared({ expenses: [expense({ contributions: { me: 1800, partner: 0 } })] }));
    mount();
    await screen.findByTestId("hh-income");
    expect(txt("hh-resp-excludedPartner-value")).toBe("$0.00");
    expect(txt("hh-resp-excludedPartner")).toContain("Covers $0.00 of shared costs");
  });
  it("in Spanish: visible chart, 'Nada indicado', and the 'unknown, not $0' explanation", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      withNothing();
      mount();
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await screen.findByTestId("hh-income");
      fireEvent.click(screen.getByTestId("hh-nav-plan"));
      await screen.findByTestId("hp-root");
      expect(screen.getByTestId("hp-resp-bar")).toBeTruthy();
      expect(txt("hp-resp-omitted-excludedPartner")).toBe("Jordan (excluido)Nada indicado".replace("Jordan", "Alex"));
      expect(txt("hp-resp-omitted-note")).toContain("Es un dato desconocido, no $0.");
      expect(screen.getByTestId("hp-resp-bar").getAttribute("aria-label")).toContain("Nada indicado");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
  it("the legend entry is styled as a bounded, wrapping row in both themes", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const block = (sel: string) => css.slice(css.lastIndexOf(sel)).split("}")[0];
    expect(block(".plan-root .hp-nothing {")).toContain("overflow-wrap: anywhere");
    expect(block(".plan-root .hp-swatch-none {")).toContain("border: 1px dashed var(--plan-muted)");
  });
});

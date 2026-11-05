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

type Composition = { adults: number | null; children: number | null; otherMembers: number | null };
type SaveInput = { expectedRevision: number; shared: SharedHousehold; composition: Composition; acknowledgeIntegrity?: string };
type StoreState = { status?: string; householdId?: string | null; revision: number; shared: SharedHousehold; composition: Composition; droppedItems: number; integrity: { ok: boolean; issues: unknown[]; fingerprint: string }; stored: Record<string, unknown> };

// The same in-memory stand-in for the data layer as the other editor tests (validates, revision-checks, integrity-gates).
const h = vi.hoisted(() => {
  class ConflictError extends Error { constructor(readonly latest: unknown) { super("conflict"); } }
  class IntegrityError extends Error { constructor(readonly issues: unknown[], readonly fingerprint: string) { super("integrity"); } }
  class ValidationError extends Error { constructor(readonly errors: unknown[]) { super("validation"); } }
  return { ConflictError, IntegrityError, ValidationError, state: null as unknown as StoreState, included: true, saves: [] as SaveInput[], failWith: null as null | Error, gate: null as null | Promise<void> };
});

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/householdShared", async () => {
  const codec = await vi.importActual<typeof import("@/lib/householdShared")>("@/lib/householdShared");
  return {
    HouseholdConflictError: h.ConflictError,
    HouseholdIntegrityError: h.IntegrityError,
    HouseholdValidationError: h.ValidationError,
    isHouseholdSharedUnavailableError: () => false,
    getHouseholdShared: async () => h.state,
    getPartnerIncluded: async () => h.included,
    setPartnerIncluded: async (_id: string, v: boolean) => ((h.included = v), v),
    saveHouseholdShared: async (input: SaveInput) => {
      h.saves.push(input);
      if (h.gate) await h.gate;
      if (h.failWith) throw h.failWith;
      const cur = h.state;
      const errors = codec.validateShared(input.shared, input.composition);
      if (errors.length) throw new h.ValidationError(errors);
      if (input.expectedRevision !== cur.revision) throw new h.ConflictError(cur);
      if (!cur.integrity.ok && input.acknowledgeIntegrity !== cur.integrity.fingerprint) throw new h.IntegrityError(cur.integrity.issues, cur.integrity.fingerprint);
      h.state = { ...cur, revision: cur.revision + 1, shared: input.shared, composition: input.composition, droppedItems: 0, integrity: { ok: true, issues: [], fingerprint: "ok" }, stored: {} };
      return h.state;
    },
  };
});

const complete = (takeHome: number | null, perCategory: number, over: Partial<FinancialProfile> = {}): FinancialProfile => ({
  ...emptyProfile(), payFrequency: takeHome === null ? null : "monthly", takeHome, incomeBasis: "actual", noDebts: true, useSubscriptions: true,
  expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: perCategory, basis: "actual" as const }])), ...over,
});
const rent: SharedExpense = { id: "x1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { me: 1800, partner: 0 }, links: [] };
const car: SharedDebt = { id: "d1", name: "Car loan", balance: 8000, monthlyPayment: 245, basis: "actual", contributions: { me: null, partner: 245 }, links: [] };
const goal = (over: Partial<SharedGoal> = {}): SharedGoal => ({ id: "g1", name: "Vacation", targetAmount: 12000, targetDate: "2027-11-04", savedAmount: 2000, contributions: { me: 500, partner: 300 }, countedInSavings: { me: false, partner: false }, ...over });
const sharedOf = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), expenses: [rent], debts: [car], noSharedDebts: false, ...over });
const ready = (shared: SharedHousehold, extra: Record<string, unknown> = {}): StoreState => ({
  status: "ready", householdId: "h1", revision: 1, shared, composition: { adults: 2, children: 0, otherMembers: null }, droppedItems: 0,
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
async function openShared() {
  await screen.findByTestId("hh-income");
  fireEvent.click(screen.getByTestId("hh-nav-shared"));
  return screen.findByTestId("sg-root");
}
const txt = (id: string) => screen.getByTestId(id).textContent;
const type = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
const val = (id: string) => (screen.getByTestId(id) as HTMLInputElement).value;
const lastSave = () => h.saves[h.saves.length - 1];
async function addGoal(f: { name?: string; target?: string; date?: string; saved?: string; me?: string; partner?: string }) {
  fireEvent.click(screen.getAllByTestId("sg-add")[0]);
  type("sg-f-name", f.name ?? "Vacation");
  if (f.target !== undefined) type("sg-f-target", f.target);
  if (f.date !== undefined) type("sg-f-date", f.date);
  if (f.saved !== undefined) type("sg-f-saved", f.saved);
  if (f.me !== undefined) type("sg-f-me", f.me);
  if (f.partner !== undefined) type("sg-f-partner", f.partner);
}

beforeEach(() => {
  h.state = ready(sharedOf());
  h.included = true;
  h.saves = [];
  h.failWith = null;
  h.gate = null;
});
afterEach(cleanup);

describe("shared goals: empty state and unanswered values", () => {
  it("the explanation and the empty state are one compact section (title, intro, empty text and actions together)", async () => {
    mount();
    await openShared();
    const card = screen.getByTestId("sg-empty");
    expect(card.textContent).toContain("Shared goals");
    expect(card.textContent).toContain("never added to household spending");
    expect(card.textContent).toContain("No shared goals yet.");
    expect(card.contains(screen.getByTestId("sg-add"))).toBe(true);
    // no second card repeating the heading above it
    expect(screen.getByTestId("sg-root").querySelectorAll("section.plan-glass")).toHaveLength(1);
    expect(h.saves).toEqual([]);
  });
  it("starts empty, explains that goals are savings, and saves nothing by looking", async () => {
    mount();
    await openShared();
    expect(txt("sg-empty")).toContain("No shared goals yet.");
    expect(txt("sg-root")).toContain("never added to household spending");
    expect(h.saves).toEqual([]);
  });

  it("only a name is needed: target, date, saved and contributions stay unanswered (null), and the card says what is missing", async () => {
    mount();
    await openShared();
    await addGoal({ name: "Someday" });
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const g = lastSave().shared.goals[0] as SharedGoal;
    expect(g).toMatchObject({ name: "Someday", targetAmount: null, targetDate: null, savedAmount: null, contributions: { me: null, partner: null }, countedInSavings: { me: false, partner: false } });
    expect(g.id.length).toBeGreaterThan(0);
    await screen.findByTestId(`sg-card-${g.id}`);
    expect(txt(`sg-chip-${g.id}`)).toBe("Needs a target amount");
    expect(txt(`sg-hint-${g.id}`)).toContain("Add a target amount");
    expect(txt(`sg-target-${g.id}`)).toBe("—");
    expect(txt(`sg-saved-unknown-${g.id}`)).toContain("Amount saved isn't entered");
    expect(txt(`sg-planned-${g.id}`)).toBe("Planned per month: nothing stated");
    expect(txt(`sg-who-${g.id}`.replace("who", "lines"))).toContain("Alex: not stated");
  });

  it("an explicit 0 is kept apart from blank: saved $0 and a $0 contribution are real answers", async () => {
    mount();
    await openShared();
    await addGoal({ target: "1000", saved: "0", me: "0", partner: "" });
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const g = lastSave().shared.goals[0] as SharedGoal;
    expect([g.savedAmount, g.contributions.me, g.contributions.partner]).toEqual([0, 0, null]);
    await screen.findByTestId(`sg-card-${g.id}`);
    expect(txt(`sg-progress-${g.id}`)).toBe("Saved $0.00 of $1,000.00 (0%)");
    expect(txt(`sg-lines-${g.id}`)).toContain("Me: $0.00");
    expect(txt(`sg-lines-${g.id}`)).toContain("Alex: not stated");
    expect(screen.queryByTestId(`sg-saved-unknown-${g.id}`)).toBeNull();
  });

  it("validation: a name is required, a $0 target is refused (blank means none), and nothing is sent", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("sg-add"));
    expect(screen.queryByText("Enter a name.")).toBeNull();
    fireEvent.click(screen.getByTestId("sg-save"));
    expect(screen.getByText("Enter a name.")).toBeTruthy();
    type("sg-f-target", "0");
    expect(screen.getByText("The target must be more than $0. Leave it empty if there is no target.")).toBeTruthy();
    type("sg-f-target", "abc");
    expect(screen.getByText("Enter a valid target with at most 2 decimals, or leave it empty.")).toBeTruthy();
    type("sg-f-saved", "-5");
    expect(screen.getByText("Enter a valid amount with at most 2 decimals, or leave it empty.")).toBeTruthy();
    expect(h.saves).toEqual([]);
  });

  it("without a partner there is no partner box", async () => {
    mount({ partner: null });
    await openShared();
    fireEvent.click(screen.getByTestId("sg-add"));
    expect(screen.queryByTestId("sg-f-partner")).toBeNull();
  });
});

describe("the existing goal calculations drive what is shown", () => {
  it("required per month, status, calendar-month timing and progress come from the household plan", async () => {
    mount();
    await openShared();
    await addGoal({ target: "12000", date: "2027-11-04", saved: "2000", me: "500", partner: "300" });
    // live preview, before saving
    expect(txt("sg-preview-status")).toBe("Short by $33.34 a month");
    expect(txt("sg-preview-required")).toBe("Needed per month: $833.34");
    expect(txt("sg-preview-timing")).toBe("Counted in calendar months from 2026-11 to 2027-11: 12.");
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const g = lastSave().shared.goals[0] as SharedGoal;
    await screen.findByTestId(`sg-card-${g.id}`);
    expect(txt(`sg-chip-${g.id}`)).toBe("Short by $33.34 a month");
    expect(txt(`sg-required-${g.id}`)).toBe("Needed per month: $833.34");
    expect(txt(`sg-planned-${g.id}`)).toBe("Planned per month: $800.00");
    expect(txt(`sg-timing-${g.id}`)).toBe("Counted in calendar months from 2026-11 to 2027-11: 12.");
    expect(txt(`sg-progress-${g.id}`)).toBe("Saved $2,000.00 of $12,000.00 (16%)");
    expect(screen.getByTestId(`sg-bar-${g.id}`).getAttribute("aria-label")).toBe("16%");
    expect(screen.getByTestId(`sg-chip-${g.id}`).getAttribute("data-status")).toBe("partial");
  });

  it("each status: on track, goal reached, past due, no contributions, needs a date", async () => {
    const cases: [Partial<SharedGoal>, string][] = [
      [{ contributions: { me: 900, partner: null } }, "On track"],
      [{ savedAmount: 12000 }, "Goal reached"],
      [{ targetDate: "2026-10-01" }, "Past due"],
      [{ contributions: { me: null, partner: null } }, "No contributions planned"],
      [{ targetDate: null }, "Needs a target date"],
    ];
    for (const [over, label] of cases) {
      cleanup();
      h.state = ready(sharedOf({ goals: [goal(over)] }));
      mount();
      await openShared();
      expect(txt("sg-chip-g1"), label).toBe(label);
    }
  });

  it("the calendar-month rule is stated, including that a later day this month counts as one month", async () => {
    h.state = ready(sharedOf({ goals: [goal({ targetDate: "2026-11-28", targetAmount: 100, savedAmount: 0, contributions: { me: 100, partner: null } })] }));
    mount();
    await openShared();
    expect(txt("sg-timing-g1")).toBe("Counted in calendar months from 2026-11 to 2026-11: 1. A target later this month counts as 1 month.");
    expect(txt("sg-chip-g1")).toBe("On track");
  });

  it("missing information is explained: no date, no target, past due", async () => {
    h.state = ready(sharedOf({ goals: [goal({ id: "a", targetDate: null }), goal({ id: "b", targetAmount: null }), goal({ id: "c", targetDate: "2026-01-01" })] }));
    mount();
    await openShared();
    expect(txt("sg-hint-a")).toContain("Add a target date");
    expect(txt("sg-hint-b")).toContain("Add a target amount");
    expect(txt("sg-hint-c")).toContain("The target date has passed.");
  });

  it("an unentered amount saved is called out as an assumption (the plan treats it as nothing saved yet)", async () => {
    mount();
    await openShared();
    await addGoal({ target: "12000", date: "2027-11-04" });
    expect(txt("sg-preview-saved-unknown")).toContain("assumes nothing is saved yet");
    expect(txt("sg-preview-required")).toBe("Needed per month: $1,000.00");
  });
});

describe("goals are savings, kept apart from spending and debts", () => {
  it("adding a goal changes no spending: the Overview total and shared total are unchanged", async () => {
    mount();
    await screen.findByTestId("hh-income");
    const before = { spending: txt("hh-spending"), shared: txt("hh-shared-total"), available: txt("hh-available") };
    fireEvent.click(screen.getByTestId("hh-nav-shared"));
    await screen.findByTestId("sg-root");
    await addGoal({ target: "12000", date: "2027-11-04", me: "500", partner: "300" });
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    fireEvent.click(screen.getByTestId("hh-nav-overview"));
    await screen.findByTestId("hh-spending");
    expect(txt("hh-spending")).toBe(before.spending); // 800 + 400 + 1,800 rent + 245 payment: no goal money in it
    expect(txt("hh-shared-total")).toBe(before.shared);
  });
  it("the goal editor never changes shared expenses, joint debts or composition", async () => {
    mount();
    await openShared();
    await addGoal({ target: "100", me: "10" });
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.expenses).toEqual([rent]);
    expect(lastSave().shared.debts).toEqual([car]);
    expect(lastSave().shared.noSharedDebts).toBe(false);
    expect(lastSave().composition).toEqual({ adults: 2, children: 0, otherMembers: null });
  });
  it("the expense and debt editors still work and carry the goals through unchanged", async () => {
    const g = goal();
    h.state = ready(sharedOf({ goals: [g] }));
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-edit-d1"));
    type("jd-f-name", "Car loan (renamed)");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.goals).toEqual([g]);
    expect(lastSave().shared.expenses).toEqual([rent]);
  });
});

describe("no double-counting of savings already in a personal planner", () => {
  it("planner savings are surfaced as a hint, and the flag is only ever set by the user", async () => {
    mount({ me: complete(5000, 100, { savingsMonthly: 200 }) });
    await openShared();
    await addGoal({ me: "500" });
    expect(txt("sg-savings-hint-me")).toBe("Your planner already has $200.00 of monthly savings. If this contribution is part of it, tick the box below.");
    expect((screen.getByTestId("sg-f-me-counted") as HTMLInputElement).checked).toBe(false); // never ticked automatically
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect((lastSave().shared.goals[0] as SharedGoal).countedInSavings).toEqual({ me: false, partner: false });
  });

  it("ticking 'already part of my monthly savings' stores the flag, and household savings don't add it again; the personal profile is untouched", async () => {
    const me = complete(5000, 100, { savingsMonthly: 200 });
    const frozen = JSON.stringify(me);
    mount({ me });
    await openShared();
    await addGoal({ target: "12000", date: "2027-11-04", me: "500", partner: "300" });
    fireEvent.click(screen.getByTestId("sg-f-me-counted"));
    expect(screen.getByTestId("sg-form").textContent).toContain("so it isn't counted twice");
    expect(screen.queryByTestId("sg-savings-hint-me")).toBeNull();
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const g = lastSave().shared.goals[0] as SharedGoal;
    expect(g.countedInSavings).toEqual({ me: true, partner: false });
    await screen.findByTestId("sg-totals");
    expect(txt("sg-total-planned")).toBe("$800.00"); // what the goal gets each month
    expect(txt("sg-total-counted")).toBe("$300.00"); // only Alex's $300 is new money for the household
    expect(txt(`sg-counted-me-${g.id}`)).toBe("Already part of my monthly savings");
    expect(JSON.stringify(me)).toBe(frozen);
  });

  it("the flag disappears (and is dropped) when the person's contribution is blank or 0", async () => {
    mount();
    await openShared();
    await addGoal({ me: "500" });
    fireEvent.click(screen.getByTestId("sg-f-me-counted"));
    type("sg-f-me", "0");
    expect(screen.queryByTestId("sg-f-me-counted")).toBeNull();
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect((lastSave().shared.goals[0] as SharedGoal).countedInSavings.me).toBe(false);
  });

  it("an excluded partner's contribution counts toward the goal but not household savings, and the form says so", async () => {
    h.included = false;
    mount();
    await openShared();
    await addGoal({ target: "12000", date: "2027-11-04", me: "500", partner: "300" });
    expect(txt("sg-excluded-note")).toContain("Alex is excluded");
    expect(screen.getByTestId("sg-form").textContent).toContain("Alex (excluded)");
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    await screen.findByTestId("sg-totals");
    expect(txt("sg-total-planned")).toBe("$800.00");
    expect(txt("sg-total-counted")).toBe("$500.00");
  });
});

describe("edit and remove", () => {
  const two = () => sharedOf({ goals: [goal({ id: "a", name: "Vacation" }), goal({ id: "b", name: "Emergency fund", targetAmount: 5000, targetDate: null, savedAmount: null, contributions: { me: 100, partner: null } })] });
  it("several goals with stable ids; editing keeps the id and leaves the others exactly as they were", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("sg-edit-a"));
    expect(val("sg-f-name")).toBe("Vacation");
    expect([val("sg-f-target"), val("sg-f-date"), val("sg-f-saved"), val("sg-f-me"), val("sg-f-partner")]).toEqual(["12000", "2027-11-04", "2000", "500", "300"]);
    type("sg-f-saved", "3000");
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const list = lastSave().shared.goals as SharedGoal[];
    expect(list.map((g) => g.id)).toEqual(["a", "b"]);
    expect(list[0]).toMatchObject({ savedAmount: 3000, targetAmount: 12000 });
    expect(list[1]).toEqual(two().goals[1]);
  });
  it("removing asks first, says the planners are untouched, and removes only that goal", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("sg-remove-a"));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg.textContent).toContain("Remove Vacation?");
    expect(dlg.textContent).toContain("Savings in your planners");
    expect(h.saves).toEqual([]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect((lastSave().shared.goals as SharedGoal[]).map((g) => g.id)).toEqual(["b"]);
    expect(lastSave().shared.expenses).toEqual([rent]);
    await waitFor(() => expect(screen.queryByTestId("sg-card-a")).toBeNull());
  });
  it("cancelling an edit changes nothing", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("sg-edit-a"));
    type("sg-f-name", "Changed");
    fireEvent.click(screen.getByTestId("sg-cancel"));
    expect(h.saves).toEqual([]);
    expect(txt("sg-name-a")).toBe("Vacation");
  });
});

describe("data safety", () => {
  it("a stale save is refused, nothing is overwritten, the latest is shown, and saving again applies the edit on top", async () => {
    h.state = ready(sharedOf({ goals: [goal({ id: "a" })] }));
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("sg-edit-a"));
    type("sg-f-name", "Vacation (mine)");
    h.state = ready(sharedOf({ goals: [goal({ id: "a" }), goal({ id: "z", name: "Added elsewhere" })] }), { revision: 2 });
    fireEvent.click(screen.getByTestId("sg-save"));
    await screen.findByTestId("sg-message");
    expect(screen.getByTestId("sg-message").getAttribute("data-kind")).toBe("conflict");
    expect(h.state.shared.goals.map((g) => g.name)).toEqual(["Vacation", "Added elsewhere"]);
    expect(val("sg-f-name")).toBe("Vacation (mine)");
    expect(await screen.findByTestId("sg-card-z")).toBeTruthy();
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(2));
    expect(h.saves[1].expectedRevision).toBe(2);
    expect(h.state.shared.goals.map((g) => g.name)).toEqual(["Vacation (mine)", "Added elsewhere"]);
  });
  it("saves never overlap", async () => {
    mount();
    await openShared();
    await addGoal({ target: "100" });
    let release: () => void = () => {};
    h.gate = new Promise<void>((r) => (release = r));
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect((screen.getByTestId("sg-save") as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByTestId("sg-save"));
    expect(h.saves).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.queryByTestId("sg-form")).toBeNull());
  });
  const broken = () =>
    ready(sharedOf({ goals: [goal({ id: "a" })] }), {
      droppedItems: 1,
      integrity: { ok: false, issues: [{ code: "malformedItem", list: "goals", index: 1 }], fingerprint: "abc" },
      stored: { shared_goals: [{ id: "a" }, "junk"], revision: 1 },
    });
  it("unreadable stored data: the same warning, JSON download and acknowledgement gate the goal controls too", async () => {
    h.state = broken();
    mount();
    await openShared();
    expect(screen.getByTestId("hh-integrity")).toBeTruthy();
    expect(screen.getByTestId("hh-export")).toBeTruthy();
    for (const id of ["sg-add", "sg-edit-a", "sg-remove-a"]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("se-ack"));
    expect((screen.getByTestId("sg-add") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("sg-add"));
    type("sg-f-name", "New goal");
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().acknowledgeIntegrity).toBe("abc");
  });
  it("only one form is open at a time across expenses, debts and goals", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("sg-add"));
    expect((screen.getByTestId("se-add") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("jd-edit-d1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("sg-cancel"));
    expect((screen.getByTestId("se-add") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("jd-edit-d1"));
    expect((screen.getByTestId("sg-add") as HTMLButtonElement).disabled).toBe(true);
  });
  it("a generic save failure keeps the form and the input", async () => {
    mount();
    await openShared();
    await addGoal({ target: "100", me: "10" });
    h.failWith = new Error("network down");
    fireEvent.click(screen.getByTestId("sg-save"));
    await waitFor(() => expect(txt("sg-message")).toBe("network down"));
    expect(val("sg-f-me")).toBe("10");
  });
});

describe("limits, scope and language", () => {
  it("at 10 goals adding is disabled and says why", async () => {
    h.state = ready(sharedOf({ goals: Array.from({ length: 10 }, (_, i) => goal({ id: "g" + i, name: "Goal " + i })) }));
    mount();
    await openShared();
    expect((screen.getByTestId("sg-add") as HTMLButtonElement).disabled).toBe(true);
    expect(txt("sg-limit")).toBe("You've reached the limit of 10 shared goals.");
  });
  it("the Plan tab opens the household plan dashboard", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    expect(await screen.findByTestId("hp-root")).toBeTruthy();
  });
  it("renders the goal editor, statuses, timing and the savings flag in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      h.state = ready(sharedOf({ goals: [goal({ id: "a" })] }));
      mount({ me: complete(5000, 100, { savingsMonthly: 200 }) });
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await openShared();
      expect(txt("sg-root")).toContain("Metas compartidas");
      expect(txt("sg-chip-a")).toBe("Faltan $33.34 al mes");
      expect(txt("sg-timing-a")).toBe("Se cuentan meses calendario de 2026-11 a 2027-11: 12.");
      expect(txt("sg-progress-a")).toBe("Ahorrado $2,000.00 de $12,000.00 (16%)");
      fireEvent.click(screen.getByTestId("sg-edit-a"));
      expect(txt("sg-savings-hint-me")).toBe("Tu planificador ya tiene $200.00 de ahorro mensual. Si esta contribución forma parte de él, marca la casilla de abajo.");
      expect(txt("sg-form")).toContain("Contribuciones mensuales planificadas");
      type("sg-f-name", "");
      fireEvent.click(screen.getByTestId("sg-save"));
      expect(screen.getByText("Escribe un nombre.")).toBeTruthy();
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

describe("layout rules in the stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  it("the progress bar and date field are contained, and the person box stacks inside the shared grid", () => {
    expect(css.slice(css.lastIndexOf(".plan-root .sg-progress {")).split("}")[0]).toContain("overflow: hidden");
    expect(css.slice(css.lastIndexOf('.plan-root .se-form input[type="date"] {')).split("}")[0]).toContain("max-width: 100%");
    expect(css.slice(css.lastIndexOf(".plan-root .sg-person {")).split("}")[0]).toContain("min-width: 0");
  });
});

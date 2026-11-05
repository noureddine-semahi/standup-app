import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { EXPENSE_CATEGORIES, emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import { emptyShared, type SharedDebt, type SharedExpense, type SharedGoal, type SharedHousehold } from "@/lib/householdPlan";
import type { Bill } from "@/lib/bills";
import type { Subscription } from "@/lib/subscriptions";
import type { PartnerRecord } from "@/lib/supabase/household";
import HouseholdOverview from "./HouseholdOverview";
import type { FinancialProfileController } from "./useFinancialProfile";
import type { HouseholdController } from "./useHousehold";

const TODAY = "2026-11-04";
const NONE = { me: null, partner: null };

type Composition = { adults: number | null; children: number | null; otherMembers: number | null };
type SaveInput = { expectedRevision: number; shared: SharedHousehold; composition: Composition; acknowledgeIntegrity?: string };
type StoreState = { status?: string; householdId?: string | null; revision: number; shared: SharedHousehold; composition: Composition; droppedItems: number; integrity: { ok: boolean; issues: unknown[]; fingerprint: string }; stored: Record<string, unknown> };

// An in-memory stand-in for the data layer that behaves like the real one where it matters: it validates, checks the
// revision (a stale save throws a conflict carrying the latest version and writes nothing), and refuses to save over
// unreadable stored data unless the exact fingerprint is acknowledged.
const h = vi.hoisted(() => {
  class ConflictError extends Error { constructor(readonly latest: unknown) { super("conflict"); } }
  class IntegrityError extends Error { constructor(readonly issues: unknown[], readonly fingerprint: string) { super("integrity"); } }
  class ValidationError extends Error { constructor(readonly errors: unknown[]) { super("validation"); } }
  return {
    ConflictError, IntegrityError, ValidationError,
    state: null as unknown as StoreState,
    included: true,
    saves: [] as SaveInput[],
    beforeSave: null as null | (() => void),
    failWith: null as null | Error,
    gate: null as null | Promise<void>,
  };
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
      h.beforeSave?.();
      const cur = h.state!;
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
const expense = (over: Partial<SharedExpense> = {}): SharedExpense => ({ id: "e1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const debt: SharedDebt = { id: "d1", name: "Car loan", balance: 8000, monthlyPayment: 245, basis: "actual", contributions: { me: null, partner: 245 }, links: [] };
const goal: SharedGoal = { id: "g1", name: "House", targetAmount: 12000, targetDate: "2027-11-04", savedAmount: 0, contributions: { me: 50, partner: null }, countedInSavings: { me: false, partner: false } };
const sharedOf = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), debts: [debt], goals: [goal], ...over });
const ready = (shared: SharedHousehold, extra: Record<string, unknown> = {}): StoreState => ({
  status: "ready", householdId: "h1", revision: 1, shared, composition: { adults: 2, children: 0, otherMembers: null }, droppedItems: 0,
  integrity: { ok: true, issues: [], fingerprint: "ok" }, stored: { revision: 1 }, ...extra,
});
const alex = (profile: FinancialProfile = complete(3000, 50)): PartnerRecord => ({ id: "m1", name: "Alex", profile });
const bill = (over: Partial<Bill> = {}): Bill => ({ id: "b1", name: "Rent", amountType: "fixed", expectedAmount: 1800, recurrence: "monthly", firstDueDate: "2026-01-01", remindDaysBefore: 3, category: "Rent / Mortgage", notes: null, archivedAt: null, createdAt: "2026-01-01T00:00:00Z", ...over });
const sub = (): Subscription => ({ id: "s1", name: "Netflix", provider: null, category: null, planName: null, amount: 15, currency: "USD", frequency: "monthly", customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null, remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "x", updatedAt: "x" });

function mount(opts: { me?: FinancialProfile; partner?: PartnerRecord | null; bills?: Bill[]; subs?: Subscription[] } = {}) {
  const me: FinancialProfileController = { state: "ready", loadError: null, profile: opts.me ?? complete(5000, 100), save: async () => null };
  const household: HouseholdController = { state: "ready", loadError: null, partner: opts.partner === undefined ? alex() : opts.partner, addPartner: async () => null, renamePartner: async () => null, removePartner: async () => null, savePartner: async () => null };
  return render(
    <LanguageProvider>
      <div className="plan-root">
        <HouseholdOverview me={me} household={household} bills={opts.bills ?? []} accounts={[]} subscriptions={opts.subs ?? []} todayISO={TODAY} onAddPartner={() => {}} />
      </div>
    </LanguageProvider>
  );
}
async function openShared() {
  await screen.findByTestId("hh-income");
  fireEvent.click(screen.getByTestId("hh-nav-shared"));
  return screen.findByTestId("se-root");
}
const txt = (id: string) => screen.getByTestId(id).textContent;
const type = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
const lastSave = () => h.saves[h.saves.length - 1];
async function addExpense(f: { name?: string; amount?: string; me?: string; partner?: string; category?: string }) {
  fireEvent.click(screen.getAllByTestId("se-add")[0]);
  type("se-f-name", f.name ?? "Rent");
  if (f.category) type("se-f-category", f.category);
  type("se-f-amount", f.amount ?? "1800");
  if (f.me !== undefined) type("se-f-me", f.me);
  if (f.partner !== undefined) type("se-f-partner", f.partner);
}

beforeEach(() => {
  h.state = ready(sharedOf());
  h.included = true;
  h.saves = [];
  h.beforeSave = null;
  h.failWith = null;
  h.gate = null;
});
afterEach(cleanup);

describe("empty and 'none' states", () => {
  it("the explanation and the empty state are one compact section (title, intro, empty text and actions together)", async () => {
    mount();
    await openShared();
    const card = screen.getByTestId("se-empty");
    expect(card.textContent).toContain("Shared expenses");
    expect(card.textContent).toContain("never split evenly");
    expect(card.textContent).toContain("No shared expenses entered yet.");
    expect(card.contains(screen.getByTestId("se-add"))).toBe(true);
    // no second card repeating the heading above it
    expect(screen.getByTestId("se-root").querySelectorAll("section.plan-glass")).toHaveLength(1);
    expect(h.saves).toEqual([]);
  });
  it("unanswered: offers to add one or to confirm there are none (and nothing is saved by looking)", async () => {
    mount();
    await openShared();
    expect(txt("se-empty")).toContain("No shared expenses entered yet.");
    expect(screen.getByTestId("se-add")).toBeTruthy();
    expect(screen.getByTestId("se-none")).toBeTruthy();
    expect(h.saves).toEqual([]);
  });

  it("'There are no shared expenses' needs an explicit confirmation, then saves that answer and keeps debts and goals", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-none"));
    expect(screen.getByRole("alertdialog").textContent).toContain("Confirm: no shared expenses");
    expect(h.saves).toEqual([]); // not saved by opening the dialog
    fireEvent.click(screen.getByRole("button", { name: "Yes, none" }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().expectedRevision).toBe(1);
    expect(lastSave().shared).toMatchObject({ expenses: [], noSharedExpenses: true, debts: [debt], goals: [goal] });
    expect(lastSave().composition).toEqual({ adults: 2, children: 0, otherMembers: null });
    await screen.findByTestId("se-none-confirmed");
    expect(screen.queryByTestId("se-none")).toBeNull();
  });

  it("cancelling the confirmation saves nothing", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-none"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.saves).toEqual([]);
  });

  it("after confirming 'none', adding an expense clears that answer", async () => {
    h.state = ready(sharedOf({ noSharedExpenses: true }));
    mount();
    await openShared();
    expect(txt("se-none-confirmed")).toContain("confirmed");
    await addExpense({ me: "1800" });
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.noSharedExpenses).toBe(false);
    expect(lastSave().shared.expenses).toHaveLength(1);
  });
});

describe("adding expenses and who covers them", () => {
  it("saves name, category, amount and only the contributions that were stated; the rest is shown as not yet assigned", async () => {
    mount();
    await openShared();
    await addExpense({ me: "900", category: "utilities", name: "Power" });
    expect(txt("se-sum-assigned")).toBe("Assigned: $900.00");
    expect(txt("se-sum-remaining")).toBe("Not yet assigned: $900.00");
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const saved = lastSave().shared.expenses[0] as SharedExpense;
    expect(saved).toMatchObject({ label: "Power", category: "utilities", amount: 1800, basis: "actual", contributions: { me: 900, partner: null }, links: [] });
    expect(saved.id.length).toBeGreaterThan(0);
    await screen.findByTestId(`se-card-${saved.id}`);
    expect(txt(`se-chip-${saved.id}`)).toBe("Partly assigned");
    expect(txt(`se-who-${saved.id}`)).toContain("Me: $900.00");
    expect(txt(`se-who-${saved.id}`)).toContain("Alex: not stated"); // never assumed
    expect(txt(`se-remaining-${saved.id}`)).toBe("Not yet assigned: $900.00");
    expect(screen.queryByTestId("se-form")).toBeNull();
    expect(txt("se-message")).toBe("Saved.");
  });

  it("nobody stated: the whole amount is not yet assigned and is never split", async () => {
    mount();
    await openShared();
    await addExpense({});
    expect(txt("se-summary")).toContain("Nobody is assigned yet");
    expect(txt("se-summary")).toContain("it is not split evenly");
    expect(txt("se-sum-remaining")).toBe("Not yet assigned: $1,800.00");
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.expenses[0].contributions).toEqual({ me: null, partner: null });
    const id = lastSave().shared.expenses[0].id;
    await screen.findByTestId(`se-chip-${id}`);
    expect(txt(`se-chip-${id}`)).toBe("Not yet assigned");
  });

  it("empty is 'not stated' and a typed 0 is an explicit $0 (shown differently on the card)", async () => {
    mount();
    await openShared();
    await addExpense({ me: "1800", partner: "0" });
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const id = lastSave().shared.expenses[0].id;
    expect(lastSave().shared.expenses[0].contributions).toEqual({ me: 1800, partner: 0 });
    await screen.findByTestId(`se-who-${id}`);
    expect(txt(`se-who-${id}`)).toContain("Alex: $0.00");
    expect(txt(`se-who-${id}`)).not.toContain("not stated");
    expect(txt(`se-chip-${id}`)).toBe("Assigned");
  });

  it("shortcuts: Me covers all / Partner covers all / Clear, needing an amount first", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-add"));
    expect((screen.getByTestId("se-btn-me-all") as HTMLButtonElement).disabled).toBe(true);
    expect(txt("se-shortcut-hint")).toContain("Enter the amount first");
    type("se-f-amount", "1800");
    fireEvent.click(screen.getByTestId("se-btn-me-all"));
    expect([(screen.getByTestId("se-f-me") as HTMLInputElement).value, (screen.getByTestId("se-f-partner") as HTMLInputElement).value]).toEqual(["1800", "0"]);
    expect(txt("se-summary")).toContain("Fully assigned.");
    fireEvent.click(screen.getByTestId("se-btn-partner-all"));
    expect([(screen.getByTestId("se-f-me") as HTMLInputElement).value, (screen.getByTestId("se-f-partner") as HTMLInputElement).value]).toEqual(["0", "1800"]);
    fireEvent.click(screen.getByTestId("se-btn-clear"));
    expect([(screen.getByTestId("se-f-me") as HTMLInputElement).value, (screen.getByTestId("se-f-partner") as HTMLInputElement).value]).toEqual(["", ""]);
  });

  it("custom amounts work, and over-assigning is stopped before anything is sent", async () => {
    mount();
    await openShared();
    await addExpense({ me: "1500", partner: "1500" });
    expect(screen.getByTestId("se-error-over").textContent).toContain("add up to more than the cost");
    fireEvent.click(screen.getByTestId("se-save"));
    expect(h.saves).toEqual([]);
    type("se-f-partner", "300");
    expect(screen.queryByTestId("se-error-over")).toBeNull();
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.expenses[0].contributions).toEqual({ me: 1500, partner: 300 });
  });

  it("required fields are explained after a save attempt, and nothing is sent", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-add"));
    expect(screen.queryByText("Enter a name.")).toBeNull(); // no nagging before the first attempt
    fireEvent.click(screen.getByTestId("se-save"));
    expect(screen.getByText("Enter a name.")).toBeTruthy();
    expect(screen.getByText("Enter the monthly amount.")).toBeTruthy();
    type("se-f-amount", "12.345");
    expect(screen.getByText("Enter a valid amount with at most 2 decimals.")).toBeTruthy();
    type("se-f-me", "abc");
    expect(screen.getByText("Enter a valid amount with at most 2 decimals, or leave it empty.")).toBeTruthy();
    expect(h.saves).toEqual([]);
  });

  it("several expenses in the same category are kept as separate entries", async () => {
    mount();
    await openShared();
    await addExpense({ name: "Rent", me: "1000" });
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    await screen.findByTestId("se-list");
    await addExpense({ name: "Renter's insurance", amount: "40" });
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(2));
    const list = lastSave().shared.expenses as SharedExpense[];
    expect(list.map((e) => [e.label, e.category])).toEqual([["Rent", "housing"], ["Renter's insurance", "housing"]]);
    expect(new Set(list.map((e) => e.id)).size).toBe(2);
    expect(txt("se-count")).toBe("Shared expenses: 2");
  });

  it("without a partner there is no partner box, shortcut or 'not stated' line", async () => {
    mount({ partner: null });
    await openShared();
    fireEvent.click(screen.getByTestId("se-add"));
    expect(screen.queryByTestId("se-f-partner")).toBeNull();
    expect(screen.queryByTestId("se-btn-partner-all")).toBeNull();
    type("se-f-name", "Rent");
    type("se-f-amount", "1000");
    fireEvent.click(screen.getByTestId("se-btn-me-all"));
    expect((screen.getByTestId("se-f-me") as HTMLInputElement).value).toBe("1000");
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.expenses[0].contributions).toEqual({ me: 1000, partner: null });
  });

  it("an excluded partner can still be assigned a share, and is labelled as excluded", async () => {
    h.included = false;
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-add"));
    expect(screen.getByTestId("se-form").textContent).toContain("Alex (excluded)");
  });
});

describe("edit and remove", () => {
  const two = () => sharedOf({ expenses: [expense({ id: "a", label: "Rent", contributions: { me: 900, partner: null } }), expense({ id: "b", label: "Power", category: "utilities", amount: 120 })] });
  it("editing keeps the id and the other expenses exactly as they were", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-edit-a"));
    expect((screen.getByTestId("se-f-name") as HTMLInputElement).value).toBe("Rent");
    expect((screen.getByTestId("se-f-me") as HTMLInputElement).value).toBe("900");
    expect((screen.getByTestId("se-f-partner") as HTMLInputElement).value).toBe("");
    type("se-f-amount", "1900");
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const list = lastSave().shared.expenses as SharedExpense[];
    expect(list.map((e) => e.id)).toEqual(["a", "b"]);
    expect(list[0]).toMatchObject({ amount: 1900, contributions: { me: 900, partner: null } });
    expect(list[1]).toEqual(two().expenses[1]);
  });
  it("removing asks first, explains nothing else changes, and removes only that expense", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-remove-a"));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg.textContent).toContain("Remove Rent?");
    expect(dlg.textContent).toContain("Bills, Payments and Subscriptions are not changed");
    expect(h.saves).toEqual([]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect((lastSave().shared.expenses as SharedExpense[]).map((e) => e.id)).toEqual(["b"]);
    expect(lastSave().shared.debts).toEqual([debt]);
    expect(lastSave().shared.goals).toEqual([goal]);
    await waitFor(() => expect(screen.queryByTestId("se-card-a")).toBeNull());
  });
  it("cancelling an edit changes nothing", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-edit-a"));
    type("se-f-name", "Changed");
    fireEvent.click(screen.getByTestId("se-cancel"));
    expect(h.saves).toEqual([]);
    expect(txt("se-name-a")).toBe("Rent");
  });
});

describe("reconciliation", () => {
  const meBills = () => complete(5000, 100, { useBills: true });

  it("a name that matches a Bill triggers a possible-duplicate warning but is NEVER linked automatically", async () => {
    mount({ me: meBills(), bills: [bill()] });
    await openShared();
    await addExpense({ name: "Rent", me: "1800" });
    expect(txt("se-form-dups")).toContain("may already be one of your Bills");
    expect((document.querySelector('[data-testid="se-link-bill|b1"] input') as HTMLInputElement).checked).toBe(false);
    expect(txt("se-link-count")).toBe("Linked: 0");
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.expenses[0].links).toEqual([]);
  });

  it("only an explicit tick links it; the cost is then counted once, contributions become informational, and the original record is untouched", async () => {
    const theBill = bill();
    const frozen = JSON.stringify(theBill);
    mount({ me: meBills(), bills: [theBill] });
    await openShared();
    await addExpense({ name: "Rent", me: "900", partner: "900" });
    fireEvent.click(document.querySelector('[data-testid="se-link-bill|b1"] input')!);
    expect(txt("se-link-count")).toBe("Linked: 1");
    expect(txt("se-form-counted")).toContain("already counted elsewhere");
    expect(txt("se-form-info")).toContain("Entered: Me $900.00, Alex $900.00");
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const e = lastSave().shared.expenses[0] as SharedExpense;
    expect(e.links).toEqual([{ kind: "bill", id: "b1" }]);
    expect(e.contributions).toEqual({ me: 900, partner: 900 }); // preserved as entered
    await screen.findByTestId(`se-chip-${e.id}`);
    expect(txt(`se-chip-${e.id}`)).toBe("Counted in Finances");
    expect(txt(`se-counted-${e.id}`)).toContain("not added again");
    expect(txt(`se-info-${e.id}`)).toContain("Entered: Me $900.00, Alex $900.00");
    expect(JSON.stringify(theBill)).toBe(frozen);
  });

  it("linking to a personal planner row offers a SUGGESTED contribution that is applied only when the user chooses Use", async () => {
    mount();
    await openShared();
    await addExpense({ name: "Rent", amount: "1800" });
    fireEvent.click(document.querySelector('[data-testid="se-link-personalExpense|me|housing"] input')!);
    expect(txt("se-sugg-me")).toContain("Me: $100.00");
    expect((screen.getByTestId("se-f-me") as HTMLInputElement).value).toBe(""); // not applied
    expect(txt("se-suggestions")).toContain("Nothing is applied until you choose Use.");
    fireEvent.click(screen.getByTestId("se-sugg-use-me"));
    expect((screen.getByTestId("se-f-me") as HTMLInputElement).value).toBe("100");
  });

  it("a typed value is never overwritten by a suggestion", async () => {
    mount();
    await openShared();
    await addExpense({ name: "Rent", me: "250" });
    fireEvent.click(document.querySelector('[data-testid="se-link-personalExpense|me|housing"] input')!);
    expect(screen.queryByTestId("se-sugg-me")).toBeNull(); // Me already stated: nothing to suggest for Me
  });

  it("linking is explained as never changing the original and never automatic", async () => {
    mount({ bills: [bill()], subs: [sub()] });
    await openShared();
    fireEvent.click(screen.getByTestId("se-add"));
    expect(txt("se-links")).toContain("Linking never changes the original record, and nothing is linked automatically.");
    expect(txt("se-links")).toContain("Planner entries");
    expect(txt("se-links")).toContain("Bills");
    expect(txt("se-links")).toContain("Subscriptions");
    expect(txt("se-links")).toContain("Me: Rent / mortgage · $100.00");
  });

  it("a possible duplicate on a saved card is a warning only: the cost stays counted", async () => {
    h.state = ready(sharedOf({ expenses: [expense({ id: "n", category: "other", label: "Netflix", amount: 15, contributions: { me: 15, partner: null } })] }));
    mount({ subs: [sub()] });
    await openShared();
    expect(txt("se-dups-n")).toContain('"Netflix" may match your subscription Netflix.');
    expect(txt("se-chip-n")).not.toBe("Counted in Finances");
  });
});

describe("data safety: concurrency", () => {
  it("a stale save is refused, nothing is overwritten, the latest is shown, and saving again applies the edit on top", async () => {
    h.state = ready(sharedOf({ expenses: [expense({ id: "a", label: "Rent" })] }));
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-edit-a"));
    type("se-f-name", "Rent (mine)");
    // meanwhile someone else saves a different expense (revision 1 -> 2)
    const other = expense({ id: "x", label: "Added elsewhere", amount: 55 });
    h.state = ready(sharedOf({ expenses: [expense({ id: "a", label: "Rent" }), other] }), { revision: 2 });
    fireEvent.click(screen.getByTestId("se-save"));
    await screen.findByTestId("se-message");
    expect(txt("se-message")).toContain("changed elsewhere");
    expect(screen.getByTestId("se-message").getAttribute("data-kind")).toBe("conflict");
    expect(h.state!.shared.expenses.map((e: SharedExpense) => e.label)).toEqual(["Rent", "Added elsewhere"]); // stored data untouched
    expect(screen.getByTestId("se-form")).toBeTruthy(); // the user's edit is still on screen
    expect((screen.getByTestId("se-f-name") as HTMLInputElement).value).toBe("Rent (mine)");
    expect(await screen.findByTestId("se-card-x")).toBeTruthy(); // the list shows the latest version
    expect(h.saves[0].expectedRevision).toBe(1);
    fireEvent.click(screen.getByTestId("se-save")); // the user chooses to apply their edit on top of the latest
    await waitFor(() => expect(h.saves).toHaveLength(2));
    expect(h.saves[1].expectedRevision).toBe(2);
    expect((h.state!.shared.expenses as SharedExpense[]).map((e) => e.label)).toEqual(["Rent (mine)", "Added elsewhere"]);
    expect(h.state!.revision).toBe(3);
  });

  it("saves never overlap: the controls are disabled while one is in flight, and a second click sends nothing", async () => {
    mount();
    await openShared();
    await addExpense({ me: "1800" });
    let release: () => void = () => {};
    h.gate = new Promise<void>((r) => (release = r));
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect((screen.getByTestId("se-save") as HTMLButtonElement).disabled).toBe(true));
    expect(txt("se-save")).toBe("Saving…");
    expect((screen.getByTestId("se-cancel") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("se-save"));
    expect(h.saves).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.queryByTestId("se-form")).toBeNull());
    expect(h.saves).toHaveLength(1);
  });

  it("a validation failure from the data layer is reported and nothing is lost on screen", async () => {
    mount();
    await openShared();
    await addExpense({ me: "1800" });
    h.failWith = new h.ValidationError([{ code: "badAmount" }]);
    fireEvent.click(screen.getByTestId("se-save"));
    await screen.findByTestId("se-message");
    expect(txt("se-message")).toContain("Some entries are not valid. Nothing was saved.");
    expect((screen.getByTestId("se-f-name") as HTMLInputElement).value).toBe("Rent");
  });

  it("a generic save failure keeps the form open with the user's input", async () => {
    mount();
    await openShared();
    await addExpense({ me: "1800" });
    h.failWith = new Error("network down");
    fireEvent.click(screen.getByTestId("se-save"));
    await screen.findByTestId("se-message");
    expect(txt("se-message")).toBe("network down");
    expect((screen.getByTestId("se-f-me") as HTMLInputElement).value).toBe("1800");
  });
});

describe("data safety: unreadable stored data", () => {
  const broken = () =>
    ready(sharedOf({ expenses: [expense({ id: "a", label: "Rent" })] }), {
      droppedItems: 1,
      integrity: { ok: false, issues: [{ code: "malformedItem", list: "expenses", index: 1 }], fingerprint: "abc" },
      stored: { shared_expenses: [{ id: "a" }, "junk"], revision: 1 },
    });

  it("warns, offers the original JSON, and keeps every editing control off until the user acknowledges", async () => {
    h.state = broken();
    mount();
    await openShared();
    expect(screen.getByTestId("hh-integrity")).toBeTruthy();
    expect(screen.getByTestId("hh-export")).toBeTruthy();
    expect(txt("se-ack-box")).toContain("Editing is off until you confirm.");
    expect((screen.getByTestId("se-add") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("se-edit-a") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("se-remove-a") as HTMLButtonElement).disabled).toBe(true);
    expect(h.saves).toEqual([]);
  });

  it("after acknowledging, a save carries the acknowledgement for exactly the content shown, and the warning clears", async () => {
    h.state = broken();
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-ack"));
    expect((screen.getByTestId("se-add") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("se-add"));
    type("se-f-name", "Power");
    type("se-f-amount", "120");
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().acknowledgeIntegrity).toBe("abc");
    expect(lastSave().expectedRevision).toBe(1);
    await waitFor(() => expect(screen.queryByTestId("hh-integrity")).toBeNull());
    expect(screen.queryByTestId("se-ack")).toBeNull();
  });

  it("without the acknowledgement no save ever carries one, and a refused save says so without changing anything", async () => {
    h.state = broken();
    mount();
    await openShared();
    // Even if the controls were bypassed, the data layer refuses (stand-in behaves like the real one).
    h.failWith = new h.IntegrityError([], "abc");
    fireEvent.click(screen.getByTestId("se-ack"));
    fireEvent.click(screen.getByTestId("se-add"));
    type("se-f-name", "Power");
    type("se-f-amount", "120");
    fireEvent.click(screen.getByTestId("se-save"));
    await screen.findByTestId("se-message");
    expect(txt("se-message")).toContain("Saving was stopped because some stored data can't be read. Nothing was changed.");
    expect(screen.getByTestId("hh-integrity")).toBeTruthy();
  });

  it("export from the editor never saves anything", async () => {
    h.state = broken();
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    try {
      mount();
      await openShared();
      fireEvent.click(screen.getByTestId("hh-export"));
      await screen.findByTestId("hh-export-done");
      expect(h.saves).toEqual([]);
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
  });
});

describe("availability, limits and scope", () => {
  it("shared columns not available: the editor explains it instead of showing controls", async () => {
    h.state = { status: "unavailable" } as unknown as StoreState;
    mount();
    await screen.findByTestId("hh-income");
    fireEvent.click(screen.getByTestId("hh-nav-shared"));
    expect(txt("se-unavailable")).toContain("database update");
    expect(screen.queryByTestId("se-add")).toBeNull();
  });
  it("at 30 shared expenses adding is disabled and says why", async () => {
    h.state = ready(sharedOf({ expenses: Array.from({ length: 30 }, (_, i) => expense({ id: "e" + i, label: "Item " + i, amount: 10 })) }));
    mount();
    await openShared();
    expect((screen.getByTestId("se-add") as HTMLButtonElement).disabled).toBe(true);
    expect(txt("se-limit")).toBe("You've reached the limit of 30 shared expenses.");
  });
  it("the expense editor shows only expenses (no debts or goals inside it), and the Plan tab opens the dashboard", async () => {
    mount();
    await openShared();
    expect(screen.getByTestId("se-root").textContent).not.toMatch(/Car loan|House/);
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    expect(await screen.findByTestId("hp-root")).toBeTruthy();
  });
  it("the Overview reflects a save (household shared total updates)", async () => {
    mount();
    await openShared();
    await addExpense({ me: "1800" });
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    fireEvent.click(screen.getByTestId("hh-nav-overview"));
    await screen.findByTestId("hh-shared-total");
    expect(txt("hh-shared-total")).toContain("$2,045.00"); // 1,800 rent + the 245 joint-debt payment already stored
  });
});

describe("Spanish", () => {
  it("renders the editor, form, errors and states in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      mount();
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await openShared();
      expect(txt("se-empty")).toContain("Aún no hay gastos compartidos.");
      fireEvent.click(screen.getByTestId("se-add"));
      expect(txt("se-form")).toContain("Quién lo cubre");
      expect(txt("se-form")).toContain("Escribe 0 si esa persona no cubre nada");
      type("se-f-amount", "1800");
      fireEvent.click(screen.getByTestId("se-btn-me-all"));
      expect(txt("se-btn-me-all")).toBe("Yo: cubro todo");
      expect(txt("se-btn-partner-all")).toBe("Alex: cubre todo");
      expect(txt("se-summary")).toContain("Totalmente asignado.");
      type("se-f-me", "");
      type("se-f-partner", "");
      expect(txt("se-summary")).toContain("no se divide en partes iguales");
      fireEvent.click(screen.getByTestId("se-save"));
      expect(screen.getByText("Escribe un nombre.")).toBeTruthy();
      expect(txt("se-links")).toContain("nada se vincula automáticamente");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

describe("layout rules in the stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const block = (sel: string) => css.slice(css.lastIndexOf(sel)).split("}")[0];
  it("buttons are 44px+ and wrap their text; card text breaks instead of overflowing", () => {
    expect(block(".plan-root .se-actions .plan-btn {")).toContain("min-height: 44px");
    expect(block(".plan-root .se-actions .plan-btn {")).toContain("white-space: normal");
    expect(block(".plan-root .se-card-title {")).toContain("overflow-wrap: anywhere");
    expect(block(".plan-root .se-link {")).toContain("overflow-wrap: anywhere");
  });
  it("the two contribution boxes stack on narrow containers", () => {
    expect(css.slice(css.indexOf(".plan-root .se-grid2 {")).split("}")[0]).toContain("repeat(2, minmax(0, 1fr))");
    expect(css).toMatch(/@container \(max-width: 340px\) \{\s*\.plan-root \.se-grid2 \{\s*grid-template-columns: minmax\(0, 1fr\)/);
  });
});

describe("an explicit $0 shared expense", () => {
  it("can be saved when 0 is typed; a blank amount stays unknown and is refused", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-add"));
    type("se-f-name", "Free parking");
    fireEvent.click(screen.getByTestId("se-save"));
    expect(screen.getByText("Enter the monthly amount.")).toBeTruthy(); // blank is unknown
    expect(h.saves).toEqual([]);
    type("se-f-amount", "0");
    expect(screen.queryByText("Enter the monthly amount.")).toBeNull();
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const e = lastSave().shared.expenses[0] as SharedExpense;
    expect(e).toMatchObject({ label: "Free parking", amount: 0, contributions: { me: null, partner: null } });
    await screen.findByTestId(`se-card-${e.id}`);
    expect(txt(`se-amount-${e.id}`)).toBe("$0.00");
  });
  it("the shortcuts still work with a $0 amount (they assign $0), and assigning more than $0 is refused", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-add"));
    type("se-f-amount", "0");
    expect((screen.getByTestId("se-btn-me-all") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("se-btn-me-all"));
    expect([(screen.getByTestId("se-f-me") as HTMLInputElement).value, (screen.getByTestId("se-f-partner") as HTMLInputElement).value]).toEqual(["0", "0"]);
    type("se-f-me", "5");
    expect(screen.getByTestId("se-error-over")).toBeTruthy();
  });
  it("a $0 expense adds nothing to the household total", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-add"));
    type("se-f-name", "Free parking");
    type("se-f-amount", "0");
    fireEvent.click(screen.getByTestId("se-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    fireEvent.click(screen.getByTestId("hh-nav-overview"));
    await screen.findByTestId("hh-spending");
    expect(txt("hh-spending")).toBe("$1,445.00"); // Me 800 + Alex 400 + the stored 245 joint-debt payment + $0
  });
});

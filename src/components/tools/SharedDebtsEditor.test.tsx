import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { EXPENSE_CATEGORIES, emptyProfile, type DebtEntry, type FinancialProfile } from "@/lib/financialPlanner";
import { emptyShared, type SharedDebt, type SharedExpense, type SharedGoal, type SharedHousehold } from "@/lib/householdPlan";
import type { PartnerRecord } from "@/lib/supabase/household";
import type { PaymentAccount } from "@/lib/supabase/db";
import HouseholdOverview from "./HouseholdOverview";
import type { FinancialProfileController } from "./useFinancialProfile";
import type { HouseholdController } from "./useHousehold";

const TODAY = "2026-11-04";
const NONE = { me: null, partner: null };

type Composition = { adults: number | null; children: number | null; otherMembers: number | null };
type SaveInput = { expectedRevision: number; shared: SharedHousehold; composition: Composition; acknowledgeIntegrity?: string };
type StoreState = { status?: string; householdId?: string | null; revision: number; shared: SharedHousehold; composition: Composition; droppedItems: number; integrity: { ok: boolean; issues: unknown[]; fingerprint: string }; stored: Record<string, unknown> };

// Same in-memory stand-in for the data layer as the expense-editor tests: validates, checks the revision (a stale save
// throws a conflict carrying the latest version and writes nothing) and refuses unreadable data without the exact fingerprint.
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
const goal: SharedGoal = { id: "g1", name: "House", targetAmount: 12000, targetDate: "2027-11-04", savedAmount: 0, contributions: { me: 50, partner: null }, countedInSavings: { me: false, partner: false } };
const debt = (over: Partial<SharedDebt> = {}): SharedDebt => ({ id: "d1", name: "Mortgage", balance: 250000, monthlyPayment: 1400, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const sharedOf = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), expenses: [rent], goals: [goal], noSharedDebts: false, ...over });
const ready = (shared: SharedHousehold, extra: Record<string, unknown> = {}): StoreState => ({
  status: "ready", householdId: "h1", revision: 1, shared, composition: { adults: 2, children: 0, otherMembers: null }, droppedItems: 0,
  integrity: { ok: true, issues: [], fingerprint: "ok" }, stored: { revision: 1 }, ...extra,
});
const alex = (profile: FinancialProfile = complete(3000, 50)): PartnerRecord => ({ id: "m1", name: "Alex", profile });
const account = (over: Partial<PaymentAccount> = {}): PaymentAccount => ({ id: "a1", name: "Visa", balance: 900, minimumPayment: 35, dueDay: 15, remindDaysBefore: 3, lastReminderDueDate: null, createdAt: "x", balanceMode: "auto", ...over });
const pdebt = (over: Partial<DebtEntry> = {}): DebtEntry => ({ id: "pd1", name: "Car loan", balance: 9000, monthlyPayment: 300, basis: "actual", accountId: null, ...over });

function mount(opts: { me?: FinancialProfile; partner?: PartnerRecord | null; accounts?: PaymentAccount[] } = {}) {
  const me: FinancialProfileController = { state: "ready", loadError: null, profile: opts.me ?? complete(5000, 100), save: async () => null };
  const household: HouseholdController = { state: "ready", loadError: null, partner: opts.partner === undefined ? alex() : opts.partner, addPartner: async () => null, renamePartner: async () => null, removePartner: async () => null, savePartner: async () => null };
  return render(
    <LanguageProvider>
      <div className="plan-root">
        <HouseholdOverview me={me} household={household} bills={[]} accounts={opts.accounts ?? []} subscriptions={[]} todayISO={TODAY} onAddPartner={() => {}} />
      </div>
    </LanguageProvider>
  );
}
async function openShared() {
  await screen.findByTestId("hh-income");
  fireEvent.click(screen.getByTestId("hh-nav-shared"));
  return screen.findByTestId("jd-root");
}
const txt = (id: string) => screen.getByTestId(id).textContent;
const type = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });
const val = (id: string) => (screen.getByTestId(id) as HTMLInputElement).value;
const lastSave = () => h.saves[h.saves.length - 1];
async function addDebt(f: { name?: string; balance?: string; payment?: string; me?: string; partner?: string }) {
  fireEvent.click(screen.getAllByTestId("jd-add")[0]);
  type("jd-f-name", f.name ?? "Mortgage");
  if (f.balance !== undefined) type("jd-f-balance", f.balance);
  if (f.payment !== undefined) type("jd-f-payment", f.payment);
  if (f.me !== undefined) type("jd-f-me", f.me);
  if (f.partner !== undefined) type("jd-f-partner", f.partner);
}

beforeEach(() => {
  h.state = ready(sharedOf());
  h.included = true;
  h.saves = [];
  h.failWith = null;
  h.gate = null;
});
afterEach(cleanup);

describe("joint debts: empty and 'none' states", () => {
  it("the explanation and the empty state are one compact section (title, intro, empty text and actions together)", async () => {
    mount();
    await openShared();
    const card = screen.getByTestId("jd-empty");
    expect(card.textContent).toContain("Joint debts");
    expect(card.textContent).toContain("kept apart from monthly totals");
    expect(card.textContent).toContain("No joint debts entered yet.");
    expect(card.contains(screen.getByTestId("jd-add"))).toBe(true);
    // no second card repeating the heading above it
    expect(screen.getByTestId("jd-root").querySelectorAll("section.plan-glass")).toHaveLength(1);
    expect(h.saves).toEqual([]);
  });
  it("unanswered: add one or confirm there are none, and looking saves nothing", async () => {
    mount();
    await openShared();
    expect(txt("jd-empty")).toContain("No joint debts entered yet.");
    expect(screen.getByTestId("jd-add")).toBeTruthy();
    expect(h.saves).toEqual([]);
  });
  it("'There are no joint debts' needs an explicit confirmation, saves that answer, and keeps shared expenses, goals and composition", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-none"));
    expect(screen.getByRole("alertdialog").textContent).toContain("Confirm: no joint debts");
    expect(h.saves).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, none" }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared).toMatchObject({ debts: [], noSharedDebts: true, expenses: [rent], goals: [goal] });
    expect(lastSave().composition).toEqual({ adults: 2, children: 0, otherMembers: null });
    await screen.findByTestId("jd-none-confirmed");
  });
  it("cancelling the confirmation saves nothing; adding a debt after 'none' clears that answer", async () => {
    h.state = ready(sharedOf({ noSharedDebts: true }));
    mount();
    await openShared();
    expect(txt("jd-none-confirmed")).toContain("confirmed");
    await addDebt({ payment: "100", me: "100" });
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.noSharedDebts).toBe(false);
    expect(lastSave().shared.debts).toHaveLength(1);
  });
});

describe("joint debts: adding, amounts and who covers the monthly payment", () => {
  it("saves name, balance, payment, basis and only the shares that were stated; the rest is not yet assigned", async () => {
    mount();
    await openShared();
    await addDebt({ balance: "250000", payment: "1400", me: "700" });
    expect(txt("jd-sum-assigned")).toBe("Assigned: $700.00");
    expect(txt("jd-sum-remaining")).toBe("Not yet assigned: $700.00");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const d = lastSave().shared.debts[0] as SharedDebt;
    expect(d).toMatchObject({ name: "Mortgage", balance: 250000, monthlyPayment: 1400, basis: "actual", contributions: { me: 700, partner: null }, links: [] });
    await screen.findByTestId(`jd-card-${d.id}`);
    expect(txt(`jd-chip-${d.id}`)).toBe("Partly assigned");
    expect(txt(`jd-who-${d.id}`)).toContain("Me: $700.00");
    expect(txt(`jd-who-${d.id}`)).toContain("Alex: not stated");
    expect(txt(`jd-remaining-${d.id}`)).toBe("Not yet assigned: $700.00");
    expect(txt(`jd-balance-${d.id}`)).toBe("Balance: $250,000.00");
    expect(txt(`jd-payment-${d.id}`)).toBe("$1,400.00");
    expect(lastSave().shared.expenses).toEqual([rent]); // shared expenses untouched
    expect(lastSave().shared.goals).toEqual([goal]);
  });

  it("a blank balance and a blank payment are unknown (null); a typed 0 is a real 0", async () => {
    mount();
    await openShared();
    await addDebt({ name: "Unknown amounts", balance: "", payment: "" });
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.debts[0]).toMatchObject({ balance: null, monthlyPayment: null });
    const id = lastSave().shared.debts[0].id;
    await screen.findByTestId(`jd-card-${id}`);
    expect(txt(`jd-balance-${id}`)).toBe("Balance: not entered");
    expect(txt(`jd-payment-${id}`)).toBe("—");
    expect(txt(`jd-unknown-${id}`)).toContain("monthly payment is unknown");
    await addDebt({ name: "Paid off", balance: "0", payment: "0" });
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(2));
    const zero = lastSave().shared.debts[1] as SharedDebt;
    expect([zero.balance, zero.monthlyPayment]).toEqual([0, 0]);
    expect(txt(`jd-balance-${zero.id}`)).toBe("Balance: $0.00");
    expect(txt(`jd-payment-${zero.id}`)).toBe("$0.00");
  });

  it("estimates are saved as such and labelled", async () => {
    mount();
    await openShared();
    await addDebt({ payment: "100" });
    fireEvent.click(screen.getByTestId("jd-f-estimate"));
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.debts[0].basis).toBe("estimate");
    await screen.findByTestId(`jd-card-${lastSave().shared.debts[0].id}`);
    expect(txt(`jd-balance-${lastSave().shared.debts[0].id}`)).toContain("Includes estimates");
  });

  it("empty is 'not stated' and a typed 0 is an explicit $0 share", async () => {
    mount();
    await openShared();
    await addDebt({ payment: "1400", me: "1400", partner: "0" });
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const id = lastSave().shared.debts[0].id;
    expect(lastSave().shared.debts[0].contributions).toEqual({ me: 1400, partner: 0 });
    await screen.findByTestId(`jd-who-${id}`);
    expect(txt(`jd-who-${id}`)).toContain("Alex: $0.00");
    expect(txt(`jd-chip-${id}`)).toBe("Assigned");
  });

  it("nobody stated: the whole payment is not yet assigned and is never split", async () => {
    mount();
    await openShared();
    await addDebt({ payment: "1400" });
    expect(txt("jd-summary")).toContain("Nobody is assigned yet");
    expect(txt("jd-sum-remaining")).toBe("Not yet assigned: $1,400.00");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.debts[0].contributions).toEqual({ me: null, partner: null });
  });

  it("shortcuts act on the monthly payment (never the balance) and need a payment first", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-add"));
    type("jd-f-balance", "250000");
    expect((screen.getByTestId("jd-btn-me-all") as HTMLButtonElement).disabled).toBe(true); // a balance alone is not enough
    expect(txt("jd-shortcut-hint")).toContain("Enter the amount first");
    type("jd-f-payment", "1400");
    fireEvent.click(screen.getByTestId("jd-btn-me-all"));
    expect([val("jd-f-me"), val("jd-f-partner"), val("jd-f-balance")]).toEqual(["1400", "0", "250000"]);
    expect(txt("jd-summary")).toContain("Fully assigned.");
    fireEvent.click(screen.getByTestId("jd-btn-partner-all"));
    expect([val("jd-f-me"), val("jd-f-partner")]).toEqual(["0", "1400"]);
    fireEvent.click(screen.getByTestId("jd-btn-clear"));
    expect([val("jd-f-me"), val("jd-f-partner")]).toEqual(["", ""]);
  });

  it("shares are held to the payment (not the balance): over-assigning is stopped before anything is sent", async () => {
    mount();
    await openShared();
    await addDebt({ balance: "250000", payment: "1400", me: "1000", partner: "500" });
    expect(screen.getByTestId("jd-error-over")).toBeTruthy();
    fireEvent.click(screen.getByTestId("jd-save"));
    expect(h.saves).toEqual([]);
    type("jd-f-partner", "400");
    expect(screen.queryByTestId("jd-error-over")).toBeNull();
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
  });

  it("with an unknown payment, shares are kept as stated and the screen says they can't be checked", async () => {
    mount();
    await openShared();
    await addDebt({ payment: "", me: "300" });
    expect(txt("jd-who-note")).toContain("can't be checked against it");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.debts[0]).toMatchObject({ monthlyPayment: null, contributions: { me: 300, partner: null } });
  });

  it("required name and malformed amounts are explained after a save attempt; nothing is sent", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-add"));
    expect(screen.queryByText("Enter a name.")).toBeNull();
    fireEvent.click(screen.getByTestId("jd-save"));
    expect(screen.getByText("Enter a name.")).toBeTruthy();
    type("jd-f-balance", "12.345");
    expect(screen.getByText("Enter a valid balance with at most 2 decimals, or leave it empty.")).toBeTruthy();
    type("jd-f-payment", "abc");
    expect(screen.getByText("Enter a valid payment with at most 2 decimals, or leave it empty.")).toBeTruthy();
    expect(h.saves).toEqual([]);
  });

  it("without a partner there is no partner box or shortcut", async () => {
    mount({ partner: null });
    await openShared();
    fireEvent.click(screen.getByTestId("jd-add"));
    expect(screen.queryByTestId("jd-f-partner")).toBeNull();
    expect(screen.queryByTestId("jd-btn-partner-all")).toBeNull();
  });
});

describe("balances stay separate from monthly cash flow", () => {
  it("the monthly payment enters the household spending; the balance never does", async () => {
    mount();
    await openShared();
    await addDebt({ balance: "250000", payment: "1400", me: "1400" });
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    await screen.findByTestId("jd-totals");
    expect(txt("jd-total-payments")).toBe("$1,400.00");
    expect(txt("jd-total-balances")).toBe("$250,000.00");
    expect(txt("jd-totals")).toContain("Balances are never added to monthly spending or available cash.");
    fireEvent.click(screen.getByTestId("hh-nav-overview"));
    await screen.findByTestId("hh-spending");
    expect(txt("hh-spending")).toBe("$4,400.00"); // Me 800 + Alex 400 + rent 1,800 + the 1,400 payment: no balance anywhere
    expect(txt("hh-shared-total")).toBe("$3,200.00"); // 1,800 rent + 1,400 payment
    expect(txt("hh-root")).not.toContain("250,000");
  });
  it("an unknown balance makes the balance total 'at least' (or unknown), never $0", async () => {
    h.state = ready(sharedOf({ debts: [debt({ id: "a", balance: null }), debt({ id: "b", name: "Loan", balance: 500, monthlyPayment: 50 })] }));
    mount();
    await openShared();
    expect(screen.getByTestId("jd-total-balances").getAttribute("data-kind")).toBe("atLeast");
    expect(txt("jd-total-balances")).toBe("At least$500.00"); // the qualifier, then the amount
    cleanup();
    h.state = ready(sharedOf({ debts: [debt({ balance: null })] }));
    mount();
    await openShared();
    expect(screen.getByTestId("jd-total-balances").getAttribute("data-kind")).toBe("unknown");
    expect(txt("jd-total-balances")).toBe("—");
  });
  it("an unknown monthly payment makes the payments total 'at least' or unknown, never $0", async () => {
    h.state = ready(sharedOf({ debts: [debt({ monthlyPayment: null })] }));
    mount();
    await openShared();
    expect(screen.getByTestId("jd-total-payments").getAttribute("data-kind")).toBe("unknown");
    expect(txt("jd-total-payments")).toBe("—");
  });
});

describe("edit and remove", () => {
  const two = () => sharedOf({ debts: [debt({ id: "a", name: "Mortgage", contributions: { me: 700, partner: null } }), debt({ id: "b", name: "Car loan", balance: 8000, monthlyPayment: 245 })] });
  it("editing keeps the id and the other debts and expenses exactly as they were", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-edit-a"));
    expect(val("jd-f-name")).toBe("Mortgage");
    expect([val("jd-f-balance"), val("jd-f-payment"), val("jd-f-me"), val("jd-f-partner")]).toEqual(["250000", "1400", "700", ""]);
    type("jd-f-payment", "1500");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const list = lastSave().shared.debts as SharedDebt[];
    expect(list.map((d) => d.id)).toEqual(["a", "b"]);
    expect(list[0]).toMatchObject({ monthlyPayment: 1500, balance: 250000, contributions: { me: 700, partner: null } });
    expect(list[1]).toEqual(two().debts[1]);
    expect(lastSave().shared.expenses).toEqual([rent]);
  });
  it("removing asks first, says the originals are untouched, and removes only that debt", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-remove-a"));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg.textContent).toContain("Remove Mortgage?");
    expect(dlg.textContent).toContain("Payments accounts, Bills and Subscriptions are not changed");
    expect(h.saves).toEqual([]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect((lastSave().shared.debts as SharedDebt[]).map((d) => d.id)).toEqual(["b"]);
    expect(lastSave().shared.expenses).toEqual([rent]);
    await waitFor(() => expect(screen.queryByTestId("jd-card-a")).toBeNull());
  });
  it("cancelling an edit changes nothing", async () => {
    h.state = ready(two());
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-edit-a"));
    type("jd-f-name", "Changed");
    fireEvent.click(screen.getByTestId("jd-cancel"));
    expect(h.saves).toEqual([]);
    expect(txt("jd-name-a")).toBe("Mortgage");
  });
});

describe("reconciliation with Payments accounts and planner debts", () => {
  const meAccounts = () => complete(5000, 100, { useAccounts: true });

  it("matching names only warn: a joint debt named like a planner debt is flagged as a possible duplicate but never linked", async () => {
    const partner = alex(complete(3000, 50, { noDebts: false, debts: [pdebt({ id: "pd9", name: "Car loan" })] }));
    mount({ partner });
    await openShared();
    await addDebt({ name: "Car loan", payment: "245", me: "245" });
    expect(txt("jd-form-dups")).toContain("may also be in Alex's own debts.");
    expect((document.querySelector('[data-testid="jd-link-personalDebt|partner|pd9"] input') as HTMLInputElement).checked).toBe(false);
    expect(txt("jd-link-count")).toBe("Linked: 0");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.debts[0].links).toEqual([]);
    const id = lastSave().shared.debts[0].id;
    await screen.findByTestId(`jd-dups-${id}`);
    expect(txt(`jd-dups-${id}`)).toContain("Car loan");
  });

  it("lists Payments accounts and planner debts as explicit choices, with the originals untouched", async () => {
    const acct = account();
    const frozen = JSON.stringify(acct);
    mount({ accounts: [acct], partner: alex(complete(3000, 50, { noDebts: false, debts: [pdebt({ id: "pd9", name: "Student loan" })] })) });
    await openShared();
    fireEvent.click(screen.getByTestId("jd-add"));
    expect(txt("jd-links")).toContain("Linking never changes the original record, and nothing is linked automatically.");
    expect(txt("jd-links")).toContain("Payment accounts");
    expect(txt("jd-links")).toContain("Planner debts");
    expect(txt("jd-link-account|a1")).toContain("Visa · $35.00");
    expect(txt("jd-link-personalDebt|partner|pd9")).toContain("Alex: Student loan · $300.00");
    expect(JSON.stringify(acct)).toBe(frozen);
  });

  it("an explicit tick linking a counted Payments account: the debt is counted once, shares become informational", async () => {
    mount({ me: meAccounts(), accounts: [account({ name: "Mortgage account", minimumPayment: 1400, balance: 250000 })] });
    await openShared();
    await addDebt({ name: "Mortgage", balance: "250000", payment: "1400", me: "700", partner: "700" });
    fireEvent.click(document.querySelector('[data-testid="jd-link-account|a1"] input')!);
    expect(txt("jd-form-counted")).toContain("already counted elsewhere");
    expect(txt("jd-form-info")).toContain("Entered: Me $700.00, Alex $700.00");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const d = lastSave().shared.debts[0] as SharedDebt;
    expect(d.links).toEqual([{ kind: "account", id: "a1" }]);
    expect(d.contributions).toEqual({ me: 700, partner: 700 }); // preserved as entered
    await screen.findByTestId(`jd-chip-${d.id}`);
    expect(txt(`jd-chip-${d.id}`)).toBe("Counted in Finances");
    expect(txt(`jd-counted-${d.id}`)).toContain("not added again");
    expect(txt(`jd-info-${d.id}`)).toContain("Entered: Me $700.00, Alex $700.00");
  });

  it("linking to a planner debt offers a SUGGESTED share, applied only when the user presses Use", async () => {
    mount({ me: complete(5000, 100, { noDebts: false, debts: [pdebt()] }) });
    await openShared();
    await addDebt({ name: "Car loan", payment: "600" });
    fireEvent.click(document.querySelector('[data-testid="jd-link-personalDebt|me|pd1"] input')!);
    expect(txt("jd-sugg-me")).toContain("Me: $300.00");
    expect(val("jd-f-me")).toBe(""); // not applied
    expect(txt("jd-suggestions")).toContain("Nothing is applied until you choose Use.");
    fireEvent.click(screen.getByTestId("jd-sugg-use-me"));
    expect(val("jd-f-me")).toBe("300");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.debts[0]).toMatchObject({ contributions: { me: 300, partner: null }, links: [{ kind: "personalDebt", person: "me", debtId: "pd1" }] });
  });

  it("a typed share is never overwritten: no suggestion is offered for a person who already has one", async () => {
    mount({ me: complete(5000, 100, { noDebts: false, debts: [pdebt()] }) });
    await openShared();
    await addDebt({ name: "Car loan", payment: "600", me: "250" });
    fireEvent.click(document.querySelector('[data-testid="jd-link-personalDebt|me|pd1"] input')!);
    expect(screen.queryByTestId("jd-sugg-me")).toBeNull();
  });
});

describe("data safety", () => {
  it("a stale save is refused, nothing is overwritten, the latest is shown, and saving again applies the edit on top", async () => {
    h.state = ready(sharedOf({ debts: [debt({ id: "a" })] }));
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-edit-a"));
    type("jd-f-name", "Mortgage (mine)");
    h.state = ready(sharedOf({ debts: [debt({ id: "a" }), debt({ id: "z", name: "Added elsewhere", balance: 1, monthlyPayment: 1 })] }), { revision: 2 });
    fireEvent.click(screen.getByTestId("jd-save"));
    await screen.findByTestId("jd-message");
    expect(screen.getByTestId("jd-message").getAttribute("data-kind")).toBe("conflict");
    expect(txt("jd-message")).toContain("changed elsewhere");
    expect(h.state.shared.debts.map((d) => d.name)).toEqual(["Mortgage", "Added elsewhere"]); // stored data untouched
    expect(val("jd-f-name")).toBe("Mortgage (mine)"); // the user's edit is still on screen
    expect(await screen.findByTestId("jd-card-z")).toBeTruthy(); // the list shows the latest version
    expect(h.saves[0].expectedRevision).toBe(1);
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(2));
    expect(h.saves[1].expectedRevision).toBe(2);
    expect(h.state.shared.debts.map((d) => d.name)).toEqual(["Mortgage (mine)", "Added elsewhere"]);
    expect(h.state.revision).toBe(3);
  });

  it("saves never overlap: the controls are disabled while one is in flight", async () => {
    mount();
    await openShared();
    await addDebt({ payment: "100", me: "100" });
    let release: () => void = () => {};
    h.gate = new Promise<void>((r) => (release = r));
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect((screen.getByTestId("jd-save") as HTMLButtonElement).disabled).toBe(true));
    expect(txt("jd-save")).toBe("Saving…");
    fireEvent.click(screen.getByTestId("jd-save"));
    expect(h.saves).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.queryByTestId("jd-form")).toBeNull());
    expect(h.saves).toHaveLength(1);
  });

  it("a validation failure or generic failure keeps the form and the user's input", async () => {
    mount();
    await openShared();
    await addDebt({ payment: "100", me: "100" });
    h.failWith = new h.ValidationError([{ code: "badAmount" }]);
    fireEvent.click(screen.getByTestId("jd-save"));
    await screen.findByTestId("jd-message");
    expect(txt("jd-message")).toContain("Some entries are not valid. Nothing was saved.");
    h.failWith = new Error("network down");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(txt("jd-message")).toBe("network down"));
    expect(val("jd-f-me")).toBe("100");
  });

  const broken = () =>
    ready(sharedOf({ debts: [debt({ id: "a" })] }), {
      droppedItems: 1,
      integrity: { ok: false, issues: [{ code: "malformedItem", list: "debts", index: 1 }], fingerprint: "abc" },
      stored: { shared_debts: [{ id: "a" }, "junk"], revision: 1 },
    });

  it("unreadable stored data: the same warning, JSON download and acknowledgement gate the debt controls too", async () => {
    h.state = broken();
    mount();
    await openShared();
    expect(screen.getByTestId("hh-integrity")).toBeTruthy();
    expect(screen.getByTestId("hh-export")).toBeTruthy();
    expect((screen.getByTestId("jd-add") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("jd-edit-a") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("jd-remove-a") as HTMLButtonElement).disabled).toBe(true);
    expect(h.saves).toEqual([]);
  });

  it("after acknowledging, the save carries the acknowledgement for exactly the content shown, and the warning clears", async () => {
    h.state = broken();
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("se-ack"));
    expect((screen.getByTestId("jd-add") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("jd-add"));
    type("jd-f-name", "Car loan");
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().acknowledgeIntegrity).toBe("abc");
    await waitFor(() => expect(screen.queryByTestId("hh-integrity")).toBeNull());
  });

  it("only one form can be open at a time (expenses and debts)", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-add"));
    expect((screen.getByTestId("se-add") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("jd-cancel"));
    expect((screen.getByTestId("se-add") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("se-add"));
    expect((screen.getByTestId("jd-add") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("limits, availability and scope", () => {
  it("at 10 joint debts adding is disabled and says why", async () => {
    h.state = ready(sharedOf({ debts: Array.from({ length: 10 }, (_, i) => debt({ id: "d" + i, name: "Debt " + i, balance: 10, monthlyPayment: 5 })) }));
    mount();
    await openShared();
    expect((screen.getByTestId("jd-add") as HTMLButtonElement).disabled).toBe(true);
    expect(txt("jd-limit")).toBe("You've reached the limit of 10 joint debts.");
  });
  it("shared columns not available: the whole Shared tab explains it", async () => {
    h.state = { status: "unavailable" } as unknown as StoreState;
    mount();
    await screen.findByTestId("hh-income");
    fireEvent.click(screen.getByTestId("hh-nav-shared"));
    expect(txt("se-unavailable")).toContain("database update");
    expect(screen.queryByTestId("jd-add")).toBeNull();
  });
  it("shared expenses are unchanged by anything the debt editor does", async () => {
    mount();
    await openShared();
    await addDebt({ payment: "100", me: "100" });
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.expenses).toEqual([rent]);
    expect(txt("se-count")).toBe("Shared expenses: 1");
  });
  it("the Plan tab opens the household plan dashboard", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    expect(await screen.findByTestId("hp-root")).toBeTruthy();
  });
});

describe("Spanish", () => {
  it("renders the joint-debt editor, form, totals and errors in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      h.state = ready(sharedOf({ debts: [debt({ id: "a", contributions: { me: 700, partner: null } })] }));
      mount();
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await openShared();
      expect(txt("jd-root")).toContain("Deudas conjuntas");
      expect(txt("jd-totals")).toContain("Saldos pendientes (aparte)");
      expect(txt("jd-totals")).toContain("nunca se suman al gasto mensual");
      expect(txt("jd-balance-a")).toBe("Saldo: $250,000.00");
      fireEvent.click(screen.getByTestId("jd-edit-a"));
      expect(txt("jd-form")).toContain("Quién cubre el pago mensual");
      expect(txt("jd-form")).toContain("Déjalo vacío si no se sabe");
      expect(txt("jd-btn-me-all")).toBe("Yo: cubro todo");
      type("jd-f-name", "");
      fireEvent.click(screen.getByTestId("jd-save"));
      expect(screen.getByText("Escribe un nombre.")).toBeTruthy();
      expect(txt("jd-links")).toContain("nada se vincula automáticamente");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

describe("layout rules in the stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  it("the payment column never wraps and the joint-debt styles reuse the shared-expense layout", () => {
    const pay = css.slice(css.lastIndexOf(".plan-root .jd-pay {")).split("}")[0];
    expect(pay).toContain("justify-items: end");
    expect(pay).toContain("flex: 0 0 auto");
    expect(css).toContain(".plan-root .se-actions .plan-btn {");
  });
});

describe("a $0 payment is not described as paid off", () => {
  it("a positive balance with a $0 payment says no payment is due this month but the balance is still owed", async () => {
    h.state = ready(sharedOf({ debts: [debt({ id: "a", balance: 8000, monthlyPayment: 0 })] }));
    mount();
    await openShared();
    expect(txt("jd-chip-a")).toBe("No payment due");
    expect(txt("jd-zero-a")).toBe("No payment is due this month, but the balance is still owed.");
    expect(txt("jd-card-a")).not.toMatch(/paid off/i);
    expect(txt("jd-card-a")).not.toMatch(/\bpagada\b/i);
    expect(txt("jd-balance-a")).toBe("Balance: $8,000.00");
    expect(txt("jd-total-balances")).toBe("$8,000.00"); // the balance is still counted as owed
    expect(txt("jd-total-payments")).toBe("$0.00");
  });
  it("only a balance of exactly 0 is described as paid off", async () => {
    h.state = ready(sharedOf({ debts: [debt({ id: "a", balance: 0, monthlyPayment: 0 })] }));
    mount();
    await openShared();
    expect(txt("jd-chip-a")).toBe("Paid off");
    expect(txt("jd-zero-a")).toBe("Paid off: nothing is owed.");
  });
  it("an unknown balance with a $0 payment is neither owed nor paid off", async () => {
    h.state = ready(sharedOf({ debts: [debt({ id: "a", balance: null, monthlyPayment: 0 })] }));
    mount();
    await openShared();
    expect(txt("jd-chip-a")).toBe("No payment due");
    expect(txt("jd-zero-a")).toBe("No payment is due this month. The balance isn't entered.");
    expect(txt("jd-card-a")).not.toMatch(/paid off/i);
  });
  it("the form says the same while typing: a positive balance and a typed 0 payment is never 'paid off'", async () => {
    mount();
    await openShared();
    fireEvent.click(screen.getByTestId("jd-add"));
    type("jd-f-name", "Mortgage");
    type("jd-f-balance", "8000");
    type("jd-f-payment", "0");
    expect(txt("jd-zero-hint")).toBe("No payment is due this month, but the balance is still owed.");
    expect(txt("jd-form")).not.toMatch(/paid off:/i);
    type("jd-f-balance", "0");
    expect(txt("jd-zero-hint")).toBe("Paid off: nothing is owed.");
    type("jd-f-payment", "100");
    expect(screen.queryByTestId("jd-zero-hint")).toBeNull();
  });
  it("saving a positive balance with a $0 payment keeps both exactly as typed", async () => {
    mount();
    await openShared();
    await addDebt({ balance: "8000", payment: "0" });
    fireEvent.click(screen.getByTestId("jd-save"));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(lastSave().shared.debts[0]).toMatchObject({ balance: 8000, monthlyPayment: 0 });
  });
  it("the Spanish wording never says the debt is paid", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      h.state = ready(sharedOf({ debts: [debt({ id: "a", balance: 8000, monthlyPayment: 0 })] }));
      mount();
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await openShared();
      expect(txt("jd-chip-a")).toBe("Sin pago este mes");
      expect(txt("jd-zero-a")).toBe("No hay pago este mes, pero el saldo aún se debe.");
      expect(txt("jd-card-a")).not.toMatch(/pagada/i);
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

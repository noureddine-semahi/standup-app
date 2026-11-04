import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { PaymentsDashboardProps } from "./PaymentsDashboard";
import type { Bill } from "@/lib/bills";
import type { BillsController } from "./useBills";
import type { SubscriptionsController } from "./useSubscriptions";
import type { Subscription } from "@/lib/subscriptions";
import FinancesHub from "./FinancesHub";

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {}, clear() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const acct = (over: Partial<PaymentAccount> = {}): PaymentAccount => ({
  id: "a1",
  name: "Bank of America",
  balance: 394,
  minimumPayment: 25,
  dueDay: 13,
  remindDaysBefore: 3,
  lastReminderDueDate: null,
  createdAt: "2026-01-01T00:00:00Z",
  balanceMode: "auto",
  ...over,
});

const billsController = (over: Partial<BillsController> = {}): BillsController => ({
  state: "ready",
  loadError: null,
  bills: [],
  occurrences: {},
  historyOpenId: null,
  historyLoading: false,
  history: {},
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  recordPayment: vi.fn(),
  setAmount: vi.fn(),
  reversePayment: vi.fn(),
  toggleHistory: vi.fn(),
  ...over,
});

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: "b1",
  name: "Rent",
  amountType: "fixed",
  expectedAmount: 1000,
  recurrence: "monthly",
  firstDueDate: "2026-01-12",
  remindDaysBefore: 3,
  category: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

const subscriptionsController = (over: Partial<SubscriptionsController> = {}): SubscriptionsController => ({
  state: "ready",
  loadError: null,
  subscriptions: [],
  payments: {},
  create: vi.fn(),
  update: vi.fn(),
  changeStatus: vi.fn(),
  remove: vi.fn(),
  recordPayment: vi.fn(),
  reversePayment: vi.fn(),
  cancellationsState: "ready",
  cancellations: {},
  saveCancelUrl: vi.fn(),
  startAssistedCancellation: vi.fn(),
  reportCancellation: vi.fn(),
  reportCancellationFailure: vi.fn(),
  ...over,
});

const subscription = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1",
  name: "Netflix",
  provider: null,
  category: null,
  planName: null,
  amount: 15.49,
  currency: "USD",
  frequency: "monthly",
  customInterval: null,
  customUnit: null,
  nextBillingDate: "2026-11-20",
  startDate: null,
  status: "active",
  trialEndsOn: null,
  remindDaysBefore: 3,
  notes: null,
  billId: null,
  canceledAt: null,
  cancelUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

function setup(accounts: PaymentAccount[] = [], bills: BillsController = billsController(), subs: SubscriptionsController = subscriptionsController()) {
  const props: PaymentsDashboardProps = {
    accounts,
    loading: false,
    message: null,
    todayISO: "2026-11-03",
    busyIds: new Set(),
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onRecordPayment: vi.fn(),
    onReversePayment: vi.fn(),
    historyOpenId: null,
    historyLoadingId: null,
    historyByAccount: {},
    onToggleHistory: vi.fn(),
  };
  render(
    <LanguageProvider>
      <FinancesHub {...props} bills={bills} subscriptions={subs} />
    </LanguageProvider>
  );
}

describe("FinancesHub overview", () => {
  it("shows zeros (not sample data) with no accounts", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Finances" })).toBeTruthy();
    expect(screen.getByText("Stay ahead of your financial commitments.")).toBeTruthy();
    expect(screen.getByTestId("fin-balances").textContent).toBe("$0.00");
    expect(screen.getByTestId("fin-due").textContent).toBe("$0.00");
    expect(screen.getByTestId("fin-subs").textContent).toBe("$0.00");
    expect(screen.getByTestId("fin-upcoming").textContent).toBe("0");
  });

  it("derives all four figures from real accounts and never sums them into one total", () => {
    setup([
      acct({ id: "1", balance: 1000, minimumPayment: 35, dueDay: 3 }),
      acct({ id: "2", balance: 500.25, minimumPayment: 20, dueDay: 5 }),
      acct({ id: "3", balance: 10, minimumPayment: 5, dueDay: 25 }),
    ]);
    expect(screen.getByTestId("fin-balances").textContent).toBe("$1,510.25");
    expect(screen.getByTestId("fin-due").textContent).toBe("$60.00");
    expect(screen.getByTestId("fin-upcoming").textContent).toBe("2");
    const overview = screen.getByRole("region", { name: "Finances overview" });
    expect(within(overview).getAllByText(/^\$/).length).toBe(3); // balances, due, subscriptions -- no fourth "total"
  });
});

describe("FinancesHub tabs", () => {
  it("offers Bills, Payments and Subscriptions, with Payments selected by default", () => {
    setup([acct()]);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Bills", "Payments", "Subscriptions"]);
    expect(screen.getByRole("tab", { name: "Payments" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("pay-card")).toBeTruthy();
  });

  it("switches panels; existing payment data stays intact when returning", () => {
    setup([acct()]);
    fireEvent.click(screen.getByRole("tab", { name: "Bills" }));
    expect(screen.getByRole("tab", { name: "Bills" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("pay-card")).toBeNull();
    expect(screen.getByText("No bills added yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Subscriptions" }));
    expect(screen.getByRole("heading", { name: "Subscriptions" })).toBeTruthy(); // the real tracker, not a placeholder
    fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
    expect(screen.getByText("Bank of America")).toBeTruthy();
    // Overview is unaffected by which tab is open.
    expect(screen.getByTestId("fin-balances").textContent).toBe("$394.00");
  });
});

describe("FinancesHub with bills", () => {
  it("adds this month's remaining bills (estimates included, and labelled) to Monthly due and Upcoming, leaving balances alone", () => {
    const rent = bill({ id: "r", name: "Rent", expectedAmount: 1000, firstDueDate: "2026-01-12" });
    const power = bill({ id: "e", name: "Electricity", amountType: "variable", expectedAmount: 145, firstDueDate: "2026-01-05" });
    const pay = (id: string, amount: number) => ({ id, amount, paidAt: "x", note: null, reversedAt: null });
    setup(
      [acct({ id: "1", balance: 394, minimumPayment: 25, dueDay: 25 })],
      billsController({
        bills: [rent, power],
        occurrences: {
          r: {
            "2026-10-12": { id: "o1", billId: "r", dueDate: "2026-10-12", amountDue: 1000, payments: [pay("p", 1000)] },
            "2026-11-12": { id: "o2", billId: "r", dueDate: "2026-11-12", amountDue: 1000, payments: [pay("q", 400)] },
          },
          e: { "2026-10-05": { id: "o3", billId: "e", dueDate: "2026-10-05", amountDue: 120, payments: [pay("z", 120)] } },
        },
      })
    );
    expect(screen.getByTestId("fin-balances").textContent).toBe("$394.00");
    expect(screen.getByTestId("fin-due").textContent).toBe("$770.00"); // 25 minimum + 600 left on rent + 145 electricity estimate
    expect(screen.getByText("Includes estimates")).toBeTruthy();
    expect(screen.queryByText(/awaiting/)).toBeNull();
    expect(screen.getByTestId("fin-upcoming").textContent).toBe("1"); // electricity Nov 5 is inside its window
  });

  it("shows 'Amount pending' instead of $0.00 when no bill has an actual or estimated amount (and no minimums)", () => {
    const power = bill({ id: "e", name: "Electricity", amountType: "variable", expectedAmount: null, firstDueDate: "2026-01-12" });
    const water = bill({ id: "w", name: "Water", amountType: "variable", expectedAmount: null, firstDueDate: "2026-01-20" });
    setup([], billsController({ bills: [power, water] }));
    expect(screen.getByTestId("fin-due").textContent).toBe("Amount pending");
    expect(screen.getByText("2 bills awaiting amounts")).toBeTruthy();
    expect(screen.queryByText("Known amounts only")).toBeNull();
    expect(screen.queryByText("Includes estimates")).toBeNull();
  });

  it("estimates are real numbers in the overview, labelled 'Includes estimates', with no-amount bills counted as awaiting", () => {
    const power = bill({ id: "e", name: "Electricity", amountType: "variable", expectedAmount: 145, firstDueDate: "2026-01-12" });
    const water = bill({ id: "w", name: "Water", amountType: "variable", expectedAmount: null, firstDueDate: "2026-01-20" });
    setup([], billsController({ bills: [power, water] }));
    expect(screen.getByTestId("fin-due").textContent).toBe("$145.00");
    expect(screen.getByText("Includes estimates")).toBeTruthy();
    expect(screen.getByText("1 bill awaiting amount")).toBeTruthy();
    expect(screen.queryByText("Known amounts only")).toBeNull();
  });

  it("actual amounts only plus a no-amount bill: 'Known amounts only'", () => {
    const rent = bill({ id: "r", name: "Rent", expectedAmount: 1000, firstDueDate: "2026-11-12", recurrence: "once" });
    const water = bill({ id: "w", name: "Water", amountType: "variable", expectedAmount: null, firstDueDate: "2026-11-20", recurrence: "once" });
    setup([], billsController({ bills: [rent, water] }));
    expect(screen.getByTestId("fin-due").textContent).toBe("$1,000.00");
    expect(screen.getByText("Known amounts only")).toBeTruthy();
    expect(screen.getByText("1 bill awaiting amount")).toBeTruthy();
    expect(screen.queryByText("Includes estimates")).toBeNull();
  });

  it("keeps the account-only overview when Bills is unavailable, loading or errored", () => {
    for (const state of ["unavailable", "loading", "error"] as const) {
      cleanup();
      setup([acct({ id: "1", balance: 100, minimumPayment: 10, dueDay: 25 })], billsController({ state }));
      expect(screen.getByTestId("fin-due").textContent).toBe("$10.00");
      expect(screen.queryByText(/amount not entered/)).toBeNull();
    }
  });

  it("the Bills tab shows the unavailable message when the migration isn't applied", () => {
    setup([], billsController({ state: "unavailable" }));
    fireEvent.click(screen.getByRole("tab", { name: "Bills" }));
    expect(screen.getByTestId("bills-unavailable")).toBeTruthy();
  });
});

describe("FinancesHub layout hooks", () => {
  it("every overview value carries its length so the tile can size it to stay on one line", () => {
    setup([acct({ id: "1", balance: 63354, minimumPayment: 25, dueDay: 13 })]);
    const balances = screen.getByTestId("fin-balances");
    expect(balances.textContent).toBe("$63,354.00");
    expect(balances.style.getPropertyValue("--len")).toBe("10");
    expect(screen.getByTestId("fin-subs").style.getPropertyValue("--len")).toBe("5"); // "$0.00"
    expect(screen.getByTestId("fin-upcoming").style.getPropertyValue("--len")).toBe("1");
  });

  it("keeps the Finances heading and description, with the section header for the Payments tab", () => {
    setup([acct()]);
    expect(screen.getByRole("heading", { name: "Finances" })).toBeTruthy();
    expect(screen.getByText("Stay ahead of your financial commitments.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Payments" })).toBeTruthy();
    expect(screen.getByText("Track your accounts, balances and minimum payments.")).toBeTruthy();
  });

  it("Bills and Payments share the same section-head and add-button structure", () => {
    setup([acct()], billsController());
    const payments = document.querySelector(".pay-panel")!;
    expect(payments.querySelector(".fin-section-head")).toBeTruthy();
    expect(payments.querySelector(".pay-add-btn")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Bills" }));
    const bills = document.querySelector(".pay-panel")!;
    expect(bills.querySelector(".fin-section-head")).toBeTruthy();
    expect(bills.querySelector(".pay-add-btn")).toBeTruthy();
  });
});

describe("FinancesHub with subscriptions", () => {
  const monthly = (id: string, amount: number, over: Partial<Subscription> = {}) => subscription({ id, name: "Svc " + id, amount, ...over });

  it("the Subscriptions tile shows the real monthly-equivalent total of active paying subscriptions", () => {
    setup(
      [],
      billsController(),
      subscriptionsController({
        subscriptions: [
          monthly("a", 15.49),
          monthly("b", 120, { frequency: "yearly" }), // 10 / month
          monthly("t", 99, { status: "trial", trialEndsOn: "2026-11-30", nextBillingDate: "2026-11-30" }), // not charged yet
          monthly("p", 99, { status: "paused" }),
          monthly("c", 99, { status: "canceled" }),
        ],
      })
    );
    expect(screen.getByTestId("fin-subs").textContent).toBe("$25.49");
  });

  it("is $0.00 with nothing tracked, and while the tables aren't available", () => {
    setup();
    expect(screen.getByTestId("fin-subs").textContent).toBe("$0.00");
    cleanup();
    setup([], billsController(), subscriptionsController({ state: "unavailable" }));
    expect(screen.getByTestId("fin-subs").textContent).toBe("$0.00");
  });

  it("says what the total leaves out: no-price subscriptions and other currencies", () => {
    setup(
      [],
      billsController(),
      subscriptionsController({ subscriptions: [monthly("a", 10), monthly("n", 0, { amount: null }), monthly("e", 8, { currency: "EUR" })] })
    );
    expect(screen.getByTestId("fin-subs").textContent).toBe("$10.00");
    expect(screen.getByText("1 awaiting price")).toBeTruthy();
    expect(screen.getByText("Excludes 1 in other currencies")).toBeTruthy();
  });

  it("subscriptions are not added to Monthly due", () => {
    setup([acct({ id: "1", balance: 100, minimumPayment: 10, dueDay: 25 })], billsController(), subscriptionsController({ subscriptions: [monthly("a", 500)] }));
    expect(screen.getByTestId("fin-due").textContent).toBe("$10.00");
  });

  it("surfaces (never merges) a possible overlap with a bill, and a linked subscription isn't flagged", () => {
    const netflixBill = bill({ id: "nb", name: "Netflix", firstDueDate: "2026-11-25", recurrence: "once" });
    setup([], billsController({ bills: [netflixBill] }), subscriptionsController({ subscriptions: [monthly("a", 15.49, { name: "Netflix" })] }));
    expect(screen.getByText("1 may overlap Bills")).toBeTruthy();
    cleanup();
    setup([], billsController({ bills: [netflixBill] }), subscriptionsController({ subscriptions: [monthly("a", 15.49, { name: "Netflix", billId: "nb" })] }));
    expect(screen.queryByText(/may overlap Bills/)).toBeNull();
  });

  it("a linked subscription's upcoming renewal isn't counted twice in Upcoming; an unlinked one is", () => {
    const soon = { nextBillingDate: "2026-11-05" }; // inside its 3-day window on 2026-11-03
    setup([], billsController(), subscriptionsController({ subscriptions: [monthly("a", 10, soon)] }));
    expect(screen.getByTestId("fin-upcoming").textContent).toBe("1");
    cleanup();
    setup([], billsController(), subscriptionsController({ subscriptions: [monthly("a", 10, { ...soon, billId: "b1" })] }));
    expect(screen.getByTestId("fin-upcoming").textContent).toBe("0");
  });

  it("the Subscriptions tab shows the unavailable message when the migration isn't applied", () => {
    setup([], billsController(), subscriptionsController({ state: "unavailable" }));
    fireEvent.click(screen.getByRole("tab", { name: "Subscriptions" }));
    expect(screen.getByTestId("subs-unavailable")).toBeTruthy();
  });
});

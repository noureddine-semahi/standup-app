import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { PaymentsDashboardProps } from "./PaymentsDashboard";
import type { Bill } from "@/lib/bills";
import type { BillsController } from "./useBills";
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

function setup(accounts: PaymentAccount[] = [], bills: BillsController = billsController()) {
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
      <FinancesHub {...props} bills={bills} />
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
    expect(screen.getByText(/Subscription tracking is coming/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
    expect(screen.getByText("Bank of America")).toBeTruthy();
    // Overview is unaffected by which tab is open.
    expect(screen.getByTestId("fin-balances").textContent).toBe("$394.00");
  });
});

describe("FinancesHub with bills", () => {
  it("adds this month's unpaid bills to Monthly due and Upcoming, leaves balances alone, and flags unknown amounts", () => {
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
    expect(screen.getByTestId("fin-due").textContent).toBe("$625.00"); // 25 minimum + 600 left on rent; electricity amount unknown
    expect(screen.getByText("+1 amount not entered")).toBeTruthy();
    expect(screen.getByTestId("fin-upcoming").textContent).toBe("1"); // electricity Nov 5 is inside its window
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

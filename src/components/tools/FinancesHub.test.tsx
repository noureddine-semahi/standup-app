import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { PaymentsDashboardProps } from "./PaymentsDashboard";
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

function setup(accounts: PaymentAccount[] = []) {
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
      <FinancesHub {...props} />
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
    expect(screen.getByText(/Bill tracking is coming/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Subscriptions" }));
    expect(screen.getByText(/Subscription tracking is coming/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
    expect(screen.getByText("Bank of America")).toBeTruthy();
    // Overview is unaffected by which tab is open.
    expect(screen.getByTestId("fin-balances").textContent).toBe("$394.00");
  });
});

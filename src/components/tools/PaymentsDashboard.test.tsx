import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { PaymentAccount } from "@/lib/supabase/db";
import PaymentsDashboard, { type PaymentsDashboardProps } from "./PaymentsDashboard";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
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
  ...over,
});

function setup(over: Partial<PaymentsDashboardProps> = {}) {
  const props: PaymentsDashboardProps = {
    accounts: [],
    loading: false,
    message: null,
    todayISO: "2026-11-03",
    busyIds: new Set(),
    onCreate: vi.fn().mockResolvedValue(null),
    onUpdate: vi.fn().mockResolvedValue(null),
    onDelete: vi.fn().mockResolvedValue(null),
    historyOpenId: null,
    historyLoadingId: null,
    historyByAccount: {},
    onToggleHistory: vi.fn(),
    ...over,
  };
  render(
    <LanguageProvider>
      <PaymentsDashboard {...props} />
    </LanguageProvider>
  );
  return props;
}

const typeInto = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("PaymentsDashboard summary", () => {
  it("shows $0.00 totals and the empty state with no accounts", () => {
    setup();
    expect(screen.getByTestId("pay-total-balance").textContent).toBe("$0.00");
    expect(screen.getByTestId("pay-monthly-minimums").textContent).toBe("$0.00");
    expect(screen.getByText("No payment accounts yet.")).toBeTruthy();
  });

  it("totals a single account", () => {
    setup({ accounts: [acct()] });
    expect(screen.getByTestId("pay-total-balance").textContent).toBe("$394.00");
    expect(screen.getByTestId("pay-monthly-minimums").textContent).toBe("$25.00");
  });

  it("totals several accounts and renders a read-only card for each, in the given order", () => {
    setup({
      accounts: [acct(), acct({ id: "a2", name: "Chase", balance: 1200.5, minimumPayment: 40 }), acct({ id: "a3", name: "Gas bill", balance: 0, minimumPayment: 60.25 })],
    });
    expect(screen.getByTestId("pay-total-balance").textContent).toBe("$1,594.50");
    expect(screen.getByTestId("pay-monthly-minimums").textContent).toBe("$125.25");
    const cards = screen.getAllByTestId("pay-card");
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual(["Bank of America", "Chase", "Gas bill"]);
    // No editable inputs until Add / Edit is opened.
    expect(document.querySelectorAll("input, textarea").length).toBe(0);
  });

  it("shows each card's next due date from the existing calculation", () => {
    setup({ accounts: [acct({ dueDay: 3 }), acct({ id: "a2", dueDay: 20 })] });
    const cards = screen.getAllByTestId("pay-card");
    expect(within(cards[0]).getByText("Due today")).toBeTruthy();
    expect(cards[1].querySelector(".pay-due")!.getAttribute("data-tier")).toBe("later");
    expect(cards[0].querySelector(".pay-due")!.getAttribute("data-tier")).toBe("today");
  });
});

describe("Add account", () => {
  it("opens an empty form, saves through onCreate with the existing field meanings, then closes", async () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
    const dialog = screen.getByRole("dialog");
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Remind (days before)") as HTMLInputElement).value).toBe("3");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    typeInto("Account name", "  Visa ");
    typeInto("Balance", "394");
    typeInto("Minimum payment", "25");
    typeInto("Due day of month", "13");
    typeInto("Remind (days before)", "5");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onCreate).toHaveBeenCalledWith({ name: "Visa", balance: 394, minimumPayment: 25, dueDay: 13, remindDaysBefore: 5 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dialog.isConnected).toBe(false);
  });

  it("rejects an out-of-range due day", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
    typeInto("Account name", "Visa");
    typeInto("Due day of month", "32");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Cancel and Escape create nothing", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
    typeInto("Account name", "Visa");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("keeps the modal open and shows the error when saving fails", async () => {
    setup({ onCreate: vi.fn().mockResolvedValue("Failed to add payment account") });
    fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
    typeInto("Account name", "Visa");
    typeInto("Due day of month", "5");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Failed to add payment account");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("Edit account", () => {
  it("prepopulates the form (reminder fields included) and does not write on open", () => {
    const props = setup({ accounts: [acct({ dueDay: 28, remindDaysBefore: 7 })] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Bank of America");
    expect((screen.getByLabelText("Balance") as HTMLInputElement).value).toBe("394");
    expect((screen.getByLabelText("Minimum payment") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Due day of month") as HTMLInputElement).value).toBe("28");
    expect((screen.getByLabelText("Remind (days before)") as HTMLInputElement).value).toBe("7");
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("saves only the changed fields through onUpdate", async () => {
    const account = acct();
    const props = setup({ accounts: [account] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    typeInto("Balance", "350.5");
    typeInto("Remind (days before)", "10");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
    expect(props.onUpdate).toHaveBeenCalledWith(account, { balance: 350.5, remindDaysBefore: 10 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("saving without changes closes without writing", async () => {
    const props = setup({ accounts: [acct()] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("Cancel discards unsaved edits", () => {
    const props = setup({ accounts: [acct()] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    typeInto("Account name", "Something else");
    typeInto("Balance", "1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onUpdate).not.toHaveBeenCalled();
    // Reopening shows the stored values, not the discarded draft.
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Bank of America");
    expect((screen.getByLabelText("Balance") as HTMLInputElement).value).toBe("394");
  });
});

describe("Remove account", () => {
  const openRemove = () => {
    fireEvent.click(screen.getByRole("button", { name: "More Bank of America" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove account" }));
  };

  it("sits behind More and never deletes without confirmation", () => {
    const props = setup({ accounts: [acct()] });
    expect(screen.queryByRole("button", { name: "Remove account" })).toBeNull();
    openRemove();
    expect(props.onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Bank of America");
  });

  it("Cancel leaves the account alone", () => {
    const props = setup({ accounts: [acct()] });
    openRemove();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("Remove Account calls onDelete once for that account", async () => {
    const account = acct();
    const props = setup({ accounts: [account] });
    openRemove();
    fireEvent.click(screen.getByRole("button", { name: "Remove Account" }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledTimes(1));
    expect(props.onDelete).toHaveBeenCalledWith(account);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("shows the error and stays open when removal fails", async () => {
    setup({ accounts: [acct()], onDelete: vi.fn().mockResolvedValue("Failed to delete payment account") });
    openRemove();
    fireEvent.click(screen.getByRole("button", { name: "Remove Account" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Failed to delete payment account");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("History", () => {
  it("is still reachable (via More) and delegates to the page's lazy loader", () => {
    const account = acct();
    const props = setup({ accounts: [account] });
    fireEvent.click(screen.getByRole("button", { name: "More Bank of America" }));
    fireEvent.click(screen.getByRole("button", { name: "Payment history" }));
    expect(props.onToggleHistory).toHaveBeenCalledWith(account);
  });
});

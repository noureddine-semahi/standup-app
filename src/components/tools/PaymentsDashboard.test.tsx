import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { PaymentAccount, PaymentTransaction } from "@/lib/supabase/db";
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
  balanceMode: "manual",
  ...over,
});

const txn = (over: Partial<PaymentTransaction> = {}): PaymentTransaction => ({
  id: "t1",
  accountId: "a1",
  goalId: null,
  amount: 40,
  paidAt: "2026-10-30T12:00:00",
  note: null,
  balanceApplied: true,
  reversedAt: null,
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
    onRecordPayment: vi.fn().mockResolvedValue(null),
    onReversePayment: vi.fn().mockResolvedValue(null),
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

describe("Payments tab cards", () => {
  it("shows the empty state with an Add action when there are no accounts", () => {
    setup();
    expect(screen.getByText("No payment accounts yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add Account/ })).toBeTruthy();
  });

  it("renders a read-only card per account, in the given order, with no inputs until Add/Edit", () => {
    setup({
      accounts: [acct(), acct({ id: "a2", name: "Chase", balance: 1200.5, minimumPayment: 40 }), acct({ id: "a3", name: "Gas bill", balance: 0, minimumPayment: 60.25 })],
    });
    const cards = screen.getAllByTestId("pay-card");
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual(["Bank of America", "Chase", "Gas bill"]);
    expect(within(cards[1]).getByText("$1,200.50")).toBeTruthy();
    expect(document.querySelectorAll("input, textarea").length).toBe(0);
  });

  it("shows each card's next due date from the existing calculation, and the balance policy", () => {
    setup({ accounts: [acct({ dueDay: 3, balanceMode: "auto" }), acct({ id: "a2", dueDay: 20 })] });
    const cards = screen.getAllByTestId("pay-card");
    expect(within(cards[0]).getByText("Due today")).toBeTruthy();
    expect(cards[0].querySelector(".pay-due")!.getAttribute("data-tier")).toBe("today");
    expect(cards[1].querySelector(".pay-due")!.getAttribute("data-tier")).toBe("later");
    expect(within(cards[0]).getByText("Auto balance")).toBeTruthy();
    expect(within(cards[1]).getByText("Manual balance")).toBeTruthy();
  });
});

describe("Add account", () => {
  it("opens an empty form defaulting to manual balance tracking and saves through onCreate", async () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
    const dialog = screen.getByRole("dialog");
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Remind (days before)") as HTMLInputElement).value).toBe("3");
    expect(screen.getByRole("button", { name: "Manual" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    typeInto("Account name", "  Visa ");
    typeInto("Balance", "394");
    typeInto("Minimum payment", "25");
    typeInto("Due day of month", "13");
    typeInto("Remind (days before)", "5");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onCreate).toHaveBeenCalledWith({ name: "Visa", balance: 394, minimumPayment: 25, dueDay: 13, remindDaysBefore: 5, balanceMode: "manual" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dialog.isConnected).toBe(false);
  });

  it("only becomes automatic when the user explicitly picks it", async () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
    typeInto("Account name", "Visa");
    typeInto("Due day of month", "5");
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ balanceMode: "auto" })));
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
  it("prepopulates the form (reminder fields and balance mode included) and does not write on open", () => {
    const props = setup({ accounts: [acct({ dueDay: 28, remindDaysBefore: 7, balanceMode: "auto" })] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Bank of America");
    expect((screen.getByLabelText("Balance") as HTMLInputElement).value).toBe("394");
    expect((screen.getByLabelText("Minimum payment") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Due day of month") as HTMLInputElement).value).toBe("28");
    expect((screen.getByLabelText("Remind (days before)") as HTMLInputElement).value).toBe("7");
    expect(screen.getByRole("button", { name: "Automatic" }).getAttribute("aria-pressed")).toBe("true");
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

  it("switching balance mode is an explicit change and is the only field sent", async () => {
    const account = acct({ balanceMode: "manual" });
    const props = setup({ accounts: [account] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    fireEvent.click(screen.getByRole("button", { name: "Automatic" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(account, { balanceMode: "auto" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Bank of America");
    expect((screen.getByLabelText("Balance") as HTMLInputElement).value).toBe("394");
  });
});

describe("Record payment", () => {
  const open = (account = acct()) => {
    const props = setup({ accounts: [account] });
    fireEvent.click(screen.getByRole("button", { name: `Record Payment ${account.name}` }));
    return props;
  };

  it("opens a form defaulting to today, with Record disabled until the amount is valid", () => {
    open();
    expect((screen.getByLabelText("Payment date") as HTMLInputElement).value).toBe("2026-11-03");
    expect((screen.getByRole("button", { name: "Record" }) as HTMLButtonElement).disabled).toBe(true);
    typeInto("Payment amount", "0");
    expect((screen.getByRole("button", { name: "Record" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("greater than zero");
  });

  it("validates decimals and future dates with clear messages", () => {
    open();
    typeInto("Payment amount", "10.555");
    expect(screen.getByRole("alert").textContent).toContain("2 decimal");
    typeInto("Payment amount", "10.55");
    typeInto("Payment date", "2026-11-04");
    expect(screen.getByRole("alert").textContent).toContain("future");
    expect((screen.getByRole("button", { name: "Record" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("manual account: balance is NOT reduced unless the user ticks the box", async () => {
    const props = open(acct({ balanceMode: "manual" }));
    typeInto("Payment amount", "50");
    expect(screen.queryByText(/Balance after/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(props.onRecordPayment).toHaveBeenCalledTimes(1));
    const [, payload] = (props.onRecordPayment as any).mock.calls[0];
    expect(payload).toMatchObject({ amount: 50, applyBalance: false, note: null });
  });

  it("manual account: ticking 'also reduce balance' previews and sends the explicit choice", async () => {
    const props = open(acct({ balanceMode: "manual", balance: 394 }));
    typeInto("Payment amount", "94.50");
    typeInto("Note (optional)", " Oct statement ");
    fireEvent.click(screen.getByLabelText("Also reduce this account’s balance"));
    expect(screen.getByText("Balance after: $299.50")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(props.onRecordPayment).toHaveBeenCalledTimes(1));
    expect((props.onRecordPayment as any).mock.calls[0][1]).toMatchObject({ amount: 94.5, applyBalance: true, note: "Oct statement" });
  });

  it("automatic account: no checkbox, balance preview shown, applyBalance is true", async () => {
    const props = open(acct({ balanceMode: "auto", balance: 100 }));
    expect(screen.queryByLabelText("Also reduce this account’s balance")).toBeNull();
    typeInto("Payment amount", "30");
    expect(screen.getByText("Balance after: $70.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(props.onRecordPayment).toHaveBeenCalledTimes(1));
    expect((props.onRecordPayment as any).mock.calls[0][1]).toMatchObject({ amount: 30, applyBalance: true });
  });

  it("repeated taps submit once and reuse one idempotency key; a retry after failure reuses it too", async () => {
    let resolveFirst: (v: string | null) => void = () => {};
    const onRecordPayment = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string | null>((res) => (resolveFirst = res)))
      .mockResolvedValue(null);
    open();
    cleanup();
    const props = setup({ accounts: [acct()], onRecordPayment });
    fireEvent.click(screen.getByRole("button", { name: "Record Payment Bank of America" }));
    typeInto("Payment amount", "25");
    const btn = screen.getByRole("button", { name: "Record" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(props.onRecordPayment).toHaveBeenCalledTimes(1);
    resolveFirst("Failed to record payment");
    expect((await screen.findByRole("alert")).textContent).toBe("Failed to record payment");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(onRecordPayment).toHaveBeenCalledTimes(2));
    const keys = onRecordPayment.mock.calls.map((c) => c[2]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Payment recorded.");
  });

  it("each newly opened modal gets a fresh key (multiple payments in one cycle)", async () => {
    const props = setup({ accounts: [acct()] });
    for (const amount of ["20", "20"]) {
      fireEvent.click(screen.getByRole("button", { name: "Record Payment Bank of America" }));
      typeInto("Payment amount", amount);
      fireEvent.click(screen.getByRole("button", { name: "Record" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    const keys = (props.onRecordPayment as any).mock.calls.map((c: any[]) => c[2]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("Cancel records nothing", () => {
    const props = open();
    typeInto("Payment amount", "10");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onRecordPayment).not.toHaveBeenCalled();
  });
});

describe("Payment history and reversal", () => {
  it("History toggles through the page's lazy loader", () => {
    const account = acct();
    const props = setup({ accounts: [account] });
    fireEvent.click(screen.getByRole("button", { name: "History Bank of America" }));
    expect(props.onToggleHistory).toHaveBeenCalledWith(account);
  });

  it("shows an empty state", () => {
    setup({ accounts: [acct()], historyOpenId: "a1", historyByAccount: { a1: [] } });
    expect(screen.getByText("No payments logged yet.")).toBeTruthy();
  });

  it("lists payments in the order given (newest first) with amount, date, note, and a reversed badge", () => {
    setup({
      accounts: [acct()],
      historyOpenId: "a1",
      historyByAccount: {
        a1: [
          txn({ id: "t2", amount: 75.5, paidAt: "2026-11-01T12:00:00", note: "Nov payment" }),
          txn({ id: "t1", amount: 40, paidAt: "2026-10-30T12:00:00", reversedAt: "2026-10-31T00:00:00Z" }),
        ],
      },
    });
    const rows = screen.getAllByRole("listitem").filter((li) => li.classList.contains("pay-txn"));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("$75.50");
    expect(rows[0].textContent).toContain("11/01/2026");
    expect(rows[0].textContent).toContain("Nov payment");
    expect(rows[1].textContent).toContain("Reversed");
    expect(within(rows[1]).queryByRole("button")).toBeNull(); // a reversed payment can't be reversed again
  });

  it("Reverse asks first, names the amount, and only then calls onReversePayment once", async () => {
    const account = acct();
    const t1 = txn({ balanceApplied: true });
    const props = setup({ accounts: [account], historyOpenId: "a1", historyByAccount: { a1: [t1] } });
    fireEvent.click(screen.getByRole("button", { name: /^Reverse \$40\.00/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(props.onReversePayment).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("$40.00");
    expect(dialog.textContent).toContain("added back to the balance");
    const confirm = screen.getByRole("button", { name: "Reverse Payment" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(props.onReversePayment).toHaveBeenCalledTimes(1));
    expect(props.onReversePayment).toHaveBeenCalledWith(account, t1);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("says the balance is untouched when the payment never reduced it", () => {
    setup({ accounts: [acct()], historyOpenId: "a1", historyByAccount: { a1: [txn({ balanceApplied: false })] } });
    fireEvent.click(screen.getByRole("button", { name: /^Reverse \$40\.00/ }));
    expect(screen.getByRole("alertdialog").textContent).toContain("never reduced it");
  });

  it("Cancel leaves the payment alone", () => {
    const props = setup({ accounts: [acct()], historyOpenId: "a1", historyByAccount: { a1: [txn()] } });
    fireEvent.click(screen.getByRole("button", { name: /^Reverse \$40\.00/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onReversePayment).not.toHaveBeenCalled();
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
    expect(screen.getByRole("alertdialog").textContent).toContain("Bank of America");
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

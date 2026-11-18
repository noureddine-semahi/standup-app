import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { es } from "@/lib/i18n/es";
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
    onAdjustBalance: vi.fn().mockResolvedValue(null),
    onLoadOpeningCheckpoint: vi.fn().mockResolvedValue({ balance: 394, ledgerVersion: 7, checkpoint: null }),
    onCreateOpeningCheckpoint: vi.fn().mockResolvedValue({ ok: true }),
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

  it("saves only the changed METADATA fields through onUpdate, and never sends the balance there", async () => {
    const account = acct();
    const props = setup({ accounts: [account] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    typeInto("Remind (days before)", "10");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
    expect(props.onUpdate).toHaveBeenCalledWith(account, { remindDaysBefore: 10 });
    expect(props.onAdjustBalance).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a changed balance asks for a reason, is saved as an adjustment (not through onUpdate) and shows no reason field when the balance is untouched", async () => {
    const account = acct();
    const props = setup({ accounts: [account] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    expect(screen.queryByLabelText("Reason for the balance change")).toBeNull();
    typeInto("Balance", "350.5");
    expect(screen.getByLabelText("Reason for the balance change")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    typeInto("Reason for the balance change", "  Matched my statement ");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onAdjustBalance).toHaveBeenCalledTimes(1));
    expect(props.onAdjustBalance).toHaveBeenCalledWith(account, 350.5, "Matched my statement", expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(props.onUpdate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("metadata and a balance change together: metadata goes to onUpdate WITHOUT the balance first, then the adjustment", async () => {
    const order: string[] = [];
    const account = acct();
    const props = setup({
      accounts: [account],
      onUpdate: vi.fn().mockImplementation(async () => (order.push("update"), null)),
      onAdjustBalance: vi.fn().mockImplementation(async () => (order.push("adjust"), null)),
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    typeInto("Remind (days before)", "10");
    typeInto("Balance", "300");
    typeInto("Reason for the balance change", "Fix");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onAdjustBalance).toHaveBeenCalledTimes(1));
    expect(props.onUpdate).toHaveBeenCalledWith(account, { remindDaysBefore: 10 });
    expect(order).toEqual(["update", "adjust"]);
  });

  it("if saving the metadata fails, no adjustment is attempted and the error stays in the open form", async () => {
    const props = setup({ accounts: [acct()], onUpdate: vi.fn().mockResolvedValue("Failed to update payment account") });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    typeInto("Remind (days before)", "10");
    typeInto("Balance", "300");
    typeInto("Reason for the balance change", "Fix");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Failed to update payment account");
    expect(props.onAdjustBalance).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("metadata saved but the balance adjustment failed: says details WERE saved and the adjustment was NOT, keeps the original reason, and stays open for a retry", async () => {
    const original = "This account's balance changed since you opened this form. Close it and try again.";
    const account = acct();
    const props = setup({ accounts: [account], onAdjustBalance: vi.fn().mockResolvedValue(original) });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    typeInto("Remind (days before)", "10");
    typeInto("Balance", "300");
    typeInto("Reason for the balance change", "Matched my statement");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(props.onUpdate).toHaveBeenCalledWith(account, { remindDaysBefore: 10 });
    expect(props.onAdjustBalance).toHaveBeenCalledTimes(1);
    expect(alert.textContent).toBe(`Account details were saved. The balance adjustment was not saved: ${original}`);
    // the form is still open, with what the user typed, and Save is available again
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Reason for the balance change") as HTMLInputElement).value).toBe("Matched my statement");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed adjustment (for example a stale balance) keeps the form open with the message", async () => {
    setup({ accounts: [acct()], onAdjustBalance: vi.fn().mockResolvedValue("This account's balance changed since you opened this form. Close it and try again.") });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    typeInto("Balance", "300");
    typeInto("Reason for the balance change", "Fix");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/balance changed since you opened/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("reverting the balance to its original value removes the reason requirement and writes nothing", async () => {
    const props = setup({ accounts: [acct()] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Bank of America" }));
    typeInto("Balance", "300");
    expect(screen.getByLabelText("Reason for the balance change")).toBeTruthy();
    typeInto("Balance", "394");
    expect(screen.queryByLabelText("Reason for the balance change")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onAdjustBalance).not.toHaveBeenCalled();
  });

  it("adding an account still sends its starting balance through onCreate with no reason field", async () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Account/ }));
    typeInto("Account name", "Visa");
    typeInto("Balance", "120");
    typeInto("Due day of month", "5");
    expect(screen.queryByLabelText("Reason for the balance change")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Visa", balance: 120 })));
    expect(props.onAdjustBalance).not.toHaveBeenCalled();
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

describe("Opening checkpoint", () => {
  const UUID = /^[0-9a-f-]{36}$/;
  const openDialog = async (name = "Bank of America") => {
    fireEvent.click(screen.getByRole("button", { name: `More ${name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm opening balance" }));
    await screen.findByTestId("opening-balance");
  };
  const confirmButton = () => screen.getByRole("button", { name: /Confirm opening balance|Confirming/ }) as HTMLButtonElement;

  it("is offered only from the More menu, and opening the dialog reads the account but writes nothing", async () => {
    const account = acct();
    const props = setup({ accounts: [account] });
    expect(screen.queryByRole("button", { name: "Confirm opening balance" })).toBeNull();
    await openDialog();
    expect(props.onLoadOpeningCheckpoint).toHaveBeenCalledWith(account);
    expect(screen.getByTestId("opening-balance").textContent).toMatch(/394/);
    expect(screen.getByTestId("opening-version").textContent).toBe("7");
    expect(props.onCreateOpeningCheckpoint).not.toHaveBeenCalled();
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onAdjustBalance).not.toHaveBeenCalled();
  });

  it("explains in plain words what the confirmation is and what it is not (EN), with today as the default editable as-of date", async () => {
    setup({ accounts: [acct()] });
    await openDialog();
    const dialog = screen.getByRole("dialog").textContent ?? "";
    expect(dialog).toContain("You're confirming the balance shown above, as it is right now.");
    expect(dialog).toContain("starting point for checking this account's future changes");
    expect(dialog).toContain("Nothing is changed: the balance stays exactly as it is.");
    expect(dialog).toContain("This doesn't verify your past transactions, and it doesn't work out what the balance was on an earlier statement date.");
    expect(dialog).toContain("A date for your records (today by default). It doesn't change the balance or rebuild an earlier one.");
    expect(dialog).not.toContain("correct for"); // the old date help implied the balance was verified for that date
    expect((screen.getByLabelText("As-of date") as HTMLInputElement).value).toBe("2026-11-03");
    typeInto("As-of date", "2026-10-15"); // still editable
    expect((screen.getByLabelText("As-of date") as HTMLInputElement).value).toBe("2026-10-15");
  });

  it("the Spanish text says the same three things", () => {
    expect(es["pay.openingIntro"]).toMatch(/confirmando el saldo que se muestra arriba, tal como está ahora/);
    expect(es["pay.openingIntro"]).toMatch(/punto de partida .* cambios futuros/);
    expect(es["pay.openingScope"]).toMatch(/no verifica tus transacciones pasadas/);
    expect(es["pay.openingScope"]).toMatch(/saldo en la fecha de un estado de cuenta anterior/);
    expect(es["pay.openingDateHelp"]).toMatch(/hoy por defecto/);
    expect(es["pay.openingDateHelp"]).toMatch(/No cambia el saldo ni reconstruye uno anterior/);
  });

  it("Confirm stays disabled until the user types the exact current balance (two decimals at most)", async () => {
    setup({ accounts: [acct()] });
    await openDialog();
    expect(confirmButton().disabled).toBe(true);
    typeInto("Type the balance to confirm", "393");
    expect(confirmButton().disabled).toBe(true);
    expect(screen.getByText("That doesn't match the current balance.")).toBeTruthy();
    typeInto("Type the balance to confirm", "394.005");
    expect(confirmButton().disabled).toBe(true);
    typeInto("Type the balance to confirm", "394.00");
    expect(confirmButton().disabled).toBe(false);
    typeInto("Type the balance to confirm", "394");
    expect(confirmButton().disabled).toBe(false);
  });

  it("sends exactly what it showed (balance and ledger version), the as-of date, the trimmed note and one key; then closes with a confirmation", async () => {
    const account = acct();
    const props = setup({ accounts: [account] });
    await openDialog();
    typeInto("Type the balance to confirm", "394");
    typeInto("Note (optional)", "  First check ");
    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onCreateOpeningCheckpoint).toHaveBeenCalledTimes(1));
    expect(props.onCreateOpeningCheckpoint).toHaveBeenCalledWith(account, {
      confirmedBalance: 394, expectedLedgerVersion: 7, statementDate: "2026-11-03", note: "First check", clientKey: expect.stringMatching(UUID),
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Opening balance confirmed.");
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onAdjustBalance).not.toHaveBeenCalled();
  });

  it("the note is optional (sent as null when blank) and the as-of date can be changed", async () => {
    const props = setup({ accounts: [acct()] });
    await openDialog();
    typeInto("Type the balance to confirm", "394");
    typeInto("As-of date", "2026-10-31");
    fireEvent.click(confirmButton());
    await waitFor(() => expect(props.onCreateOpeningCheckpoint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ statementDate: "2026-10-31", note: null })));
  });

  it("a date in the future or an empty date blocks Confirm", async () => {
    setup({ accounts: [acct()] });
    await openDialog();
    typeInto("Type the balance to confirm", "394");
    typeInto("As-of date", "2026-12-01");
    expect(confirmButton().disabled).toBe(true);
    expect(screen.getByText("Enter a valid date that isn't in the future.")).toBeTruthy();
    typeInto("As-of date", "");
    expect(confirmButton().disabled).toBe(true);
    typeInto("As-of date", "2026-11-03");
    expect(confirmButton().disabled).toBe(false);
  });

  it("repeated taps while the request is in flight send it once", async () => {
    let resolve!: (r: { ok: true }) => void;
    const pending = new Promise<{ ok: true }>((r) => (resolve = r));
    const props = setup({ accounts: [acct()], onCreateOpeningCheckpoint: vi.fn().mockReturnValue(pending) });
    await openDialog();
    typeInto("Type the balance to confirm", "394");
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(props.onCreateOpeningCheckpoint).toHaveBeenCalledTimes(1);
    expect(confirmButton().disabled).toBe(true);
    expect(confirmButton().textContent).toBe("Confirming…");
    resolve({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(props.onCreateOpeningCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("a stale confirmation shows the message, keeps the dialog open, and Refresh reloads the account and clears what was typed", async () => {
    const props = setup({
      accounts: [acct()],
      onCreateOpeningCheckpoint: vi.fn().mockResolvedValue({ ok: false, kind: "stale", message: "This account changed since you opened this form. Refresh to see the current balance, then confirm again." }),
      onLoadOpeningCheckpoint: vi.fn().mockResolvedValueOnce({ balance: 394, ledgerVersion: 7, checkpoint: null }).mockResolvedValueOnce({ balance: 380, ledgerVersion: 8, checkpoint: null }),
    });
    await openDialog();
    typeInto("Type the balance to confirm", "394");
    fireEvent.click(confirmButton());
    expect((await screen.findByRole("alert")).textContent).toMatch(/changed since you opened this form/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByTestId("opening-balance").textContent).toMatch(/380/));
    expect(props.onLoadOpeningCheckpoint).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("opening-version").textContent).toBe("8");
    expect((screen.getByLabelText("Type the balance to confirm") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(confirmButton().disabled).toBe(true); // the user must confirm the NEW balance explicitly
  });

  it("an account that already has a checkpoint shows it, offers no confirmation, and can only be closed", async () => {
    const props = setup({
      accounts: [acct()],
      onLoadOpeningCheckpoint: vi.fn().mockResolvedValue({ balance: 394, ledgerVersion: 9, checkpoint: { balance: 300, statementDate: "2026-10-01", ledgerVersion: 3 } }),
    });
    await openDialog();
    expect(screen.getByRole("status").textContent).toMatch(/already has an opening balance confirmed: .*300/);
    expect(screen.queryByLabelText("Type the balance to confirm")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm opening balance" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onCreateOpeningCheckpoint).not.toHaveBeenCalled();
  });

  it("if a checkpoint appears while confirming ('exists'), the dialog reloads and shows it", async () => {
    setup({
      accounts: [acct()],
      onCreateOpeningCheckpoint: vi.fn().mockResolvedValue({ ok: false, kind: "exists", message: "This account already has an opening balance confirmed." }),
      onLoadOpeningCheckpoint: vi.fn().mockResolvedValueOnce({ balance: 394, ledgerVersion: 7, checkpoint: null })
        .mockResolvedValueOnce({ balance: 394, ledgerVersion: 8, checkpoint: { balance: 394, statementDate: "2026-11-03", ledgerVersion: 8 } }),
    });
    await openDialog();
    typeInto("Type the balance to confirm", "394");
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/already has an opening balance confirmed/));
    expect(screen.queryByLabelText("Type the balance to confirm")).toBeNull();
  });

  it("any other failure keeps the dialog open with the message, and the user can retry with the same request key", async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, kind: "other", message: "Network down" }).mockResolvedValueOnce({ ok: true });
    setup({ accounts: [acct()], onCreateOpeningCheckpoint: create });
    await openDialog();
    typeInto("Type the balance to confirm", "394");
    fireEvent.click(confirmButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1].clientKey).toBe(create.mock.calls[0][1].clientKey);
  });

  it("a load failure shows an error and offers no confirmation", async () => {
    const props = setup({ accounts: [acct()], onLoadOpeningCheckpoint: vi.fn().mockRejectedValue(new Error("boom")) });
    fireEvent.click(screen.getByRole("button", { name: "More Bank of America" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm opening balance" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't load this account/);
    expect(screen.queryByLabelText("Type the balance to confirm")).toBeNull();
    expect(props.onCreateOpeningCheckpoint).not.toHaveBeenCalled();
  });

  it("Cancel and Escape create nothing", async () => {
    const props = setup({ accounts: [acct()] });
    await openDialog();
    typeInto("Type the balance to confirm", "394");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await openDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onCreateOpeningCheckpoint).not.toHaveBeenCalled();
  });
});

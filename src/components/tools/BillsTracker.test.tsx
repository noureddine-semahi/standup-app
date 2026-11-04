import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { Bill, BillOccurrenceRecord, OccurrenceMap } from "@/lib/bills";
import BillsTracker from "./BillsTracker";
import type { BillsController } from "./useBills";

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {}, clear() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TODAY = "2026-11-03";

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

const rec = (billId: string, dueDate: string, amountDue: number | null, payments: BillOccurrenceRecord["payments"] = []): BillOccurrenceRecord => ({
  id: `o-${billId}-${dueDate}`,
  billId,
  dueDate,
  amountDue,
  payments,
});
const pay = (id: string, amount: number, over: Record<string, unknown> = {}) => ({ id, amount, paidAt: "2026-10-30T12:00:00", note: null, reversedAt: null, ...over });
const mapOf = (...rs: BillOccurrenceRecord[]): OccurrenceMap => {
  const m: OccurrenceMap = {};
  for (const r of rs) (m[r.billId] ??= {})[r.dueDate] = r;
  return m;
};

function controller(over: Partial<BillsController> = {}): BillsController {
  return {
    state: "ready",
    loadError: null,
    bills: [],
    occurrences: {},
    historyOpenId: null,
    historyLoading: false,
    history: {},
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    archive: vi.fn().mockResolvedValue(null),
    recordPayment: vi.fn().mockResolvedValue(null),
    setAmount: vi.fn().mockResolvedValue(null),
    reversePayment: vi.fn().mockResolvedValue(null),
    toggleHistory: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<BillsController> = {}) {
  const c = controller(over);
  render(
    <LanguageProvider>
      <BillsTracker controller={c} todayISO={TODAY} />
    </LanguageProvider>
  );
  return c;
}

const typeInto = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("availability and empty states", () => {
  it("shows a safe unavailable state when the migration hasn't been applied: no summary, Add disabled", () => {
    setup({ state: "unavailable" });
    expect(screen.getByTestId("bills-unavailable").textContent).toContain("database update");
    expect((screen.getByRole("button", { name: /Add Bill/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("bills-expected")).toBeNull();
    expect(screen.queryByTestId("bill-card")).toBeNull();
  });

  it("shows a load error without fabricating data", () => {
    setup({ state: "error", loadError: "boom" });
    expect(screen.getByRole("alert").textContent).toBe("boom");
    expect(screen.queryByTestId("bills-expected")).toBeNull();
  });

  it("empty: 'No bills added yet.' with an Add action and zeroed summary", () => {
    setup();
    expect(screen.getByText("No bills added yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add Bill/ })).toBeTruthy();
    expect(screen.getByTestId("bills-expected").textContent).toBe("$0.00");
    expect(screen.getByTestId("bills-overdue").textContent).toBe("0");
  });
});

describe("bill cards", () => {
  it("fixed, variable with estimate, variable without any amount", () => {
    setup({
      bills: [
        bill({ id: "f", name: "Internet", expectedAmount: 60 }),
        bill({ id: "v", name: "Electricity", amountType: "variable", expectedAmount: 145 }),
        bill({ id: "n", name: "Water", amountType: "variable", expectedAmount: null }),
      ],
    });
    const cards = screen.getAllByTestId("bill-card");
    const byName = (n: string) => cards.find((c) => within(c).getByRole("heading").textContent === n)!;
    expect(within(byName("Internet")).getByText("Amount due: $60.00")).toBeTruthy();
    expect(within(byName("Electricity")).getByText("Estimated: $145.00")).toBeTruthy();
    expect(within(byName("Water")).getByText("Amount not entered")).toBeTruthy();
    expect(within(byName("Water")).queryByText(/\$0\.00/)).toBeNull();
    expect(within(byName("Internet")).getByText("Monthly")).toBeTruthy();
  });

  it("shows overdue, due-soon tiers and orders unpaid by due date with paid last", () => {
    setup({
      bills: [
        bill({ id: "a", name: "Later", firstDueDate: "2026-11-25" }),
        bill({ id: "b", name: "Overdue one", firstDueDate: "2026-10-20", recurrence: "once" }),
        bill({ id: "c", name: "Soon", firstDueDate: "2026-11-05" }),
        bill({ id: "d", name: "Paid", firstDueDate: "2026-10-01", recurrence: "once", expectedAmount: 50 }),
      ],
      occurrences: mapOf(rec("d", "2026-10-01", 50, [pay("p", 50)])),
    });
    const names = screen.getAllByTestId("bill-card").map((c) => within(c).getByRole("heading").textContent);
    expect(names).toEqual(["Overdue one", "Soon", "Later", "Paid"]);
    const cards = screen.getAllByTestId("bill-card");
    expect(cards[0].getAttribute("data-tier")).toBe("overdue");
    expect(cards[0].querySelector(".pay-due")!.textContent).toBe("Overdue");
    expect(cards[1].getAttribute("data-tier")).toBe("soon");
    expect(cards[3].getAttribute("data-tier")).toBe("paid");
    expect(cards[3].querySelector(".pay-due")!.textContent).toBe("Paid");
  });

  it("a paid cycle does not mark the next cycle paid; partial payment shows paid and outstanding", () => {
    setup({
      bills: [bill({ id: "r", name: "Rent" })],
      occurrences: mapOf(rec("r", "2026-10-12", 1000, [pay("p1", 1000)]), rec("r", "2026-11-12", 1000, [pay("p2", 400)])),
    });
    const card = screen.getByTestId("bill-card");
    expect(within(card).getByText("Partially paid")).toBeTruthy();
    expect(within(card).getByText("Paid $400.00 · $600.00 left")).toBeTruthy();
  });

  it("a variable bill with a payment but no actual amount is not marked paid", () => {
    setup({
      bills: [bill({ id: "v", name: "Electricity", amountType: "variable", expectedAmount: 145 })],
      occurrences: mapOf(rec("v", "2026-10-12", 130, [pay("a", 130)]), rec("v", "2026-11-12", null, [pay("p", 150)])),
    });
    const card = screen.getByTestId("bill-card");
    expect(card.querySelector(".pay-due")!.textContent).toBe("Amount pending confirmation");
    expect(within(card).queryByText("Partially paid")).toBeNull();
    expect(within(card).queryByText("Paid")).toBeNull();
    expect(within(card).getByText("Recorded payments: $150.00")).toBeTruthy();
    expect(within(card).getByText("Estimated: $145.00")).toBeTruthy();
  });

  it("variable bill with no payments and no actual amount: pending, estimate shown, nothing recorded", () => {
    setup({ bills: [bill({ id: "v", name: "Electricity", amountType: "variable", expectedAmount: 145, firstDueDate: "2026-11-12" })] });
    const card = screen.getByTestId("bill-card");
    expect(card.querySelector(".pay-due")!.textContent).toBe("Amount pending confirmation");
    expect(within(card).getByText("Estimated: $145.00")).toBeTruthy();
    expect(card.textContent).not.toContain("Recorded payments");
  });

  it("a payment equal to the estimate does not make the bill paid while the actual amount is unknown", () => {
    setup({
      bills: [bill({ id: "v", name: "Electricity", amountType: "variable", expectedAmount: 129.15 })],
      occurrences: mapOf(rec("v", "2026-10-12", 100, [pay("a", 100)]), rec("v", "2026-11-12", null, [pay("p", 129.15)])),
    });
    const card = screen.getByTestId("bill-card");
    expect(card.querySelector(".pay-due")!.textContent).toBe("Amount pending confirmation");
    expect(within(card).getByText("Recorded payments: $129.15")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Set amount due Electricity" })).toBeTruthy();
  });

  it("once the actual amount is finalized, status follows it: paid, partial, or overpaid", () => {
    // one-time bill so the card shows exactly this cycle
    const v = bill({ id: "v", name: "Electricity", amountType: "variable", expectedAmount: 129.15, recurrence: "once", firstDueDate: "2026-11-12" });
    const cases: [number, string, string][] = [
      [129.15, "Paid", "Paid $129.15"],
      [60, "Partially paid", "Paid $60.00 · $69.15 left"],
      [150, "Paid", "Paid $150.00 · $20.85 over"],
    ];
    for (const [paid, chip, line] of cases) {
      cleanup();
      setup({ bills: [v], occurrences: mapOf(rec("v", "2026-11-12", 129.15, [pay("p", paid)])) });
      const card = screen.getByTestId("bill-card");
      expect(card.querySelector(".pay-due")!.textContent, String(paid)).toBe(chip);
      expect(within(card).getByText(line)).toBeTruthy();
      expect(within(card).getByText("Amount due: $129.15")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Set amount due Electricity/ })).toBeNull(); // amount known: lives under More
    }
  });

  it("fixed bills keep their familiar presentation", () => {
    setup({ bills: [bill({ id: "f", name: "Internet", expectedAmount: 60, firstDueDate: "2026-11-20" })] });
    const card = screen.getByTestId("bill-card");
    expect(card.querySelector(".pay-due")!.textContent).toBe("Due 11/20/2026");
    expect(within(card).getByText("Amount due: $60.00")).toBeTruthy();
    expect(within(card).queryByText(/pending/i)).toBeNull();
  });
});

describe("summary panels: Expected / Paid / Remaining", () => {
  const power = (over: Partial<Bill> = {}) => bill({ id: "e", name: "Electricity", amountType: "variable", expectedAmount: 145, firstDueDate: "2026-01-12", ...over });

  it("expected uses actual where known, otherwise the estimate, and says it includes estimates", () => {
    setup({
      bills: [
        bill({ id: "r", name: "Rent", expectedAmount: 1000, firstDueDate: "2026-01-12" }),
        power(),
        bill({ id: "i", name: "Internet", expectedAmount: 60, firstDueDate: "2026-01-05" }),
      ],
      occurrences: mapOf(
        rec("r", "2026-10-12", 1000, [pay("a", 1000)]),
        rec("r", "2026-11-12", 1000, [pay("b", 250)]),
        rec("e", "2026-10-12", 140, [pay("c", 140)]),
        rec("i", "2026-10-05", 60, [pay("d", 60)])
      ),
    });
    expect(screen.getByTestId("bills-expected").textContent).toBe("$1,205.00"); // rent 1000 + electricity estimate 145 + internet 60
    expect(screen.getByTestId("bills-paid").textContent).toBe("$250.00");
    expect(screen.getByTestId("bills-remaining").textContent).toBe("$955.00"); // 750 + 145 + 60
    expect(screen.getAllByText("Includes estimates")).toHaveLength(2); // on both Expected and Remaining
    expect(screen.queryByTestId("bills-unknown")).toBeNull();
    expect(screen.getByTestId("bills-upcoming").textContent).toBe("1"); // internet Nov 5 is within its window
    expect(screen.getByTestId("bills-overdue").textContent).toBe("0");
  });

  it("an actual amount replaces the estimate and the 'includes estimates' label goes away", () => {
    setup({
      bills: [power({ firstDueDate: "2026-11-12", recurrence: "once" })],
      occurrences: mapOf(rec("e", "2026-11-12", 130.5, [pay("a", 30.5)])),
    });
    expect(screen.getByTestId("bills-expected").textContent).toBe("$130.50");
    expect(screen.getByTestId("bills-remaining").textContent).toBe("$100.00");
    expect(screen.queryByText("Includes estimates")).toBeNull();
  });

  it("paying exactly the estimate lowers remaining to $0.00 but the card still isn't 'Paid'", () => {
    setup({
      bills: [power({ firstDueDate: "2026-11-12", recurrence: "once", expectedAmount: 129.15 })],
      occurrences: mapOf(rec("e", "2026-11-12", null, [pay("a", 129.15)])),
    });
    expect(screen.getByTestId("bills-remaining").textContent).toBe("$0.00");
    expect(screen.getByTestId("bills-paid").textContent).toBe("$129.15");
    const card = screen.getByTestId("bill-card");
    expect(card.querySelector(".pay-due")!.textContent).toBe("Amount pending confirmation");
  });

  it("overpaying a fixed bill shows the paid amount and a $0.00 (never negative) remaining", () => {
    setup({
      bills: [bill({ id: "f", name: "Rent", expectedAmount: 1000, firstDueDate: "2026-11-12", recurrence: "once" })],
      occurrences: mapOf(rec("f", "2026-11-12", 1000, [pay("a", 1500)])),
    });
    expect(screen.getByTestId("bills-paid").textContent).toBe("$1,500.00");
    expect(screen.getByTestId("bills-remaining").textContent).toBe("$0.00");
    expect(screen.getByTestId("bills-expected").textContent).toBe("$1,000.00");
  });

  it("fixed bills only: no estimate wording anywhere", () => {
    setup({ bills: [bill({ id: "f", name: "Rent", expectedAmount: 1000, firstDueDate: "2026-11-12", recurrence: "once" })] });
    expect(screen.getByTestId("bills-expected").textContent).toBe("$1,000.00");
    expect(screen.getByTestId("bills-remaining").textContent).toBe("$1,000.00");
    expect(screen.queryByText("Includes estimates")).toBeNull();
    expect(screen.queryByTestId("bills-unknown")).toBeNull();
  });
});

describe("summary clarity (unknown amounts)", () => {
  it("every cycle has no amount at all: 'Amount pending' instead of $0.00, with the awaiting count", () => {
    setup({
      bills: [
        bill({ id: "e", name: "Electricity", amountType: "variable", expectedAmount: null, firstDueDate: "2026-01-12" }),
        bill({ id: "w", name: "Water", amountType: "variable", expectedAmount: null, firstDueDate: "2026-01-20" }),
      ],
    });
    expect(screen.getByTestId("bills-expected").textContent).toBe("Amount pending");
    expect(screen.getByTestId("bills-remaining").textContent).toBe("Amount pending");
    expect(screen.getByTestId("bills-unknown").textContent).toBe("2 bills awaiting amounts");
    expect(screen.queryByText("Known amounts only")).toBeNull();
    expect(screen.queryByText("Includes estimates")).toBeNull();
  });

  it("estimates alone are real numbers, not 'pending'", () => {
    setup({
      bills: [
        bill({ id: "e", name: "Electricity", amountType: "variable", expectedAmount: 145, firstDueDate: "2026-01-12" }),
        bill({ id: "w", name: "Water", amountType: "variable", expectedAmount: 60, firstDueDate: "2026-01-20" }),
      ],
    });
    expect(screen.getByTestId("bills-expected").textContent).toBe("$205.00");
    expect(screen.getAllByText("Includes estimates")).toHaveLength(2);
    expect(screen.queryByTestId("bills-unknown")).toBeNull();
  });

  it("actual amounts plus a no-amount bill: 'Known amounts only' + the awaiting count", () => {
    setup({
      bills: [
        bill({ id: "f", name: "Rent", expectedAmount: 1000, firstDueDate: "2026-11-12", recurrence: "once" }),
        bill({ id: "w", name: "Water", amountType: "variable", expectedAmount: null, firstDueDate: "2026-11-20", recurrence: "once" }),
      ],
    });
    expect(screen.getByTestId("bills-expected").textContent).toBe("$1,000.00");
    expect(screen.getByText("Known amounts only")).toBeTruthy();
    expect(screen.getByTestId("bills-unknown").textContent).toBe("1 bill awaiting amount");
  });

  it("estimates plus a no-amount bill: includes estimates AND the awaiting count (no misleading 'known only')", () => {
    setup({
      bills: [
        bill({ id: "e", name: "Electricity", amountType: "variable", expectedAmount: 145, firstDueDate: "2026-11-12", recurrence: "once" }),
        bill({ id: "w", name: "Water", amountType: "variable", expectedAmount: null, firstDueDate: "2026-11-20", recurrence: "once" }),
      ],
    });
    expect(screen.getByTestId("bills-expected").textContent).toBe("$145.00");
    expect(screen.getAllByText("Includes estimates").length).toBeGreaterThan(0);
    expect(screen.getByTestId("bills-unknown").textContent).toBe("1 bill awaiting amount");
    expect(screen.queryByText("Known amounts only")).toBeNull();
  });

  it("no bills at all is a plain $0.00 with no pending or estimate wording", () => {
    setup();
    expect(screen.getByTestId("bills-expected").textContent).toBe("$0.00");
    expect(screen.getByTestId("bills-remaining").textContent).toBe("$0.00");
    expect(screen.queryByTestId("bills-unknown")).toBeNull();
    expect(screen.queryByText("Includes estimates")).toBeNull();
  });
});

describe("Add and edit bill", () => {
  it("opens an empty form, shows validation messages, and creates nothing until valid", async () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Bill/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.create).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["This field is required.", "This field is required."]);

    typeInto(/^Bill name/, "  Rent ");
    typeInto(/^Amount(?! type)/, "-5");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("The amount can’t be negative.");
    typeInto(/^Amount(?! type)/, "1200.50");
    typeInto("First due date", "2026-11-30");
    typeInto("Repeats", "quarterly");
    typeInto("Remind (days before)", "5");
    typeInto("Category (optional)", "Housing");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.create).toHaveBeenCalledTimes(1));
    expect(c.create).toHaveBeenCalledWith({
      name: "Rent",
      amountType: "fixed",
      expectedAmount: 1200.5,
      firstDueDate: "2026-11-30",
      recurrence: "quarterly",
      remindDaysBefore: 5,
      category: "Housing",
      notes: null,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a variable bill accepts a blank estimate", async () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Bill/ }));
    typeInto("Bill name", "Electricity");
    fireEvent.click(screen.getByRole("button", { name: "Variable" }));
    expect(screen.getByLabelText("Estimated amount (optional)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.create).toHaveBeenCalledWith(expect.objectContaining({ amountType: "variable", expectedAmount: null })));
  });

  it("Cancel and Escape create nothing", () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Bill/ }));
    typeInto("Bill name", "X");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add Bill/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(c.create).not.toHaveBeenCalled();
  });

  it("keeps the modal open with the server's message when saving fails", async () => {
    setup({ create: vi.fn().mockResolvedValue("nope") });
    fireEvent.click(screen.getByRole("button", { name: /Add Bill/ }));
    typeInto("Bill name", "Rent");
    typeInto("Amount", "10");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByText("nope")).getAttribute("role")).toBe("alert");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Edit prepopulates, sends only changed fields, and Cancel discards", async () => {
    const b = bill();
    const c = setup({ bills: [b] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Rent" }));
    expect((screen.getByLabelText("Bill name") as HTMLInputElement).value).toBe("Rent");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("1000");
    expect((screen.getByLabelText("First due date") as HTMLInputElement).value).toBe("2026-01-12");
    expect((screen.getByLabelText("Repeats") as HTMLSelectElement).value).toBe("monthly");
    typeInto("Bill name", "Something else");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(c.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit Rent" }));
    expect((screen.getByLabelText("Bill name") as HTMLInputElement).value).toBe("Rent");
    typeInto("Amount", "1100");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.update).toHaveBeenCalledWith(b, { expectedAmount: 1100 }));
  });

  it("saving an edit with no changes writes nothing", async () => {
    const c = setup({ bills: [bill()] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Rent" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(c.update).not.toHaveBeenCalled();
  });
});

describe("Record bill payment", () => {
  const open = (b = bill(), occurrences: OccurrenceMap = {}, over: Partial<BillsController> = {}) => {
    const c = setup({ bills: [b], occurrences, ...over });
    fireEvent.click(screen.getByRole("button", { name: `Record Payment ${b.name}` }));
    return c;
  };

  it("prefills the outstanding amount, defaults to today, and states that balances aren't touched", () => {
    open(bill(), mapOf(rec("b1", "2026-10-12", 1000, [pay("p", 1000)]), rec("b1", "2026-11-12", 1000, [pay("q", 400)])));
    expect((screen.getByLabelText("Amount paid") as HTMLInputElement).value).toBe("600");
    expect((screen.getByLabelText("Payment date") as HTMLInputElement).value).toBe(TODAY);
    expect(screen.getByText(/never change a card or loan balance/)).toBeTruthy();
    expect(screen.queryByLabelText("Actual amount due this cycle")).toBeNull(); // fixed bill
  });

  it("validates amount, decimals and future dates", () => {
    open();
    typeInto("Amount paid", "0");
    expect(screen.getByRole("alert").textContent).toContain("greater than zero");
    typeInto("Amount paid", "10.555");
    expect(screen.getByRole("alert").textContent).toContain("2 decimal");
    typeInto("Amount paid", "10.55");
    typeInto("Payment date", "2026-11-04");
    expect(screen.getByRole("alert").textContent).toContain("future");
    expect((screen.getByRole("button", { name: "Record" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("records a partial payment against the right cycle", async () => {
    const c = open(bill(), mapOf(rec("b1", "2026-10-12", 1000, [pay("p", 1000)])));
    typeInto("Amount paid", "250.25");
    typeInto(/^Note/, "first half");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(c.recordPayment).toHaveBeenCalledTimes(1));
    const [b, dueDate, payload] = (c.recordPayment as any).mock.calls[0];
    expect(b.id).toBe("b1");
    expect(dueDate).toBe("2026-11-12");
    expect(payload).toMatchObject({ amount: 250.25, note: "first half", amountDue: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Payment recorded.");
  });

  it("variable bill: asks for the actual amount due and sends it with the payment", async () => {
    const v = bill({ id: "v", name: "Electricity", amountType: "variable", expectedAmount: 145 });
    const c = open(v, mapOf(rec("v", "2026-10-12", 130, [pay("a", 130)])));
    // untick "full amount" to enter a different actual amount due
    fireEvent.click(screen.getByLabelText("This payment is the full amount due"));
    expect((screen.getByLabelText(/Actual amount due this cycle/) as HTMLInputElement).value).toBe("");
    typeInto("Amount paid", "152.10");
    typeInto(/Actual amount due this cycle/, "152.10");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(c.recordPayment).toHaveBeenCalled());
    expect((c.recordPayment as any).mock.calls[0][2]).toMatchObject({ amount: 152.1, amountDue: 152.1 });
  });

  it("variable bill with no amount yet: 'full amount' is on by default and sets the amount due to what was paid", async () => {
    const v = bill({ id: "v", name: "Electricity", amountType: "variable", expectedAmount: 145 });
    const c = open(v, mapOf(rec("v", "2026-10-12", 130, [pay("a", 130)])));
    const box = screen.getByLabelText("This payment is the full amount due") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.queryByLabelText(/Actual amount due this cycle/)).toBeNull();
    typeInto("Amount paid", "129.15");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(c.recordPayment).toHaveBeenCalled());
    expect((c.recordPayment as any).mock.calls[0][2]).toMatchObject({ amount: 129.15, amountDue: 129.15 });
  });

  it("unticking 'full amount' makes it a partial payment that leaves the amount due unset", async () => {
    const v = bill({ id: "v", name: "Electricity", amountType: "variable", expectedAmount: 145 });
    const c = open(v, mapOf(rec("v", "2026-10-12", 130, [pay("a", 130)])));
    fireEvent.click(screen.getByLabelText("This payment is the full amount due"));
    typeInto("Amount paid", "50");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(c.recordPayment).toHaveBeenCalled());
    expect((c.recordPayment as any).mock.calls[0][2]).toMatchObject({ amount: 50, amountDue: null });
  });

  it("no 'full amount' option for fixed bills, or when the cycle already has an amount and payments", () => {
    open(bill());
    expect(screen.queryByLabelText("This payment is the full amount due")).toBeNull();
    cleanup();
    const v = bill({ id: "v", name: "Water", amountType: "variable", expectedAmount: null });
    open(v, mapOf(rec("v", "2026-10-12", 50, [pay("a", 50)]), rec("v", "2026-11-12", 100, [pay("b", 40)])));
    expect(screen.queryByLabelText("This payment is the full amount due")).toBeNull();
  });

  it("repeated taps submit once; a retry after failure reuses the same idempotency key", async () => {
    let resolveFirst: (v: string | null) => void = () => {};
    const recordPayment = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string | null>((res) => (resolveFirst = res)))
      .mockResolvedValue(null);
    const c = open(bill(), mapOf(rec("b1", "2026-10-12", 1000, [pay("p", 1000)])), { recordPayment });
    typeInto("Amount paid", "25");
    const btn = screen.getByRole("button", { name: "Record" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(c.recordPayment).toHaveBeenCalledTimes(1);
    resolveFirst("Failed");
    expect((await screen.findAllByRole("alert")).some((a) => a.textContent === "Failed")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2));
    const keys = recordPayment.mock.calls.map((x) => x[3]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("each newly opened modal gets a fresh key (multiple payments for one cycle)", async () => {
    const c = setup({ bills: [bill()] });
    for (const amount of ["20", "30"]) {
      fireEvent.click(screen.getByRole("button", { name: "Record Payment Rent" }));
      typeInto("Amount paid", amount);
      fireEvent.click(screen.getByRole("button", { name: "Record" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    const keys = (c.recordPayment as any).mock.calls.map((x: any[]) => x[3]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("Cancel records nothing", () => {
    const c = open();
    typeInto("Amount paid", "10");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(c.recordPayment).not.toHaveBeenCalled();
  });
});

describe("History and reversal", () => {
  const b = bill();
  const history = [
    rec("b1", "2026-11-12", 1000, [pay("p2", 400, { note: "half" }), pay("p3", 100, { reversedAt: "2026-11-02T00:00:00Z" })]),
    rec("b1", "2026-10-12", 1000, [pay("p1", 1000)]),
  ];

  it("History toggles through the controller", () => {
    const c = setup({ bills: [b] });
    fireEvent.click(screen.getByRole("button", { name: "History Rent" }));
    expect(c.toggleHistory).toHaveBeenCalledWith(b);
  });

  it("empty state", () => {
    setup({ bills: [b], historyOpenId: "b1", history: { b1: [] } });
    expect(screen.getByText("No payments recorded yet.")).toBeTruthy();
  });

  it("shows each cycle's due date, amount, paid, outstanding and status, with reversed payments kept visible", () => {
    setup({ bills: [b], historyOpenId: "b1", history: { b1: history } });
    const cycles = within(screen.getByTestId("bill-history")).getAllByText(/Amount due: \$1,000\.00/);
    expect(cycles).toHaveLength(2);
    const text = screen.getByTestId("bill-history").textContent!;
    expect(text).toContain("11/12/2026");
    expect(text).toContain("Paid $400.00");
    expect(text).toContain("Outstanding $600.00");
    expect(text).toContain("Reversed");
    expect(text).toContain("half");
    // a reversed payment can't be reversed again
    expect(screen.queryByRole("button", { name: /^Reverse \$100\.00/ })).toBeNull();
  });

  it("Reverse asks first, then calls the controller once", async () => {
    const c = setup({ bills: [b], historyOpenId: "b1", history: { b1: history } });
    fireEvent.click(screen.getByRole("button", { name: /^Reverse \$400\.00/ }));
    expect(c.reversePayment).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("$400.00");
    const confirm = screen.getByRole("button", { name: "Reverse Payment" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(c.reversePayment).toHaveBeenCalledTimes(1));
    expect(c.reversePayment).toHaveBeenCalledWith(b, "p2");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});

describe("Remove and set amount", () => {
  it("Remove sits behind More and needs confirmation", async () => {
    const b = bill();
    const c = setup({ bills: [b] });
    expect(screen.queryByRole("button", { name: "Remove bill" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More Rent" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove bill" }));
    expect(c.archive).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("Rent");
    fireEvent.click(screen.getByRole("button", { name: "Remove Bill" }));
    await waitFor(() => expect(c.archive).toHaveBeenCalledWith(b));
  });

  it("variable bills can set the cycle's actual amount; fixed bills can't", async () => {
    const v = bill({ id: "v", name: "Water", amountType: "variable", expectedAmount: null });
    const c = setup({ bills: [v, bill({ id: "f", name: "Rent" })] });
    fireEvent.click(screen.getByRole("button", { name: "More Rent" }));
    const rentCard = screen.getAllByTestId("bill-card").find((c) => within(c).queryByRole("heading", { name: "Rent" }))!;
    expect(within(rentCard).queryByRole("button", { name: /Set amount due/ })).toBeNull(); // fixed bills never offer it
    // unknown amount: the action is right on the card
    fireEvent.click(screen.getByRole("button", { name: "Set amount due Water" }));
    typeInto("Amount due", "88.40");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.setAmount).toHaveBeenCalledWith(v, "2026-10-12", 88.4));
  });
});

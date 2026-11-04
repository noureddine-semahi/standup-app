import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { Bill } from "@/lib/bills";
import type { Subscription, SubscriptionPayment } from "@/lib/subscriptions";
import SubscriptionsTracker from "./SubscriptionsTracker";
import type { SubscriptionsController } from "./useSubscriptions";

let storedLanguage: string | null = null;
beforeEach(() => {
  storedLanguage = null;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === "standup-language" ? storedLanguage : null),
    setItem() {},
    removeItem() {},
    clear() {},
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TODAY = "2026-11-04";

const sub = (over: Partial<Subscription> = {}): Subscription => ({
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

const payment = (over: Partial<SubscriptionPayment> = {}): SubscriptionPayment => ({
  id: "p1",
  subscriptionId: "s1",
  amount: 15.49,
  paidAt: "2026-10-20T12:00:00",
  note: null,
  billingDate: null,
  reversedAt: null,
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

function controller(over: Partial<SubscriptionsController> = {}): SubscriptionsController {
  return {
    state: "ready",
    loadError: null,
    subscriptions: [],
    payments: {},
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    changeStatus: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(null),
    recordPayment: vi.fn().mockResolvedValue(null),
    reversePayment: vi.fn().mockResolvedValue(null),
    cancellationsState: "ready",
    cancellations: {},
    saveCancelUrl: vi.fn().mockResolvedValue(null),
    startAssistedCancellation: vi.fn().mockResolvedValue(null),
    reportCancellation: vi.fn().mockResolvedValue(null),
    reportCancellationFailure: vi.fn().mockResolvedValue(null),
    ...over,
  };
}

function setup(over: Partial<SubscriptionsController> = {}, bills: Bill[] = []) {
  const c = controller(over);
  render(
    <LanguageProvider>
      <SubscriptionsTracker controller={c} todayISO={TODAY} bills={bills} />
    </LanguageProvider>
  );
  return c;
}

const typeInto = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const cardOf = (name: string) => screen.getAllByTestId("sub-card").find((c) => within(c).queryByRole("heading", { name }))!;
const chip = (name: string) => cardOf(name).querySelector(".pay-due")!.textContent;

describe("availability and empty states", () => {
  it("unavailable (migration not applied): message, Add disabled, no tiles or cards", () => {
    setup({ state: "unavailable" });
    expect(screen.getByTestId("subs-unavailable").textContent).toContain("database update");
    expect((screen.getByRole("button", { name: /Add Subscription/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("subs-monthly")).toBeNull();
    expect(screen.queryByTestId("sub-card")).toBeNull();
  });
  it("load error is shown without fabricating data", () => {
    setup({ state: "error", loadError: "boom" });
    expect(screen.getByRole("alert").textContent).toBe("boom");
    expect(screen.queryByTestId("subs-monthly")).toBeNull();
  });
  it("loading state", () => {
    setup({ state: "loading" });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByTestId("sub-card")).toBeNull();
  });
  it("first-time empty state with an Add action and zeroed tiles", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Subscriptions" })).toBeTruthy();
    expect(screen.getByText("Manage recurring services and renewals.")).toBeTruthy();
    expect(screen.getByText("No subscriptions tracked yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add Subscription/ })).toBeTruthy();
    expect(screen.getByTestId("subs-monthly").textContent).toBe("$0.00");
    expect(screen.getByTestId("subs-yearly").textContent).toBe("$0.00");
    expect(screen.getByTestId("subs-active").textContent).toBe("0");
    expect(screen.getByTestId("subs-upcoming").textContent).toBe("0");
  });
});

describe("summary tiles", () => {
  it("monthly cost, yearly estimate, active count and upcoming renewals", () => {
    setup({
      subscriptions: [
        sub({ id: "a", name: "A", amount: 15.49 }),
        sub({ id: "b", name: "B", amount: 120, frequency: "yearly", nextBillingDate: "2026-11-06" }), // renews in 2 days
        sub({ id: "c", name: "C", amount: 10, status: "paused" }),
        sub({ id: "d", name: "D", amount: 10, status: "canceled" }),
        sub({ id: "t", name: "T", amount: 50, status: "trial", trialEndsOn: "2026-11-30", nextBillingDate: "2026-11-30" }),
      ],
    });
    expect(screen.getByTestId("subs-monthly").textContent).toBe("$25.49");
    expect(screen.getByTestId("subs-yearly").textContent).toBe("$305.88"); // 185.88 + 120
    expect(screen.getByTestId("subs-active").textContent).toBe("2");
    expect(screen.getByTestId("subs-upcoming").textContent).toBe("1");
  });

  it("flags subscriptions with no price and other currencies instead of counting them as $0", () => {
    setup({ subscriptions: [sub({ id: "a", amount: 10 }), sub({ id: "n", name: "NoPrice", amount: null }), sub({ id: "e", name: "Euro", amount: 8, currency: "EUR" })] });
    expect(screen.getByTestId("subs-monthly").textContent).toBe("$10.00");
    expect(screen.getByTestId("subs-awaiting").textContent).toBe("1 awaiting price");
    expect(screen.getByText("Excludes 1 in other currencies")).toBeTruthy();
  });

  it("each tile value carries its length so currency stays on one line", () => {
    setup({ subscriptions: [sub({ amount: 63354 })] });
    for (const id of ["subs-monthly", "subs-yearly", "subs-active", "subs-upcoming"]) {
      const el = screen.getByTestId(id);
      expect(el.style.getPropertyValue("--len"), id).toBe(String(el.textContent!.length));
    }
  });
});

describe("subscription cards", () => {
  it("shows name, plan and category, price + frequency, next renewal, status and the last payment", () => {
    setup({
      subscriptions: [sub({ planName: "Premium", category: "Streaming", nextBillingDate: "2026-11-20" })],
      payments: { s1: [payment({ paidAt: "2026-10-20T12:00:00" })] },
    });
    const card = cardOf("Netflix");
    expect(card.querySelector(".bill-category")!.textContent).toBe("Premium · Streaming");
    expect(within(card).getByText("$15.49 / month")).toBeTruthy();
    expect(within(card).getByText("Next renewal: 11/20/2026")).toBeTruthy();
    expect(within(card).getByText("Last paid $15.49 · 10/20/2026")).toBeTruthy();
    expect(chip("Netflix")).toBe("Active");
    expect(card.querySelector(".pay-due")!.getAttribute("data-tier")).toBe("paid");
  });

  it("price lines for every frequency, with a monthly equivalent when it isn't monthly", () => {
    setup({
      subscriptions: [
        sub({ id: "w", name: "W", frequency: "weekly", amount: 10 }),
        sub({ id: "q", name: "Q", frequency: "quarterly", amount: 30 }),
        sub({ id: "y", name: "Y", frequency: "yearly", amount: 120 }),
        sub({ id: "c1", name: "C1", frequency: "custom", customInterval: 10, customUnit: "days", amount: 5 }),
        sub({ id: "c2", name: "C2", frequency: "custom", customInterval: 1, customUnit: "weeks", amount: 5 }),
        sub({ id: "c3", name: "C3", frequency: "custom", customInterval: 2, customUnit: "months", amount: 30 }),
      ],
    });
    expect(within(cardOf("W")).getByText("$10.00 / week")).toBeTruthy();
    expect(within(cardOf("W")).getByText("≈ $43.33 / month")).toBeTruthy();
    expect(within(cardOf("Q")).getByText("$30.00 / quarter")).toBeTruthy();
    expect(within(cardOf("Q")).getByText("≈ $10.00 / month")).toBeTruthy();
    expect(within(cardOf("Y")).getByText("$120.00 / year")).toBeTruthy();
    expect(within(cardOf("C1")).getByText("$5.00 every 10 days")).toBeTruthy();
    expect(within(cardOf("C2")).getByText("$5.00 every week")).toBeTruthy();
    expect(within(cardOf("C3")).getByText("$30.00 every 2 months")).toBeTruthy();
    expect(within(cardOf("C3")).getByText("≈ $15.00 / month")).toBeTruthy();
  });

  it("a missing price reads 'Price not entered', never $0", () => {
    setup({ subscriptions: [sub({ amount: null })] });
    expect(within(cardOf("Netflix")).getByText("Price not entered")).toBeTruthy();
    expect(cardOf("Netflix").textContent).not.toContain("$0.00");
  });

  it("chips: reminder-window countdowns, trial, paused and canceled", () => {
    setup({
      subscriptions: [
        sub({ id: "a", name: "Today", nextBillingDate: "2026-11-04" }),
        sub({ id: "b", name: "Tomorrow", nextBillingDate: "2026-11-05" }),
        sub({ id: "c", name: "InThree", nextBillingDate: "2026-11-07" }),
        sub({ id: "d", name: "Trial", status: "trial", trialEndsOn: "2026-11-06", nextBillingDate: "2026-11-06" }),
        sub({ id: "e", name: "LongTrial", status: "trial", trialEndsOn: "2026-11-30", nextBillingDate: "2026-11-30" }),
        sub({ id: "f", name: "Pausey", status: "paused" }),
        sub({ id: "g", name: "Gone", status: "canceled" }),
      ],
    });
    expect(chip("Today")).toBe("Renews today");
    expect(chip("Tomorrow")).toBe("Renews tomorrow");
    expect(chip("InThree")).toBe("Renews in 3 days");
    expect(cardOf("InThree").querySelector(".pay-due")!.getAttribute("data-tier")).toBe("soon");
    expect(chip("Trial")).toBe("Trial ends in 2 days");
    expect(chip("LongTrial")).toBe("Trial ends 11/30/2026");
    expect(chip("Pausey")).toBe("Paused");
    expect(chip("Gone")).toBe("Canceled");
  });

  it("a trial shows its first charge date; paused and canceled show no renewal date", () => {
    setup({
      subscriptions: [
        sub({ id: "t", name: "Trial", status: "trial", trialEndsOn: "2026-11-30", nextBillingDate: "2026-11-30" }),
        sub({ id: "p", name: "Pausey", status: "paused" }),
        sub({ id: "c", name: "Gone", status: "canceled" }),
      ],
    });
    expect(within(cardOf("Trial")).getByText("First charge: 11/30/2026")).toBeTruthy();
    expect(within(cardOf("Pausey")).getByText("Renewals paused")).toBeTruthy();
    expect(within(cardOf("Gone")).getByText("Canceled (tracking only)")).toBeTruthy();
    expect(cardOf("Pausey").textContent).not.toContain("Next renewal");
  });

  it("an ended trial converts to a normal paying subscription automatically", () => {
    setup({ subscriptions: [sub({ status: "trial", trialEndsOn: "2026-11-01", nextBillingDate: "2026-11-10", remindDaysBefore: 3 })] });
    const card = cardOf("Netflix");
    expect(card.getAttribute("data-status")).toBe("active");
    expect(within(card).getByText("Trial ended")).toBeTruthy();
    expect(screen.getByTestId("subs-monthly").textContent).toBe("$15.49");
  });

  it("no payments yet is stated plainly; a renewal date passing never creates a payment", () => {
    setup({ subscriptions: [sub({ nextBillingDate: "2026-11-01" })] });
    expect(within(cardOf("Netflix")).getByText("No payments recorded yet")).toBeTruthy();
    expect(within(cardOf("Netflix")).getByText("Next renewal: 12/01/2026")).toBeTruthy();
  });

  it("orders by next charge, then paused, then canceled", () => {
    setup({
      subscriptions: [
        sub({ id: "c", name: "Canceled", status: "canceled" }),
        sub({ id: "p", name: "Paused", status: "paused" }),
        sub({ id: "l", name: "Later", nextBillingDate: "2026-12-01" }),
        sub({ id: "s", name: "Sooner", nextBillingDate: "2026-11-10" }),
      ],
    });
    expect(screen.getAllByTestId("sub-card").map((c) => within(c).getByRole("heading").textContent)).toEqual(["Sooner", "Later", "Paused", "Canceled"]);
  });

  it("long names wrap inside the card and the action hierarchy matches Bills/Payments", () => {
    setup({ subscriptions: [sub({ name: "An extremely long subscription service name that must wrap cleanly on a narrow phone screen" })] });
    const card = screen.getByTestId("sub-card");
    expect(card.classList.contains("pay-card")).toBe(true);
    expect(card.querySelector(".pay-card-actions .pay-action-wide")).toBeTruthy();
    const names = Array.from(card.querySelectorAll(".pay-card-actions button")).map((b) => b.textContent);
    expect(names).toEqual(["Record Payment", "History", "Edit", "More"]);
  });
});

describe("overlap with Bills (surfaced, not merged)", () => {
  it("flags a possible overlap on the card and in a notice, and counts it in the tile note", () => {
    setup({ subscriptions: [sub({ name: "Netflix" })] }, [bill({ id: "nb", name: "Netflix Premium" })]);
    expect(screen.getByTestId("subs-overlap-notice").textContent).toContain("may also be tracked as a bill");
    expect(within(cardOf("Netflix")).getByTestId("sub-link-note").textContent).toBe("May also be a bill: Netflix Premium");
    expect(screen.getByText("1 may overlap Bills")).toBeTruthy();
  });
  it("an explicit link reads 'Tracked in Bills' and removes the warning", () => {
    setup({ subscriptions: [sub({ name: "Netflix", billId: "nb" })] }, [bill({ id: "nb", name: "Netflix Premium" })]);
    expect(within(cardOf("Netflix")).getByTestId("sub-link-note").textContent).toBe("Tracked in Bills: Netflix Premium");
    expect(screen.queryByTestId("subs-overlap-notice")).toBeNull();
  });
  it("nothing is flagged without a plausible match", () => {
    setup({ subscriptions: [sub({ name: "Netflix" })] }, [bill({ name: "Rent" })]);
    expect(screen.queryByTestId("subs-overlap-notice")).toBeNull();
    expect(screen.queryByTestId("sub-link-note")).toBeNull();
  });
});

describe("Add subscription", () => {
  it("validates, then creates with the entered fields", async () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("This field is required.");

    typeInto(/^Subscription name/, "  Spotify ");
    typeInto(/^Provider/, "Spotify AB");
    typeInto(/^Plan name/, "Family");
    typeInto(/^Category/, "Music");
    typeInto(/^Price$/, "16.99");
    typeInto(/^Next billing date/, "2026-11-25");
    typeInto(/^Remind/, "5");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.create).toHaveBeenCalledTimes(1));
    expect(c.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Spotify", provider: "Spotify AB", planName: "Family", category: "Music", amount: 16.99, currency: "USD",
        frequency: "monthly", nextBillingDate: "2026-11-25", status: "active", trialEndsOn: null, remindDaysBefore: 5, billId: null,
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the price may be left blank (price not known yet)", async () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    typeInto(/^Subscription name/, "Mystery");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Mystery", amount: null })));
  });

  it("rejects an invalid price with a message", () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    typeInto(/^Subscription name/, "X");
    typeInto(/^Price$/, "-4");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("The amount can’t be negative.");
  });

  it("custom frequency reveals the interval and unit and sends them", async () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    expect(screen.queryByLabelText(/^Repeat every/)).toBeNull();
    typeInto(/^Subscription name/, "Odd");
    typeInto("Billing frequency", "custom");
    typeInto(/^Repeat every/, "6");
    typeInto(/^Unit/, "weeks");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.create).toHaveBeenCalledWith(expect.objectContaining({ frequency: "custom", customInterval: 6, customUnit: "weeks" })));
  });

  it("an invalid custom interval is rejected", () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    typeInto(/^Subscription name/, "Odd");
    typeInto("Billing frequency", "custom");
    typeInto(/^Repeat every/, "0");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Enter a whole number from 1 to 365.");
  });

  it("a trial asks for the end date and relabels the price and billing date", async () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    typeInto(/^Subscription name/, "Trialware");
    typeInto(/^Status/, "trial");
    expect(screen.getByLabelText(/^Price after the trial/)).toBeTruthy();
    expect(screen.getByLabelText(/^First charge date/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("This field is required.");
    typeInto(/^Trial ends/, "2026-11-20");
    typeInto(/^First charge date/, "2026-11-20");
    typeInto(/^Price after the trial/, "9.99");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.create).toHaveBeenCalledWith(expect.objectContaining({ status: "trial", trialEndsOn: "2026-11-20", nextBillingDate: "2026-11-20", amount: 9.99 })));
  });

  it("a first charge before the trial ends is rejected", () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    typeInto(/^Subscription name/, "Trialware");
    typeInto(/^Status/, "trial");
    typeInto(/^Trial ends/, "2026-11-30");
    typeInto(/^First charge date/, "2026-11-20");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("The first charge can’t be before the trial ends.");
  });

  it("offers an explicit bill link only when bills exist, and sends the chosen one", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    expect(screen.queryByLabelText(/^Also tracked as a bill/)).toBeNull();
    cleanup();
    const c = setup({}, [bill({ id: "bb", name: "Netflix Bill" })]);
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    typeInto(/^Subscription name/, "Netflix");
    typeInto(/^Also tracked as a bill/, "bb");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.create).toHaveBeenCalledWith(expect.objectContaining({ billId: "bb" })));
  });

  it("Cancel and Escape create nothing; a failed save keeps the modal open with the message", async () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    typeInto(/^Subscription name/, "X");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(c.create).not.toHaveBeenCalled();
    cleanup();
    setup({ create: vi.fn().mockResolvedValue("nope") });
    fireEvent.click(screen.getByRole("button", { name: /Add Subscription/ }));
    typeInto(/^Subscription name/, "X");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByText("nope")).getAttribute("role")).toBe("alert");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("Edit subscription", () => {
  it("prepopulates, sends only the changed fields, and Cancel discards", async () => {
    const s = sub({ provider: "Netflix Inc.", planName: "Premium" });
    const c = setup({ subscriptions: [s] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Netflix" }));
    expect((screen.getByLabelText(/^Subscription name/) as HTMLInputElement).value).toBe("Netflix");
    expect((screen.getByLabelText(/^Price$/) as HTMLInputElement).value).toBe("15.49");
    expect((screen.getByLabelText(/^Plan name/) as HTMLInputElement).value).toBe("Premium");
    typeInto(/^Subscription name/, "Changed");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(c.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit Netflix" }));
    expect((screen.getByLabelText(/^Subscription name/) as HTMLInputElement).value).toBe("Netflix");
    typeInto(/^Price$/, "17.99");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.update).toHaveBeenCalledWith(s, { amount: 17.99 }));
  });

  it("saving with no changes writes nothing", async () => {
    const c = setup({ subscriptions: [sub()] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Netflix" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(c.update).not.toHaveBeenCalled();
  });

  it("changing the status in the form stamps or clears the canceled time", async () => {
    const s = sub();
    const c = setup({ subscriptions: [s] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Netflix" }));
    typeInto(/^Status/, "canceled");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(c.update).toHaveBeenCalled());
    const patch = (c.update as unknown as Mock).mock.calls[0][1];
    expect(patch.status).toBe("canceled");
    expect(typeof patch.canceledAt).toBe("string");
  });
});

describe("status actions (More menu) and destructive confirmations", () => {
  const openMore = (name: string) => fireEvent.click(screen.getByRole("button", { name: `More ${name}` }));

  it("offers Pause/Cancel/Delete for an active subscription, Resume for paused, Reactivate for canceled", () => {
    setup({
      subscriptions: [sub({ id: "a", name: "Act" }), sub({ id: "p", name: "Pau", status: "paused" }), sub({ id: "c", name: "Can", status: "canceled" })],
    });
    openMore("Act");
    const act = within(screen.getByRole("group", { name: "More Act" }));
    expect(act.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(act.getByRole("button", { name: "Mark canceled" })).toBeTruthy();
    expect(act.getByRole("button", { name: "Delete subscription" })).toBeTruthy();
    expect(act.queryByRole("button", { name: "Resume" })).toBeNull();
    openMore("Pau");
    const pau = within(screen.getByRole("group", { name: "More Pau" }));
    expect(pau.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(pau.queryByRole("button", { name: "Pause" })).toBeNull();
    openMore("Can");
    const can = within(screen.getByRole("group", { name: "More Can" }));
    expect(can.getByRole("button", { name: "Reactivate" })).toBeTruthy();
    expect(can.queryByRole("button", { name: "Mark canceled" })).toBeNull();
  });

  it("Pause and Resume apply immediately (reversible) through changeStatus", async () => {
    const act = sub({ id: "a", name: "Act" });
    const c = setup({ subscriptions: [act] });
    openMore("Act");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(c.changeStatus).toHaveBeenCalledWith(act, "pause", TODAY));
  });

  it("Mark canceled asks first, says it only updates StandUp's tracking, and keeps history", async () => {
    const act = sub({ id: "a", name: "Act" });
    const c = setup({ subscriptions: [act] });
    openMore("Act");
    fireEvent.click(screen.getByRole("button", { name: "Mark canceled" }));
    const dialog = screen.getByRole("alertdialog");
    expect(c.changeStatus).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("Act");
    expect(dialog.textContent).toContain("does not cancel the subscription with the provider");
    expect(dialog.textContent).toContain("payment history is kept");
    fireEvent.click(screen.getByRole("button", { name: "Mark Canceled" }));
    await waitFor(() => expect(c.changeStatus).toHaveBeenCalledWith(act, "cancel", TODAY));
  });

  it("declining the cancel confirmation changes nothing", () => {
    const c = setup({ subscriptions: [sub({ id: "a", name: "Act" })] });
    openMore("Act");
    fireEvent.click(screen.getByRole("button", { name: "Mark canceled" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(c.changeStatus).not.toHaveBeenCalled();
  });

  it("Delete never happens without confirmation, names the subscription and warns that history goes too", async () => {
    const act = sub({ id: "a", name: "Act" });
    const c = setup({ subscriptions: [act] });
    openMore("Act");
    fireEvent.click(screen.getByRole("button", { name: "Delete subscription" }));
    expect(c.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Act");
    expect(dialog.textContent).toContain("payment history will be permanently deleted");
    fireEvent.click(screen.getByRole("button", { name: "Delete Subscription" }));
    await waitFor(() => expect(c.remove).toHaveBeenCalledWith(act));
    expect(c.remove).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message and stays open when a destructive action fails", async () => {
    setup({ subscriptions: [sub({ id: "a", name: "Act" })], remove: vi.fn().mockResolvedValue("Failed to delete") });
    openMore("Act");
    fireEvent.click(screen.getByRole("button", { name: "Delete subscription" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Subscription" }));
    expect((await screen.findByText("Failed to delete")).getAttribute("role")).toBe("alert");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("Record payment", () => {
  const open = (over: Partial<SubscriptionsController> = {}, s = sub({ nextBillingDate: "2026-01-20" })) => {
    const c = setup({ subscriptions: [s], ...over });
    fireEvent.click(screen.getByRole("button", { name: `Record Payment ${s.name}` }));
    return c;
  };

  it("prefills the price, today, and the latest unpaid renewal; states renewals are projections", () => {
    open();
    expect((screen.getByLabelText(/^Amount paid/) as HTMLInputElement).value).toBe("15.49");
    expect((screen.getByLabelText(/^Payment date/) as HTMLInputElement).value).toBe(TODAY);
    expect((screen.getByLabelText(/^For renewal/) as HTMLSelectElement).value).toBe("2026-10-20"); // latest renewal on/before today
    expect(screen.getByText(/Renewals are projections/)).toBeTruthy();
  });

  it("defaults to the upcoming renewal once the previous one already has a payment", () => {
    open({ payments: { s1: [payment({ billingDate: "2026-10-20" })] } });
    expect((screen.getByLabelText(/^For renewal/) as HTMLSelectElement).value).toBe("2026-11-20");
  });

  it("validates amount, decimals and future dates", () => {
    open();
    typeInto(/^Amount paid/, "0");
    expect(screen.getByRole("alert").textContent).toContain("greater than zero");
    typeInto(/^Amount paid/, "1.005");
    expect(screen.getByRole("alert").textContent).toContain("2 decimal");
    typeInto(/^Amount paid/, "9.99");
    typeInto(/^Payment date/, "2026-11-05");
    expect(screen.getByRole("alert").textContent).toContain("future");
    expect((screen.getByRole("button", { name: "Record" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("records the payment (with its renewal and note), then confirms", async () => {
    const c = open();
    typeInto(/^Note/, "Oct charge");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(c.recordPayment).toHaveBeenCalledTimes(1));
    const [s, payload] = (c.recordPayment as unknown as Mock).mock.calls[0];
    expect(s.id).toBe("s1");
    expect(payload).toMatchObject({ amount: 15.49, note: "Oct charge", billingDate: "2026-10-20" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Payment recorded.");
  });

  it("a payment can be historical and not tied to any renewal", async () => {
    const c = open();
    typeInto(/^Payment date/, "2025-03-01");
    typeInto(/^For renewal/, "");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(c.recordPayment).toHaveBeenCalled());
    expect((c.recordPayment as unknown as Mock).mock.calls[0][1].billingDate).toBeNull();
  });

  it("repeated taps submit once; a retry after failure reuses the idempotency key; a new modal gets a new key", async () => {
    let resolveFirst: (v: string | null) => void = () => {};
    const recordPayment = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string | null>((res) => (resolveFirst = res)))
      .mockResolvedValue(null);
    open({ recordPayment });
    const btn = screen.getByRole("button", { name: "Record" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(recordPayment).toHaveBeenCalledTimes(1);
    resolveFirst("Failed");
    expect((await screen.findAllByRole("alert")).some((a) => a.textContent === "Failed")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2));
    const keys = recordPayment.mock.calls.map((x) => x[2]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Record Payment Netflix" }));
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(3));
    expect(recordPayment.mock.calls[2][2]).not.toBe(keys[0]);
  });

  it("Cancel records nothing", () => {
    const c = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(c.recordPayment).not.toHaveBeenCalled();
  });
});

describe("History and reversal", () => {
  const history = [
    payment({ id: "p3", amount: 15.49, paidAt: "2026-10-20T12:00:00", billingDate: "2026-10-20", note: "Oct" }),
    payment({ id: "p2", amount: 15.49, paidAt: "2026-09-20T12:00:00", reversedAt: "2026-09-21T00:00:00Z" }),
    payment({ id: "p1", amount: 12, paidAt: "2025-12-20T12:00:00" }),
  ];

  it("empty state", () => {
    setup({ subscriptions: [sub()] });
    fireEvent.click(screen.getByRole("button", { name: "History Netflix" }));
    expect(screen.getByText("No payments recorded yet.")).toBeTruthy();
  });

  it("shows actual spending totals (reversed payments excluded), each payment, its renewal and note", () => {
    setup({ subscriptions: [sub()], payments: { s1: history } });
    fireEvent.click(screen.getByRole("button", { name: "History Netflix" }));
    const h = screen.getByTestId("sub-history");
    expect(h.textContent).toContain("Total paid: $27.49");
    expect(h.textContent).toContain("This year: $15.49");
    expect(h.textContent).toContain("For renewal 10/20/2026");
    expect(h.textContent).toContain("Oct");
    expect(h.textContent).toContain("Reversed");
    expect(screen.queryByRole("button", { name: /^Reverse \$15\.49 09\/20\/2026/ })).toBeNull(); // already reversed
  });

  it("history is preserved after cancellation", () => {
    setup({ subscriptions: [sub({ status: "canceled" })], payments: { s1: history } });
    fireEvent.click(screen.getByRole("button", { name: "History Netflix" }));
    expect(screen.getByTestId("sub-history").textContent).toContain("Total paid: $27.49");
  });

  it("Reverse asks first and then calls the controller once", async () => {
    const s = sub();
    const c = setup({ subscriptions: [s], payments: { s1: history } });
    fireEvent.click(screen.getByRole("button", { name: "History Netflix" }));
    fireEvent.click(screen.getByRole("button", { name: /^Reverse \$15\.49 10\/20\/2026/ }));
    expect(c.reversePayment).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("$15.49");
    const confirm = screen.getByRole("button", { name: "Reverse Payment" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(c.reversePayment).toHaveBeenCalledTimes(1));
    expect(c.reversePayment).toHaveBeenCalledWith(s, "p3");
  });
});

describe("localization", () => {
  it("renders Spanish when the language is es", () => {
    storedLanguage = "es";
    setup({ subscriptions: [sub({ nextBillingDate: "2026-11-06" })] });
    expect(screen.getByRole("heading", { name: "Suscripciones" })).toBeTruthy();
    expect(screen.getByText("Administra servicios recurrentes y renovaciones.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Agregar suscripción/ })).toBeTruthy();
    expect(screen.getByText("Costo mensual")).toBeTruthy();
    expect(screen.getByText("Próximas renovaciones")).toBeTruthy();
    expect(chip("Netflix")).toBe("Se renueva en 2 días");
    expect(screen.getByRole("button", { name: "Registrar pago Netflix" })).toBeTruthy();
  });
  it("Spanish empty and unavailable states", () => {
    storedLanguage = "es";
    setup();
    expect(screen.getByText("Aún no hay suscripciones.")).toBeTruthy();
    cleanup();
    setup({ state: "unavailable" });
    expect(screen.getByTestId("subs-unavailable").textContent).toContain("actualización de la base de datos");
  });
});

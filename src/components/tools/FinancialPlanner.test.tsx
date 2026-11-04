import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { Bill } from "@/lib/bills";
import type { Subscription } from "@/lib/subscriptions";
import type { PaymentAccount } from "@/lib/supabase/db";
import { EXPENSE_CATEGORIES, emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import FinancialPlanner from "./FinancialPlanner";
import type { FinancialProfileController, PlannerLoadState } from "./useFinancialProfile";

const TODAY = "2026-11-04";

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: "b1", name: "Rent", amountType: "fixed", expectedAmount: 1200, recurrence: "monthly", firstDueDate: "2026-01-01",
  remindDaysBefore: 3, category: "Rent / Mortgage", notes: null, archivedAt: null, createdAt: "2026-01-01T00:00:00Z", ...over,
});
const account = (over: Partial<PaymentAccount> = {}): PaymentAccount => ({
  id: "a1", name: "Visa", balance: 900, minimumPayment: 35, dueDay: 15, remindDaysBefore: 3, lastReminderDueDate: null,
  createdAt: "2026-01-01T00:00:00Z", balanceMode: "auto", ...over,
});
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1", name: "Netflix", provider: null, category: null, planName: null, amount: 15, currency: "USD", frequency: "monthly",
  customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null,
  remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", ...over,
});

type Records = { bills?: Bill[]; accounts?: PaymentAccount[]; subscriptions?: Subscription[] };

/** A stateful stand-in for the hook: save() merges into the profile like the real one, and can be told to fail. */
function Harness({ initial, records = {}, state = "ready", onSave, failWith }: { initial: FinancialProfile; records?: Records; state?: PlannerLoadState; onSave?: (p: Partial<FinancialProfile>) => void; failWith?: string }) {
  const [profile, setProfile] = useState(initial);
  const controller: FinancialProfileController = {
    state,
    loadError: null,
    profile,
    save: async (patch) => {
      onSave?.(patch);
      if (failWith) return failWith;
      setProfile((p) => ({ ...p, ...patch, updatedAt: "2026-11-04T10:00:00Z" }));
      return null;
    },
  };
  return (
    <FinancialPlanner controller={controller} bills={records.bills ?? []} accounts={records.accounts ?? []} subscriptions={records.subscriptions ?? []} todayISO={TODAY} />
  );
}

function setup(initial: FinancialProfile = emptyProfile(), records: Records = {}, extra: Partial<Parameters<typeof Harness>[0]> = {}) {
  const saves: Partial<FinancialProfile>[] = [];
  render(
    <LanguageProvider>
      <Harness initial={initial} records={records} onSave={(p) => saves.push(p)} {...extra} />
    </LanguageProvider>
  );
  return saves;
}

const filled = (over: Partial<FinancialProfile> = {}): FinancialProfile => ({
  ...emptyProfile(),
  payFrequency: "monthly",
  takeHome: 5000,
  incomeBasis: "actual",
  adults: 2,
  noDebts: true,
  expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 100, basis: "actual" as const }])),
  updatedAt: "2026-11-01T00:00:00Z",
  ...over,
});

const txt = (id: string) => screen.getByTestId(id).textContent;
const goProfile = () => fireEvent.click(screen.getByTestId("plan-nav-profile"));
const goPlan = () => fireEvent.click(screen.getByTestId("plan-nav-plan"));
afterEach(cleanup);

describe("dashboard: missing information is shown, never invented", () => {
  it("a new profile shows 'not provided' dashes (no $0.00 anywhere), 0% complete, and what is missing", () => {
    setup();
    for (const id of ["plan-income", "plan-obligations", "plan-expenses", "plan-subscriptions", "plan-available"]) expect(txt(id), id).toBe("—");
    expect(txt("plan-completion")).toBe("0%");
    expect(document.body.textContent).not.toContain("$0.00");
    const banner = screen.getByTestId("plan-incomplete").textContent!;
    expect(banner).toContain("income");
    expect(banner).toContain("some living expenses");
    expect(banner).toContain("obligations");
    expect(screen.getByTestId("plan-cta").textContent).toBe("Set up my profile");
  });

  it("shows the normalized figures and available cash once the profile has them", () => {
    setup(filled({ useSubscriptions: true }), { subscriptions: [sub({ amount: 20 })] });
    expect(txt("plan-income")).toBe("$5,000.00");
    expect(txt("plan-expenses")).toBe("$800.00");
    expect(txt("plan-subscriptions")).toBe("$20.00");
    expect(txt("plan-obligations")).toBe("$0.00"); // explicitly "no debts": a real zero, not unknown
    expect(txt("plan-available")).toBe("$4,180.00");
    expect(txt("plan-row-available")).toBe("$4,180.00");
    expect(screen.queryByTestId("plan-incomplete")).toBeNull();
  });

  it("normalizes pay frequency (biweekly $1,000 = $2,166.67 a month)", () => {
    setup(filled({ payFrequency: "biweekly", takeHome: 1000 }));
    expect(txt("plan-income")).toBe("$2,166.67");
  });

  it("flags estimates and incomplete data on the available figure", () => {
    setup(filled({ incomeBasis: "estimate", expenses: { housing: { amount: 1000, basis: "estimate" } } }));
    const tile = screen.getByTestId("plan-available").closest("[data-tile]")!;
    expect(tile.textContent).toContain("Includes estimates");
    expect(tile.textContent).toContain("Based on incomplete data");
  });

  it("income unknown -> available stays unknown even with expenses entered", () => {
    setup(filled({ payFrequency: null, takeHome: null }));
    expect(txt("plan-available")).toBe("—");
    expect(txt("plan-row-available")).toBe("Not provided");
  });

  it("debt balances are listed separately and don't change the monthly figures", () => {
    setup(filled({ noDebts: false, debts: [{ id: "d", name: "Car", balance: 9000, monthlyPayment: 300, basis: "actual", accountId: null }] }));
    expect(txt("plan-obligations")).toBe("$300.00");
    expect(txt("plan-row-debt")).toBe("$9,000.00");
    expect(txt("plan-available")).toBe("$3,900.00"); // 5000 - 300 - 800, the $9,000 balance is not subtracted
  });

  it("an irregular-income profile also shows the lowest month", () => {
    setup(filled({ payFrequency: "irregular", takeHome: null, incomeTypical: 4000, incomeLow: 1500 }));
    expect(txt("plan-income")).toBe("$4,000.00");
    expect(txt("plan-row-low")).toBe("$700.00");
  });

  it("shows a shortfall warning when spending plus planned savings exceed income", () => {
    setup(filled({ takeHome: 700, savingsMonthly: 100 }));
    expect(screen.getByText("Spending and planned savings are more than your income.")).toBeTruthy();
    expect(txt("plan-row-capacity")).toBe("$0.00");
  });

  it("every currency value is sized to its tile (no wrapping) and the rows never wrap amounts", () => {
    setup(filled({ takeHome: 1234567.89 }));
    const v = screen.getByTestId("plan-income");
    expect(v.getAttribute("style")).toContain("--len");
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const block = (sel: string) => css.slice(css.indexOf(sel)).split("}")[0];
    expect(block(".plan-row dd {")).toContain("white-space: nowrap");
    expect(block(".plan-tile-value {")).toContain("white-space: nowrap");
    expect(block(".plan-avail-value {")).toContain("white-space: nowrap");
    expect(block(".plan-cf-value {")).toContain("white-space: nowrap");
    expect(block(".plan-actions {")).toContain("minmax(0, 1fr)");
    expect(block(".plan-glass {")).toContain("min-width: 0");
  });
});

describe("existing records: only with consent, read-only, no double counting", () => {
  const records: Records = { bills: [bill({ category: "Utilities", expectedAmount: 150 })], accounts: [account()], subscriptions: [sub({ amount: 15 })] };

  it("nothing from Bills / Payments / Subscriptions is used until the user turns it on", () => {
    setup(filled(), records);
    expect(txt("plan-obligations")).toBe("$0.00");
    expect(txt("plan-subscriptions")).toBe("—");
    expect((screen.getByTestId("plan-use-bills") as HTMLInputElement).checked).toBe(false);
  });

  it("turning a source on saves only the consent flag, then folds the records in", async () => {
    const saves = setup(filled(), records);
    fireEvent.click(screen.getByTestId("plan-use-bills"));
    await waitFor(() => expect(txt("plan-obligations")).toBe("$150.00"));
    expect(saves).toEqual([{ useBills: true }]);
    fireEvent.click(screen.getByTestId("plan-use-accounts"));
    await waitFor(() => expect(txt("plan-obligations")).toBe("$185.00"));
    fireEvent.click(screen.getByTestId("plan-use-subscriptions"));
    await waitFor(() => expect(txt("plan-subscriptions")).toBe("$15.00"));
    expect(saves).toEqual([{ useBills: true }, { useAccounts: true }, { useSubscriptions: true }]);
  });

  it("a subscription linked to an included bill isn't counted twice, and the screen says so", async () => {
    setup(filled({ useBills: true, useSubscriptions: true }), { ...records, subscriptions: [sub({ billId: "b1" })], bills: [bill()] });
    expect(txt("plan-subscriptions")).toBe("$0.00");
    expect(screen.getByText("1 already counted through a linked bill.")).toBeTruthy();
  });

  it("surfaces (does not merge) a bill that probably covers a living expense", () => {
    setup(filled({ useBills: true }), records);
    expect(screen.getByTestId("plan-overlap").textContent).toContain("Utilities");
  });

  it("the planner never writes to the records it reads (it only has a profile save)", () => {
    const saves = setup(filled(), records);
    fireEvent.click(screen.getByTestId("plan-use-bills"));
    expect(saves.every((s) => Object.keys(s).every((k) => k.startsWith("use") || k === "updatedAt"))).toBe(true);
  });
});

describe("guided profile: five steps, saved between sessions", () => {
  it("starts at step 1 and saves after the step, moving on to step 2 with progress stored", async () => {
    const saves = setup();
    fireEvent.click(screen.getByTestId("plan-cta"));
    expect(screen.getByTestId("plan-step-1")).toBeTruthy();
    expect(screen.getByText("Step 1 of 5")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "biweekly" } });
    fireEvent.change(screen.getByLabelText(/Take-home per paycheck/), { target: { value: "1500.25" } });
    fireEvent.change(screen.getByLabelText("Income type"), { target: { value: "actual" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("plan-step-2")).toBeTruthy());
    expect(saves[0]).toMatchObject({ payFrequency: "biweekly", takeHome: 1500.25, incomeBasis: "actual", currentStep: 2, skippedSteps: [] });
  });

  it("validates inputs: a bad amount shows an error and nothing is saved", async () => {
    const saves = setup();
    fireEvent.click(screen.getByTestId("plan-cta"));
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "monthly" } });
    fireEvent.change(screen.getByLabelText(/Take-home per paycheck/), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Enter a valid amount with at most 2 decimals.")).toBeTruthy();
    expect(saves).toEqual([]);
    expect(screen.getByTestId("plan-step-1")).toBeTruthy();
  });

  it("irregular income asks for a typical (and optional lowest) month", async () => {
    const saves = setup();
    fireEvent.click(screen.getByTestId("plan-cta"));
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "irregular" } });
    expect(screen.queryByLabelText(/Take-home per paycheck/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Typical monthly take-home/), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText(/Lowest recent month/), { target: { value: "3500" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("The lowest month can’t be above the typical month.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Lowest recent month/), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ payFrequency: "irregular", incomeTypical: 3000, incomeLow: 1200, takeHome: null });
  });

  it("an optional step can be skipped: it records the skip, moves on, and shows 'Skipped' on the dashboard", async () => {
    const saves = setup(filled({ adults: null }));
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Edit Income/ }));
    fireEvent.click(screen.getByTestId("plan-skip"));
    await waitFor(() => expect(screen.getByTestId("plan-step-2")).toBeTruthy());
    expect(saves[0]).toEqual({ skippedSteps: [1], currentStep: 2 });
    fireEvent.click(screen.getByTestId("plan-skip")); // skip household too
    await waitFor(() => expect(screen.getByTestId("plan-step-3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back to overview" }));
    expect(within(screen.getByTestId("plan-step-row-2")).getByText("Skipped")).toBeTruthy();
    // skipping never erases data that was already entered
    expect(within(screen.getByTestId("plan-step-row-1")).getByText("Complete")).toBeTruthy();
  });

  it("progress persists: a returning user resumes at the first unfinished step, and finished steps can be edited with their values", async () => {
    setup(filled({ adults: null, expenses: {}, noDebts: false }));
    expect(screen.getByTestId("plan-cta").textContent).toBe("Continue setup");
    fireEvent.click(screen.getByTestId("plan-cta"));
    expect(screen.getByTestId("plan-step-2")).toBeTruthy(); // step 1 is complete, so resume at 2
    fireEvent.click(screen.getByRole("button", { name: "Back to overview" }));
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Edit Income/ }));
    expect((screen.getByLabelText(/How often are you paid/) as HTMLSelectElement).value).toBe("monthly");
    expect((screen.getByLabelText(/Take-home per paycheck/) as HTMLInputElement).value).toBe("5000");
  });

  it("household step is optional and bounded", async () => {
    const saves = setup();
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Start Location/ }));
    fireEvent.change(screen.getByLabelText(/Adults in household/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Out of range.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Adults in household/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/State \/ province/), { target: { value: "TX" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ adults: 2, region: "TX", country: null, dependents: null });
  });

  it("living expenses: blank rows stay unknown; estimate vs actual is stored per row", async () => {
    const saves = setup();
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Start Living expenses/ }));
    const housing = within(screen.getByTestId("plan-expense-housing"));
    fireEvent.change(housing.getByLabelText(/Rent \/ mortgage/), { target: { value: "1400" } });
    fireEvent.click(housing.getByLabelText("Estimate")); // untick: this one is an actual figure
    const groceries = within(screen.getByTestId("plan-expense-groceries"));
    fireEvent.change(groceries.getByLabelText(/Groceries/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].expenses).toEqual({ housing: { amount: 1400, basis: "actual" }, groceries: { amount: 0, basis: "estimate" } });
  });

  it("'Already in my Bills' is offered only on rows an included bill probably covers", async () => {
    const saves = setup(filled({ useBills: true }), { bills: [bill({ category: "Utilities" })] });
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Edit Living expenses/ }));
    expect(within(screen.getByTestId("plan-expense-utilities")).getByLabelText("Already in my Bills")).toBeTruthy();
    expect(within(screen.getByTestId("plan-expense-groceries")).queryByLabelText("Already in my Bills")).toBeNull();
    fireEvent.click(within(screen.getByTestId("plan-expense-utilities")).getByLabelText("Already in my Bills"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].expenses?.utilities).toEqual({ amount: 100, basis: "actual", covered: true });
  });

  it("debts: 'no debts' is an answer; balances and monthly payments are separate fields; a Payments account can be linked", async () => {
    const saves = setup(emptyProfile(), { accounts: [account()] });
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Start Debts/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Visa" } });
    fireEvent.change(screen.getByLabelText("Balance owed"), { target: { value: "900" } });
    fireEvent.change(screen.getByLabelText("Monthly payment"), { target: { value: "35" } });
    fireEvent.change(screen.getByLabelText("Already tracked in Payments?"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].debts).toEqual([{ id: expect.any(String), name: "Visa", balance: 900, monthlyPayment: 35, basis: "estimate", accountId: "a1" }]);
    expect(saves[0].noDebts).toBe(false);
  });

  it("'I have no debts' hides the list and saves an empty one", async () => {
    const saves = setup();
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Start Debts/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    fireEvent.click(screen.getByLabelText("I have no debts"));
    expect(screen.queryByRole("button", { name: "+ Add debt" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ debts: [], noDebts: true });
  });

  it("the account link only appears when there are Payments accounts to link", () => {
    setup(emptyProfile(), {});
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Start Debts/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    expect(screen.queryByLabelText("Already tracked in Payments?")).toBeNull();
  });

  it("goals: finishing the last step returns to the overview with the profile marked complete", async () => {
    const saves = setup(filled());
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Start Financial goals/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add goal" }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Emergency fund" } });
    fireEvent.change(screen.getByLabelText("Target amount (optional)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].goals).toEqual([{ id: expect.any(String), name: "Emergency fund", targetAmount: 5000, targetDate: null }]);
    await waitFor(() => expect(screen.queryByTestId("plan-step-5")).toBeNull());
    expect(within(screen.getByTestId("plan-step-row-5")).getByText("Complete")).toBeTruthy();
  });

  it("a failed save keeps the user on the step with their input and shows the error", async () => {
    setup(emptyProfile(), {}, { failWith: "Network down" });
    fireEvent.click(screen.getByTestId("plan-cta"));
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "monthly" } });
    fireEvent.change(screen.getByLabelText(/Take-home per paycheck/), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    expect(screen.getByTestId("plan-step-1")).toBeTruthy();
    expect((screen.getByLabelText(/Take-home per paycheck/) as HTMLInputElement).value).toBe("3000");
  });
});

describe("inner navigation: Overview / Profile / Plan", () => {
  it("opens on the Overview and switches views without leaving the Planner or changing any data", () => {
    const saves = setup(filled());
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("plan-flow")).toBeTruthy();
    goProfile();
    expect(screen.getByTestId("plan-step-row-1")).toBeTruthy();
    expect(screen.queryByTestId("plan-flow")).toBeNull();
    goPlan();
    expect(screen.getByTestId("plan-cf")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your Financial Plan" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("plan-nav-overview"));
    expect(screen.getByRole("heading", { name: "Financial Planner" })).toBeTruthy();
    expect(saves).toEqual([]);
  });
  it("the snapshot has the four mockup tiles plus a full-width available-cash panel", () => {
    setup(filled({ useSubscriptions: true }));
    const tiles = [...document.querySelectorAll(".plan-tile")].map((t) => t.getAttribute("data-tile"));
    expect(tiles).toEqual(["income", "obligations", "subscriptions", "expenses"]);
    expect(document.querySelector(".plan-avail")).toBeTruthy();
    expect(screen.getByTestId("plan-available").closest(".plan-avail")!.textContent).toContain("/ month");
  });
  it("available cash: positive and negative get different treatments; missing shows a dash with no unit", () => {
    setup(filled());
    expect(document.querySelector(".plan-avail")!.getAttribute("data-tone")).toBe("positive");
    cleanup();
    setup(filled({ takeHome: 300 }));
    expect(document.querySelector(".plan-avail")!.getAttribute("data-tone")).toBe("negative");
    expect(screen.getByTestId("plan-available").textContent!.startsWith("-")).toBe(true);
    cleanup();
    setup();
    expect(document.querySelector(".plan-avail")!.getAttribute("data-tone")).toBe("none");
    expect(document.querySelector(".plan-avail")!.textContent).not.toContain("/ month");
  });
  it("a complete profile hides Continue Setup and says so; the ring shows the real percentage", () => {
    setup(
      filled({
        goals: [{ id: "g", name: "Trip", targetAmount: null, targetDate: null }],
      })
    );
    expect(screen.getByTestId("plan-completion").textContent).toBe("100%");
    expect(screen.queryByTestId("plan-cta")).toBeNull();
    expect(screen.getByText("Your profile is complete.")).toBeTruthy();
  });
  it("profile cards: icon, step number, name, status and the right action per status", () => {
    setup(filled({ expenses: { housing: { amount: 1, basis: "actual" } }, skippedSteps: [5] }));
    goProfile();
    const action = (n: number) => within(screen.getByTestId(`plan-step-row-${n}`)).getByRole("button").textContent;
    expect(action(1)).toBe("Edit"); // complete
    expect(action(3)).toBe("Continue"); // partial
    expect(action(5)).toBe("Start"); // skipped
    expect(within(screen.getByTestId("plan-step-row-3")).getByText("Step 3 of 5")).toBeTruthy();
    expect(screen.getByTestId("plan-step-row-1").querySelector("svg")).toBeTruthy();
  });
});

describe("Your Financial Plan view", () => {
  it("cash flow shows income, expenses (everything that leaves each month) and available, from the plan", () => {
    setup(filled({ useSubscriptions: true }), { subscriptions: [sub({ amount: 20 })] });
    goPlan();
    expect(txt("plan-cf-income")).toBe("$5,000.00");
    expect(txt("plan-cf-expenses")).toBe("$820.00");
    expect(txt("plan-cf-available")).toBe("$4,180.00");
  });
  it("the donut breakdown uses the real calculated amounts, with percentages that add up to 100", () => {
    setup(
      filled({
        useSubscriptions: true,
        expenses: { housing: { amount: 1000, basis: "actual" }, groceries: { amount: 400, basis: "estimate" } },
      }),
      { subscriptions: [sub({ amount: 100 })] }
    );
    goPlan();
    const pct = (k: string) => Number(screen.getByTestId(`plan-legend-${k}`).querySelector(".plan-legend-pct")!.textContent!.replace("%", ""));
    expect(pct("housing") + pct("groceries") + pct("subscriptions")).toBe(100);
    expect([66, 67]).toContain(pct("housing")); // 1000 of 1500, rounded so the slices still total 100
    expect(txt("plan-donut-total")).toBe("$1,500.00");
    const chart = screen.getByRole("img", { name: /Spending breakdown\. Total \$1,500\.00/ });
    expect(chart.getAttribute("aria-label")).toMatch(/Rent \/ mortgage 6[67]% \(\$1,000\.00\)/);
    expect(screen.queryByTestId("plan-legend-utilities")).toBeNull(); // never invent a missing expense
  });
  it("with nothing to show it says so instead of drawing an empty chart", () => {
    setup();
    goPlan();
    expect(screen.getByTestId("plan-breakdown-empty").textContent).toBe("Add your expenses to see where your money goes.");
    expect(document.querySelector(".plan-donut")).toBeNull();
  });
  it("next steps come from the plan's own gaps and open the matching setup step", () => {
    setup();
    goPlan();
    expect(screen.getByTestId("plan-next-addIncome")).toBeTruthy();
    fireEvent.click(screen.getByTestId("plan-next-addIncome"));
    expect(screen.getByTestId("plan-step-1")).toBeTruthy();
  });
  it("rule-based items without a setup step are shown as plain text (not clickable)", () => {
    setup(filled({ takeHome: 300, useSubscriptions: true }));
    goPlan();
    const item = screen.getByTestId("plan-next-shortfall");
    expect(item.tagName).toBe("DIV");
    expect(item.textContent).toContain("Spending is more than your income");
  });
  it("'Add to My Goals' is honestly unavailable: no button, and nothing is created", () => {
    const saves = setup(filled());
    goPlan();
    const note = screen.getByTestId("plan-goals-unavailable");
    expect(note.textContent).toContain("isn’t available yet");
    expect(within(note).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add to My Goals/ })).toBeNull();
    expect(saves).toEqual([]);
  });
});

describe("wizard chrome: progress track, total, Back / Save & Exit / Next", () => {
  it("shows a five-step track with completed steps checked and the current one marked", () => {
    setup(filled());
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Edit Living expenses/ }));
    const items = [...screen.getByTestId("plan-stepper").querySelectorAll("li")];
    expect(items.map((li) => li.getAttribute("data-state"))).toEqual(["done", "done", "current", "done", "later"]);
    expect(items[2].getAttribute("aria-current")).toBe("step");
    expect(items[0].querySelector("svg")).toBeTruthy(); // check mark on a completed step
  });
  it("Living Expenses shows a running total that follows what is typed (blank stays unknown)", () => {
    setup();
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Start Living expenses/ }));
    expect(txt("plan-expense-total-value")).toBe("—");
    fireEvent.change(within(screen.getByTestId("plan-expense-housing")).getByLabelText(/Rent \/ mortgage/), { target: { value: "1400" } });
    fireEvent.change(within(screen.getByTestId("plan-expense-groceries")).getByLabelText(/Groceries/), { target: { value: "450.50" } });
    expect(txt("plan-expense-total-value")).toBe("$1,850.50");
    expect(screen.getByTestId("plan-expense-total").textContent).toContain("6 categories left blank");
    fireEvent.change(within(screen.getByTestId("plan-expense-groceries")).getByLabelText(/Groceries/), { target: { value: "oops" } });
    expect(txt("plan-expense-total-value")).toBe("$1,400.00"); // an invalid row isn't counted
  });
  it("Back goes to the previous step; on step 1 it returns to the overview", async () => {
    setup(filled());
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /Edit Living expenses/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("plan-step-2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("plan-step-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByTestId("plan-step-1")).toBeNull();
    expect(screen.getByTestId("plan-step-row-1")).toBeTruthy();
  });
  it("Save & Exit saves the step and returns to the overview (resume point stays on that step)", async () => {
    const saves = setup();
    fireEvent.click(screen.getByTestId("plan-cta"));
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "monthly" } });
    fireEvent.change(screen.getByLabelText(/Take-home per paycheck/), { target: { value: "4000" } });
    fireEvent.click(screen.getByTestId("plan-save-exit"));
    await waitFor(() => expect(screen.queryByTestId("plan-step-1")).toBeNull());
    expect(saves[0]).toMatchObject({ payFrequency: "monthly", takeHome: 4000, currentStep: 1 });
    expect(screen.getByText("Saved.")).toBeTruthy();
    expect(txt("plan-income")).toBe("$4,000.00");
  });
  it("Save & Exit still validates", async () => {
    const saves = setup();
    fireEvent.click(screen.getByTestId("plan-cta"));
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "monthly" } });
    fireEvent.change(screen.getByLabelText(/Take-home per paycheck/), { target: { value: "-5" } });
    fireEvent.click(screen.getByTestId("plan-save-exit"));
    expect(await screen.findByText("Amounts can’t be negative.")).toBeTruthy();
    expect(saves).toEqual([]);
  });
  it("every wizard control is a real button or field with a visible label (keyboard and screen-reader friendly)", () => {
    setup();
    fireEvent.click(screen.getByTestId("plan-cta"));
    for (const b of screen.getAllByRole("button")) expect((b.textContent ?? "").trim() || b.getAttribute("aria-label")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to overview" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Profile progress" })).toBeTruthy();
  });
});

describe("income step refinements", () => {
  const openIncome = () => fireEvent.click(screen.getByTestId("plan-cta"));

  it("the take-home field is always on screen: disabled with a hint until a pay frequency is chosen, then enabled and relabelled", () => {
    setup();
    openIncome();
    const amount = screen.getByLabelText("Take-home pay") as HTMLInputElement;
    expect(amount.disabled).toBe(true);
    expect(screen.getByText("Choose how often you’re paid, then enter your take-home amount.")).toBeTruthy();
    expect(amount.getAttribute("aria-describedby")).toBe("plan-amount-hint");
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "weekly" } });
    const enabled = screen.getByLabelText("Take-home per paycheck") as HTMLInputElement;
    expect(enabled.disabled).toBe(false);
    expect(screen.queryByText(/Choose how often you’re paid, then enter/)).toBeNull();
  });

  it("the selector is 'Income type' (Actual / Estimate) on this step; other steps keep their own wording", () => {
    setup(emptyProfile(), { accounts: [] });
    openIncome();
    expect(screen.getByLabelText("Income type")).toBeTruthy();
    expect(screen.queryByLabelText(/This figure is/)).toBeNull();
    const sel = screen.getByLabelText("Income type") as HTMLSelectElement;
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([["estimate", "Estimate"], ["actual", "Actual (pay stub)"]]);
    fireEvent.click(screen.getByRole("button", { name: "Back to overview" }));
    fireEvent.click(screen.getByTestId("plan-nav-profile"));
    fireEvent.click(screen.getByRole("button", { name: /Start Debts/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    expect(screen.getAllByLabelText("This figure is").length).toBeGreaterThan(0);
  });

  it("Next validates: an empty step shows what is required and saves nothing", async () => {
    const saves = setup();
    openIncome();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Choose how often you’re paid.")).toBeTruthy();
    expect(saves).toEqual([]);
    expect(screen.getByTestId("plan-step-1")).toBeTruthy();
    // picking a frequency clears the message; the amount is then required
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "monthly" } });
    expect(screen.queryByText("Choose how often you’re paid.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Enter your take-home amount.")).toBeTruthy();
    expect(saves).toEqual([]);
  });

  it("irregular income requires a typical month (the lowest month stays optional)", async () => {
    const saves = setup();
    openIncome();
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "irregular" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Enter your take-home amount.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Typical monthly take-home/), { target: { value: "2800" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ payFrequency: "irregular", incomeTypical: 2800, incomeLow: null });
  });

  it("Save & Exit applies the same required check", async () => {
    const saves = setup();
    openIncome();
    fireEvent.click(screen.getByTestId("plan-save-exit"));
    expect(await screen.findByText("Choose how often you’re paid.")).toBeTruthy();
    expect(saves).toEqual([]);
  });

  it("Skip for now still works with nothing entered, and records only the skip", async () => {
    const saves = setup();
    openIncome();
    fireEvent.click(screen.getByTestId("plan-skip"));
    await waitFor(() => expect(screen.getByTestId("plan-step-2")).toBeTruthy());
    expect(saves).toEqual([{ skippedSteps: [1], currentStep: 2 }]);
  });

  it("a valid entry still saves and keeps the Actual / Estimate choice", async () => {
    const saves = setup();
    openIncome();
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "biweekly" } });
    fireEvent.change(screen.getByLabelText("Take-home per paycheck"), { target: { value: "2650.40" } });
    fireEvent.change(screen.getByLabelText("Income type"), { target: { value: "actual" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ payFrequency: "biweekly", takeHome: 2650.4, incomeBasis: "actual", currentStep: 2 });
  });
});

describe("step 3: the total is honest about what is and isn't entered", () => {
  const openExpenses = () => {
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /(Start|Edit|Continue) Living expenses/ }));
  };
  const amountInput = (c: string, label: RegExp) => within(screen.getByTestId(`plan-expense-${c}`)).getByLabelText(label);

  it("nothing entered: a dash and an explanation, never $0.00", () => {
    setup();
    openExpenses();
    const total = screen.getByTestId("plan-expense-total");
    expect(total.getAttribute("data-state")).toBe("none");
    expect(txt("plan-expense-total-value")).toBe("—");
    expect(total.textContent).toContain("Not available yet. Enter at least one amount to see a total.");
    expect(total.textContent).not.toContain("$0.00");
    expect(total.textContent).toContain("Total Living Expenses");
  });

  it("some amounts: the calculated amount is labeled 'Partial total' with what is still blank", () => {
    setup();
    openExpenses();
    fireEvent.change(amountInput("housing", /Rent/), { target: { value: "1400" } });
    const total = screen.getByTestId("plan-expense-total");
    expect(total.getAttribute("data-state")).toBe("partial");
    expect(total.textContent).toContain("Partial total");
    expect(total.textContent).not.toContain("Total Living Expenses");
    expect(txt("plan-expense-total-value")).toBe("$1,400.00");
    expect(total.textContent).toContain("7 categories left blank");
  });

  it("every category given: the complete total", () => {
    setup();
    openExpenses();
    for (const [c, label] of [["housing", /Rent/], ["utilities", /Utilities/], ["groceries", /Groceries/], ["transportation", /Transportation/], ["insurance", /Insurance/], ["healthcare", /Healthcare/], ["childcare", /Childcare/], ["other", /Other/]] as const) {
      fireEvent.change(amountInput(c, label), { target: { value: "100" } });
    }
    const total = screen.getByTestId("plan-expense-total");
    expect(total.getAttribute("data-state")).toBe("complete");
    expect(total.textContent).toContain("Total Living Expenses");
    expect(total.textContent).not.toContain("Partial total");
    expect(txt("plan-expense-total-value")).toBe("$800.00");
  });

  it("an explicitly entered $0 is a real answer: it counts as entered, so the total is $0.00 (not a dash)", () => {
    setup();
    openExpenses();
    fireEvent.change(amountInput("housing", /Rent/), { target: { value: "0" } });
    expect(screen.getByTestId("plan-expense-total").getAttribute("data-state")).toBe("partial");
    expect(txt("plan-expense-total-value")).toBe("$0.00");
    for (const [c, label] of [["utilities", /Utilities/], ["groceries", /Groceries/], ["transportation", /Transportation/], ["insurance", /Insurance/], ["healthcare", /Healthcare/], ["childcare", /Childcare/], ["other", /Other/]] as const) {
      fireEvent.change(amountInput(c, label), { target: { value: "0" } });
    }
    expect(screen.getByTestId("plan-expense-total").getAttribute("data-state")).toBe("complete");
    expect(txt("plan-expense-total-value")).toBe("$0.00");
  });

  it("clearing the only amount returns to 'not available'", () => {
    setup();
    openExpenses();
    fireEvent.change(amountInput("housing", /Rent/), { target: { value: "50" } });
    fireEvent.change(amountInput("housing", /Rent/), { target: { value: "" } });
    expect(txt("plan-expense-total-value")).toBe("—");
  });

  it("the Estimate box looks inactive on an empty row but stays a normal, focusable, working checkbox that keeps its choice", async () => {
    const saves = setup();
    openExpenses();
    const row = within(screen.getByTestId("plan-expense-housing"));
    const box = row.getByLabelText("Estimate") as HTMLInputElement;
    const label = box.closest("label")!;
    expect(label.getAttribute("data-empty")).toBe("true");
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(true); // the default choice is kept, just shown neutral
    fireEvent.click(box); // can be changed even before an amount is typed
    expect(box.checked).toBe(false);
    fireEvent.change(row.getByLabelText(/Rent/), { target: { value: "1400" } });
    expect(label.getAttribute("data-empty")).toBe("false");
    expect(box.checked).toBe(false); // the earlier choice survived typing
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].expenses?.housing).toEqual({ amount: 1400, basis: "actual" });
  });

  it("a saved estimate selection is kept when the amount is cleared and typed again", () => {
    setup(filled({ expenses: { housing: { amount: 900, basis: "estimate" }, utilities: { amount: 100, basis: "actual" } } }));
    openExpenses();
    const row = within(screen.getByTestId("plan-expense-housing"));
    expect((row.getByLabelText("Estimate") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(row.getByLabelText(/Rent/), { target: { value: "" } });
    expect(row.getByLabelText("Estimate").closest("label")!.getAttribute("data-empty")).toBe("true");
    expect((row.getByLabelText("Estimate") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(row.getByLabelText(/Rent/), { target: { value: "950" } });
    expect((row.getByLabelText("Estimate") as HTMLInputElement).checked).toBe(true);
  });
});

describe("step 4: debts empty state and the savings section", () => {
  const openDebts = () => {
    goProfile();
    fireEvent.click(screen.getByRole("button", { name: /(Start|Edit|Continue) Debts/ }));
  };

  it("with no debts: a compact empty state with Add debt, and no blank debt form", () => {
    setup();
    openDebts();
    const empty = screen.getByTestId("plan-debts-empty");
    expect(empty.textContent).toContain("No debts added yet.");
    expect(within(empty).getByRole("button", { name: "+ Add debt" })).toBeTruthy();
    expect(screen.queryByTestId("plan-debt")).toBeNull();
    expect(screen.queryByLabelText("Balance owed")).toBeNull();
    expect(screen.queryByLabelText("Monthly payment")).toBeNull();
  });

  it("Add debt reveals the existing entry form (same fields, same behavior)", async () => {
    const saves = setup(emptyProfile(), { accounts: [account()] });
    openDebts();
    fireEvent.click(within(screen.getByTestId("plan-debts-empty")).getByRole("button", { name: "+ Add debt" }));
    expect(screen.queryByTestId("plan-debts-empty")).toBeNull();
    expect(screen.getAllByTestId("plan-debt")).toHaveLength(1);
    for (const l of ["Name", "Balance owed", "Monthly payment", "Already tracked in Payments?"]) expect(screen.getByLabelText(l)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Visa" } });
    fireEvent.change(screen.getByLabelText("Balance owed"), { target: { value: "900" } });
    fireEvent.change(screen.getByLabelText("Already tracked in Payments?"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].debts).toEqual([{ id: expect.any(String), name: "Visa", balance: 900, monthlyPayment: null, basis: "estimate", accountId: "a1" }]);
    // the add button now lives below the list for further debts
    expect(screen.queryByTestId("plan-debts-empty")).toBeNull();
  });

  it("removing the last debt brings the empty state back", () => {
    setup(emptyProfile());
    openDebts();
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByTestId("plan-debts-empty")).toBeTruthy();
  });

  it("'I have no debts' still hides everything debt-related, including the empty state", () => {
    setup();
    openDebts();
    fireEvent.click(screen.getByLabelText("I have no debts"));
    expect(screen.queryByTestId("plan-debts-empty")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add debt" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Savings" })).toBeTruthy(); // savings stays available
  });

  it("savings has its own heading and divider, separate from the debts section, and keeps its fields", () => {
    setup();
    openDebts();
    const heading = screen.getByRole("heading", { name: "Savings" });
    expect(document.querySelector(".plan-divider")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Savings" });
    expect(within(group).getByLabelText("Savings balance (optional)")).toBeTruthy();
    expect(within(group).getByLabelText("Monthly savings (optional)")).toBeTruthy();
    // the divider sits between the debt area and the heading
    const order = (a: Element, b: Element) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(screen.getByTestId("plan-debts-empty"), document.querySelector(".plan-divider")!)).toBeTruthy();
    expect(order(document.querySelector(".plan-divider")!, heading)).toBeTruthy();
  });

  it("debt validation and Payments linking are unchanged", async () => {
    const saves = setup(emptyProfile(), { accounts: [account()] });
    openDebts();
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Required.")).toBeTruthy();
    expect(saves).toEqual([]);
  });
});

describe("states", () => {
  it("unavailable (migration not applied): says so and offers no setup", () => {
    setup(emptyProfile(), {}, { state: "unavailable" });
    expect(screen.getByTestId("plan-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("plan-cta")).toBeNull();
    expect(screen.queryByTestId("plan-income")).toBeNull();
  });
  it("loading shows a loading message, not empty figures", () => {
    setup(emptyProfile(), {}, { state: "loading" });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByTestId("plan-income")).toBeNull();
  });
});

describe("Spanish", () => {
  it("the dashboard, tiles and a step render in Spanish, with the same figures", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      setup(filled());
      await waitFor(() => expect(screen.getByRole("heading", { name: "Planificador financiero" })).toBeTruthy());
      expect(screen.getByText("Ingreso neto mensual")).toBeTruthy();
      expect(screen.getAllByText("Disponible estimado").length).toBeGreaterThan(0);
      expect(txt("plan-income")).toBe("$5,000.00");
      expect(screen.getByRole("tab", { name: "Perfil" })).toBeTruthy();
      goProfile();
      fireEvent.click(screen.getByRole("button", { name: /Editar Ingresos/ }));
      expect(screen.getByText("Paso 1 de 5")).toBeTruthy();
      expect(screen.getByLabelText(/¿Cada cuánto te pagan?/)).toBeTruthy();
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

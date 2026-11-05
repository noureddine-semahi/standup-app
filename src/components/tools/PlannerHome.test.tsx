import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { EXPENSE_CATEGORIES, emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import type { Bill } from "@/lib/bills";
import type { Subscription } from "@/lib/subscriptions";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { PartnerRecord } from "@/lib/supabase/household";
import PlannerHome from "./PlannerHome";
import type { FinancialProfileController, PlannerLoadState } from "./useFinancialProfile";
import type { HouseholdController } from "./useHousehold";

const TODAY = "2026-11-04";

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: "b1", name: "Rent", amountType: "fixed", expectedAmount: 1200, recurrence: "monthly", firstDueDate: "2026-01-01",
  remindDaysBefore: 3, category: "Rent / Mortgage", notes: null, archivedAt: null, createdAt: "2026-01-01T00:00:00Z", ...over,
});
const account = (): PaymentAccount => ({
  id: "a1", name: "Visa", balance: 900, minimumPayment: 35, dueDay: 15, remindDaysBefore: 3, lastReminderDueDate: null,
  createdAt: "2026-01-01T00:00:00Z", balanceMode: "auto",
});
const sub = (): Subscription => ({
  id: "s1", name: "Netflix", provider: null, category: null, planName: null, amount: 15, currency: "USD", frequency: "monthly",
  customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null,
  remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "x", updatedAt: "x",
});

const myProfile = (over: Partial<FinancialProfile> = {}): FinancialProfile => ({
  ...emptyProfile(),
  payFrequency: "monthly",
  takeHome: 5000,
  incomeBasis: "actual",
  adults: 2,
  noDebts: true,
  expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 100, basis: "actual" as const }])),
  useSubscriptions: true,
  updatedAt: "2026-11-01T00:00:00Z",
  ...over,
});

type Spies = { meSaves: Partial<FinancialProfile>[]; partnerSaves: Partial<FinancialProfile>[]; added: string[]; renamed: string[]; removed: string[] };

/** Stateful stand-ins for both hooks, so persistence and isolation are exercised for real. */
function Harness({ me, partner, hState = "ready", spies }: { me: FinancialProfile; partner: PartnerRecord | null; hState?: PlannerLoadState; spies: Spies }) {
  const [myP, setMyP] = useState(me);
  const [pr, setPr] = useState(partner);
  const meCtl: FinancialProfileController = {
    state: "ready",
    loadError: null,
    profile: myP,
    save: async (patch) => {
      spies.meSaves.push(patch);
      setMyP((p) => ({ ...p, ...patch, updatedAt: "2026-11-04T10:00:00Z" }));
      return null;
    },
  };
  const hh: HouseholdController = {
    state: hState,
    loadError: null,
    partner: pr,
    addPartner: async (name) => {
      spies.added.push(name);
      setPr({ id: "m1", name, profile: emptyProfile() });
      return null;
    },
    renamePartner: async (name) => {
      spies.renamed.push(name);
      setPr((p) => (p ? { ...p, name } : p));
      return null;
    },
    removePartner: async () => {
      spies.removed.push("removed");
      setPr(null);
      return null;
    },
    savePartner: async (patch) => {
      spies.partnerSaves.push(patch);
      setPr((p) => (p ? { ...p, profile: { ...p.profile, ...patch, updatedAt: "2026-11-04T10:00:00Z" } } : p));
      return null;
    },
  };
  return <PlannerHome me={meCtl} household={hh} bills={[bill()]} accounts={[account()]} subscriptions={[sub()]} todayISO={TODAY} />;
}

function setup(over: { me?: FinancialProfile; partner?: PartnerRecord | null; hState?: PlannerLoadState } = {}) {
  const spies: Spies = { meSaves: [], partnerSaves: [], added: [], renamed: [], removed: [] };
  render(
    <LanguageProvider>
      <Harness me={over.me ?? myProfile()} partner={over.partner ?? null} hState={over.hState} spies={spies} />
    </LanguageProvider>
  );
  return spies;
}

const alex = (profile: Partial<FinancialProfile> = {}): PartnerRecord => ({ id: "m1", name: "Alex", profile: { ...emptyProfile(), ...profile } });
const tab = (key: string) => screen.getByTestId(`plan-person-${key}`);
const txt = (id: string) => screen.getByTestId(id).textContent;

afterEach(cleanup);

describe("person switcher", () => {
  it("offers Me, Partner and Household, opens on Me, and Me is the unchanged personal planner", () => {
    setup();
    expect(screen.getByRole("tablist", { name: "Whose finances" })).toBeTruthy();
    expect(["me", "partner", "household"].map((k) => tab(k).textContent)).toEqual(["Me", "Partner", "Household"]);
    expect(tab("me").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Financial Planner" })).toBeTruthy();
    expect(txt("plan-income")).toBe("$5,000.00");
    expect(screen.getByTestId("plan-use-bills")).toBeTruthy(); // my records panel is still here
  });

  it("the partner tab is labelled with the partner's name once one exists", () => {
    setup({ partner: alex() });
    expect(tab("partner").textContent).toBe("Alex");
  });

  it("switching tabs shows the right content without changing any data", () => {
    const spies = setup({ partner: alex() });
    fireEvent.click(tab("partner"));
    expect(tab("partner").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Planning for Alex")).toBeTruthy();
    fireEvent.click(tab("household"));
    expect(screen.getByTestId("hh-root")).toBeTruthy();
    fireEvent.click(tab("me"));
    expect(txt("plan-income")).toBe("$5,000.00");
    expect(spies.meSaves).toEqual([]);
    expect(spies.partnerSaves).toEqual([]);
  });
});

describe("partner: empty state, add, rename, remove", () => {
  it("with no partner it explains what a partner is and offers to add one", () => {
    setup();
    fireEvent.click(tab("partner"));
    const empty = screen.getByTestId("plan-partner-empty");
    expect(empty.textContent).toContain("No partner added yet");
    expect(empty.textContent).toContain("They don’t need a StandUp account");
    expect(empty.textContent).toContain("Your Bills, Payments and Subscriptions stay under your own profile");
    expect(within(empty).getByRole("button", { name: "Add partner" })).toBeTruthy();
    expect(screen.queryByTestId("plan-income")).toBeNull(); // no fabricated partner figures
  });

  it("adds a partner by name; a blank name uses 'Partner'", async () => {
    const spies = setup();
    fireEvent.click(tab("partner"));
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "  Jordan " } });
    fireEvent.click(screen.getByTestId("plan-partner-add"));
    await waitFor(() => expect(spies.added).toEqual(["Jordan"]));
    expect(await screen.findByText("Planning for Jordan")).toBeTruthy();
    cleanup();
    const s2 = setup();
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-partner-add"));
    await waitFor(() => expect(s2.added).toEqual(["Partner"]));
  });

  it("rejects a name that is too long without adding anything", () => {
    const spies = setup();
    fireEvent.click(tab("partner"));
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "x".repeat(61) } });
    fireEvent.click(screen.getByTestId("plan-partner-add"));
    expect(screen.getByText("Use 60 characters or fewer.")).toBeTruthy();
    expect(spies.added).toEqual([]);
  });

  it("renames the partner", async () => {
    const spies = setup({ partner: alex() });
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-partner-rename"));
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "Alexis" } });
    fireEvent.click(screen.getByTestId("plan-partner-rename-save"));
    await waitFor(() => expect(spies.renamed).toEqual(["Alexis"]));
    expect(await screen.findByText("Planning for Alexis")).toBeTruthy();
    expect(tab("partner").textContent).toBe("Alexis");
  });

  it("removing asks first, says exactly what is deleted and what is not, and only then removes", async () => {
    const spies = setup({ partner: alex({ payFrequency: "monthly", takeHome: 2000 }) });
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-partner-remove"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Remove Alex?");
    expect(dialog.textContent).toContain("income, expenses, debts, savings, goals and setup progress");
    expect(dialog.textContent).toContain("Your own profile and your Bills, Payments and Subscriptions are not affected");
    expect(spies.removed).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(spies.removed).toHaveLength(0);
    fireEvent.click(screen.getByTestId("plan-partner-remove"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove partner" }));
    await waitFor(() => expect(spies.removed).toHaveLength(1));
    expect(await screen.findByTestId("plan-partner-empty")).toBeTruthy();
    expect(spies.meSaves).toEqual([]); // my profile was never touched
  });
});

describe("partner profile: separate data, progress and wizard", () => {
  it("shows the partner's own figures, not mine, and none of my records", () => {
    setup({ partner: alex({ payFrequency: "weekly", takeHome: 600, incomeBasis: "actual", noDebts: true, expenses: { housing: { amount: 1000, basis: "actual" } } }) });
    fireEvent.click(tab("partner"));
    expect(txt("plan-income")).toBe("$2,600.00"); // 600 weekly = 600 * 52 / 12
    expect(txt("plan-expenses")).toBe("$1,000.00");
    expect(screen.queryByTestId("plan-subscriptions")).toBeNull();
    expect(screen.queryByTestId("plan-use-bills")).toBeNull();
    expect(screen.getByTestId("plan-partner-records-note").textContent).toContain("managed under Me and aren’t part of Alex’s plan yet");
    expect(screen.queryByTestId("plan-overlap")).toBeNull();
  });

  it("a new partner starts with their own empty progress (0%), whatever my progress is", () => {
    setup({ partner: alex(), me: myProfile() });
    expect(txt("plan-completion")).toBe("80%"); // me: four of five steps are complete
    fireEvent.click(tab("partner"));
    expect(txt("plan-completion")).toBe("0%");
    expect(txt("plan-income")).toBe("—");
    expect(screen.queryByText("Based on incomplete data")).toBeNull();
  });

  it("the partner reuses the same five-step wizard and saves to the PARTNER only", async () => {
    const spies = setup({ partner: alex() });
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-cta"));
    expect(screen.getByTestId("plan-step-1")).toBeTruthy();
    expect(screen.getByText("Step 1 of 5")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/How often are you paid/), { target: { value: "biweekly" } });
    fireEvent.change(screen.getByLabelText("Take-home per paycheck"), { target: { value: "1800" } });
    fireEvent.change(screen.getByLabelText("Income type"), { target: { value: "actual" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(spies.partnerSaves).toHaveLength(1));
    expect(spies.partnerSaves[0]).toMatchObject({ payFrequency: "biweekly", takeHome: 1800, incomeBasis: "actual", currentStep: 2 });
    expect(spies.meSaves).toEqual([]);
  });

  it("the partner's location step has no household-size questions and saves only location", async () => {
    const spies = setup({ partner: alex({ payFrequency: "monthly", takeHome: 1 }) });
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-nav-profile"));
    fireEvent.click(screen.getByRole("button", { name: /Start Location/ }));
    expect(screen.queryByLabelText("Adults in household")).toBeNull();
    expect(screen.queryByLabelText("Dependents")).toBeNull();
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(spies.partnerSaves).toHaveLength(1));
    expect(spies.partnerSaves[0]).toMatchObject({ country: "US", region: null });
    expect(spies.partnerSaves[0]).not.toHaveProperty("adults");
    expect(spies.partnerSaves[0]).not.toHaveProperty("dependents");
  });

  it("Skip for now works for the partner and is recorded on the partner only", async () => {
    const spies = setup({ partner: alex() });
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-cta"));
    fireEvent.click(screen.getByTestId("plan-skip"));
    await waitFor(() => expect(spies.partnerSaves).toEqual([{ skippedSteps: [1], currentStep: 2 }]));
    expect(spies.meSaves).toEqual([]);
  });

  it("debts for a partner can't be linked to my Payments accounts", () => {
    setup({ partner: alex() });
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-nav-profile"));
    fireEvent.click(screen.getByRole("button", { name: /Start Debts/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add debt" }));
    expect(screen.queryByLabelText("Already tracked in Payments?")).toBeNull();
  });

  it("my own saves never change the partner, and the partner's never change mine", async () => {
    const spies = setup({ partner: alex({ payFrequency: "monthly", takeHome: 2000 }) });
    fireEvent.click(screen.getByTestId("plan-use-bills")); // a save on ME
    await waitFor(() => expect(spies.meSaves).toEqual([{ useBills: true }]));
    fireEvent.click(tab("partner"));
    expect(txt("plan-income")).toBe("$2,000.00");
    expect(spies.partnerSaves).toEqual([]);
  });

  it("each person keeps their own step progress when switching back and forth", () => {
    setup({ partner: alex({ payFrequency: "monthly", takeHome: 1500, expenses: { housing: { amount: 1, basis: "actual" } } }) });
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-nav-profile"));
    expect(within(screen.getByTestId("plan-step-row-1")).getByText("Complete")).toBeTruthy();
    expect(within(screen.getByTestId("plan-step-row-3")).getByText("In progress")).toBeTruthy();
    fireEvent.click(tab("me"));
    fireEvent.click(screen.getByTestId("plan-nav-profile"));
    expect(within(screen.getByTestId("plan-step-row-3")).getByText("Complete")).toBeTruthy();
  });
});

describe("step 2 is named for what each person is asked", () => {
  const name2 = () => within(screen.getByTestId("plan-step-row-2")).getByText(/Location/).textContent;

  it("Me keeps 'Location & household'; the partner's step is just 'Location'", () => {
    setup({ partner: alex() });
    fireEvent.click(screen.getByTestId("plan-nav-profile"));
    expect(name2()).toBe("Location & household");
    fireEvent.click(screen.getByRole("button", { name: "Edit Location & household" })); // my step is already complete
    expect(within(screen.getByTestId("plan-step-2")).getByRole("heading", { name: "Location & household" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to overview" }));
    fireEvent.click(tab("partner"));
    fireEvent.click(screen.getByTestId("plan-nav-profile"));
    expect(name2()).toBe("Location");
    expect(screen.getByRole("button", { name: "Start Location" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Location & household/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start Location" }));
    expect(within(screen.getByTestId("plan-step-2")).getByRole("heading", { name: "Location" })).toBeTruthy();
  });

  it("the same in Spanish: Me 'Ubicación y hogar', partner 'Ubicación'", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      setup({ partner: alex() });
      await waitFor(() => expect(tab("me").textContent).toBe("Yo"));
      fireEvent.click(screen.getByTestId("plan-nav-profile"));
      expect(screen.getByRole("button", { name: /Ubicación y hogar/ })).toBeTruthy();
      fireEvent.click(tab("partner"));
      fireEvent.click(screen.getByTestId("plan-nav-profile"));
      expect(screen.getByRole("button", { name: /Empezar Ubicación$/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Ubicación y hogar/ })).toBeNull();
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

describe("household tab: the Household Overview replaces the placeholder", () => {
  it("opens the overview with its own Overview | Shared | Plan navigation, and no placeholder text", async () => {
    setup({ partner: alex({ payFrequency: "monthly", takeHome: 2000 }) });
    fireEvent.click(tab("household"));
    expect(screen.queryByTestId("plan-household-soon")).toBeNull();
    expect(screen.getByTestId("hh-title").textContent).toBe("Household overview");
    expect(["overview", "shared", "plan"].map((k) => screen.getByTestId(`hh-nav-${k}`).textContent)).toEqual(["Overview", "Shared", "Plan"]);
    expect(await screen.findByTestId("hh-income")).toBeTruthy();
    // the Me planner's own figures are not on this screen
    expect(screen.queryByTestId("plan-income")).toBeNull();
    expect(screen.queryByTestId("plan-available")).toBeNull();
  });
  it("without a partner it covers Me only and offers to add one (which opens the Partner tab)", async () => {
    setup();
    fireEvent.click(tab("household"));
    expect(screen.getByTestId("hh-no-partner").textContent).toContain("No partner added yet");
    fireEvent.click(screen.getByTestId("hh-add-partner"));
    expect(tab("partner").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("plan-partner-empty")).toBeTruthy();
  });
  it("opening the overview never saves anything on the Me or Partner side", async () => {
    const spies = setup({ partner: alex({ payFrequency: "monthly", takeHome: 2000 }) });
    fireEvent.click(tab("household"));
    await screen.findByTestId("hh-income");
    fireEvent.click(screen.getByTestId("hh-nav-shared"));
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    expect(spies.meSaves).toEqual([]);
    expect(spies.partnerSaves).toEqual([]);
  });
});

describe("backward compatibility and availability", () => {
  it("household tables not applied: Partner and Household explain it, and Me works exactly as before", async () => {
    const spies = setup({ hState: "unavailable" });
    fireEvent.click(tab("partner"));
    expect(screen.getByTestId("plan-partner-unavailable").textContent).toContain("database update");
    expect(screen.queryByTestId("plan-partner-add")).toBeNull();
    fireEvent.click(tab("household"));
    expect(screen.getByTestId("hh-partner-unavailable").textContent).toContain("database update");
    fireEvent.click(tab("me"));
    expect(txt("plan-income")).toBe("$5,000.00");
    fireEvent.click(screen.getByTestId("plan-use-accounts"));
    await waitFor(() => expect(spies.meSaves).toEqual([{ useAccounts: true }]));
  });
  it("loading shows a loading message in the Partner tab only", () => {
    setup({ hState: "loading" });
    expect(txt("plan-income")).toBe("$5,000.00");
    fireEvent.click(tab("partner"));
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
  it("a personal profile with no household at all behaves exactly like the original planner (same figures)", () => {
    setup({ me: myProfile({ useBills: true }) });
    expect(txt("plan-obligations")).toBe("$1,200.00");
    expect(txt("plan-available")).toBe("$2,985.00"); // 5000 - 1200 bills - 800 living - 15 subscription
  });
});

describe("Spanish and layout", () => {
  it("the switcher and the partner empty state render in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      setup();
      await waitFor(() => expect(tab("me").textContent).toBe("Yo"));
      expect(tab("partner").textContent).toBe("Pareja");
      expect(tab("household").textContent).toBe("Hogar");
      fireEvent.click(tab("partner"));
      expect(screen.getByText("Aún no has agregado a tu pareja")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Agregar pareja" })).toBeTruthy();
      fireEvent.click(tab("household"));
      expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar");
      expect(screen.getByTestId("hh-nav-overview").textContent).toBe("Resumen");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });

  it("the switcher is a three-column grid of 44px+ buttons that truncate instead of overflowing", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const block = (sel: string) => css.slice(css.indexOf(sel)).split("}")[0];
    expect(block(".plan-root .plan-people {")).toContain("repeat(3, minmax(0, 1fr))");
    const btn = block(".plan-root .plan-people-btn {");
    expect(btn).toContain("min-height: 44px");
    expect(btn).toContain("text-overflow: ellipsis");
    expect(btn).toContain("min-width: 0");
  });
});

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
// The Household tab loads the household's shared data and the partner's include flag; here: an empty, healthy household.
vi.mock("@/lib/supabase/householdShared", () => ({
  getHouseholdShared: async () => ({
    status: "ready", householdId: null, revision: 0,
    shared: { expenses: [], noSharedExpenses: false, debts: [], noSharedDebts: false, goals: [] },
    composition: { adults: null, children: null, otherMembers: null },
    droppedItems: 0, integrity: { ok: true, issues: [], fingerprint: "x" }, stored: {},
  }),
  getPartnerIncluded: async () => true,
  setPartnerIncluded: async (_id: string, v: boolean) => v,
}));

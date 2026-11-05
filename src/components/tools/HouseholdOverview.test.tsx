import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { EXPENSE_CATEGORIES, emptyProfile, type FinancialProfile } from "@/lib/financialPlanner";
import { emptyComposition, emptyShared, type SharedExpense, type SharedHousehold } from "@/lib/householdPlan";
import type { PartnerRecord } from "@/lib/supabase/household";
import HouseholdOverview from "./HouseholdOverview";
import type { FinancialProfileController, PlannerLoadState } from "./useFinancialProfile";
import type { HouseholdController } from "./useHousehold";

const TODAY = "2026-11-04";
const NONE = { me: null, partner: null };

const h = vi.hoisted(() => ({
  shared: null as unknown,
  included: true as boolean | null,
  loadError: null as Error | null,
  setIncludedImpl: null as null | ((id: string, v: boolean) => Promise<boolean>),
  calls: [] as string[],
}));

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/householdShared", () => ({
  getHouseholdShared: async () => {
    h.calls.push("get");
    if (h.loadError) throw h.loadError;
    return h.shared;
  },
  getPartnerIncluded: async () => h.included,
  setPartnerIncluded: async (id: string, v: boolean) => {
    h.calls.push(`include:${id}:${v}`);
    if (h.setIncludedImpl) return h.setIncludedImpl(id, v);
    h.included = v;
    return v;
  },
  // The Overview must never save shared data. If it ever tries, the test below fails.
  saveHouseholdShared: async () => {
    h.calls.push("SAVE");
    throw new Error("the Overview must not save shared data");
  },
}));

const complete = (takeHome: number | null, perCategory: number, over: Partial<FinancialProfile> = {}): FinancialProfile => ({
  ...emptyProfile(),
  payFrequency: takeHome === null ? null : "monthly",
  takeHome,
  incomeBasis: "actual",
  noDebts: true,
  useSubscriptions: true,
  expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: perCategory, basis: "actual" as const }])),
  ...over,
});
const expense = (over: Partial<SharedExpense> = {}): SharedExpense => ({ id: "e1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const sharedOf = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), noSharedExpenses: true, noSharedDebts: true, ...over });
const ready = (shared: SharedHousehold = sharedOf(), extra: Record<string, unknown> = {}) => ({
  status: "ready", householdId: "h1", revision: 1, shared, composition: emptyComposition(), droppedItems: 0,
  integrity: { ok: true, issues: [], fingerprint: "ok" }, stored: { revision: 1 }, ...extra,
});
const alex = (profile: FinancialProfile = complete(3000, 50)): PartnerRecord => ({ id: "m1", name: "Alex", profile });

function mount(opts: { me?: FinancialProfile; partner?: PartnerRecord | null; meState?: PlannerLoadState; hState?: PlannerLoadState; onAdd?: () => void } = {}) {
  const me: FinancialProfileController = { state: opts.meState ?? "ready", loadError: null, profile: opts.me ?? complete(5000, 100), save: async () => null };
  const household: HouseholdController = {
    state: opts.hState ?? "ready", loadError: null, partner: opts.partner === undefined ? alex() : opts.partner,
    addPartner: async () => null, renamePartner: async () => null, removePartner: async () => null, savePartner: async () => null,
  };
  return render(
    <LanguageProvider>
      <div className="plan-root">
        <HouseholdOverview me={me} household={household} bills={[]} accounts={[]} subscriptions={[]} todayISO={TODAY} onAddPartner={opts.onAdd ?? (() => {})} />
      </div>
    </LanguageProvider>
  );
}
const txt = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  h.shared = ready();
  h.included = true;
  h.loadError = null;
  h.setIncludedImpl = null;
  h.calls = [];
});
afterEach(cleanup);

describe("Household Overview: loading, content and heading", () => {
  it("shows the Me + Partner heading and the four summary figures", async () => {
    mount();
    expect(txt("hh-heading")).toBe("Me + Alex");
    await screen.findByTestId("hh-income");
    expect(txt("hh-income")).toBe("$8,000.00");
    expect(txt("hh-spending")).toBe("$1,200.00");
    expect(txt("hh-shared-total")).toBe("$0.00"); // the household said there are none: a real zero
    expect(txt("hh-available")).toBe("$6,800.00");
    expect(screen.getByTestId("hh-available").getAttribute("data-kind")).toBe("definitive");
    expect(screen.queryByTestId("hh-available-provisional")).toBeNull();
  });

  it("shows a loading message first", () => {
    mount();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("covers Me only when there is no partner, and offers to add one", async () => {
    const onAdd = vi.fn();
    mount({ partner: null, onAdd });
    await screen.findByTestId("hh-income");
    expect(txt("hh-heading")).toBe("Me");
    expect(txt("hh-income")).toBe("$5,000.00");
    expect(screen.queryByTestId("hh-include-toggle")).toBeNull();
    fireEvent.click(screen.getByTestId("hh-add-partner"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("explains an unavailable Me or Partner table instead of showing figures", () => {
    mount({ hState: "unavailable" });
    expect(screen.getByTestId("hh-partner-unavailable").textContent).toContain("database update");
    cleanup();
    mount({ meState: "unavailable" });
    expect(screen.getByTestId("hh-me-unavailable")).toBeTruthy();
  });
});

describe("unknown is never $0; partial is labelled; provisional is labelled", () => {
  it("income not entered: a dash and 'Not entered yet', available cash cannot be worked out", async () => {
    mount({ me: complete(null, 100), partner: null });
    await screen.findByTestId("hh-income");
    expect(txt("hh-income")).toBe("—");
    expect(screen.getByTestId("hh-income").getAttribute("data-kind")).toBe("unknown");
    expect(txt("hh-available")).toBe("—");
    expect(screen.getByTestId("hh-available").getAttribute("data-kind")).toBe("unknown");
    expect(screen.getByTestId("hh-available-card").textContent).toContain("Add the missing income");
    expect(screen.getByTestId("hh-root").textContent).not.toMatch(/\$0\.00.*Household income/);
  });

  it("the partner's income missing: household income says 'At least' and the warning names the partner", async () => {
    mount({ partner: alex(complete(null, 50)) });
    await screen.findByTestId("hh-income");
    expect(screen.getByTestId("hh-income").getAttribute("data-kind")).toBe("atLeast");
    expect(txt("hh-income")).toBe("$5,000.00");
    expect(screen.getByTestId("hh-root").textContent).toContain("At least");
    expect(txt("hh-warnings")).toContain("Alex's income hasn't been entered.");
    expect(screen.getByTestId("hh-available").getAttribute("data-kind")).not.toBe("definitive");
  });

  it("provisional available cash carries a Provisional label, a note and every assumption", async () => {
    h.shared = ready(sharedOf({ expenses: [expense({ contributions: { me: null, partner: 1000 } })] }));
    mount({ partner: alex() });
    await screen.findByTestId("hh-income");
    fireEvent.click(screen.getByTestId("hh-include-toggle")); // leave Alex out: the unassigned remainder could be theirs
    await waitFor(() => expect(screen.getByTestId("hh-available-provisional")).toBeTruthy());
    expect(screen.getByTestId("hh-available").getAttribute("data-kind")).toBe("provisional");
    expect(txt("hh-available-provisional")).toBe("Provisional");
    expect(txt("hh-assumptions")).toContain("Costs nobody is assigned to are counted against the household's income.");
    expect(txt("hh-available-card")).toContain("Provisional — not guaranteed savings");
    expect(txt("hh-available-card")).toContain("not money you can count on saving");
  });
});

describe("partner inclusion", () => {
  it("is on by default, explains itself, and toggling saves that one flag and recomputes the totals", async () => {
    mount();
    await screen.findByTestId("hh-income");
    const box = screen.getByTestId("hh-include-toggle") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(txt("hh-include")).toContain("Include Alex in household totals");
    expect(txt("hh-include")).toContain("Shared costs Alex covers stay in the household total");
    fireEvent.click(box);
    await waitFor(() => expect(txt("hh-income")).toBe("$5,000.00"));
    expect(h.calls).toContain("include:m1:false");
    expect(txt("hh-heading")).toBe("Me + Alex (excluded)");
    expect(txt("hh-spending")).toBe("$800.00");
    fireEvent.click(box);
    await waitFor(() => expect(txt("hh-income")).toBe("$8,000.00"));
    expect(h.calls).toContain("include:m1:true");
  });

  it("a stored 'excluded' setting is respected on load", async () => {
    h.included = false;
    mount();
    await screen.findByTestId("hh-income");
    expect((screen.getByTestId("hh-include-toggle") as HTMLInputElement).checked).toBe(false);
    expect(txt("hh-income")).toBe("$5,000.00");
  });

  it("if the switch cannot be saved, the setting and totals stay as they were and an error is shown", async () => {
    h.setIncludedImpl = async () => {
      throw new Error("network");
    };
    mount();
    await screen.findByTestId("hh-income");
    fireEvent.click(screen.getByTestId("hh-include-toggle"));
    await screen.findByTestId("hh-include-error");
    expect((screen.getByTestId("hh-include-toggle") as HTMLInputElement).checked).toBe(true);
    expect(txt("hh-income")).toBe("$8,000.00");
  });

  it("the switch is disabled while saving", async () => {
    let release: (v: boolean) => void = () => {};
    h.setIncludedImpl = () => new Promise<boolean>((r) => (release = r));
    mount();
    await screen.findByTestId("hh-income");
    fireEvent.click(screen.getByTestId("hh-include-toggle"));
    await waitFor(() => expect((screen.getByTestId("hh-include-toggle") as HTMLInputElement).disabled).toBe(true));
    expect(txt("hh-include")).toContain("Saving…");
    release(false);
    await waitFor(() => expect((screen.getByTestId("hh-include-toggle") as HTMLInputElement).disabled).toBe(false));
  });
});

describe("responsibility, unassigned amounts and informational contributions", () => {
  it("shows per-person responsibility as assigned (not paid), the unassigned amount, and never a 50/50 split", async () => {
    h.shared = ready(sharedOf({ expenses: [expense({ contributions: { me: 800, partner: null } })] }));
    mount();
    await screen.findByTestId("hh-income");
    const resp = txt("hh-responsibility")!;
    expect(resp).toContain("Assigned responsibility is what each person said they cover");
    expect(resp).toContain("not a record of what has been paid");
    expect(resp).toContain("nothing is split evenly");
    expect(txt("hh-resp-me-value")).toBe("$1,600.00"); // 800 own + 800 toward rent
    expect(txt("hh-resp-partner-value")).toBe("$400.00"); // Alex's own costs only
    expect(txt("hh-unassigned-value")).toBe("$1,000.00"); // 1,800 - 800, assigned to nobody
    expect(txt("hh-unassigned")).toContain("not assigned to anyone");
  });

  it("with no shared items there is nothing to assign and no zero is invented", async () => {
    mount();
    await screen.findByTestId("hh-income");
    expect(txt("hh-unassigned-value")).toBe("—");
    expect(txt("hh-unassigned")).toContain("No shared costs to assign yet.");
  });

  it("an excluded partner is a separate row and unassigned stays unassigned (not Me's)", async () => {
    h.included = false;
    h.shared = ready(sharedOf({ expenses: [expense({ contributions: { me: null, partner: 1000 } })] }));
    mount();
    await screen.findByTestId("hh-income");
    expect(txt("hh-resp-excludedPartner")).toContain("Alex (excluded)");
    expect(txt("hh-resp-excludedPartner-value")).toBe("$1,000.00");
    expect(txt("hh-resp-me-value")).toBe("$800.00"); // only Me's own costs
    expect(txt("hh-unassigned-value")).toBe("$800.00");
    expect(txt("hh-warnings")).toContain("is not assigned while Alex is excluded");
  });

  it("contributions on a Finances-linked cost are listed for information and are not in any total", async () => {
    const meBills = complete(5000, 100, { useBills: true });
    const bill = { id: "b1", name: "Rent", amountType: "fixed", expectedAmount: 1800, recurrence: "monthly", firstDueDate: "2026-01-01", remindDaysBefore: 3, category: "Rent / Mortgage", notes: null, archivedAt: null, createdAt: "2026-01-01T00:00:00Z" };
    h.shared = ready(sharedOf({ expenses: [expense({ contributions: { me: 900, partner: 900 }, links: [{ kind: "bill", id: "b1" }] })] }));
    const me: FinancialProfileController = { state: "ready", loadError: null, profile: meBills, save: async () => null };
    const household: HouseholdController = { state: "ready", loadError: null, partner: alex(), addPartner: async () => null, renamePartner: async () => null, removePartner: async () => null, savePartner: async () => null };
    render(
      <LanguageProvider>
        <div className="plan-root">
          <HouseholdOverview me={me} household={household} bills={[bill as never]} accounts={[]} subscriptions={[]} todayISO={TODAY} onAddPartner={() => {}} />
        </div>
      </LanguageProvider>
    );
    await screen.findByTestId("hh-income");
    const info = txt("hh-informational")!;
    expect(info).toContain("not added to any total");
    expect(info).toContain("Rent: Me $900.00, Alex $900.00");
    expect(txt("hh-unassigned-value")).toBe("—"); // the linked cost is counted once, by the Bill, not as an unassigned shared cost
  });
});

describe("data completeness and duplicate warnings", () => {
  it("shared costs not answered yet are flagged and the shared figure is a dash", async () => {
    h.shared = ready(emptyShared());
    mount();
    await screen.findByTestId("hh-income");
    expect(txt("hh-shared-total")).toBe("—");
    expect(txt("hh-warnings")).toContain("Shared costs haven't been answered yet.");
    expect(txt("hh-warnings")).toContain("Joint debts haven't been answered yet.");
  });

  it("everything answered and complete: 'Nothing is missing.'", async () => {
    mount();
    await screen.findByTestId("hh-income");
    expect(txt("hh-warnings-none")).toBe("Nothing is missing.");
    expect(screen.queryByTestId("hh-duplicates")).toBeNull();
  });

  it("a shared cost that looks like a subscription is warned about by name, with the cost still counted", async () => {
    h.shared = ready(sharedOf({ expenses: [expense({ id: "n", category: "other", label: "Netflix", amount: 15 })] }));
    const me: FinancialProfileController = { state: "ready", loadError: null, profile: complete(5000, 100), save: async () => null };
    const household: HouseholdController = { state: "ready", loadError: null, partner: alex(), addPartner: async () => null, renamePartner: async () => null, removePartner: async () => null, savePartner: async () => null };
    const sub = { id: "s1", name: "Netflix", provider: null, category: null, planName: null, amount: 15, currency: "USD", frequency: "monthly", customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null, remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "x", updatedAt: "x" };
    render(
      <LanguageProvider>
        <div className="plan-root">
          <HouseholdOverview me={me} household={household} bills={[]} accounts={[]} subscriptions={[sub as never]} todayISO={TODAY} onAddPartner={() => {}} />
        </div>
      </LanguageProvider>
    );
    await screen.findByTestId("hh-income");
    expect(txt("hh-duplicates")).toContain('"Netflix" may match your subscription Netflix.');
    expect(txt("hh-duplicates")).toContain("Nothing was removed");
    expect(txt("hh-shared-total")).toBe("$15.00");
  });
});

describe("missing-schema fallback", () => {
  it("shared columns not available: a clear note, and the overview still works without inventing shared figures", async () => {
    h.shared = { status: "unavailable" };
    mount();
    await screen.findByTestId("hh-shared-unavailable");
    expect(txt("hh-shared-unavailable")).toContain("database update");
    expect(txt("hh-income")).toBe("$8,000.00");
    expect(txt("hh-shared-total")).toBe("—");
    expect(screen.getByTestId("hh-available").getAttribute("data-kind")).not.toBe("definitive");
  });

  it("a load failure shows a retry that reloads", async () => {
    h.loadError = new Error("boom");
    mount();
    await screen.findByTestId("hh-load-error");
    expect(txt("hh-load-error")).toContain("boom");
    h.loadError = null;
    fireEvent.click(screen.getByTestId("hh-retry"));
    await screen.findByTestId("hh-income");
    expect(txt("hh-income")).toBe("$8,000.00");
  });
});

describe("stored-data integrity problems", () => {
  const broken = () =>
    ready(sharedOf({ expenses: [expense()] }), {
      droppedItems: 2,
      integrity: { ok: false, issues: [{ code: "malformedItem", list: "expenses", index: 1 }, { code: "duplicateId", list: "expenses", index: 2, ref: "e1" }], fingerprint: "abc" },
      stored: { shared_expenses: [{ id: "e1" }, "junk", { id: "e1" }], revision: 5 },
    });

  it("shows a clear warning, marks cash provisional and totals as incomplete, and never offers a save", async () => {
    h.shared = broken();
    mount();
    await screen.findByTestId("hh-integrity");
    expect(screen.getByTestId("hh-integrity").getAttribute("role")).toBe("alert");
    expect(txt("hh-integrity-body")).toContain("2 saved entries can't be shown");
    expect(txt("hh-integrity-body")).toContain("Nothing has been changed or removed");
    expect(txt("hh-integrity-body")).toContain("Saving stays off");
    expect(screen.getByTestId("hh-available").getAttribute("data-kind")).toBe("provisional");
    expect(txt("hh-assumptions")).toContain("Some saved household data could not be read.");
    expect(screen.getByTestId("hh-shared-total").getAttribute("data-kind")).toBe("atLeast");
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(h.calls).not.toContain("SAVE");
  });

  it("lets the user download the ORIGINAL stored JSON, unchanged, and reports success", async () => {
    h.shared = broken();
    const created: Blob[] = [];
    const urlSpy = vi.fn((b: Blob) => (created.push(b), "blob:test"));
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: urlSpy, revokeObjectURL: revoke });
    const clicks: { download: string; href: string }[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    };
    try {
      mount();
      await screen.findByTestId("hh-export");
      fireEvent.click(screen.getByTestId("hh-export"));
      await screen.findByTestId("hh-export-done");
      expect(clicks).toEqual([{ download: "standup-household-original-data.json", href: "blob:test" }]);
      const text = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsText(created[0]);
      });
      const parsed = JSON.parse(text);
      expect(parsed.stored).toEqual({ shared_expenses: [{ id: "e1" }, "junk", { id: "e1" }], revision: 5 });
      expect(parsed.fingerprint).toBe("abc");
      expect(text).not.toMatch(/token|password|email|owner_id/i);
      expect(h.calls).not.toContain("SAVE");
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
  });

  it("an export failure is reported, not swallowed", async () => {
    h.shared = broken();
    Object.assign(URL, { createObjectURL: () => { throw new Error("no"); }, revokeObjectURL: () => {} });
    mount();
    await screen.findByTestId("hh-export");
    fireEvent.click(screen.getByTestId("hh-export"));
    await screen.findByTestId("hh-export-failed");
  });

  it("healthy data shows no integrity warning and no export button", async () => {
    mount();
    await screen.findByTestId("hh-income");
    expect(screen.queryByTestId("hh-integrity")).toBeNull();
    expect(screen.queryByTestId("hh-export")).toBeNull();
  });
});

describe("inner navigation: Overview | Shared | Plan", () => {
  it("Shared opens the shared-expenses editor; Plan opens the household plan dashboard", async () => {
    mount();
    await screen.findByTestId("hh-income");
    expect(["overview", "shared", "plan"].map((k) => txt(`hh-nav-${k}`))).toEqual(["Overview", "Shared", "Plan"]);
    expect(screen.getByTestId("hh-nav-overview").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("hh-nav-shared"));
    expect(await screen.findByTestId("se-root")).toBeTruthy();
    expect(screen.queryByTestId("hh-shared-soon")).toBeNull();
    expect(screen.queryByTestId("hh-income")).toBeNull();
    fireEvent.click(screen.getByTestId("hh-nav-plan"));
    expect(await screen.findByTestId("hp-root")).toBeTruthy(); // the Plan tab is the household plan dashboard
    expect(screen.queryByTestId("hh-plan-soon")).toBeNull();
    fireEvent.click(screen.getByTestId("hh-nav-overview"));
    expect(txt("hh-income")).toBe("$8,000.00");
  });
});

describe("the Overview never writes shared data", () => {
  it("across load, toggling, navigation and export, the only write is the include flag", async () => {
    mount();
    await screen.findByTestId("hh-income");
    fireEvent.click(screen.getByTestId("hh-include-toggle"));
    await waitFor(() => expect(h.calls.some((c) => c.startsWith("include:"))).toBe(true));
    fireEvent.click(screen.getByTestId("hh-nav-shared"));
    fireEvent.click(screen.getByTestId("hh-nav-overview"));
    expect(h.calls.filter((c) => c === "SAVE")).toEqual([]);
    expect(h.calls.filter((c) => c.startsWith("include:"))).toEqual(["include:m1:false"]);
  });
});

describe("Spanish", () => {
  it("renders the overview, warnings and provisional labels in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      h.shared = ready(sharedOf({ expenses: [expense()] }));
      mount({ partner: alex(complete(null, 50)) });
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await screen.findByTestId("hh-income");
      expect(txt("hh-heading")).toBe("Yo + Alex");
      expect(txt("hh-include")).toContain("Incluir a Alex en los totales del hogar");
      expect(txt("hh-warnings")).toContain("No se han ingresado los ingresos de Alex.");
      expect(txt("hh-responsibility")).toContain("Quién cubre qué");
      expect(txt("hh-responsibility")).toContain("Sin asignar");
      expect(screen.getByTestId("hh-root").textContent).toContain("Al menos");
      expect(["overview", "shared", "plan"].map((k) => txt(`hh-nav-${k}`))).toEqual(["Resumen", "Compartido", "Plan"]);
      fireEvent.click(screen.getByTestId("hh-nav-plan"));
      expect(await screen.findByTestId("hp-root")).toBeTruthy();
      expect(txt("hp-root")).toContain("Plan del hogar");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

describe("layout rules in the stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const block = (sel: string) => css.slice(css.lastIndexOf(sel)).split("}")[0];

  it("amounts never wrap and long text breaks instead of overflowing", () => {
    expect(block(".plan-root .hh-val .hh-num {")).toContain("white-space: nowrap");
    expect(block(".plan-root .hh-list,")).toContain("overflow-wrap: anywhere");
    expect(block(".plan-root .hh-alert .plan-btn {")).toContain("white-space: normal");
  });
  it("reuses the planner's tokens (metallic dark and light) rather than new colours", () => {
    const own = css.slice(css.indexOf("Tools > Planner > Household overview (Phase 2, Step 3)"));
    expect(own).toContain("var(--plan-muted)");
    expect(own).toContain('[data-theme="light"] .plan-root');
    expect(own).not.toMatch(/background:\s*#/);
  });
  it("the inner navigation is the planner's equal-column 44px segmented control (three sections, four with the Partner)", () => {
    expect(block(".plan-root .plan-seg {")).toContain("grid-auto-columns: minmax(0, 1fr)");
    expect(block(".plan-root .plan-seg-btn {")).toContain("min-height: 44px");
  });
});

describe("partly assigned shared costs show the remainder, never as paid or funded", () => {
  it("lists each partly assigned cost with what is assigned, the total and the unassigned remainder", async () => {
    h.shared = ready(sharedOf({ expenses: [expense({ contributions: { me: 800, partner: 100 } })] }));
    mount();
    await screen.findByTestId("hh-income");
    const block = txt("hh-partial")!;
    expect(block).toContain("Partly assigned shared costs");
    expect(txt("hh-partial-e1")).toBe("Rent: $900.00 of $1,800.00 assigned. $900.00 not yet assigned.");
    expect(block).toContain("not what has been paid");
    expect(block).toContain("not assigned to anyone");
    expect(txt("hh-unassigned-value")).toBe("$900.00"); // the same remainder, in the unassigned row
  });
  it("the wording never calls assigned amounts paid or funded", async () => {
    h.shared = ready(sharedOf({ expenses: [expense({ contributions: { me: 800, partner: null } })] }));
    mount();
    await screen.findByTestId("hh-income");
    const line = txt("hh-partial-e1")!;
    expect(line).not.toMatch(/paid|funded|covered/i);
  });
  it("a fully assigned or fully unassigned cost is not listed as partly assigned", async () => {
    h.shared = ready(sharedOf({ expenses: [expense({ contributions: { me: 800, partner: 1000 } }), expense({ id: "e2", label: "Power", amount: 100 })] }));
    mount();
    await screen.findByTestId("hh-income");
    expect(screen.queryByTestId("hh-partial")).toBeNull();
    expect(txt("hh-unassigned-value")).toBe("$100.00"); // Power: nobody stated
  });
  it("is shown in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      h.shared = ready(sharedOf({ expenses: [expense({ contributions: { me: 800, partner: 100 } })] }));
      mount();
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await screen.findByTestId("hh-partial-e1");
      expect(txt("hh-partial-e1")).toBe("Rent: $900.00 de $1,800.00 asignados. $900.00 sin asignar.");
      expect(txt("hh-partial")).toContain("no lo que se ha pagado");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

describe("household composition when unanswered", () => {
  it("explains that household details can be set up later, and shows a dash (never 0)", async () => {
    mount();
    await screen.findByTestId("hh-income");
    expect(txt("hh-size")).toBe("—");
    expect(screen.getByTestId("hh-size").getAttribute("data-kind")).toBe("unknown");
    const tile = document.querySelector('[data-tile="size"]')!.textContent!;
    expect(tile).toContain("Household details can be set up later");
  });
  it("partly answered: 'at least' with a note that the rest can be added later", async () => {
    h.shared = ready(sharedOf(), { composition: { adults: 2, children: null, otherMembers: null } });
    mount();
    await screen.findByTestId("hh-income");
    expect(screen.getByTestId("hh-size").getAttribute("data-kind")).toBe("atLeast");
    expect(txt("hh-size")).toBe("2");
    expect(document.querySelector('[data-tile="size"]')!.textContent).toContain("You can add them later");
  });
  it("fully answered: the total and its breakdown", async () => {
    h.shared = ready(sharedOf(), { composition: { adults: 2, children: 1, otherMembers: 0 } });
    mount();
    await screen.findByTestId("hh-income");
    expect(txt("hh-size")).toBe("3");
    expect(document.querySelector('[data-tile="size"]')!.textContent).toContain("2 adults, 1 child, 0 others");
  });
  it("Spanish note, and no editor is offered", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      mount();
      await waitFor(() => expect(screen.getByTestId("hh-title").textContent).toBe("Resumen del hogar"));
      await screen.findByTestId("hh-income");
      expect(document.querySelector('[data-tile="size"]')!.textContent).toContain("se pueden configurar más adelante");
      expect(screen.queryByRole("spinbutton")).toBeNull();
      expect(document.querySelector('[data-tile="size"] input, [data-tile="size"] button')).toBeNull();
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

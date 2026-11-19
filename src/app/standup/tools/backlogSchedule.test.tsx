import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { es } from "@/lib/i18n/es";
import type { BacklogGoal } from "@/lib/supabase/db";

// The real Tools page, with its data layer replaced: it exercises the page's own Backlog scheduling wiring (which control moves a Task, when, and how often).
const api = vi.hoisted(() => ({
  getBacklogGoals: vi.fn(),
  updateBacklogGoal: vi.fn(),
  deleteBacklogGoal: vi.fn(),
  promoteBacklogGoal: vi.fn(),
  addBacklogGoal: vi.fn(),
  addLongTermGoal: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/db")>("@/lib/supabase/db");
  return {
    ...actual,
    ...api,
    getRecurringGoalTemplates: vi.fn().mockResolvedValue([]),
    addRecurringGoalTemplate: vi.fn(),
    setRecurringGoalTemplateActive: vi.fn(),
    deleteRecurringGoalTemplate: vi.fn(),
    getLists: vi.fn().mockResolvedValue([]),
    createList: vi.fn(),
    deleteList: vi.fn(),
    getListItemsForLists: vi.fn().mockResolvedValue({}),
    addListItem: vi.fn(),
    deleteListItem: vi.fn(),
    pushListToGoal: vi.fn(),
  };
});
vi.mock("@/lib/supabase/entitlements", () => ({ getMyEntitlement: vi.fn().mockResolvedValue({ tier: "free" }) }));
vi.mock("@/lib/useFeatureFlags", () => ({ useLimitReachedText: () => () => "" }));
vi.mock("@/lib/useFixedSubNav", () => ({
  useFixedSubNav: () => ({ sentinelRef: { current: null }, barRef: { current: null }, wrapperRef: { current: null }, contentRef: { current: null }, barStyle: {}, wrapperStyle: {} }),
}));
vi.mock("@/components/GoalsManagementPanel", () => ({ default: ({ longTermView }: { longTermView: React.ReactNode }) => <div data-testid="goals-panel">{longTermView}</div> }));
vi.mock("@/components/tools/NotesTab", () => ({ default: () => <div /> }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import ToolsPage from "./page";

const TODAY = "2026-11-18";
const TOMORROW = "2026-11-19";
const FUTURE = "2026-11-25";

const item = (over: Partial<BacklogGoal> = {}): BacklogGoal => ({
  id: "b1", user_id: "u1", title: "Call the bank", details: "Ask about the fee", priority: 3, target_date: null, category: null, created_at: "2026-11-01T09:00:00Z", ...over,
});
const longTerm = (): BacklogGoal => item({ id: "l1", title: "Learn Spanish", details: null, priority: 2, target_date: "2027-06-01", category: "Growth" });

function mount(tab: "backlog" | "goals", items: BacklogGoal[]) {
  const store = new Map<string, string>([["standup-tools-active-tab", tab]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  api.getBacklogGoals.mockResolvedValue(items);
  render(
    <LanguageProvider>
      <ToolsPage />
    </LanguageProvider>
  );
}
const card = (title: string) => screen.getByText(title).closest(".goal-row") as HTMLElement;
const dateInput = (c: HTMLElement) => within(c).getByLabelText("Pick a date") as HTMLInputElement;
const scheduleBtn = (c: HTMLElement) => within(c).getByRole("button", { name: "Schedule" }) as HTMLButtonElement;
const tomorrowBtn = (c: HTMLElement) => within(c).getByRole("button", { name: /→ Tomorrow/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Backlog card: compact layout", () => {
  it("the title and its Edit action share one row that does not wrap, and the Remove button is still there", async () => {
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    const edit = within(c).getByRole("button", { name: "Edit Call the bank" });
    const title = within(c).getByText("Call the bank");
    const row = edit.parentElement as HTMLElement;
    expect(row.contains(title)).toBe(true); // same row container
    expect(row.className).toContain("items-start");
    expect(row.className).not.toContain("flex-wrap"); // the Edit action never drops below the title
    expect(within(c).getByTitle("Remove from backlog")).toBeTruthy();
  });

  it("uses tighter spacing: a compact card body and closer cards, with the priority colour untouched", async () => {
    mount("backlog", [item({ priority: 1 })]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    const body = c.querySelector(".goal-row-body") as HTMLElement;
    expect(body.style.padding).toBe("0.85rem 1.6rem 0.85rem 1.25rem");
    expect(c.parentElement?.className).toContain("space-y-3");
    expect(c.style.getPropertyValue("--p-color")).not.toBe(""); // still driven by the item's priority
  });

  it("scheduling controls: Tomorrow, a date picker and one compact Schedule button; the old full-width Push is gone", async () => {
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    expect(tomorrowBtn(c)).toBeTruthy();
    expect(dateInput(c)).toBeTruthy();
    expect(scheduleBtn(c).className).not.toContain("w-full");
    expect(within(c).queryByRole("button", { name: "Push" })).toBeNull();
  });

  it("is built to stay inside narrow screens: controls wrap, the date group may shrink, and nothing has a fixed overflowing width", async () => {
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    const controls = tomorrowBtn(c).parentElement as HTMLElement;
    expect(controls.className).toContain("flex-wrap");
    const group = dateInput(c).parentElement as HTMLElement;
    expect(["0", "0px"]).toContain(group.style.minWidth);
    expect(dateInput(c).className).toContain("min-w-0");
    expect(scheduleBtn(c).className).toContain("flex-shrink-0");
    for (const el of [tomorrowBtn(c), dateInput(c), scheduleBtn(c)]) expect(el.style.width).toBe(""); // no fixed width to overflow with
    expect(tomorrowBtn(c).style.minWidth).toBe(""); // the old 130px minimum is gone
  });
});

describe("Backlog card: scheduling behavior", () => {
  it("Tomorrow is still one click: it promotes that item to tomorrow exactly once and removes it from the list", async () => {
    api.promoteBacklogGoal.mockResolvedValue({ id: "g1" });
    const it1 = item();
    mount("backlog", [it1, item({ id: "b2", title: "Buy stamps" })]);
    await screen.findByText("Call the bank");
    fireEvent.click(tomorrowBtn(card("Call the bank")));
    await waitFor(() => expect(screen.queryByText("Call the bank")).toBeNull());
    expect(api.promoteBacklogGoal).toHaveBeenCalledTimes(1);
    expect(api.promoteBacklogGoal).toHaveBeenCalledWith(it1, TOMORROW);
    expect(screen.getByText("Buy stamps")).toBeTruthy(); // the other item is untouched
    expect(screen.getByText(`"Call the bank" moved to ${TOMORROW}.`)).toBeTruthy();
  });

  it("choosing a date does NOT schedule: it only enables Schedule", async () => {
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    expect(scheduleBtn(c).disabled).toBe(true);
    fireEvent.change(dateInput(c), { target: { value: FUTURE } });
    expect(dateInput(c).value).toBe(FUTURE);
    expect(api.promoteBacklogGoal).not.toHaveBeenCalled();
    expect(scheduleBtn(c).disabled).toBe(false);
    expect(screen.getByText("Call the bank")).toBeTruthy();
  });

  it("Schedule is enabled only for a real date that is today or later", async () => {
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    const enabledFor = (value: string) => {
      fireEvent.change(dateInput(c), { target: { value } });
      return !scheduleBtn(c).disabled;
    };
    expect(enabledFor("")).toBe(false);
    expect(enabledFor("2026-11-17")).toBe(false); // yesterday, e.g. typed past the picker's min
    expect(enabledFor(TODAY)).toBe(true);
    expect(enabledFor(FUTURE)).toBe(true);
    expect(enabledFor("")).toBe(false); // clearing the date turns it off again
  });

  it("Schedule moves the item to the chosen date (the existing promotion call), removes it from the list, and confirms", async () => {
    api.promoteBacklogGoal.mockResolvedValue({ id: "g1" });
    const it1 = item();
    mount("backlog", [it1]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    fireEvent.change(dateInput(c), { target: { value: FUTURE } });
    fireEvent.click(scheduleBtn(c));
    await waitFor(() => expect(screen.queryByText("Call the bank")).toBeNull());
    expect(api.promoteBacklogGoal).toHaveBeenCalledTimes(1);
    expect(api.promoteBacklogGoal).toHaveBeenCalledWith(it1, FUTURE);
    expect(screen.getByText(`"Call the bank" moved to ${FUTURE}.`)).toBeTruthy();
  });

  it("repeated clicks while scheduling send one request, and every scheduling control is locked until it settles", async () => {
    let resolve!: (v: unknown) => void;
    api.promoteBacklogGoal.mockReturnValue(new Promise((r) => (resolve = r)));
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    fireEvent.change(dateInput(c), { target: { value: FUTURE } });
    fireEvent.click(scheduleBtn(c));
    fireEvent.click(scheduleBtn(c));
    fireEvent.click(tomorrowBtn(c));
    expect(api.promoteBacklogGoal).toHaveBeenCalledTimes(1);
    expect(scheduleBtn(c).disabled).toBe(true);
    expect(tomorrowBtn(c).disabled).toBe(true);
    expect(dateInput(c).disabled).toBe(true);
    resolve({ id: "g1" });
    await waitFor(() => expect(screen.queryByText("Call the bank")).toBeNull());
    expect(api.promoteBacklogGoal).toHaveBeenCalledTimes(1);
  });

  it("a failed schedule keeps the item, shows the message, and the controls work again", async () => {
    api.promoteBacklogGoal.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ id: "g1" });
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    fireEvent.change(dateInput(c), { target: { value: FUTURE } });
    fireEvent.click(scheduleBtn(c));
    expect(await screen.findByText("network down")).toBeTruthy();
    expect(screen.getByText("Call the bank")).toBeTruthy();
    expect(scheduleBtn(c).disabled).toBe(false);
    expect(dateInput(c).value).toBe(FUTURE); // the chosen date is kept for the retry
    fireEvent.click(scheduleBtn(c));
    await waitFor(() => expect(screen.queryByText("Call the bank")).toBeNull());
    expect(api.promoteBacklogGoal).toHaveBeenCalledTimes(2);
  });

  it("each card keeps its own date: choosing one never changes or schedules another", async () => {
    mount("backlog", [item(), item({ id: "b2", title: "Buy stamps" })]);
    await screen.findByText("Call the bank");
    fireEvent.change(dateInput(card("Call the bank")), { target: { value: FUTURE } });
    expect(dateInput(card("Buy stamps")).value).toBe("");
    expect(scheduleBtn(card("Buy stamps")).disabled).toBe(true);
    expect(scheduleBtn(card("Call the bank")).disabled).toBe(false);
  });
});

describe("Backlog card: editing and removing still work", () => {
  it("Edit, Save and Cancel are unchanged; scheduling controls are off while a card is being edited", async () => {
    api.updateBacklogGoal.mockResolvedValue(item({ title: "Call Chase Bank" }));
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    const row = screen.getByTestId("backlog-editor").closest(".goal-row") as HTMLElement;
    expect(tomorrowBtn(row).disabled).toBe(true);
    expect(scheduleBtn(row).disabled).toBe(true);
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(api.updateBacklogGoal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Call Chase Bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Call Chase Bank")).toBeTruthy());
    expect(api.updateBacklogGoal).toHaveBeenCalledWith("b1", { title: "Call Chase Bank", details: "Ask about the fee", priority: 3 });
    expect(api.promoteBacklogGoal).not.toHaveBeenCalled();
  });

  it("Remove still deletes just that item", async () => {
    api.deleteBacklogGoal.mockResolvedValue(undefined);
    mount("backlog", [item(), item({ id: "b2", title: "Buy stamps" })]);
    await screen.findByText("Call the bank");
    fireEvent.click(within(card("Call the bank")).getByTitle("Remove from backlog"));
    await waitFor(() => expect(screen.queryByText("Call the bank")).toBeNull());
    expect(api.deleteBacklogGoal).toHaveBeenCalledWith("b1");
    expect(screen.getByText("Buy stamps")).toBeTruthy();
    expect(api.promoteBacklogGoal).not.toHaveBeenCalled();
  });
});

describe("Long-Term cards are unchanged by this work, and Spanish is covered", () => {
  it("a Long-Term Goal still has its own Push control and no Schedule button", async () => {
    mount("goals", [longTerm()]);
    await screen.findByText("Learn Spanish");
    const c = card("Learn Spanish");
    expect(within(c).getByRole("button", { name: "Push" })).toBeTruthy();
    expect(within(c).queryByRole("button", { name: "Schedule" })).toBeNull();
  });

  it("the new strings exist in Spanish, and the existing Tomorrow text is reused", () => {
    expect(es["backlog.schedule"]).toBe("Programar");
    expect(es["backlog.scheduleDateLabel"].trim().length).toBeGreaterThan(0);
    expect(es["backlog.pushToTomorrow"]).toBe("→ Mañana");
  });
});

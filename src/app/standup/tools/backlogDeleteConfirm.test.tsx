import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import type { BacklogGoal } from "@/lib/supabase/db";

// The real Tools page with its data layer replaced: the X on a Backlog / Long-Term card must only open a confirmation.
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

const item = (over: Partial<BacklogGoal> = {}): BacklogGoal => ({
  id: "b1", user_id: "u1", title: "Call the bank", details: "Ask about the fee", priority: 3, target_date: null, category: null, created_at: "2026-11-01T09:00:00Z", ...over,
});
const other = () => item({ id: "b2", title: "Renew passport" });
const longTerm = () => item({ id: "l1", title: "Learn Spanish", details: null, priority: 2, target_date: "2027-06-01", category: "Growth" });

function mount(tab: "backlog" | "goals", items: BacklogGoal[], lang?: "es") {
  const store = new Map<string, string>([["standup-tools-active-tab", tab]]);
  if (lang) store.set("standup-language", lang);
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
const xBtn = (title: string, label = "Remove from backlog") => within(card(title)).getByTitle(label) as HTMLButtonElement;
const dialog = () => screen.getByRole("alertdialog");
const deleteBtn = () => within(dialog()).getByRole("button", { name: "Delete" }) as HTMLButtonElement;
const cancelBtn = () => within(dialog()).getByRole("button", { name: "Cancel" });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.deleteBacklogGoal.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each([
  ["regular Backlog card", "backlog" as const, "Call the bank", () => [item(), other()], "b1"],
  ["Long-Term Goal card", "goals" as const, "Learn Spanish", () => [longTerm(), other()], "l1"],
])("%s", (_name, tab, title, make, id) => {
  it("clicking X only opens the confirmation (title + permanent warning); nothing is deleted", async () => {
    mount(tab, make());
    await screen.findByText(title);
    fireEvent.click(xBtn(title));
    expect(dialog().textContent).toContain(title);
    expect(dialog().textContent).toMatch(/permanently deleted/i);
    expect(api.deleteBacklogGoal).not.toHaveBeenCalled();
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  });

  it("Cancel, Escape and the backdrop all leave the item untouched", async () => {
    mount(tab, make());
    await screen.findByText(title);
    fireEvent.click(xBtn(title));
    fireEvent.click(cancelBtn());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(xBtn(title));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(xBtn(title));
    fireEvent.click(dialog().parentElement as HTMLElement); // backdrop
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.deleteBacklogGoal).not.toHaveBeenCalled();
    expect(card(title)).toBeTruthy();
  });

  it("Delete deletes exactly the selected item, once, and removes only that card", async () => {
    mount(tab, make());
    await screen.findByText(title);
    fireEvent.click(xBtn(title));
    fireEvent.click(deleteBtn());
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
    expect(api.deleteBacklogGoal).toHaveBeenCalledTimes(1);
    expect(api.deleteBacklogGoal).toHaveBeenCalledWith(id);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("repeated Delete clicks send one request", async () => {
    let release: () => void = () => {};
    api.deleteBacklogGoal.mockReturnValue(new Promise<void>((r) => (release = r)));
    mount(tab, make());
    await screen.findByText(title);
    fireEvent.click(xBtn(title));
    const btn = deleteBtn();
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(api.deleteBacklogGoal).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
    expect(api.deleteBacklogGoal).toHaveBeenCalledTimes(1);
  });

  it("a failed delete keeps the item and shows the error", async () => {
    api.deleteBacklogGoal.mockRejectedValue(new Error("permission denied"));
    mount(tab, make());
    await screen.findByText(title);
    fireEvent.click(xBtn(title));
    fireEvent.click(deleteBtn());
    await screen.findByText("permission denied");
    expect(card(title)).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("localization and wiring", () => {
  it("shows the confirmation in Spanish", async () => {
    mount("backlog", [item()], "es");
    await screen.findByText("Call the bank");
    fireEvent.click(within(card("Call the bank")).getByTitle(es["backlog.removeFromBacklog"]));
    expect(dialog().textContent).toContain(es["backlog.deleteConfirmTitle"]);
    expect(within(dialog()).getByRole("button", { name: es["backlog.deleteConfirm"] })).toBeTruthy();
    expect(within(dialog()).getByRole("button", { name: es["today.cancel"] })).toBeTruthy();
  });

  it("every new key exists in both languages", () => {
    for (const k of ["backlog.deleteConfirmTitle", "backlog.deleteConfirmBody", "backlog.deleteConfirm", "backlog.deleting"] as const) {
      expect(en[k], k).toBeTruthy();
      expect(es[k], k).toBeTruthy();
    }
  });

  it("the X is still disabled while that item is being edited (existing behaviour)", async () => {
    mount("backlog", [item()]);
    await screen.findByText("Call the bank");
    const c = card("Call the bank");
    fireEvent.click(within(c).getByRole("button", { name: "Edit Call the bank" }));
    expect((within(c).getByTitle("Remove from backlog") as HTMLButtonElement).disabled).toBe(true);
  });
});

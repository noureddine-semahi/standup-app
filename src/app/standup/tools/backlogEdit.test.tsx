import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { BacklogGoal } from "@/lib/supabase/db";

// The real Tools page, with its data layer replaced: it exercises the page's own Backlog wiring (which card is editing, what gets saved, what is displayed afterward).
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

const plain = (over: Partial<BacklogGoal> = {}): BacklogGoal => ({
  id: "b1", user_id: "u1", title: "Call the bank", details: "Ask about the fee", priority: 3, target_date: null, category: null, created_at: "2026-11-01T09:00:00Z", ...over,
});
const longTerm = (over: Partial<BacklogGoal> = {}): BacklogGoal => ({
  id: "l1", user_id: "u1", title: "Learn Spanish", details: "daily practice", priority: 2, target_date: "2027-06-01", category: "Growth", created_at: "2026-10-01T09:00:00Z", ...over,
});

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

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Backlog: editing an item on the Tools page", () => {
  it("Edit opens the inline editor for that card only, with its current values; Push and Remove are off for it", async () => {
    mount("backlog", [plain(), plain({ id: "b2", title: "Buy stamps", details: null, priority: 2 })]);
    await screen.findByText("Call the bank");
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    const editor = screen.getByTestId("backlog-editor");
    expect((within(editor).getByLabelText("Title") as HTMLInputElement).value).toBe("Call the bank");
    expect((within(editor).getByLabelText("Details (optional)") as HTMLTextAreaElement).value).toBe("Ask about the fee");
    expect((within(editor).getByLabelText("Priority") as HTMLSelectElement).value).toBe("3");
    expect(screen.getAllByTestId("backlog-editor")).toHaveLength(1);
    const editing = screen.getByTestId("backlog-editor").closest(".goal-row") as HTMLElement;
    expect((within(editing).getByTitle("Remove from backlog") as HTMLButtonElement).disabled).toBe(true);
    expect((within(editing).getByRole("button", { name: /→ Tomorrow/ }) as HTMLButtonElement).disabled).toBe(true);
    // the other card is unaffected
    expect((within(card("Buy stamps")).getByTitle("Remove from backlog") as HTMLButtonElement).disabled).toBe(false);
    expect(within(card("Buy stamps")).queryByTestId("backlog-editor")).toBeNull();
  });

  it("Save writes title, details and priority for THAT item, then the card shows the new values in the same place", async () => {
    const saved = plain({ title: "Call Chase Bank", details: "Dispute the fee", priority: 1 });
    api.updateBacklogGoal.mockResolvedValue(saved);
    mount("backlog", [plain(), plain({ id: "b2", title: "Buy stamps", details: null, priority: 2 })]);
    await screen.findByText("Call the bank");
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    const editor = screen.getByTestId("backlog-editor");
    fireEvent.change(within(editor).getByLabelText("Title"), { target: { value: "Call Chase Bank" } });
    fireEvent.change(within(editor).getByLabelText("Details (optional)"), { target: { value: "Dispute the fee" } });
    fireEvent.change(within(editor).getByLabelText("Priority"), { target: { value: "1" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByTestId("backlog-editor")).toBeNull());
    expect(api.updateBacklogGoal).toHaveBeenCalledTimes(1);
    expect(api.updateBacklogGoal).toHaveBeenCalledWith("b1", { title: "Call Chase Bank", details: "Dispute the fee", priority: 1 });
    const cards = Array.from(document.querySelectorAll(".goal-row"));
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("Call Chase Bank");
    expect(cards[0].textContent).toContain("Dispute the fee");
    expect(cards[1].textContent).toContain("Buy stamps"); // order and the other item unchanged
    expect(screen.queryByText("Call the bank")).toBeNull();
    // nothing else was written
    for (const fn of [api.deleteBacklogGoal, api.promoteBacklogGoal, api.addBacklogGoal, api.addLongTermGoal]) expect(fn).not.toHaveBeenCalled();
  });

  it("Cancel persists nothing and restores the original card", async () => {
    mount("backlog", [plain()]);
    await screen.findByText("Call the bank");
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Totally different" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.updateBacklogGoal).not.toHaveBeenCalled();
    expect(screen.queryByTestId("backlog-editor")).toBeNull();
    expect(screen.getByText("Call the bank")).toBeTruthy();
    expect(screen.queryByText("Totally different")).toBeNull();
  });

  it("an empty title is refused: nothing is saved and the editor stays open", async () => {
    mount("backlog", [plain()]);
    await screen.findByText("Call the bank");
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Enter" });
    expect(await screen.findByText("Enter a title.")).toBeTruthy();
    expect(api.updateBacklogGoal).not.toHaveBeenCalled();
    expect(screen.getByTestId("backlog-editor")).toBeTruthy();
  });

  it("a failed save keeps the editor open with the message and leaves the displayed item as it was", async () => {
    api.updateBacklogGoal.mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce(plain({ title: "Retried title" }));
    mount("backlog", [plain()]);
    await screen.findByText("Call the bank");
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Retried title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("permission denied")).toBeTruthy();
    expect(screen.getByTestId("backlog-editor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByTestId("backlog-editor")).toBeNull());
    expect(screen.getByText("Retried title")).toBeTruthy();
  });

  it("repeated taps while the save is in flight send one request", async () => {
    let resolve!: (row: BacklogGoal) => void;
    api.updateBacklogGoal.mockReturnValue(new Promise<BacklogGoal>((r) => (resolve = r)));
    mount("backlog", [plain()]);
    await screen.findByText("Call the bank");
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Phone the bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Enter" });
    expect(api.updateBacklogGoal).toHaveBeenCalledTimes(1);
    resolve(plain({ title: "Phone the bank" }));
    await waitFor(() => expect(screen.getByText("Phone the bank")).toBeTruthy());
  });

  it("opening another card's editor closes the first (one editor at a time)", async () => {
    mount("backlog", [plain(), plain({ id: "b2", title: "Buy stamps", details: null })]);
    await screen.findByText("Call the bank");
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the bank" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Buy stamps" }));
    expect(screen.getAllByTestId("backlog-editor")).toHaveLength(1);
    expect(within(card("Call the bank")).queryByTestId("backlog-editor")).toBeNull();
  });
});

describe("Long-Term Goals: editing keeps their date and category", () => {
  it("edits title, details and priority; the target date and category stay displayed and are never written", async () => {
    api.updateBacklogGoal.mockResolvedValue(longTerm({ title: "Learn Spanish well", details: null, priority: 1 }));
    mount("goals", [longTerm()]);
    await screen.findByText("Learn Spanish");
    expect(within(card("Learn Spanish")).getByText("Growth")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Learn Spanish" }));
    const editor = screen.getByTestId("backlog-editor");
    expect(within(editor.closest(".goal-row") as HTMLElement).getByText("Growth")).toBeTruthy(); // the category is still shown while editing
    fireEvent.change(within(editor).getByLabelText("Title"), { target: { value: "Learn Spanish well" } });
    fireEvent.change(within(editor).getByLabelText("Details (optional)"), { target: { value: "" } });
    fireEvent.change(within(editor).getByLabelText("Priority"), { target: { value: "1" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByTestId("backlog-editor")).toBeNull());
    expect(api.updateBacklogGoal).toHaveBeenCalledWith("l1", { title: "Learn Spanish well", details: null, priority: 1 });
    const saved = card("Learn Spanish well");
    expect(within(saved).getByText("Growth")).toBeTruthy();
    expect(saved.textContent).toMatch(/2027|06\/01|6\/1/); // the target date is still shown
    expect(saved.textContent).not.toContain("daily practice");
    expect(api.promoteBacklogGoal).not.toHaveBeenCalled();
  });

  it("Push and Remove are off for a Long-Term Goal while it is being edited", async () => {
    mount("goals", [longTerm()]);
    await screen.findByText("Learn Spanish");
    fireEvent.click(screen.getByRole("button", { name: "Edit Learn Spanish" }));
    const row = screen.getByTestId("backlog-editor").closest(".goal-row") as HTMLElement;
    expect((within(row).getByTitle("Remove from backlog") as HTMLButtonElement).disabled).toBe(true);
    expect((within(row).getByRole("button", { name: "Push" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(row).queryByRole("button", { name: "Edit Learn Spanish" })).toBeNull(); // no second Edit while editing
  });
});

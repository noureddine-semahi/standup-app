import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import type { ChecklistItem } from "@/lib/supabase/db";

const api = vi.hoisted(() => ({
  addChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  setChecklistItemStatus: vi.fn(),
  updateChecklistItemText: vi.fn(),
  getLists: vi.fn(),
  getListItemsForLists: vi.fn(),
  attachListToGoal: vi.fn(),
}));
vi.mock("@/lib/supabase/db", () => ({ ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { es } from "@/lib/i18n/es";
import GoalChecklist from "./GoalChecklist";

const mk = (id: string, text: string, status: ChecklistItem["status"], position: number): ChecklistItem => ({
  id, goal_id: "g1", user_id: "u1", text, is_checked: status === "completed", status, position, created_at: "2026-11-01T00:00:00Z",
});
const seed = () => [mk("a", "Milk", "pending", 0), mk("b", "Eggs", "completed", 1), mk("c", "Bread", "missing", 2)];

let latest: ChecklistItem[] = [];
function Harness({ initial, readOnly = false }: { initial: ChecklistItem[]; readOnly?: boolean }) {
  const [items, setItems] = useState(initial);
  useEffect(() => {
    latest = items;
  }, [items]);
  return <GoalChecklist goalId="g1" items={items} onItemsChange={setItems} readOnly={readOnly} />;
}
function mount(initial = seed(), readOnly = false, lang?: "es") {
  const store = new Map<string, string>();
  if (lang) store.set("standup-language", lang);
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: () => {}, clear: () => {} });
  return render(
    <LanguageProvider>
      <Harness initial={initial} readOnly={readOnly} />
    </LanguageProvider>
  );
}
const row = (text: string) => screen.getByText(text, { selector: "span" }).closest("[data-testid=checklist-row]") as HTMLElement;
const statusBtn = (text: string) => within(row(text)).getByRole("button", { name: new RegExp(`^${text}: `) }) as HTMLButtonElement;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.setChecklistItemStatus.mockResolvedValue(undefined);
  api.deleteChecklistItem.mockResolvedValue(undefined);
  api.updateChecklistItemText.mockImplementation(async (id: string, text: string) => ({ id, text }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("three statuses", () => {
  it("renders pending, completed and missing distinctly (box glyph, text colour and strike-through)", () => {
    mount();
    const box = (t: string) => row(t).querySelector("[data-status]") as HTMLElement;
    expect(row("Milk").getAttribute("data-status")).toBe("pending");
    expect(within(box("Milk")).queryByText("", { selector: "svg" })).toBeNull();
    expect(box("Milk").querySelector("svg")).toBeNull(); // empty box
    expect(box("Eggs").querySelector("svg")).toBeTruthy(); // green check
    expect(box("Eggs").style.color).toBe("rgb(52, 211, 153)");
    expect(box("Bread").querySelector("svg")).toBeTruthy(); // red X
    expect(box("Bread").style.color).toBe("rgb(248, 113, 113)");
    const text = (t: string) => screen.getByText(t, { selector: "span" });
    expect(text("Milk").style.textDecoration).toBe("none");
    expect(text("Eggs").style.textDecoration).toBe("line-through");
    expect(text("Bread").style.textDecoration).toBe("line-through");
    expect(text("Bread").style.color).toBe("rgb(248, 113, 113)");
  });

  it("Missing does not count as completed in the progress counter", () => {
    mount();
    expect(screen.getByText(/\(1\/3\)/)).toBeTruthy(); // only Eggs is completed
  });

  it("the status control names the current and next status, and cycles pending → completed → missing → pending", async () => {
    mount();
    expect(statusBtn("Milk").getAttribute("aria-label")).toBe("Milk: Pending. Tap to change to Completed.");
    fireEvent.click(statusBtn("Milk"));
    await waitFor(() => expect(api.setChecklistItemStatus).toHaveBeenLastCalledWith("a", "completed"));
    fireEvent.click(statusBtn("Milk"));
    await waitFor(() => expect(api.setChecklistItemStatus).toHaveBeenLastCalledWith("a", "missing"));
    await waitFor(() => expect(row("Milk").getAttribute("data-status")).toBe("missing"));
    fireEvent.click(statusBtn("Milk"));
    await waitFor(() => expect(api.setChecklistItemStatus).toHaveBeenLastCalledWith("a", "pending"));
    expect(api.setChecklistItemStatus).toHaveBeenCalledTimes(3);
    // other items never touched
    expect(latest.find((i) => i.id === "c")).toMatchObject({ status: "missing" });
  });

  it("is optimistic and rolls back when the write fails", async () => {
    api.setChecklistItemStatus.mockRejectedValue(new Error("nope"));
    mount();
    fireEvent.click(statusBtn("Milk"));
    expect(row("Milk").getAttribute("data-status")).toBe("completed"); // optimistic
    await waitFor(() => expect(row("Milk").getAttribute("data-status")).toBe("pending")); // rolled back
    expect(latest.find((i) => i.id === "a")).toMatchObject({ status: "pending", is_checked: false });
  });

  it("legacy rows without a status field fall back to is_checked", () => {
    const legacy = [{ ...mk("x", "Old checked", "completed", 0), status: undefined as never, is_checked: true }, { ...mk("y", "Old open", "pending", 1), status: undefined as never, is_checked: false }];
    mount(legacy);
    expect(row("Old checked").getAttribute("data-status")).toBe("completed");
    expect(row("Old open").getAttribute("data-status")).toBe("pending");
  });
});

describe("edit", () => {
  it("pencil opens an inline editor; Save writes ONLY the new text and keeps status/position", async () => {
    mount();
    fireEvent.click(within(row("Bread")).getByRole("button", { name: "Edit item" }));
    const input = screen.getByLabelText("Item text") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Sourdough " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Sourdough")).toBeTruthy());
    expect(api.updateChecklistItemText).toHaveBeenCalledTimes(1);
    expect(api.updateChecklistItemText).toHaveBeenCalledWith("c", "Sourdough");
    expect(latest.find((i) => i.id === "c")).toMatchObject({ id: "c", text: "Sourdough", status: "missing", position: 2 });
    expect(api.setChecklistItemStatus).not.toHaveBeenCalled();
  });
  it("Cancel and Escape write nothing and restore the original text", () => {
    mount();
    fireEvent.click(within(row("Milk")).getByRole("button", { name: "Edit item" }));
    fireEvent.change(screen.getByLabelText("Item text"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Milk")).toBeTruthy();
    fireEvent.click(within(row("Milk")).getByRole("button", { name: "Edit item" }));
    fireEvent.change(screen.getByLabelText("Item text"), { target: { value: "Changed" } });
    fireEvent.keyDown(screen.getByLabelText("Item text"), { key: "Escape" });
    expect(screen.getByText("Milk")).toBeTruthy();
    expect(api.updateChecklistItemText).not.toHaveBeenCalled();
  });
  it("an empty or unchanged edit writes nothing", () => {
    mount();
    fireEvent.click(within(row("Milk")).getByRole("button", { name: "Edit item" }));
    fireEvent.change(screen.getByLabelText("Item text"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Item text"), { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Item text"), { target: { value: "Milk" } });
    fireEvent.keyDown(screen.getByLabelText("Item text"), { key: "Enter" });
    expect(api.updateChecklistItemText).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Item text")).toBeNull(); // unchanged closes
  });
  it("a failed save keeps the editor open with an error and the original text in the list", async () => {
    api.updateChecklistItemText.mockRejectedValue(new Error("boom"));
    mount();
    fireEvent.click(within(row("Milk")).getByRole("button", { name: "Edit item" }));
    fireEvent.change(screen.getByLabelText("Item text"), { target: { value: "Oat milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Item text")).toBeTruthy();
    expect(latest.find((i) => i.id === "a")?.text).toBe("Milk");
  });
  it("repeated Save clicks send one request", async () => {
    let release: (v: unknown) => void = () => {};
    api.updateChecklistItemText.mockReturnValue(new Promise((r) => (release = r)));
    mount();
    fireEvent.click(within(row("Milk")).getByRole("button", { name: "Edit item" }));
    fireEvent.change(screen.getByLabelText("Item text"), { target: { value: "Oat milk" } });
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(api.updateChecklistItemText).toHaveBeenCalledTimes(1);
    release({});
    await waitFor(() => expect(screen.getByText("Oat milk")).toBeTruthy());
  });
});

describe("delete", () => {
  it("the trash button deletes only that item; pencil and trash sit side by side with ≥32px targets", async () => {
    mount();
    const r = row("Eggs");
    const pencil = within(r).getByRole("button", { name: "Edit item" });
    const trash = within(r).getByRole("button", { name: "Remove item" });
    expect(pencil.parentElement).toBe(trash.parentElement); // adjacent, same group
    expect(pencil.nextElementSibling).toBe(trash);
    for (const b of [pencil, trash, statusBtn("Eggs")]) {
      expect(parseInt(b.style.width)).toBeGreaterThanOrEqual(32);
      expect(parseInt(b.style.height)).toBeGreaterThanOrEqual(32);
    }
    fireEvent.click(trash);
    await waitFor(() => expect(screen.queryByText("Eggs")).toBeNull());
    expect(api.deleteChecklistItem).toHaveBeenCalledTimes(1);
    expect(api.deleteChecklistItem).toHaveBeenCalledWith("b");
    expect(latest.map((i) => i.id).sort()).toEqual(["a", "c"]);
  });
  it("restores the item when the delete fails", async () => {
    api.deleteChecklistItem.mockRejectedValue(new Error("nope"));
    mount();
    fireEvent.click(within(row("Eggs")).getByRole("button", { name: "Remove item" }));
    await waitFor(() => expect(latest).toHaveLength(3));
    expect(screen.getByText("Eggs")).toBeTruthy();
  });
});

describe("read-only view", () => {
  it("shows each status with no status button, pencil, trash or add field", () => {
    mount(seed(), true);
    for (const [text, status] of [["Milk", "pending"], ["Eggs", "completed"], ["Bread", "missing"]]) {
      const r = row(text);
      expect(r.getAttribute("data-status")).toBe(status);
      expect(within(r).queryAllByRole("button")).toHaveLength(0);
      expect(within(r).getByRole("img").getAttribute("aria-label")).toBe(status[0].toUpperCase() + status.slice(1));
    }
    expect(screen.queryByPlaceholderText("Add item…")).toBeNull();
  });
});

describe("Spanish", () => {
  it("localizes the status, edit and delete controls", () => {
    mount(seed(), false, "es");
    expect(within(row("Bread")).getByRole("button", { name: es["checklist.editItem"] })).toBeTruthy();
    expect(within(row("Bread")).getByRole("button", { name: es["checklist.removeItem"] })).toBeTruthy();
    expect(statusBtn("Bread").getAttribute("aria-label")).toBe(`Bread: ${es["checklist.status.missing"]}. Toca para cambiar a ${es["checklist.status.pending"]}.`);
  });
});

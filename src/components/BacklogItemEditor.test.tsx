import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { es } from "@/lib/i18n/es";
import type { BacklogGoal } from "@/lib/supabase/db";
import BacklogItemEditor from "./BacklogItemEditor";

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

const item: BacklogGoal = { id: "b1", user_id: "u1", title: "Call the bank", details: "Ask about the fee", priority: 3, target_date: null, category: null, created_at: "2026-11-01T00:00:00Z" };

function setup(over: Partial<{ item: BacklogGoal; onSave: (d: unknown) => Promise<string | null> }> = {}) {
  const onSave = vi.fn(over.onSave ?? (async () => null));
  const onCancel = vi.fn();
  render(
    <LanguageProvider>
      <BacklogItemEditor item={over.item ?? item} onSave={onSave} onCancel={onCancel} />
    </LanguageProvider>
  );
  return { onSave, onCancel };
}
const title = () => screen.getByLabelText("Title") as HTMLInputElement;
const details = () => screen.getByLabelText("Details (optional)") as HTMLTextAreaElement;
const priority = () => screen.getByLabelText("Priority") as HTMLSelectElement;
const saveBtn = () => screen.getByRole("button", { name: /^(Save|Saving…)$/ }) as HTMLButtonElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("BacklogItemEditor", () => {
  it("opens with the item's current title, details and priority", () => {
    setup();
    expect(title().value).toBe("Call the bank");
    expect(details().value).toBe("Ask about the fee");
    expect(priority().value).toBe("3");
  });

  it("offers the same P1-P5 choices as the add form, so an existing P4 or P5 item keeps its priority", () => {
    setup({ item: { ...item, priority: 5 } });
    expect(Array.from(priority().options).map((o) => o.text)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(priority().value).toBe("5");
  });

  it("Save sends the edited title, details and priority (trimmed), and nothing else", async () => {
    const { onSave } = setup();
    type(title(), "  Call Chase Bank  ");
    type(details(), "  Dispute the fee ");
    type(priority(), "1");
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ title: "Call Chase Bank", details: "Dispute the fee", priority: 1 });
  });

  it("blank details are sent as null (clearing the details is a legitimate edit)", async () => {
    const { onSave } = setup();
    type(details(), "   ");
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: "Call the bank", details: null, priority: 3 }));
  });

  it("an item with no details starts with an empty box and stays null when untouched but retitled", async () => {
    const { onSave } = setup({ item: { ...item, details: null } });
    expect(details().value).toBe("");
    type(title(), "Phone the bank");
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: "Phone the bank", details: null, priority: 3 }));
  });

  it("Cancel discards the edits and never saves", () => {
    const { onSave, onCancel } = setup();
    type(title(), "Something else");
    type(priority(), "1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Escape cancels without saving", () => {
    const { onSave, onCancel } = setup();
    type(title(), "Changed");
    fireEvent.keyDown(title(), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("an empty or whitespace-only title is refused: Save is disabled, a message shows, nothing is sent", () => {
    const { onSave } = setup();
    type(title(), "   ");
    expect(saveBtn().disabled).toBe(true);
    fireEvent.keyDown(title(), { key: "Enter" }); // Enter must not bypass the rule
    expect(screen.getByRole("alert").textContent).toBe("Enter a title.");
    expect(onSave).not.toHaveBeenCalled();
    type(title(), "Back again");
    expect(saveBtn().disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Enter in the title saves", async () => {
    const { onSave } = setup();
    type(title(), "Phone the bank");
    fireEvent.keyDown(title(), { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("saving with nothing changed just closes: no write", () => {
    const { onSave, onCancel } = setup();
    fireEvent.click(saveBtn());
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("repeated taps while saving send one request, the controls lock, and the button says Saving…", async () => {
    let resolve!: (v: string | null) => void;
    const pending = new Promise<string | null>((r) => (resolve = r));
    const { onSave } = setup({ onSave: () => pending });
    type(title(), "Phone the bank");
    fireEvent.click(saveBtn());
    fireEvent.click(saveBtn());
    fireEvent.keyDown(title(), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saveBtn().textContent).toBe("Saving…");
    expect(saveBtn().disabled).toBe(true);
    expect(title().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    resolve(null);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("a failed save shows the message, keeps the typed values, unlocks, and a retry works", async () => {
    const onSaveImpl = vi.fn().mockResolvedValueOnce("Failed to save changes").mockResolvedValueOnce(null);
    const { onSave } = setup({ onSave: onSaveImpl });
    type(title(), "Phone the bank");
    fireEvent.click(saveBtn());
    expect((await screen.findByRole("alert")).textContent).toBe("Failed to save changes");
    expect(title().value).toBe("Phone the bank");
    expect(title().disabled).toBe(false);
    expect(saveBtn().disabled).toBe(false);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it("the Spanish strings exist", () => {
    for (const k of ["backlog.edit", "backlog.editSave", "backlog.editCancel", "backlog.editSaving", "backlog.editTitleLabel", "backlog.editDetailsLabel", "backlog.editPriorityLabel", "backlog.errTitleRequired", "backlog.failedUpdate"] as const)
      expect(es[k].trim().length, k).toBeGreaterThan(0);
    expect(es["backlog.errTitleRequired"]).toBe("Escribe un título.");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import type { Note } from "@/lib/notes";

const api = vi.hoisted(() => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  getNote: vi.fn(),
  saveNoteText: vi.fn(),
  setNotePinned: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("@/lib/supabase/notes", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/notes")>()), ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import NotesTab from "./NotesTab";

const note = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  title: "Groceries",
  body: "milk\neggs",
  pinned: false,
  revision: 1,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-02T10:00:00Z",
  ...over,
});

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
};
async function mount(notes: Note[] = []) {
  api.listNotes.mockResolvedValue(notes);
  render(
    <LanguageProvider>
      <NotesTab />
    </LanguageProvider>
  );
  await settle();
}
const ids = () => [...screen.getByTestId("notes-grid").querySelectorAll("li")].map((li) => li.getAttribute("data-testid")!.replace("note-card-", ""));
const type = (testid: string, value: string) => fireEvent.change(screen.getByTestId(testid), { target: { value } });

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(api).forEach((f) => f.mockReset());
  api.saveNoteText.mockImplementation(async (_id, rev, text) => ({ status: "ok", note: note({ ...text, revision: rev + 1 }) }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("library states", () => {
  it("shows a loading state, then the empty state with a New note button", async () => {
    let release!: (n: Note[]) => void;
    api.listNotes.mockReturnValue(new Promise((res) => (release = res)));
    render(
      <LanguageProvider>
        <NotesTab />
      </LanguageProvider>
    );
    expect(screen.getByTestId("notes-loading")).toBeTruthy();
    await act(async () => release([]));
    await settle();
    expect(screen.getByTestId("notes-empty").textContent).toContain("No notes yet.");
    expect(screen.getByTestId("notes-new")).toBeTruthy();
  });
  it("shows an error with a retry that loads again", async () => {
    api.listNotes.mockRejectedValueOnce({ code: "08006", message: "connection lost" });
    render(
      <LanguageProvider>
        <NotesTab />
      </LanguageProvider>
    );
    await settle();
    expect(screen.getByTestId("notes-error")).toBeTruthy();
    api.listNotes.mockResolvedValueOnce([note()]);
    fireEvent.click(screen.getByTestId("notes-retry"));
    await settle();
    expect(screen.getByTestId("note-card-n1")).toBeTruthy();
  });
  it("explains when the Notes table isn't set up yet (migration not applied) and offers no New note", async () => {
    api.listNotes.mockRejectedValueOnce({ code: "42P01", message: 'relation "notes" does not exist' });
    render(
      <LanguageProvider>
        <NotesTab />
      </LanguageProvider>
    );
    await settle();
    expect(screen.getByTestId("notes-unavailable").textContent).toContain("database update");
    expect((screen.getByTestId("notes-new") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("cards, ordering and search", () => {
  const list = [
    note({ id: "a", title: "Old", body: "plain", updatedAt: "2026-10-01T10:00:00Z" }),
    note({ id: "b", title: "Recent", body: "Learn Spanish", updatedAt: "2026-11-03T10:00:00Z" }),
    note({ id: "c", title: "Pinned one", body: "", pinned: true, updatedAt: "2026-09-01T10:00:00Z" }),
    note({ id: "d", title: "", body: "no title here", updatedAt: "2026-11-02T10:00:00Z" }),
  ];
  it("lists pinned first, then most recently edited, with title, a preview, the edited date and a pin indicator", async () => {
    await mount(list);
    expect(ids()).toEqual(["c", "b", "d", "a"]);
    const card = screen.getByTestId("note-card-b");
    expect(card.textContent).toContain("Recent");
    expect(card.textContent).toContain("Learn Spanish");
    expect(card.textContent).toContain("Edited");
    expect(screen.getByTestId("note-pin-c").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("note-pin-a").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("note-card-d").textContent).toContain("Untitled note");
    expect(screen.getByTestId("note-card-c").textContent).toContain("No text");
  });
  it("searches title and text, and says so when nothing matches", async () => {
    await mount(list);
    type("notes-search", "spanish");
    expect(ids()).toEqual(["b"]);
    type("notes-search", "PINNED");
    expect(ids()).toEqual(["c"]);
    type("notes-search", "zzz");
    expect(screen.getByTestId("notes-no-matches").textContent).toContain("zzz");
    type("notes-search", "");
    expect(ids()).toHaveLength(4);
  });
  it("pinning from a card is revision-checked and moves the card to the top", async () => {
    await mount(list);
    api.setNotePinned.mockResolvedValue({ status: "ok", note: { ...list[0], pinned: true, revision: 2 } });
    fireEvent.click(screen.getByTestId("note-pin-a"));
    await settle();
    expect(api.setNotePinned).toHaveBeenCalledWith("a", 1, true);
    expect(ids()).toEqual(["a", "c", "b", "d"]); // both pinned now, newest edit first, then the rest
  });
  it("a pin conflict reloads the list instead of guessing", async () => {
    await mount(list);
    api.setNotePinned.mockResolvedValue({ status: "conflict" });
    api.listNotes.mockResolvedValue([...list]);
    fireEvent.click(screen.getByTestId("note-pin-a"));
    await settle();
    expect(api.listNotes).toHaveBeenCalledTimes(2);
  });
});

describe("create and edit with autosave", () => {
  it("New note opens the editor and typing autosaves after a pause, showing Saving… then Saved", async () => {
    await mount([]);
    api.createNote.mockResolvedValue(note({ id: "new", title: "", body: "", revision: 0 }));
    fireEvent.click(screen.getByTestId("notes-new"));
    await settle();
    expect(screen.getByTestId("note-editor")).toBeTruthy();
    type("note-title", "Plan");
    type("note-body", "Write the plan");
    expect(screen.getByTestId("note-status").textContent).toContain("Saving…");
    expect(api.saveNoteText).not.toHaveBeenCalled();
    await advance(900);
    expect(api.saveNoteText).toHaveBeenCalledTimes(1);
    expect(api.saveNoteText).toHaveBeenCalledWith("new", 0, { title: "Plan", body: "Write the plan" });
    expect(screen.getByTestId("note-status").textContent).toContain("Saved");
  });
  it("a save that fails shows an error, keeps the text, and retry saves it", async () => {
    await mount([note()]);
    fireEvent.click(screen.getByTestId("note-open-n1"));
    api.saveNoteText.mockRejectedValueOnce({ message: "connection lost" });
    type("note-body", "milk\neggs\nbread");
    await advance(900);
    expect(screen.getByTestId("note-error").textContent).toContain("aren't saved");
    expect((screen.getByTestId("note-body") as HTMLTextAreaElement).value).toBe("milk\neggs\nbread");
    await act(async () => fireEvent.click(screen.getByTestId("note-retry")));
    await settle();
    expect(api.saveNoteText).toHaveBeenLastCalledWith("n1", 1, { title: "Groceries", body: "milk\neggs\nbread" });
    expect(screen.getByTestId("note-status").textContent).toContain("Saved");
    expect(screen.queryByTestId("note-error")).toBeNull();
  });
  it("saves use the revision the last save returned, so quick consecutive edits never race", async () => {
    await mount([note({ revision: 4 })]);
    fireEvent.click(screen.getByTestId("note-open-n1"));
    type("note-body", "one");
    await advance(900);
    type("note-body", "one two");
    await advance(900);
    expect(api.saveNoteText.mock.calls.map((c) => c[1])).toEqual([4, 5]);
  });
  it("a stale save (someone else saved first) is reported, never forced; Keep mine saves over it after loading the latest revision", async () => {
    await mount([note({ revision: 1 })]);
    fireEvent.click(screen.getByTestId("note-open-n1"));
    api.saveNoteText.mockResolvedValueOnce({ status: "conflict" });
    type("note-body", "my text");
    await advance(900);
    expect(screen.getByTestId("note-conflict")).toBeTruthy();
    expect((screen.getByTestId("note-body") as HTMLTextAreaElement).value).toBe("my text");
    // no further automatic attempts while in conflict
    type("note-body", "my text more");
    await advance(3000);
    expect(api.saveNoteText).toHaveBeenCalledTimes(1);
    api.getNote.mockResolvedValue(note({ revision: 7, body: "theirs" }));
    await act(async () => fireEvent.click(screen.getByTestId("note-keep-mine")));
    await settle();
    expect(api.saveNoteText).toHaveBeenLastCalledWith("n1", 7, { title: "Groceries", body: "my text more" });
    expect(screen.queryByTestId("note-conflict")).toBeNull();
  });
  it("Load latest drops the unsaved text and reopens the editor on the stored version", async () => {
    await mount([note({ revision: 1 })]);
    fireEvent.click(screen.getByTestId("note-open-n1"));
    api.saveNoteText.mockResolvedValueOnce({ status: "conflict" });
    type("note-body", "mine");
    await advance(900);
    api.getNote.mockResolvedValue(note({ revision: 5, body: "from elsewhere" }));
    await act(async () => fireEvent.click(screen.getByTestId("note-load-latest")));
    await settle();
    expect((screen.getByTestId("note-body") as HTMLTextAreaElement).value).toBe("from elsewhere");
    expect(screen.queryByTestId("note-conflict")).toBeNull();
  });
  it("Back saves pending text first; if that fails it stays put with a choice instead of losing the edit", async () => {
    await mount([note()]);
    fireEvent.click(screen.getByTestId("note-open-n1"));
    api.saveNoteText.mockRejectedValue({ message: "offline" });
    type("note-body", "keep this");
    await act(async () => fireEvent.click(screen.getByTestId("note-back")));
    await settle();
    expect(api.saveNoteText).toHaveBeenCalled();
    expect(screen.getByTestId("note-editor")).toBeTruthy();
    expect(screen.getByTestId("note-leave-blocked")).toBeTruthy();
    expect((screen.getByTestId("note-body") as HTMLTextAreaElement).value).toBe("keep this");
    await act(async () => fireEvent.click(screen.getByTestId("note-leave-anyway")));
    await settle();
    expect(screen.getByTestId("notes-library")).toBeTruthy();
  });
  it("Back with everything saved returns to the library at once, and an untouched new note is removed", async () => {
    await mount([]);
    api.createNote.mockResolvedValue(note({ id: "new", title: "", body: "", revision: 0 }));
    api.deleteNote.mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId("notes-new"));
    await settle();
    await act(async () => fireEvent.click(screen.getByTestId("note-back")));
    await settle();
    expect(api.deleteNote).toHaveBeenCalledWith("new");
    expect(screen.getByTestId("notes-empty")).toBeTruthy();
  });
});

describe("pin and delete in the editor", () => {
  it("pin saves pending text first, then pins with the current revision", async () => {
    await mount([note({ revision: 1 })]);
    fireEvent.click(screen.getByTestId("note-open-n1"));
    api.setNotePinned.mockResolvedValue({ status: "ok", note: note({ pinned: true, revision: 3 }) });
    type("note-body", "changed");
    await act(async () => fireEvent.click(screen.getByTestId("note-pin")));
    await settle();
    expect(api.saveNoteText).toHaveBeenCalledWith("n1", 1, { title: "Groceries", body: "changed" });
    expect(api.setNotePinned).toHaveBeenCalledWith("n1", 2, true);
    expect(screen.getByTestId("note-pin").getAttribute("aria-pressed")).toBe("true");
  });
  it("delete asks first; cancelling deletes nothing; confirming deletes and returns to the library", async () => {
    await mount([note(), note({ id: "n2", title: "Other" })]);
    fireEvent.click(screen.getByTestId("note-open-n1"));
    fireEvent.click(screen.getByTestId("note-delete"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Groceries");
    expect(dialog.textContent).toContain("can't be undone");
    fireEvent.click(within(dialog).getByText("Cancel", { exact: false }));
    expect(api.deleteNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("note-delete"));
    api.deleteNote.mockResolvedValue(undefined);
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Delete")));
    await settle();
    expect(api.deleteNote).toHaveBeenCalledWith("n1");
    expect(screen.queryByTestId("note-card-n1")).toBeNull();
    expect(screen.getByTestId("note-card-n2")).toBeTruthy();
  });
  it("a failed delete keeps the note and reports the error", async () => {
    await mount([note()]);
    fireEvent.click(screen.getByTestId("note-open-n1"));
    fireEvent.click(screen.getByTestId("note-delete"));
    api.deleteNote.mockRejectedValue({ message: "denied" });
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Delete")));
    await settle();
    expect(screen.getByRole("alertdialog").textContent).toContain("denied");
    expect(screen.getByTestId("note-editor")).toBeTruthy();
  });
});

describe("Spanish", () => {
  it("renders the library and editor in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      await mount([note()]);
      await settle();
      expect(screen.getByTestId("notes-new").textContent).toContain("Nueva nota");
      expect((screen.getByTestId("notes-search") as HTMLInputElement).placeholder).toBe("Buscar notas…");
      fireEvent.click(screen.getByTestId("note-open-n1"));
      expect(screen.getByTestId("note-back").textContent).toContain("Volver a Notas");
      expect((screen.getByTestId("note-title") as HTMLInputElement).placeholder).toBe("Título");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

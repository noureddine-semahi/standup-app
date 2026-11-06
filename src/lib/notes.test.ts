import { describe, it, expect } from "vitest";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, clampNoteText, filterNotes, isBlankNote, notePreview, sortNotes, type Note } from "./notes";

const note = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  title: "",
  body: "",
  pinned: false,
  revision: 0,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  ...over,
});

describe("sortNotes", () => {
  it("puts pinned notes first, then the most recently updated", () => {
    const a = note({ id: "a", updatedAt: "2026-11-01T10:00:00Z" });
    const b = note({ id: "b", updatedAt: "2026-11-03T10:00:00Z" });
    const c = note({ id: "c", updatedAt: "2026-11-02T10:00:00Z", pinned: true });
    const d = note({ id: "d", updatedAt: "2026-10-01T10:00:00Z", pinned: true });
    expect(sortNotes([a, b, c, d]).map((n) => n.id)).toEqual(["c", "d", "b", "a"]);
  });
  it("is stable for equal timestamps (falls back to id) and does not mutate its input", () => {
    const x = note({ id: "x" });
    const y = note({ id: "y" });
    const input = [y, x];
    expect(sortNotes(input).map((n) => n.id)).toEqual(["x", "y"]);
    expect(input.map((n) => n.id)).toEqual(["y", "x"]);
  });
});

describe("filterNotes", () => {
  const list = [note({ id: "1", title: "Groceries", body: "milk, eggs" }), note({ id: "2", title: "Ideas", body: "Learn SPANISH" }), note({ id: "3", title: "", body: "" })];
  it("matches the title and the body, ignoring case", () => {
    expect(filterNotes(list, "grocer").map((n) => n.id)).toEqual(["1"]);
    expect(filterNotes(list, "spanish").map((n) => n.id)).toEqual(["2"]);
    expect(filterNotes(list, "EGGS").map((n) => n.id)).toEqual(["1"]);
  });
  it("returns everything for a blank query and nothing when nothing matches", () => {
    expect(filterNotes(list, "   ")).toHaveLength(3);
    expect(filterNotes(list, "zzz")).toEqual([]);
  });
  it("keeps the order it was given", () => {
    expect(filterNotes(list, "e").map((n) => n.id)).toEqual(["1", "2"]);
  });
});

describe("notePreview", () => {
  it("drops blank lines and surrounding space", () => {
    expect(notePreview("\n  first line  \n\n\n second \n")).toBe("first line\nsecond");
  });
  it("cuts long text with an ellipsis", () => {
    const p = notePreview("x".repeat(500), 100);
    expect(p).toHaveLength(101);
    expect(p.endsWith("…")).toBe(true);
  });
});

describe("blank notes and limits", () => {
  it("a note with only whitespace is blank", () => {
    expect(isBlankNote({ title: "  ", body: "\n " })).toBe(true);
    expect(isBlankNote({ title: "a", body: "" })).toBe(false);
    expect(isBlankNote({ title: "", body: "b" })).toBe(false);
  });
  it("clamps to the database limits", () => {
    const r = clampNoteText("t".repeat(NOTE_TITLE_MAX + 5), "b".repeat(NOTE_BODY_MAX + 5));
    expect(r.title).toHaveLength(NOTE_TITLE_MAX);
    expect(r.body).toHaveLength(NOTE_BODY_MAX);
  });
});

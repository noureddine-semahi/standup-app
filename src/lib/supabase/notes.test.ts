import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { table: string; op: string; args: unknown[] };
const state = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; args: unknown[] }[],
  rows: [] as Record<string, unknown>[],
  /** what an update/insert "returns": null means no row matched (revision mismatch / not the owner) */
  writeResult: undefined as Record<string, unknown> | null | undefined,
  error: null as unknown,
  userId: "u1",
  signedOut: false,
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const rec = (op: string, ...args: unknown[]) => state.calls.push({ table, op, args });
      const chain: Record<string, unknown> = {};
      const out = (data: unknown) => ({ data: state.error ? null : data, error: state.error });
      Object.assign(chain, {
        select: (...a: unknown[]) => (rec("select", ...a), chain),
        eq: (...a: unknown[]) => (rec("eq", ...a), chain),
        order: (...a: unknown[]) => (rec("order", ...a), chain),
        insert: (...a: unknown[]) => (rec("insert", ...a), chain),
        update: (...a: unknown[]) => (rec("update", ...a), chain),
        delete: (...a: unknown[]) => (rec("delete", ...a), chain),
        single: async () => out(state.writeResult ?? {}),
        maybeSingle: async () => out(state.writeResult === undefined ? null : state.writeResult),
        then: (resolve: (v: unknown) => void) => {
          const wrote = state.calls.some((c) => c.op === "insert" || c.op === "update" || c.op === "delete");
          resolve(out(wrote ? null : state.rows));
        },
      });
      return chain;
    },
  },
}));

vi.mock("@/lib/supabase/db", () => ({
  getCurrentUserId: async () => {
    if (state.signedOut) throw new Error("Not signed in");
    return state.userId;
  },
}));

import { createNote, deleteNote, isNotesUnavailableError, listNotes, saveNoteText, setNotePinned } from "./notes";

const row = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  title: "T",
  body: "B",
  pinned: false,
  revision: 2,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  ...over,
});
const eqs = () => state.calls.filter((c) => c.op === "eq").map((c) => c.args as [string, unknown]);
const ops = () => state.calls.map((c) => c.op);

beforeEach(() => {
  state.calls = [];
  state.rows = [];
  state.writeResult = undefined;
  state.error = null;
  state.userId = "u1";
  state.signedOut = false;
});

describe("listNotes", () => {
  it("reads only the signed-in user's notes and returns them pinned first, then newest", async () => {
    state.rows = [row({ id: "a", updated_at: "2026-11-01T00:00:00Z" }), row({ id: "b", updated_at: "2026-11-03T00:00:00Z" }), row({ id: "c", pinned: true, updated_at: "2026-10-01T00:00:00Z" })];
    const notes = await listNotes();
    expect(notes.map((n) => n.id)).toEqual(["c", "b", "a"]);
    expect(eqs()).toContainEqual(["user_id", "u1"]);
    expect(state.calls.every((c) => c.table === "notes")).toBe(true);
    expect(notes[0]).toMatchObject({ pinned: true, revision: 2, createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
  });
  it("is empty for a user with no notes, and surfaces errors", async () => {
    await expect(listNotes()).resolves.toEqual([]);
    state.error = { code: "XX000", message: "boom" };
    await expect(listNotes()).rejects.toMatchObject({ message: "boom" });
  });
});

describe("createNote", () => {
  it("inserts an empty note owned by the session user (the owner is never taken from the caller)", async () => {
    state.writeResult = row({ id: "new", title: "", body: "", revision: 0 });
    const n = await createNote();
    const insert = state.calls.find((c) => c.op === "insert")!;
    expect(insert.args[0]).toEqual({ user_id: "u1", title: "", body: "" });
    expect(n).toMatchObject({ id: "new", title: "", body: "", pinned: false, revision: 0 });
  });
});

describe("saveNoteText", () => {
  it("updates only the text, scoped to the note, its owner and the revision the editor loaded", async () => {
    state.writeResult = row({ revision: 3, title: "New", body: "Text" });
    const r = await saveNoteText("n1", 2, { title: "New", body: "Text" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.note.revision).toBe(3);
    expect(state.calls.find((c) => c.op === "update")!.args[0]).toEqual({ title: "New", body: "Text" });
    expect(eqs()).toEqual(expect.arrayContaining([["id", "n1"], ["user_id", "u1"], ["revision", 2]]));
  });
  it("reports a conflict, and writes nothing else, when no row matched (stale revision or not the owner)", async () => {
    state.writeResult = null;
    await expect(saveNoteText("n1", 1, { title: "x", body: "y" })).resolves.toEqual({ status: "conflict" });
  });
  it("clamps over-long text to the database limits instead of failing", async () => {
    state.writeResult = row();
    await saveNoteText("n1", 2, { title: "t".repeat(500), body: "b".repeat(30000) });
    const sent = state.calls.find((c) => c.op === "update")!.args[0] as { title: string; body: string };
    expect(sent.title).toHaveLength(200);
    expect(sent.body).toHaveLength(20000);
  });
  it("throws real errors so the editor can show them", async () => {
    state.error = { code: "08006", message: "connection lost" };
    await expect(saveNoteText("n1", 2, { title: "", body: "" })).rejects.toMatchObject({ message: "connection lost" });
  });
});

describe("setNotePinned", () => {
  it("updates only pinned, with the same owner and revision scoping", async () => {
    state.writeResult = row({ pinned: true, revision: 3 });
    const r = await setNotePinned("n1", 2, true);
    expect(r.status).toBe("ok");
    expect(state.calls.find((c) => c.op === "update")!.args[0]).toEqual({ pinned: true });
    expect(eqs()).toEqual(expect.arrayContaining([["id", "n1"], ["user_id", "u1"], ["revision", 2]]));
  });
  it("conflicts on a stale revision", async () => {
    state.writeResult = null;
    await expect(setNotePinned("n1", 0, true)).resolves.toEqual({ status: "conflict" });
  });
});

describe("deleteNote", () => {
  it("deletes by id AND owner, nothing broader", async () => {
    await deleteNote("n1");
    expect(ops()).toContain("delete");
    expect(eqs()).toEqual(expect.arrayContaining([["id", "n1"], ["user_id", "u1"]]));
  });
});

describe("authorization boundaries", () => {
  it("every operation refuses to run when nobody is signed in, before touching the database", async () => {
    state.signedOut = true;
    for (const run of [() => listNotes(), () => createNote(), () => saveNoteText("n1", 0, { title: "", body: "" }), () => setNotePinned("n1", 0, true), () => deleteNote("n1")]) {
      await expect(run()).rejects.toThrow("Not signed in");
    }
    expect(state.calls).toHaveLength(0);
  });
  it("the owner id always comes from the session: a different user gets a different scope, and no function takes a user id", async () => {
    state.userId = "someone-else";
    state.writeResult = row();
    await saveNoteText("n1", 2, { title: "a", body: "b" });
    await deleteNote("n1");
    expect(eqs().filter((e) => e[0] === "user_id").every((e) => e[1] === "someone-else")).toBe(true);
    for (const fn of [listNotes, createNote, saveNoteText, setNotePinned, deleteNote]) {
      expect(fn.toString()).not.toMatch(/userId:\s*string/);
    }
  });
  it("every statement targets the notes table only", async () => {
    state.writeResult = row();
    await listNotes();
    await createNote();
    await saveNoteText("n1", 0, { title: "", body: "" });
    await setNotePinned("n1", 0, false);
    await deleteNote("n1");
    expect([...new Set(state.calls.map((c: Call) => c.table))]).toEqual(["notes"]);
  });
});

describe("isNotesUnavailableError", () => {
  it("recognises a missing table (migration not applied) but not other failures", () => {
    expect(isNotesUnavailableError({ code: "42P01", message: "x" })).toBe(true);
    expect(isNotesUnavailableError({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isNotesUnavailableError({ message: "Could not find the table 'public.notes' in the schema cache" })).toBe(true);
    expect(isNotesUnavailableError({ code: "08006", message: "connection lost" })).toBe(false);
    expect(isNotesUnavailableError(null)).toBe(false);
  });
});

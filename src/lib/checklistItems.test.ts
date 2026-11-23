import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// In-memory stand-in for the Supabase client that applies real UPDATEs, so the tests can prove which columns each helper writes.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const state = vi.hoisted(() => ({ rows: [] as Record<string, any>[], calls: [] as string[], payloads: [] as Record<string, any>[], failWith: null as string | null })); // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock("@/lib/supabase/client", () => {
  type Result = { data: unknown; error: { message: string } | null };
  class Query implements PromiseLike<Result> {
    private filters: ((r: Row) => boolean)[] = [];
    private patch: Row | null = null;
    constructor(private table: string) {}
    update(patch: Row) {
      this.patch = patch;
      state.payloads.push(patch);
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((r) => r[col] === val);
      return this;
    }
    select() {
      return this;
    }
    private run(): Result {
      state.calls.push(`${this.patch ? "update" : "select"}:${this.table}`);
      if (state.failWith) return { data: null, error: { message: state.failWith } };
      const hit = state.rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.patch) hit.forEach((r) => Object.assign(r, this.patch));
      return { data: hit, error: null };
    }
    single(): Promise<Result> {
      const r = this.run();
      const rows = r.data as Row[] | null;
      if (r.error) return Promise.resolve(r);
      if (!rows || rows.length !== 1) return Promise.resolve({ data: null, error: { message: "no row" } });
      return Promise.resolve({ data: rows[0], error: null });
    }
    then<A = Result, B = never>(f?: ((v: Result) => A | PromiseLike<A>) | null, r?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return Promise.resolve(this.run()).then(f, r);
    }
  }
  return { supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } }, error: null }) }, from: (t: string) => new Query(t) } };
});

import { setChecklistItemStatus, updateChecklistItemText } from "./supabase/db";

const base = { goal_id: "g1", user_id: "u1", created_at: "2026-11-01T00:00:00Z" };
beforeEach(() => {
  state.rows = [
    { id: "c1", ...base, text: "Milk", is_checked: false, status: "pending", position: 0 },
    { id: "c2", ...base, text: "Eggs", is_checked: false, status: "missing", position: 1 },
  ];
  state.calls = [];
  state.payloads = [];
  state.failWith = null;
});

describe("setChecklistItemStatus", () => {
  it("writes status AND a consistent is_checked, for each of the three statuses", async () => {
    await setChecklistItemStatus("c1", "completed");
    await setChecklistItemStatus("c1", "missing");
    await setChecklistItemStatus("c1", "pending");
    expect(state.payloads).toEqual([
      { status: "completed", is_checked: true },
      { status: "missing", is_checked: false },
      { status: "pending", is_checked: false },
    ]);
  });
  it("changes only that item and leaves text, position and the other items alone", async () => {
    await setChecklistItemStatus("c1", "completed");
    expect(state.rows[0]).toMatchObject({ id: "c1", text: "Milk", position: 0, status: "completed", is_checked: true });
    expect(state.rows[1]).toMatchObject({ id: "c2", status: "missing", is_checked: false });
  });
  it("refuses an unknown status before any request, and surfaces database errors", async () => {
    await expect(setChecklistItemStatus("c1", "done" as never)).rejects.toThrow(/invalid/i);
    expect(state.calls).toEqual([]);
    state.failWith = "permission denied";
    await expect(setChecklistItemStatus("c1", "completed")).rejects.toMatchObject({ message: "permission denied" });
  });
});

describe("updateChecklistItemText", () => {
  it("writes ONLY the trimmed text; id, position, status and goal are untouched", async () => {
    const saved = await updateChecklistItemText("c2", "  Free-range eggs ");
    expect(state.payloads).toEqual([{ text: "Free-range eggs" }]);
    expect(saved).toMatchObject({ id: "c2", text: "Free-range eggs", position: 1, status: "missing", goal_id: "g1" });
  });
  it("rejects empty or whitespace text before any request", async () => {
    for (const bad of ["", "   "]) await expect(updateChecklistItemText("c1", bad)).rejects.toThrow(/required/i);
    expect(state.calls).toEqual([]);
    expect(state.rows[0].text).toBe("Milk");
  });
  it("rejects when the item does not exist", async () => {
    await expect(updateChecklistItemText("nope", "x")).rejects.toBeTruthy();
  });
});

describe("migration 20261218000100 (shape)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261218000100_goal_checklist_item_status.sql"), "utf8").replace(/\r\n/g, "\n");
  it("is one transaction that adds a constrained status column, backfills from is_checked, and keeps is_checked", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/commit;\s*$/);
    expect(sql).toMatch(/add column if not exists status text not null default 'pending'/);
    expect(sql).toMatch(/check \(status in \('pending', 'completed', 'missing'\)\)/);
    expect(sql).toMatch(/case when is_checked then 'completed' else 'pending' end/);
    expect(sql).not.toMatch(/drop column/i);
  });
  it("syncs with a single BEFORE row trigger that edits NEW only (no recursion)", () => {
    expect(sql).toMatch(/before insert or update on public\.goal_checklist_items/);
    expect(sql).toMatch(/new\.is_checked := \(new\.status = 'completed'\)/);
    const fn = sql.slice(sql.indexOf("create or replace function"), sql.indexOf("drop trigger"));
    expect(fn).not.toMatch(/\b(update|insert|delete)\s+(into\s+)?public\./i);
  });
});

describe("reschedule copy", () => {
  it("selects and re-inserts status so Missing/Completed survive a reschedule", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/supabase/db.ts"), "utf8");
    expect(src).toContain('.select("text, is_checked, status, position")');
    expect(src).toMatch(/is_checked: it\.status === "completed",\s*status: it\.status,/);
  });
});

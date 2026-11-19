import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory stand-in for the Supabase client, rich enough for updateBacklogGoal: it applies a real UPDATE to a stored row, so the test can prove which columns
// changed and which did not.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const state = vi.hoisted(() => ({ rows: [] as Record<string, any>[], calls: [] as string[], updatePayloads: [] as Record<string, any>[], failWith: null as string | null })); // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock("@/lib/supabase/client", () => {
  type Result = { data: unknown; error: { message: string } | null };
  class Query implements PromiseLike<Result> {
    private filters: ((r: Row) => boolean)[] = [];
    private patch: Row | null = null;
    constructor(private table: string) {}
    update(patch: Row) {
      this.patch = patch;
      state.updatePayloads.push(patch);
      return this;
    }
    eq(col: string, val: unknown) {
      state.calls.push(`eq:${col}`);
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
      if (!rows || rows.length !== 1) return Promise.resolve({ data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } });
      return Promise.resolve({ data: rows[0], error: null });
    }
    then<A = Result, B = never>(onfulfilled?: ((v: Result) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } }, error: null }) },
      from: (table: string) => new Query(table),
    },
  };
});

import { updateBacklogGoal } from "./supabase/db";

const longTerm = { id: "l1", user_id: "u1", title: "Learn Spanish", details: "daily", priority: 2, target_date: "2027-06-01", category: "Growth", created_at: "2026-10-01T08:00:00.000Z" };
const plain = { id: "b1", user_id: "u1", title: "Call the bank", details: "Ask about the fee", priority: 3, target_date: null, category: null, created_at: "2026-11-01T09:30:00.000Z" };
const stranger = { id: "b9", user_id: "someone-else", title: "Not mine", details: null, priority: 3, target_date: null, category: null, created_at: "2026-11-01T00:00:00.000Z" };

beforeEach(() => {
  state.rows = [{ ...plain }, { ...longTerm }, { ...stranger }];
  state.calls = [];
  state.updatePayloads = [];
  state.failWith = null;
});

describe("updateBacklogGoal", () => {
  it("writes title, details and priority, returns the saved row, and keeps its id, owner and creation date", async () => {
    const saved = await updateBacklogGoal("b1", { title: "Call Chase Bank", details: "Dispute the fee", priority: 1 });
    expect(saved).toMatchObject({ id: "b1", user_id: "u1", title: "Call Chase Bank", details: "Dispute the fee", priority: 1, created_at: plain.created_at });
    expect(state.rows.find((r) => r.id === "b1")).toMatchObject({ title: "Call Chase Bank", details: "Dispute the fee", priority: 1 });
  });

  it("the UPDATE contains ONLY those three columns (nothing about dates, category, ids or scheduling can be written)", async () => {
    await updateBacklogGoal("b1", { title: "Call Chase Bank", details: "x", priority: 2 });
    expect(state.updatePayloads).toHaveLength(1);
    expect(Object.keys(state.updatePayloads[0]).sort()).toEqual(["details", "priority", "title"]);
  });

  it("a Long-Term Goal keeps its target date and category through an edit", async () => {
    const saved = await updateBacklogGoal("l1", { title: "Learn Spanish well", details: null, priority: 1 });
    expect(saved).toMatchObject({ id: "l1", title: "Learn Spanish well", details: null, priority: 1, target_date: "2027-06-01", category: "Growth", created_at: longTerm.created_at });
  });

  it("other rows are untouched, and the update is scoped to this id AND this owner", async () => {
    await updateBacklogGoal("b1", { title: "Call Chase Bank", priority: 1 });
    expect(state.rows.find((r) => r.id === "l1")).toEqual(longTerm);
    expect(state.rows.find((r) => r.id === "b9")).toEqual(stranger);
    expect(state.calls).toEqual(expect.arrayContaining(["eq:id", "eq:user_id", "update:goal_backlog"]));
  });

  it("trims the title and details; blank or missing details become null", async () => {
    await updateBacklogGoal("b1", { title: "  Spaced  ", details: "  note  ", priority: 3 });
    expect(state.updatePayloads[0]).toEqual({ title: "Spaced", details: "note", priority: 3 });
    await updateBacklogGoal("b1", { title: "Spaced", details: "   ", priority: 3 });
    expect(state.updatePayloads[1].details).toBeNull();
    await updateBacklogGoal("b1", { title: "Spaced", priority: 3 });
    expect(state.updatePayloads[2].details).toBeNull();
  });

  it("refuses an empty or whitespace-only title before any request", async () => {
    for (const bad of ["", "   "]) await expect(updateBacklogGoal("b1", { title: bad, priority: 3 })).rejects.toThrow(/title is required/i);
    expect(state.calls).toEqual([]);
    expect(state.rows.find((r) => r.id === "b1")).toEqual(plain);
  });

  it("refuses a priority outside 1-5 or a non-integer, before any request; accepts the edges", async () => {
    for (const bad of [0, 6, 2.5, NaN, -1]) await expect(updateBacklogGoal("b1", { title: "ok", priority: bad })).rejects.toThrow(/priority/i);
    expect(state.calls).toEqual([]);
    await expect(updateBacklogGoal("b1", { title: "ok", priority: 1 })).resolves.toMatchObject({ priority: 1 });
    await expect(updateBacklogGoal("b1", { title: "ok", priority: 5 })).resolves.toMatchObject({ priority: 5 });
  });

  it("rejects (instead of silently doing nothing) when the row doesn't exist or isn't the caller's", async () => {
    await expect(updateBacklogGoal("missing", { title: "x", priority: 3 })).rejects.toBeTruthy();
    await expect(updateBacklogGoal("b9", { title: "hijack", priority: 1 })).rejects.toBeTruthy(); // someone else's row
    expect(state.rows.find((r) => r.id === "b9")).toEqual(stranger);
  });

  it("throws the database error unchanged", async () => {
    state.failWith = "permission denied";
    await expect(updateBacklogGoal("b1", { title: "x", priority: 3 })).rejects.toMatchObject({ message: "permission denied" });
  });
});

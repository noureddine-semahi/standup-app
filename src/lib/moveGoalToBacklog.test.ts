import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory stand-in for the Supabase client, just rich enough for deleteGoal / assertGoalDeletable / moveGoalToBacklog. The REAL db.ts code runs against it, so these
// tests cover the actual order of operations (check, insert, delete, cleanup) and not a re-implementation of it.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Hooks = { log: string[]; failGoalDelete: boolean; failBacklogDelete: boolean; afterBacklogInsert: (() => void) | null };
const state = vi.hoisted(
  () => ({ tables: {} as Record<string, Record<string, any>[]>, seq: 0, hooks: { log: [], failGoalDelete: false, failBacklogDelete: false, afterBacklogInsert: null } as unknown as Hooks }) // eslint-disable-line @typescript-eslint/no-explicit-any
);

vi.mock("@/lib/supabase/client", () => {
  type Result = { data: unknown; error: { message: string } | null };
  const rowsOf = (t: string) => (state.tables[t] ??= []);
  class Query implements PromiseLike<Result> {
    private filters: ((r: Row) => boolean)[] = [];
    private max: number | null = null;
    private inserts: Row[] | null = null;
    private deleting = false;
    constructor(private table: string) {}
    select() {
      return this;
    }
    insert(rows: Row | Row[]) {
      this.inserts = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    delete() {
      this.deleting = true;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((r) => r[col] === val);
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    private run(): Result {
      const table = rowsOf(this.table);
      if (this.inserts) {
        const created = this.inserts.map((input) => ({ id: `${this.table}-${++state.seq}`, created_at: "2026-11-18T12:00:00.000Z", ...input }));
        table.push(...created);
        state.hooks.log.push(`insert:${this.table}`);
        if (this.table === "goal_backlog") state.hooks.afterBacklogInsert?.();
        return { data: created, error: null };
      }
      if (this.deleting) {
        state.hooks.log.push(`delete:${this.table}`);
        if (this.table === "goals" && state.hooks.failGoalDelete) return { data: null, error: { message: "network down while deleting the goal" } };
        if (this.table === "goal_backlog" && state.hooks.failBacklogDelete) return { data: null, error: { message: "cleanup failed" } };
        const doomed = table.filter((r) => this.filters.every((f) => f(r)));
        state.tables[this.table] = table.filter((r) => !doomed.includes(r));
        return { data: doomed, error: null };
      }
      state.hooks.log.push(`select:${this.table}`);
      let rows = table.filter((r) => this.filters.every((f) => f(r)));
      if (this.max !== null) rows = rows.slice(0, this.max);
      return { data: rows, error: null };
    }
    single(): Promise<Result> {
      const r = this.run();
      return Promise.resolve({ data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error });
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

import { assertGoalDeletable, deleteGoal, moveGoalToBacklog, GoalDeleteBlockedError, type Goal } from "./supabase/db";

const T = (name: string) => (state.tables[name] ??= []);
const goalRow = { id: "g1", user_id: "u1", plan_id: "p1", title: "Call the bank", details: "Ask about the fee", status: "not_started", priority: 2, sort_order: 0 };
const goal = goalRow as unknown as Goal;

beforeEach(() => {
  state.tables = {};
  state.seq = 0;
  state.hooks.log = [];
  state.hooks.failGoalDelete = false;
  state.hooks.failBacklogDelete = false;
  state.hooks.afterBacklogInsert = null;
  T("goals").push({ ...goalRow });
});

const backlogRows = () => T("goal_backlog");
const goalStillThere = () => T("goals").some((g) => g.id === "g1");

describe("moveGoalToBacklog: a blocked move creates nothing", () => {
  const blockedCases: [string, () => void, "reschedule" | "assignment"][] = [
    ["a Task created by a reschedule (a reschedule TARGET)", () => T("goal_reschedules").push({ id: "r1", from_goal_id: "other", materialized_goal_id: "g1" }), "reschedule"],
    ["a Task that was rescheduled away (a reschedule SOURCE)", () => T("goal_reschedules").push({ id: "r1", from_goal_id: "g1", materialized_goal_id: null }), "reschedule"],
    ["an assignment SOURCE Task", () => T("goal_assignments").push({ id: "a1", assigner_goal_id: "g1", recipient_goal_id: "x" }), "assignment"],
    ["an assignment RECIPIENT Task", () => T("goal_assignments").push({ id: "a1", assigner_goal_id: "x", recipient_goal_id: "g1" }), "assignment"],
  ];

  it.each(blockedCases)("%s: rejects with GoalDeleteBlockedError, inserts NO Backlog row, deletes nothing", async (_name, seed, reason) => {
    seed();
    const attempt = moveGoalToBacklog(goal);
    await expect(attempt).rejects.toBeInstanceOf(GoalDeleteBlockedError);
    await expect(attempt).rejects.toMatchObject({ reason });
    expect(backlogRows()).toHaveLength(0);
    expect(goalStillThere()).toBe(true);
    expect(state.hooks.log.some((op) => op.startsWith("insert:") || op.startsWith("delete:"))).toBe(false);
  });

  it("repeated blocked attempts still create zero Backlog rows", async () => {
    T("goal_reschedules").push({ id: "r1", from_goal_id: "other", materialized_goal_id: "g1" });
    for (let i = 0; i < 5; i++) await expect(moveGoalToBacklog(goal)).rejects.toBeInstanceOf(GoalDeleteBlockedError);
    expect(backlogRows()).toHaveLength(0);
    expect(goalStillThere()).toBe(true);
  });

  it("never reports success: a blocked move rejects instead of resolving", async () => {
    T("goal_assignments").push({ id: "a1", assigner_goal_id: "g1", recipient_goal_id: "x" });
    const outcome = await moveGoalToBacklog(goal).then(
      () => "resolved",
      () => "rejected"
    );
    expect(outcome).toBe("rejected");
  });
});

describe("moveGoalToBacklog: an eligible Task moves as before", () => {
  it("checks first, then inserts the Backlog row, then deletes the goal, and returns the new row", async () => {
    const created = await moveGoalToBacklog(goal);
    expect(created).toMatchObject({ title: "Call the bank", details: "Ask about the fee", priority: 2, user_id: "u1" });
    expect(backlogRows()).toHaveLength(1);
    expect(backlogRows()[0].id).toBe(created.id);
    expect(goalStillThere()).toBe(false);
    const log = state.hooks.log;
    const firstWrite = log.findIndex((op) => op.startsWith("insert:") || op.startsWith("delete:"));
    expect(log.slice(0, firstWrite).filter((op) => op === "select:goal_reschedules").length).toBeGreaterThanOrEqual(2); // the eligibility check ran before any write
    expect(log[firstWrite]).toBe("insert:goal_backlog");
    expect(log.filter((op) => op === "insert:goal_backlog")).toHaveLength(1);
  });

  it("a missing priority defaults to 3, and missing details become null", async () => {
    const created = await moveGoalToBacklog({ ...goal, priority: undefined, details: undefined } as unknown as Goal);
    expect(created).toMatchObject({ priority: 3, details: null });
  });
});

describe("moveGoalToBacklog: a failure after the insert cleans up only its own row", () => {
  it("the goal delete fails: the Task stays, the NEW Backlog row is removed, and the original error is thrown", async () => {
    T("goal_backlog").push({ id: "pre-existing", user_id: "u1", title: "Something else", details: null, priority: 3 });
    state.hooks.failGoalDelete = true;
    await expect(moveGoalToBacklog(goal)).rejects.toMatchObject({ message: "network down while deleting the goal" });
    expect(goalStillThere()).toBe(true);
    expect(backlogRows().map((r) => r.id)).toEqual(["pre-existing"]); // only the row this call created was removed
  });

  it("the Task becomes protected between the check and the delete: the Backlog row is removed and the block is reported", async () => {
    state.hooks.afterBacklogInsert = () => T("goal_reschedules").push({ id: "r-late", from_goal_id: "g1", materialized_goal_id: null });
    await expect(moveGoalToBacklog(goal)).rejects.toBeInstanceOf(GoalDeleteBlockedError);
    expect(backlogRows()).toHaveLength(0);
    expect(goalStillThere()).toBe(true);
  });

  it("if the cleanup itself fails, the ORIGINAL error is still the one reported (never success, never the cleanup error)", async () => {
    state.hooks.failGoalDelete = true;
    state.hooks.failBacklogDelete = true;
    await expect(moveGoalToBacklog(goal)).rejects.toMatchObject({ message: "network down while deleting the goal" });
    expect(goalStillThere()).toBe(true);
  });
});

describe("one definition of 'deletable' for deleteGoal and moveGoalToBacklog", () => {
  it("assertGoalDeletable passes for an eligible Task and throws the blocked error for a protected one", async () => {
    await expect(assertGoalDeletable("g1")).resolves.toBeUndefined();
    T("goal_reschedules").push({ id: "r1", from_goal_id: "g1", materialized_goal_id: null });
    await expect(assertGoalDeletable("g1")).rejects.toBeInstanceOf(GoalDeleteBlockedError);
  });

  it("deleteGoal still deletes an eligible Task and still refuses a protected one (unchanged behavior)", async () => {
    T("goal_reschedules").push({ id: "r1", from_goal_id: "other", materialized_goal_id: "g1" });
    await expect(deleteGoal("g1")).rejects.toBeInstanceOf(GoalDeleteBlockedError);
    expect(goalStillThere()).toBe(true);
    state.tables.goal_reschedules = [];
    await deleteGoal("g1");
    expect(goalStillThere()).toBe(false);
  });

  it("moveGoalToBacklog and deleteGoal agree on every protected case", async () => {
    const seeds: (() => void)[] = [
      () => T("goal_reschedules").push({ id: "r", from_goal_id: "g1" }),
      () => T("goal_reschedules").push({ id: "r", from_goal_id: "x", materialized_goal_id: "g1" }),
      () => T("goal_assignments").push({ id: "a", assigner_goal_id: "g1" }),
      () => T("goal_assignments").push({ id: "a", recipient_goal_id: "g1" }),
    ];
    for (const seed of seeds) {
      state.tables = { goals: [{ ...goalRow }] };
      seed();
      const viaDelete = await deleteGoal("g1").then(() => "ok", (e) => (e as GoalDeleteBlockedError).reason);
      const viaMove = await moveGoalToBacklog(goal).then(() => "ok", (e) => (e as GoalDeleteBlockedError).reason);
      expect(viaMove).toBe(viaDelete);
      expect(viaMove).not.toBe("ok");
    }
  });
});

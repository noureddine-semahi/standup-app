import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// An in-memory stand-in for the Supabase client, just rich enough for getOrCreatePlan / materializeReschedules / rescheduleGoalToDate. It exercises the REAL db.ts code,
// so these tests cover the whole reschedule -> open-the-destination-day flow, not a re-implementation of it.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const USER = "u1";
const store = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, any>[]>, seq: 0, tick: 0 })); // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock("@/lib/supabase/client", () => {
  type Result = { data: unknown; error: { code?: string; message: string } | null };
  const rowsOf = (t: string) => (store.tables[t] ??= []);
  class Query implements PromiseLike<Result> {
    private filters: ((r: Row) => boolean)[] = [];
    private orderBy: { col: string; asc: boolean } | null = null;
    private max: number | null = null;
    private inserts: Row[] | null = null;
    private patch: Row | null = null;
    constructor(private table: string) {}
    select() {
      return this;
    }
    insert(rows: Row | Row[]) {
      this.inserts = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    update(patch: Row) {
      this.patch = patch;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((r) => r[col] === val);
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.filters.push((r) => vals.includes(r[col]));
      return this;
    }
    order(col: string, opts?: { ascending?: boolean }) {
      this.orderBy = { col, asc: opts?.ascending !== false };
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    private run(): Result {
      const table = rowsOf(this.table);
      if (this.inserts) {
        const created: Row[] = [];
        for (const input of this.inserts) {
          if (this.table === "daily_plans" && table.some((r) => r.user_id === input.user_id && r.plan_date === input.plan_date)) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          const row: Row = { id: `${this.table}-${++store.seq}`, created_at: new Date(Date.UTC(2026, 10, 1, 0, 0, ++store.tick)).toISOString(), ...input };
          table.push(row);
          created.push(row);
        }
        return { data: created, error: null };
      }
      let rows = table.filter((r) => this.filters.every((f) => f(r)));
      if (this.patch) {
        rows.forEach((r) => Object.assign(r, this.patch));
        return { data: rows, error: null };
      }
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.max !== null) rows = rows.slice(0, this.max);
      return { data: rows, error: null };
    }
    maybeSingle(): Promise<Result> {
      const r = this.run();
      return Promise.resolve({ data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error });
    }
    single(): Promise<Result> {
      return this.maybeSingle();
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

import { getOrCreatePlan, rescheduleGoalToDate, type Goal } from "./supabase/db";

const TOMORROW = "2026-11-19";
const FRIDAY = "2026-11-20";
const MONDAY = "2026-11-23";
const LATER = "2026-11-25";

const T = (name: string) => (store.tables[name] ??= []);
const flush = () => new Promise((r) => setTimeout(r, 0)); // lets the un-awaited timeline-note write finish

async function planGoals(dateISO: string) {
  const plan = T("daily_plans").find((p) => p.plan_date === dateISO);
  return plan ? T("goals").filter((g) => g.plan_id === plan.id) : [];
}
const intents = () => T("goal_reschedules").filter((r) => r.materialized === false);
const markers = () => T("goal_reschedules").filter((r) => r.materialized === true);

/** A Task on today's plan, in a weekly recurring Goal, with a note, a checklist item and an attachment. */
function seedTask() {
  T("outcome_goals").push({ id: "og1", user_id: USER, goal_type: "recurring", recurrence_frequency: "weekly", recurrence_start_date: "2026-11-01", recurrence_target_count: 3 });
  T("daily_plans").push({ id: "plan-today", user_id: USER, plan_date: "2026-11-18", status: "draft" });
  const goal = { id: "g1", user_id: USER, plan_id: "plan-today", title: "Call the bank", details: "Ask about the fee", status: "not_started", priority: 2, sort_order: 0, outcome_goal_id: "og1", outcome_goal_cycle_id: "cycle-origin" };
  T("goals").push(goal);
  T("goal_notes").push({ id: "n1", user_id: USER, goal_id: "g1", note: "Account ends 4242", kind: "note", created_at: "2026-11-10T09:00:00.000Z" });
  T("goal_checklist_items").push({ id: "c1", user_id: USER, goal_id: "g1", text: "Bring statement", is_checked: true, status: "completed", position: 0 });
  T("goal_checklist_items").push({ id: "c2", user_id: USER, goal_id: "g1", text: "Old receipt", is_checked: false, status: "missing", position: 1 });
  T("goal_checklist_items").push({ id: "c3", user_id: USER, goal_id: "g1", text: "Photo ID", is_checked: false, status: "pending", position: 2 });
  T("goal_attachments").push({ id: "a1", user_id: USER, goal_id: "g1", storage_path: "u1/files/statement.pdf", file_name: "statement.pdf", mime_type: "application/pdf", size_bytes: 1234 });
  return goal as unknown as Goal;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T12:00:00"));
  store.tables = {};
  store.seq = 0;
  store.tick = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a single reschedule (unchanged behavior)", () => {
  it("creates exactly one goal on the destination day, with its details, Goal and cycle membership, notes, checklist and attachments; the original keeps its history", async () => {
    const goal = seedTask();
    await rescheduleGoalToDate({ goal, toDateISO: TOMORROW, reason: "Busy day" }); // tomorrow materializes immediately
    await flush();
    const dest = await planGoals(TOMORROW);
    expect(dest).toHaveLength(1);
    expect(dest[0]).toMatchObject({ title: "Call the bank", details: "Ask about the fee", status: "not_started", priority: 2, outcome_goal_id: "og1" });
    const cycle = T("outcome_goal_cycles").find((c) => c.id === dest[0].outcome_goal_cycle_id);
    expect(cycle).toBeTruthy();
    expect(cycle!.cycle_start <= TOMORROW && TOMORROW <= cycle!.cycle_end).toBe(true); // the destination day's OWN cycle, never the source row's
    expect(dest[0].outcome_goal_cycle_id).not.toBe("cycle-origin");
    expect(T("goal_notes").filter((n) => n.goal_id === dest[0].id).map((n) => n.note)).toContain("Account ends 4242");
    expect(T("goal_checklist_items").filter((i) => i.goal_id === dest[0].id)).toMatchObject([
      { text: "Bring statement", is_checked: true, status: "completed", position: 0 },
      { text: "Old receipt", is_checked: false, status: "missing", position: 1 }, // Missing is carried, not reset to pending
      { text: "Photo ID", is_checked: false, status: "pending", position: 2 },
    ]);
    expect(T("goal_attachments").filter((a) => a.goal_id === dest[0].id)).toMatchObject([{ storage_path: "u1/files/statement.pdf", file_name: "statement.pdf" }]);
    // lineage and the original
    expect(markers()).toHaveLength(1);
    expect(markers()[0]).toMatchObject({ from_goal_id: "g1", to_date: TOMORROW, materialized_goal_id: dest[0].id });
    expect(T("goals").find((g) => g.id === "g1")).toMatchObject({ status: "postponed", plan_id: "plan-today" });
    expect(T("goal_notes").some((n) => n.goal_id === "g1" && n.note === "Account ends 4242")).toBe(true);
    expect(T("goal_notes").some((n) => n.goal_id === "g1" && n.kind === "rescheduled")).toBe(true);
  });

  it("a later date materializes only when that day's plan is opened, and opening it again changes nothing", async () => {
    const goal = seedTask();
    await rescheduleGoalToDate({ goal, toDateISO: FRIDAY });
    expect(await planGoals(FRIDAY)).toHaveLength(0);
    await getOrCreatePlan(FRIDAY);
    expect(await planGoals(FRIDAY)).toHaveLength(1);
    await getOrCreatePlan(FRIDAY);
    await getOrCreatePlan(FRIDAY);
    expect(await planGoals(FRIDAY)).toHaveLength(1);
    expect(markers()).toHaveLength(1);
  });
});

describe("a Task rescheduled twice before the first move happens: the LATEST intent wins", () => {
  it("Friday -> Tomorrow: only Tomorrow receives the Task, even when Friday is opened afterward", async () => {
    const goal = seedTask();
    await rescheduleGoalToDate({ goal, toDateISO: FRIDAY });
    await rescheduleGoalToDate({ goal, toDateISO: TOMORROW }); // the Quick Add path; materializes tomorrow at once
    await flush();
    expect(await planGoals(TOMORROW)).toHaveLength(1);
    await getOrCreatePlan(FRIDAY);
    await getOrCreatePlan(FRIDAY);
    expect(await planGoals(FRIDAY)).toHaveLength(0);
    expect(T("goals").filter((g) => g.title === "Call the bank" && g.id !== "g1")).toHaveLength(1);
    expect(markers().map((m) => m.to_date)).toEqual([TOMORROW]);
  });

  it("Date A -> Date B (B later): only B materializes, whichever plan opens first", async () => {
    for (const order of [[FRIDAY, LATER], [LATER, FRIDAY]]) {
      store.tables = {};
      const goal = seedTask();
      await rescheduleGoalToDate({ goal, toDateISO: FRIDAY });
      await rescheduleGoalToDate({ goal, toDateISO: LATER });
      for (const d of order) await getOrCreatePlan(d);
      expect(await planGoals(FRIDAY), order.join(">")).toHaveLength(0);
      expect(await planGoals(LATER), order.join(">")).toHaveLength(1);
      expect(markers().map((m) => m.to_date)).toEqual([LATER]);
    }
  });

  it("Date A -> Date B (B EARLIER than A): only B materializes, whichever plan opens first", async () => {
    for (const order of [[FRIDAY, LATER], [LATER, FRIDAY]]) {
      store.tables = {};
      const goal = seedTask();
      await rescheduleGoalToDate({ goal, toDateISO: LATER });
      await rescheduleGoalToDate({ goal, toDateISO: FRIDAY });
      for (const d of order) await getOrCreatePlan(d);
      expect(await planGoals(LATER), order.join(">")).toHaveLength(0);
      expect(await planGoals(FRIDAY), order.join(">")).toHaveLength(1);
    }
  });

  it("A -> B -> A: the latest is A, so A materializes once and B never does", async () => {
    const goal = seedTask();
    await rescheduleGoalToDate({ goal, toDateISO: FRIDAY });
    await rescheduleGoalToDate({ goal, toDateISO: LATER });
    await rescheduleGoalToDate({ goal, toDateISO: FRIDAY });
    await getOrCreatePlan(LATER);
    await getOrCreatePlan(FRIDAY);
    expect(await planGoals(LATER)).toHaveLength(0);
    expect(await planGoals(FRIDAY)).toHaveLength(1);
    expect(intents().filter((r) => r.to_date === FRIDAY)).toHaveLength(2); // the pending rows are never touched
  });

  it("three dates: only the last one materializes", async () => {
    const goal = seedTask();
    for (const d of [FRIDAY, MONDAY, LATER]) await rescheduleGoalToDate({ goal, toDateISO: d });
    for (const d of [LATER, MONDAY, FRIDAY]) await getOrCreatePlan(d);
    expect((await planGoals(FRIDAY)).length + (await planGoals(MONDAY)).length).toBe(0);
    expect(await planGoals(LATER)).toHaveLength(1);
  });

  it("the superseded intent still materializes nothing after the winning destination has already materialized (and was opened first)", async () => {
    const goal = seedTask();
    await rescheduleGoalToDate({ goal, toDateISO: LATER });
    await rescheduleGoalToDate({ goal, toDateISO: TOMORROW });
    await flush();
    await getOrCreatePlan(TOMORROW);
    await getOrCreatePlan(LATER);
    expect(await planGoals(LATER)).toHaveLength(0);
    expect(await planGoals(TOMORROW)).toHaveLength(1);
  });

  it("different Tasks never supersede each other", async () => {
    const goalA = seedTask();
    T("goals").push({ id: "g2", user_id: USER, plan_id: "plan-today", title: "Pay rent", details: null, status: "not_started", priority: 3, sort_order: 1, outcome_goal_id: null, outcome_goal_cycle_id: null });
    const goalB = T("goals").find((g) => g.id === "g2") as unknown as Goal;
    await rescheduleGoalToDate({ goal: goalA, toDateISO: FRIDAY });
    await rescheduleGoalToDate({ goal: goalB, toDateISO: LATER });
    await getOrCreatePlan(FRIDAY);
    await getOrCreatePlan(LATER);
    expect((await planGoals(FRIDAY)).map((g) => g.title)).toEqual(["Call the bank"]);
    expect((await planGoals(LATER)).map((g) => g.title)).toEqual(["Pay rent"]);
  });
});

describe("repeated same-date reschedules", () => {
  it("the same Task rescheduled to the same date several times produces one destination goal", async () => {
    const goal = seedTask();
    for (let i = 0; i < 3; i++) await rescheduleGoalToDate({ goal, toDateISO: FRIDAY });
    expect(intents().filter((r) => r.to_date === FRIDAY)).toHaveLength(3);
    await getOrCreatePlan(FRIDAY);
    await getOrCreatePlan(FRIDAY);
    expect(await planGoals(FRIDAY)).toHaveLength(1);
    expect(markers()).toHaveLength(1);
  });

  it("the same applies to tomorrow, which materializes at once", async () => {
    const goal = seedTask();
    await rescheduleGoalToDate({ goal, toDateISO: TOMORROW });
    await rescheduleGoalToDate({ goal, toDateISO: TOMORROW });
    await flush();
    expect(await planGoals(TOMORROW)).toHaveLength(1);
  });
});

describe("materialized markers are results, not intents", () => {
  it("historical data: a marker for another date, newer than a genuine pending intent, does NOT supersede it", async () => {
    seedTask();
    // Old Production shape: the Task was rescheduled to X (materialized, marker written later) and then to Y (pending, the latest REAL intent).
    T("goal_reschedules").push(
      { id: "r-x", user_id: USER, from_goal_id: "g1", to_goal_id: "g1", from_date: "2026-11-18", to_date: FRIDAY, materialized: false, snapshot_title: "Call the bank", snapshot_details: "Ask about the fee", snapshot_priority: 2, created_at: "2026-11-18T10:00:00.000Z" },
      { id: "r-y", user_id: USER, from_goal_id: "g1", to_goal_id: "g1", from_date: "2026-11-18", to_date: LATER, materialized: false, snapshot_title: "Call the bank", snapshot_details: "Ask about the fee", snapshot_priority: 2, created_at: "2026-11-18T10:05:00.000Z" },
      { id: "m-x", user_id: USER, from_goal_id: "g1", to_goal_id: "g1", from_date: "2026-11-18", to_date: FRIDAY, materialized: true, materialized_goal_id: "old-copy", snapshot_title: "Call the bank", snapshot_details: null, snapshot_priority: 2, created_at: "2026-11-18T11:00:00.000Z" }
    );
    await getOrCreatePlan(LATER);
    expect(await planGoals(LATER)).toHaveLength(1); // the genuine latest intent still materializes
  });

  it("the Task created from a move can itself be rescheduled onward (a new source Task, its own intents)", async () => {
    const goal = seedTask();
    await rescheduleGoalToDate({ goal, toDateISO: TOMORROW });
    await flush();
    const copy = (await planGoals(TOMORROW))[0] as unknown as Goal;
    await rescheduleGoalToDate({ goal: copy, toDateISO: LATER });
    await getOrCreatePlan(LATER);
    expect(await planGoals(LATER)).toHaveLength(1);
    expect((await planGoals(TOMORROW))[0]).toMatchObject({ status: "postponed" });
    expect(markers().map((m) => m.to_date).sort()).toEqual([TOMORROW, LATER].sort());
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { updateGoalStatusAction } from "./serverActions";

// Real ids from the confirmed live-data P1 regression trace: SOURCE
// ("Paint the hubcaps", postponed) was rescheduled forward and
// materialized onto CONTINUATION (not_started), which was never itself
// rescheduled further. See db.test.ts's walkMaterializedChain tests for
// the same fixture used at the pure-logic level.
const SOURCE = "8732b169-dabb-4a47-9d72-ecb395951e4d";
const CONTINUATION = "4528697c-3d7e-4a05-b52a-df0fb52829a9";
const USER_ID = "user-1";

type Row = Record<string, any>;

/**
 * A minimal, purpose-built fake of just the Supabase query-builder shape
 * updateGoalStatusAction/cancelOrphanedReschedulesAction actually call
 * (.from().select().eq().single()/.maybeSingle(), .update().eq(),
 * .insert(), the plain-array .not()/.order()/.in() chain, and .rpc()).
 * Not a general mock library -- scoped tightly to prove the real
 * production code path (not just the already-covered pure helpers in
 * db.test.ts) actually wires reconciliation in, end to end, against an
 * in-memory fixture instead of any live database.
 */
function createFakeSupabase(tables: { goals: Row[]; goal_reschedules: Row[]; goal_notes: Row[]; daily_plans: Row[] }) {
  function builder(table: string) {
    const rows: Row[] = (tables as any)[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];

    const api: any = {
      select() {
        return api;
      },
      eq(col: string, val: any) {
        filters.push((r) => r[col] === val);
        return api;
      },
      not(col: string, op: string, val: any) {
        if (op === "is" && val === null) filters.push((r) => r[col] !== null && r[col] !== undefined);
        return api;
      },
      in(col: string, vals: any[]) {
        filters.push((r) => vals.includes(r[col]));
        return api;
      },
      order() {
        return api; // fixtures are pre-sorted; ordering isn't exercised here
      },
      limit() {
        return api;
      },
      async single() {
        const found = rows.filter((r) => filters.every((f) => f(r)));
        return found[0] ? { data: found[0], error: null } : { data: null, error: new Error("not found") };
      },
      async maybeSingle() {
        const found = rows.filter((r) => filters.every((f) => f(r)));
        return { data: found[0] ?? null, error: null };
      },
      update(patch: Row) {
        return {
          async eq(col: string, val: any) {
            const target = rows.find((r) => r[col] === val);
            if (target) Object.assign(target, patch);
            return { error: null };
          },
        };
      },
      async insert(obj: Row) {
        rows.push(obj);
        return { error: null };
      },
      // Plain `await supabase.from(...).select(...)...` with no terminal
      // .single()/.maybeSingle() (used for the batched array fetches in
      // cancelOrphanedReschedulesAction) -- making `api` itself thenable
      // lets `await` resolve it directly.
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        const found = rows.filter((r) => filters.every((f) => f(r)));
        resolve({ data: found, error: null });
      },
    };
    return api;
  }

  return {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: null, error: null }),
  } as any;
}

function makeFixture() {
  return {
    goals: [
      { id: SOURCE, plan_id: "plan-1", reviewed_at: "2026-09-28T00:00:00Z", title: "Paint the hubcaps", status: "postponed" },
      { id: CONTINUATION, plan_id: "plan-2", reviewed_at: "2026-09-28T00:00:00Z", title: "Paint the hubcaps", status: "not_started" },
    ],
    goal_reschedules: [
      {
        from_goal_id: SOURCE,
        materialized_goal_id: CONTINUATION,
        materialized: true,
        materialized_at: "2026-09-28T17:32:23.870Z",
      },
    ],
    goal_notes: [] as Row[],
    daily_plans: [{ id: "plan-1", reviewed_at: null, awareness_awarded: false }],
  };
}

describe("updateGoalStatusAction — reschedule reconciliation", () => {
  let fixture: ReturnType<typeof makeFixture>;

  beforeEach(() => {
    fixture = makeFixture();
  });

  it("cancels the unresolved materialized continuation when the source is marked Completed (regression: 8732b169 -> 4528697c)", async () => {
    const supabase = createFakeSupabase(fixture);
    await updateGoalStatusAction(supabase, USER_ID, SOURCE, "completed" as any);

    const continuation = fixture.goals.find((g) => g.id === CONTINUATION);
    expect(continuation?.status).toBe("canceled");
  });

  it("cancels the continuation when the source is marked Canceled too", async () => {
    const supabase = createFakeSupabase(fixture);
    await updateGoalStatusAction(supabase, USER_ID, SOURCE, "canceled" as any);

    const continuation = fixture.goals.find((g) => g.id === CONTINUATION);
    expect(continuation?.status).toBe("canceled");
  });

  it("does NOT touch the continuation for a non-terminal status change (requirement 8)", async () => {
    const supabase = createFakeSupabase(fixture);
    await updateGoalStatusAction(supabase, USER_ID, SOURCE, "in_progress" as any);

    const continuation = fixture.goals.find((g) => g.id === CONTINUATION);
    expect(continuation?.status).toBe("not_started"); // unchanged
  });

  it("leaves an already-resolved continuation alone (idempotency / requirement 5)", async () => {
    fixture.goals.find((g) => g.id === CONTINUATION)!.status = "completed";
    const supabase = createFakeSupabase(fixture);
    await updateGoalStatusAction(supabase, USER_ID, SOURCE, "completed" as any);

    const continuation = fixture.goals.find((g) => g.id === CONTINUATION);
    expect(continuation?.status).toBe("completed"); // the user's own decision survives

    const autoCanceledNote = fixture.goal_notes.find(
      (n) => n.goal_id === CONTINUATION && String(n.note).startsWith("Automatically canceled")
    );
    expect(autoCanceledNote).toBeUndefined(); // no duplicate reconciliation event logged
  });

  it("is a no-op the second time it runs against the same already-reconciled source (idempotency / requirement 8)", async () => {
    const supabase = createFakeSupabase(fixture);
    await updateGoalStatusAction(supabase, USER_ID, SOURCE, "completed" as any);
    await updateGoalStatusAction(supabase, USER_ID, SOURCE, "completed" as any);

    const continuation = fixture.goals.find((g) => g.id === CONTINUATION);
    expect(continuation?.status).toBe("canceled");

    const autoCanceledNotes = fixture.goal_notes.filter(
      (n) => n.goal_id === CONTINUATION && String(n.note).startsWith("Automatically canceled")
    );
    expect(autoCanceledNotes.length).toBe(1); // only logged once, not once per run
  });

  it("preserves the existing response shape (requirement 4)", async () => {
    const supabase = createFakeSupabase(fixture);
    const result = await updateGoalStatusAction(supabase, USER_ID, SOURCE, "completed" as any);

    expect(result).toEqual({ goalId: SOURCE, title: "Paint the hubcaps", status: "completed" });
  });

  it("does not affect an unrelated goal with no reschedule lineage", async () => {
    fixture.goals.push({ id: "unrelated-1", plan_id: "plan-3", reviewed_at: "2026-09-28T00:00:00Z", title: "Unrelated task", status: "not_started" });
    const supabase = createFakeSupabase(fixture);
    await updateGoalStatusAction(supabase, USER_ID, "unrelated-1", "completed" as any);

    const continuation = fixture.goals.find((g) => g.id === CONTINUATION);
    expect(continuation?.status).toBe("not_started"); // untouched by an unrelated completion
  });
});

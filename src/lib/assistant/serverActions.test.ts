import { describe, it, expect, beforeEach } from "vitest";
import { updateGoalStatusAction, removeGoalAction, moveGoalToBacklogAction } from "./serverActions";
import { GoalDeleteBlockedError } from "@/lib/supabase/db";

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
function createFakeSupabase(
  tables: { goals: Row[]; goal_reschedules: Row[]; goal_notes: Row[]; daily_plans: Row[] } & Partial<
    Record<"goal_assignments" | "goal_backlog", Row[]>
  >
) {
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
      // Supports both the plain `await ...insert(obj)` shape already used
      // elsewhere in this file AND moveGoalToBacklogAction's
      // `...insert(obj).select().single()` chain -- the row is pushed
      // eagerly either way (matching real Postgres: the write happens
      // regardless of whether the caller asks `.select()` for it back).
      insert(obj: Row) {
        const withId = { id: obj.id ?? `fake-id-${rows.length}-${Math.random().toString(36).slice(2, 8)}`, ...obj };
        rows.push(withId);
        return {
          then(resolve: (v: { error: null }) => void) {
            resolve({ error: null });
          },
          select() {
            return {
              async single() {
                return { data: withId, error: null };
              },
            };
          },
        };
      },
      // removeGoalAction/moveGoalToBacklogAction's `.delete().eq(...)`.
      delete() {
        return {
          async eq(col: string, val: any) {
            const idx = rows.findIndex((r) => r[col] === val);
            if (idx >= 0) rows.splice(idx, 1);
            return { error: null };
          },
        };
      },
      // Plain `await supabase.from(...).select(...)...` with no terminal
      // .single()/.maybeSingle() (used for the batched array fetches in
      // cancelOrphanedReschedulesAction, and for assertGoalDeletable's
      // four `.limit(1)` existence checks) -- making `api` itself
      // thenable lets `await` resolve it directly.
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

// Lifecycle-integrity fix: deleteGoal() (db.ts) and these two mirrors now
// refuse to hard-delete a goal that participates in a reschedule or
// assignment relationship -- see findGoalDeleteBlockReason/
// GoalDeleteBlockedError in db.ts. These tests exercise the real
// production code path (not just the pure decision helper already
// covered in db.test.ts) against an in-memory fixture, same reasoning as
// the updateGoalStatusAction suite above.
describe("removeGoalAction / moveGoalToBacklogAction — delete-safety guard", () => {
  const DISPOSABLE = "disposable-1";
  const ASSIGN_SOURCE = "assign-source-1";
  const ASSIGN_RECIPIENT = "assign-recipient-1";
  const RESCHEDULE_SOURCE = "reschedule-source-1";
  const RESCHEDULE_TARGET = "reschedule-target-1";

  function makeDeleteFixture() {
    return {
      goals: [
        { id: DISPOSABLE, plan_id: "plan-1", title: "Ordinary disposable task", status: "not_started" },
        { id: ASSIGN_SOURCE, plan_id: "plan-1", title: "Assigned out", status: "postponed" },
        { id: ASSIGN_RECIPIENT, plan_id: "plan-2", title: "Assigned to me", status: "completed" },
        { id: RESCHEDULE_SOURCE, plan_id: "plan-1", title: "Rescheduled task", status: "postponed" },
        { id: RESCHEDULE_TARGET, plan_id: "plan-3", title: "Rescheduled task", status: "not_started" },
      ],
      goal_reschedules: [
        { from_goal_id: RESCHEDULE_SOURCE, materialized_goal_id: RESCHEDULE_TARGET, materialized: true },
      ],
      goal_notes: [] as Row[],
      daily_plans: [] as Row[],
      goal_assignments: [
        {
          id: "assignment-1",
          assigner_id: "owner-1",
          recipient_id: "nino-1",
          assigner_goal_id: ASSIGN_SOURCE,
          recipient_goal_id: ASSIGN_RECIPIENT,
          status: "accepted",
        },
      ],
      goal_backlog: [] as Row[],
    };
  }

  let fixture: ReturnType<typeof makeDeleteFixture>;

  beforeEach(() => {
    fixture = makeDeleteFixture();
  });

  it("an ordinary disposable/unlinked Task can still be deleted", async () => {
    const supabase = createFakeSupabase(fixture);
    const result = await removeGoalAction(supabase, USER_ID, DISPOSABLE);

    expect(result).toEqual({ title: "Ordinary disposable task" });
    expect(fixture.goals.find((g) => g.id === DISPOSABLE)).toBeUndefined();
  });

  it("an assignment SOURCE Task (assigner_goal_id) cannot be destructively deleted", async () => {
    const supabase = createFakeSupabase(fixture);
    await expect(removeGoalAction(supabase, USER_ID, ASSIGN_SOURCE)).rejects.toMatchObject({
      reason: "assignment",
    });
  });

  it("an assignment RECIPIENT Task (recipient_goal_id) cannot be destructively deleted -- the Share-1 scenario", async () => {
    const supabase = createFakeSupabase(fixture);
    await expect(removeGoalAction(supabase, USER_ID, ASSIGN_RECIPIENT)).rejects.toMatchObject({
      reason: "assignment",
    });
  });

  it("a reschedule SOURCE cannot be destructively deleted", async () => {
    const supabase = createFakeSupabase(fixture);
    await expect(removeGoalAction(supabase, USER_ID, RESCHEDULE_SOURCE)).rejects.toMatchObject({
      reason: "reschedule",
    });
  });

  it("a materialized reschedule descendant cannot be deleted if it would corrupt chain history", async () => {
    const supabase = createFakeSupabase(fixture);
    await expect(removeGoalAction(supabase, USER_ID, RESCHEDULE_TARGET)).rejects.toMatchObject({
      reason: "reschedule",
    });
  });

  it("a blocked delete leaves the original goals row intact", async () => {
    const supabase = createFakeSupabase(fixture);
    await expect(removeGoalAction(supabase, USER_ID, ASSIGN_RECIPIENT)).rejects.toBeInstanceOf(GoalDeleteBlockedError);

    expect(fixture.goals.find((g) => g.id === ASSIGN_RECIPIENT)).toBeDefined();
  });

  it("a blocked delete leaves the assignment relationship intact", async () => {
    const supabase = createFakeSupabase(fixture);
    await expect(removeGoalAction(supabase, USER_ID, ASSIGN_SOURCE)).rejects.toBeInstanceOf(GoalDeleteBlockedError);

    const assignment = fixture.goal_assignments.find((a) => a.id === "assignment-1");
    expect(assignment?.assigner_goal_id).toBe(ASSIGN_SOURCE);
    expect(assignment?.recipient_goal_id).toBe(ASSIGN_RECIPIENT);
  });

  it("a blocked delete leaves the reschedule relationship intact", async () => {
    const supabase = createFakeSupabase(fixture);
    await expect(removeGoalAction(supabase, USER_ID, RESCHEDULE_SOURCE)).rejects.toBeInstanceOf(GoalDeleteBlockedError);

    const edge = fixture.goal_reschedules[0];
    expect(edge.from_goal_id).toBe(RESCHEDULE_SOURCE);
    expect(edge.materialized_goal_id).toBe(RESCHEDULE_TARGET);
  });

  it("moveGoalToBacklogAction is guarded the same way -- an assignment-linked Task is not moved to backlog or deleted", async () => {
    const supabase = createFakeSupabase(fixture);
    await expect(moveGoalToBacklogAction(supabase, USER_ID, ASSIGN_RECIPIENT)).rejects.toMatchObject({
      reason: "assignment",
    });

    expect(fixture.goals.find((g) => g.id === ASSIGN_RECIPIENT)).toBeDefined();
    expect(fixture.goal_backlog.length).toBe(0); // no backlog copy was created either
  });

  it("moveGoalToBacklogAction still works for an ordinary, unlinked Task", async () => {
    const supabase = createFakeSupabase(fixture);
    const result = await moveGoalToBacklogAction(supabase, USER_ID, DISPOSABLE);

    expect(result.title).toBe("Ordinary disposable task");
    expect(fixture.goals.find((g) => g.id === DISPOSABLE)).toBeUndefined();
    expect(fixture.goal_backlog.length).toBe(1);
  });
});

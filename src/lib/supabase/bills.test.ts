import { describe, it, expect, vi, beforeEach } from "vitest";

// A recording fake of the Supabase client: each table returns canned rows, every
// builder call is logged, and any insert/update/rpc is captured so we can prove
// what the suggestion code does (and does NOT) write.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  inserts: [] as { table: string; row: any }[],
  updates: [] as { table: string; patch: any }[],
  rpcs: [] as { fn: string; args: any }[],
}));

vi.mock("@/lib/supabase/client", () => {
  const builder = (table: string) => {
    let mode: "select" | "insert" | "update" = "select";
    let payload: any;
    const b: any = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => {
              if (mode === "insert") {
                state.inserts.push({ table, row: payload });
                return resolve({ data: { id: "new-goal", ...payload }, error: null });
              }
              if (mode === "update") {
                state.updates.push({ table, patch: payload });
                return resolve({ data: null, error: null });
              }
              return resolve({ data: state.tables[table] ?? [], error: null });
            };
          }
          if (prop === "insert") return (row: any) => ((mode = "insert"), (payload = row), b);
          if (prop === "update") return (row: any) => ((mode = "update"), (payload = row), b);
          return () => b;
        },
      }
    );
    return b;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }) },
      from: (table: string) => builder(table),
      rpc: (fn: string, args: any) => {
        state.rpcs.push({ fn, args });
        return Promise.resolve({ data: [{ r_payment_id: "p1", r_occurrence_id: "o1", r_duplicate: false }], error: null });
      },
    },
  };
});

vi.mock("@/lib/supabase/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase/db")>()),
  getCurrentUserId: async () => "u1",
  getOrCreatePlan: async () => ({ id: "plan-1" }),
}));

import { addGoalFromBill, billGoalTitle, getSuggestedBillReminders, isBillsUnavailableError, recordBillPayment, reverseBillPayment } from "./bills";
import type { BillSuggestion } from "@/lib/bills";

const billRow = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  name: "Electricity",
  amount_type: "fixed",
  expected_amount: "120.00",
  recurrence: "monthly",
  first_due_date: "2026-01-12",
  remind_days_before: 3,
  category: null,
  notes: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  state.tables = {};
  state.inserts = [];
  state.updates = [];
  state.rpcs = [];
});

describe("isBillsUnavailableError", () => {
  it("recognizes a missing table/function (migration not applied) but not ordinary errors", () => {
    expect(isBillsUnavailableError({ code: "42P01", message: 'relation "public.bills" does not exist' })).toBe(true);
    expect(isBillsUnavailableError({ code: "PGRST205", message: "Could not find the table 'public.bills' in the schema cache" })).toBe(true);
    expect(isBillsUnavailableError({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isBillsUnavailableError({ message: "Payment amount must be greater than zero" })).toBe(false);
    expect(isBillsUnavailableError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isBillsUnavailableError(null)).toBe(false);
  });
});

describe("Plan Tomorrow bill suggestions", () => {
  it("returns a suggestion for a bill whose reminder window covers the plan date -- and writes nothing", async () => {
    state.tables = { bills: [billRow()], bill_occurrences: [], bill_payments: [], goals: [] };
    const out = await getSuggestedBillReminders("2026-11-10");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ dueDate: "2026-11-12", amountDue: 120 });
    expect(billGoalTitle(out[0])).toBe("Pay Electricity — $120.00 — due 11/12/2026");
    // Suggesting is read-only: no goal, plan or ledger write of any kind.
    expect(state.inserts).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });

  it("doesn't suggest a cycle that already has a linked goal", async () => {
    state.tables = {
      bills: [billRow()],
      bill_occurrences: [],
      bill_payments: [],
      goals: [{ source_bill_id: "b1", source_bill_due_date: "2026-11-12" }],
    };
    expect(await getSuggestedBillReminders("2026-11-10")).toEqual([]);
  });

  it("doesn't suggest a paid cycle", async () => {
    state.tables = {
      bills: [billRow()],
      bill_occurrences: [{ id: "o1", bill_id: "b1", due_date: "2026-11-12", amount_due: "120.00" }],
      bill_payments: [{ id: "p1", occurrence_id: "o1", amount: "120.00", paid_at: "2026-11-09T12:00:00Z", note: null, reversed_at: null }],
      goals: [],
    };
    expect(await getSuggestedBillReminders("2026-11-10")).toEqual([]);
  });

  it("no bills -> no suggestions and no further queries needed", async () => {
    state.tables = { bills: [] };
    expect(await getSuggestedBillReminders("2026-11-10")).toEqual([]);
  });

  it("tapping creates exactly one ordinary not-started goal linked to the bill cycle -- nothing else", async () => {
    const s: BillSuggestion = {
      bill: {
        id: "b1", name: "Electricity", amountType: "fixed", expectedAmount: 120, recurrence: "monthly", firstDueDate: "2026-01-12",
        remindDaysBefore: 3, category: null, notes: null, archivedAt: null, createdAt: "x",
      },
      dueDate: "2026-11-12",
      amountDue: null,
    };
    state.tables = { goals: [{ sort_order: 4 }] };
    await addGoalFromBill(s, "2026-11-10");
    expect(state.inserts).toHaveLength(1);
    const { table, row } = state.inserts[0];
    expect(table).toBe("goals");
    expect(row).toMatchObject({
      user_id: "u1",
      plan_id: "plan-1",
      title: "Pay Electricity — due 11/12/2026",
      status: "not_started",
      sort_order: 5,
      source_bill_id: "b1",
      source_bill_due_date: "2026-11-12",
    });
    // Not saved/submitted: no plan hash or status fields, no payment ledger writes, no bill writes.
    expect(Object.keys(row)).not.toContain("saved_hash");
    expect(Object.keys(row)).not.toContain("submitted_hash");
    expect(state.updates).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });
});

describe("payment RPC calls", () => {
  it("recordBillPayment sends the idempotency key and amounts to the bill RPC only (never an account RPC)", async () => {
    const r = await recordBillPayment({ billId: "b1", dueDate: "2026-11-12", amount: 50, paidAt: "2026-11-03T12:00:00Z", note: null, amountDue: null, clientKey: "k-1" });
    expect(r).toEqual({ paymentId: "p1", occurrenceId: "o1", wasDuplicate: false });
    expect(state.rpcs).toEqual([
      { fn: "record_bill_payment", args: { p_bill_id: "b1", p_due_date: "2026-11-12", p_amount: 50, p_paid_at: "2026-11-03T12:00:00Z", p_note: null, p_amount_due: null, p_client_key: "k-1" } },
    ]);
  });

  it("reverseBillPayment calls only the bill reversal RPC", async () => {
    await reverseBillPayment("p1");
    expect(state.rpcs).toEqual([{ fn: "reverse_bill_payment", args: { p_payment_id: "p1" } }]);
    expect(state.rpcs.some((x) => x.fn === "reverse_payment" || x.fn === "record_payment")).toBe(false);
  });
});

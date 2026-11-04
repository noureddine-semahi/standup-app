import { describe, it, expect, vi, beforeEach } from "vitest";

// A recording fake of the Supabase client: each table returns canned rows and every
// insert / update / delete / rpc is captured, so we can prove exactly what the code writes.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; patch: Record<string, unknown> }[],
  deletes: [] as { table: string }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/client", () => {
  const builder = (table: string) => {
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => {
              if (mode === "insert") {
                state.inserts.push({ table, row: payload });
                return resolve({ data: { id: "new-1", ...payload }, error: null });
              }
              if (mode === "update") {
                state.updates.push({ table, patch: payload });
                return resolve({ data: { id: "s1", ...(state.tables[table]?.[0] as object) }, error: null });
              }
              if (mode === "delete") {
                state.deletes.push({ table });
                return resolve({ data: null, error: null });
              }
              return resolve({ data: state.tables[table] ?? [], error: null });
            };
          }
          if (prop === "insert") return (row: Record<string, unknown>) => ((mode = "insert"), (payload = row), b);
          if (prop === "update") return (row: Record<string, unknown>) => ((mode = "update"), (payload = row), b);
          if (prop === "delete") return () => ((mode = "delete"), b);
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
      rpc: (fn: string, args: Record<string, unknown>) => {
        state.rpcs.push({ fn, args });
        return Promise.resolve({ data: [{ r_payment_id: "pay-1", r_duplicate: false }], error: null });
      },
    },
  };
});

vi.mock("@/lib/supabase/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase/db")>()),
  getCurrentUserId: async () => "u1",
  getOrCreatePlan: async () => ({ id: "plan-1" }),
}));

import {
  addGoalFromSubscription,
  createSubscription,
  deleteSubscription,
  getSubscriptionPayments,
  getSubscriptions,
  getSuggestedSubscriptionReminders,
  isSubscriptionsUnavailableError,
  recordSubscriptionCancellation,
  getSubscriptionCancellations,
  recordSubscriptionPayment,
  reverseSubscriptionPayment,
  subscriptionGoalTitle,
  updateSubscription,
} from "./subscriptions";
import type { SubscriptionFormPayload, SubscriptionSuggestion } from "@/lib/subscriptions";

const row = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "Netflix",
  provider: null,
  category: null,
  plan_name: null,
  amount: "15.49",
  currency: "USD",
  frequency: "monthly",
  custom_interval: null,
  custom_unit: null,
  next_billing_date: "2026-11-20",
  start_date: null,
  status: "active",
  trial_ends_on: null,
  remind_days_before: 3,
  notes: null,
  bill_id: null,
  canceled_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  state.tables = {};
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
  state.rpcs = [];
});

describe("availability detection", () => {
  it("a missing table/function (migration not applied) is 'unavailable'; ordinary errors are not", () => {
    expect(isSubscriptionsUnavailableError({ code: "42P01", message: 'relation "public.subscriptions" does not exist' })).toBe(true);
    expect(isSubscriptionsUnavailableError({ code: "PGRST205", message: "Could not find the table 'public.subscriptions'" })).toBe(true);
    expect(isSubscriptionsUnavailableError({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isSubscriptionsUnavailableError({ message: "Payment amount must be greater than zero" })).toBe(false);
    expect(isSubscriptionsUnavailableError(null)).toBe(false);
  });
});

describe("reading", () => {
  it("maps rows (string numerics to numbers, nulls kept)", async () => {
    state.tables = { subscriptions: [row({ amount: null, plan_name: "Premium", custom_interval: 6, custom_unit: "weeks", frequency: "custom" })] };
    const [s] = await getSubscriptions();
    expect(s).toMatchObject({ id: "s1", amount: null, planName: "Premium", frequency: "custom", customInterval: 6, customUnit: "weeks", nextBillingDate: "2026-11-20", billId: null });
    state.tables = { subscriptions: [row()] };
    expect((await getSubscriptions())[0].amount).toBe(15.49);
  });

  it("groups payments by subscription, keeping reversed ones marked and the given (newest-first) order", async () => {
    state.tables = {
      subscription_payments: [
        { id: "p2", subscription_id: "s1", amount: "15.49", paid_at: "2026-10-20T12:00:00Z", note: null, billing_date: "2026-10-20", reversed_at: null },
        { id: "p1", subscription_id: "s1", amount: "15.49", paid_at: "2026-09-20T12:00:00Z", note: "x", billing_date: null, reversed_at: "2026-09-21T00:00:00Z" },
        { id: "p3", subscription_id: "s2", amount: "9.99", paid_at: "2026-10-01T12:00:00Z", note: null, billing_date: null, reversed_at: null },
      ],
    };
    const out = await getSubscriptionPayments(["s1", "s2"]);
    expect(out.s1.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(out.s1[1]).toMatchObject({ reversedAt: "2026-09-21T00:00:00Z", note: "x", amount: 15.49 });
    expect(out.s2).toHaveLength(1);
    expect(await getSubscriptionPayments([])).toEqual({});
  });
});

describe("writing", () => {
  const payload: SubscriptionFormPayload = {
    name: "Spotify", provider: "Spotify AB", planName: "Family", category: "Music", amount: 16.99, currency: "USD",
    frequency: "custom", customInterval: 6, customUnit: "weeks", nextBillingDate: "2026-11-25", startDate: "2026-01-01",
    status: "trial", trialEndsOn: "2026-11-25", remindDaysBefore: 5, billId: "b1", notes: "n",
  };

  it("create inserts the mapped columns scoped to the user", async () => {
    await createSubscription(payload);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].table).toBe("subscriptions");
    expect(state.inserts[0].row).toMatchObject({
      user_id: "u1", name: "Spotify", provider: "Spotify AB", plan_name: "Family", category: "Music", amount: 16.99, currency: "USD",
      frequency: "custom", custom_interval: 6, custom_unit: "weeks", next_billing_date: "2026-11-25", start_date: "2026-01-01",
      status: "trial", trial_ends_on: "2026-11-25", remind_days_before: 5, bill_id: "b1", notes: "n", canceled_at: null,
    });
  });

  it("create stamps canceled_at only for a canceled subscription", async () => {
    await createSubscription({ ...payload, status: "canceled", trialEndsOn: null });
    expect(typeof state.inserts[0].row.canceled_at).toBe("string");
  });

  it("update sends only the given fields (nothing else is touched)", async () => {
    state.tables = { subscriptions: [row()] };
    await updateSubscription("s1", { amount: 17.99 });
    expect(state.updates).toEqual([{ table: "subscriptions", patch: { amount: 17.99 } }]);
    await updateSubscription("s1", { status: "canceled", canceledAt: "2026-11-04T10:00:00.000Z" });
    expect(state.updates[1].patch).toEqual({ status: "canceled", canceled_at: "2026-11-04T10:00:00.000Z" });
    await updateSubscription("s1", { amount: null, billId: null });
    expect(state.updates[2].patch).toEqual({ amount: null, bill_id: null });
  });

  it("cancel is an update, not a delete: history is untouched", async () => {
    state.tables = { subscriptions: [row()] };
    await updateSubscription("s1", { status: "canceled", canceledAt: "x" });
    expect(state.deletes).toEqual([]);
    expect(state.updates.every((u) => u.table === "subscriptions")).toBe(true);
  });

  it("delete removes only the subscription row (its payments go with it through the database cascade)", async () => {
    await deleteSubscription("s1");
    expect(state.deletes).toEqual([{ table: "subscriptions" }]);
  });
});

describe("payment RPCs", () => {
  it("recordSubscriptionPayment sends the idempotency key and fields to the subscription RPC only", async () => {
    const r = await recordSubscriptionPayment({ subscriptionId: "s1", amount: 15.49, paidAt: "2026-11-04T12:00:00Z", note: null, billingDate: "2026-10-20", clientKey: "k-1" });
    expect(r).toEqual({ paymentId: "pay-1", wasDuplicate: false });
    expect(state.rpcs).toEqual([
      { fn: "record_subscription_payment", args: { p_subscription_id: "s1", p_amount: 15.49, p_paid_at: "2026-11-04T12:00:00Z", p_note: null, p_billing_date: "2026-10-20", p_client_key: "k-1" } },
    ]);
  });
  it("reverseSubscriptionPayment calls only the subscription reversal RPC", async () => {
    await reverseSubscriptionPayment("pay-1");
    expect(state.rpcs).toEqual([{ fn: "reverse_subscription_payment", args: { p_payment_id: "pay-1" } }]);
    expect(state.rpcs.some((x) => /bill|payment_accounts|^record_payment$|^reverse_payment$/.test(x.fn))).toBe(false);
  });
});

describe("Unsubscribe Me data layer", () => {
  it("records a request through the cancellation RPC only, never a table write and never an automatic/confirmed status", async () => {
    await recordSubscriptionCancellation({ subscriptionId: "s1", mode: "assisted", status: "in_progress", guideUrl: "https://example.com/cancel" });
    await recordSubscriptionCancellation({ subscriptionId: "s1", mode: "manual", status: "user_reported", requestId: "r1", completedOn: "2026-11-01", note: "n" });
    expect(state.rpcs.map((x) => x.fn)).toEqual(["record_subscription_cancellation", "record_subscription_cancellation"]);
    expect(state.rpcs[0].args).toEqual({
      p_subscription_id: "s1", p_mode: "assisted", p_status: "in_progress", p_request_id: null,
      p_completed_on: null, p_guide_url: "https://example.com/cancel", p_error: null, p_note: null,
    });
    expect(state.rpcs[1].args).toMatchObject({ p_mode: "manual", p_status: "user_reported", p_request_id: "r1", p_completed_on: "2026-11-01" });
    expect(state.inserts).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.rpcs.every((x) => x.args.p_status !== "provider_confirmed" && x.args.p_mode !== "automatic")).toBe(true);
  });
  it("groups cancellation history by subscription and maps rows", async () => {
    state.tables.subscription_cancellations = [
      { id: "c2", subscription_id: "s1", mode: "assisted", status: "failed", requested_at: "2026-11-02T00:00:00Z", completed_on: null, guide_url: null, provider_reference: null, error_message: "x", note: null },
      { id: "c1", subscription_id: "s1", mode: "manual", status: "user_reported", requested_at: "2026-11-01T00:00:00Z", completed_on: "2026-11-01", guide_url: null, provider_reference: null, error_message: null, note: "n" },
      { id: "c3", subscription_id: "s2", mode: "manual", status: "user_reported", requested_at: "2026-10-01T00:00:00Z", completed_on: "2026-10-01", guide_url: null, provider_reference: null, error_message: null, note: null },
    ];
    const out = await getSubscriptionCancellations(["s1", "s2"]);
    expect(out.s1.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(out.s1[0]).toMatchObject({ status: "failed", errorMessage: "x", completedOn: null });
    expect(out.s2).toHaveLength(1);
    expect(await getSubscriptionCancellations([])).toEqual({});
  });
});

describe("Plan Tomorrow suggestions (never automatic)", () => {
  const plan = "2026-11-17";

  it("suggests a renewal inside its reminder window and writes nothing", async () => {
    state.tables = { subscriptions: [row()], subscription_payments: [], goals: [] };
    const out = await getSuggestedSubscriptionReminders(plan);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ event: "renewal", date: "2026-11-20", amount: 15.49 });
    expect(subscriptionGoalTitle(out[0])).toBe("Review Netflix renewal — $15.49 — 11/20/2026");
    expect(state.inserts).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.deletes).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });

  it("suggests a trial ending", async () => {
    state.tables = { subscriptions: [row({ status: "trial", trial_ends_on: "2026-11-20", next_billing_date: "2026-11-20" })], subscription_payments: [], goals: [] };
    const out = await getSuggestedSubscriptionReminders(plan);
    expect(out.map((s) => s.event)).toEqual(["trial_end"]);
    expect(subscriptionGoalTitle(out[0])).toBe("Cancel or keep Netflix trial — ends 11/20/2026");
  });

  it("doesn't repeat an event that already has a linked goal (no duplicate goals)", async () => {
    state.tables = {
      subscriptions: [row()],
      subscription_payments: [],
      goals: [{ source_subscription_id: "s1", source_subscription_event: "renewal", source_subscription_date: "2026-11-20" }],
    };
    expect(await getSuggestedSubscriptionReminders(plan)).toEqual([]);
  });

  it("doesn't suggest a renewal that already has a recorded payment", async () => {
    state.tables = {
      subscriptions: [row()],
      subscription_payments: [{ id: "p1", subscription_id: "s1", amount: "15.49", paid_at: "2026-11-10T12:00:00Z", note: null, billing_date: "2026-11-20", reversed_at: null }],
      goals: [],
    };
    expect(await getSuggestedSubscriptionReminders(plan)).toEqual([]);
  });

  it("nothing tracked -> no suggestions", async () => {
    state.tables = { subscriptions: [] };
    expect(await getSuggestedSubscriptionReminders(plan)).toEqual([]);
  });

  it("tapping creates exactly one ordinary not-started goal linked to its event -- nothing else", async () => {
    const s: SubscriptionSuggestion = {
      subscription: {
        id: "s1", name: "Netflix", provider: null, category: null, planName: null, amount: 15.49, currency: "USD", frequency: "monthly",
        customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null,
        remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "x", updatedAt: "x",
      },
      event: "renewal",
      date: "2026-11-20",
      amount: 15.49,
    };
    state.tables = { goals: [{ sort_order: 4 }] };
    await addGoalFromSubscription(s, plan);
    expect(state.inserts).toHaveLength(1);
    const { table, row: goal } = state.inserts[0];
    expect(table).toBe("goals");
    expect(goal).toMatchObject({
      user_id: "u1", plan_id: "plan-1", title: "Review Netflix renewal — $15.49 — 11/20/2026", status: "not_started", sort_order: 5,
      source_subscription_id: "s1", source_subscription_event: "renewal", source_subscription_date: "2026-11-20",
    });
    // Not saved / submitted, and no payment or subscription write.
    expect(Object.keys(goal)).not.toContain("saved_hash");
    expect(Object.keys(goal)).not.toContain("submitted_hash");
    expect(state.updates).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });
});

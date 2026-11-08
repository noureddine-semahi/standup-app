// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Record<string, unknown>[] | { error: unknown; status?: number }>,
    users: [] as { id: string; email: string | null }[],
    authError: null as unknown,
    selected: {} as Record<string, string>,
    writes: 0,
  };
  const client = {
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: (cols: string) => ((state.selected[table] = cols), q),
        order: () => q,
        range: (from: number, to: number) => {
          const t = state.tables[table];
          if (t && !Array.isArray(t)) return Promise.resolve({ data: null, error: t.error, status: t.status });
          return Promise.resolve({ data: (t ?? []).slice(from, to + 1), error: null });
        },
        insert: () => (state.writes++, q),
        update: () => (state.writes++, q),
        delete: () => (state.writes++, q),
        upsert: () => (state.writes++, q),
      };
      return q;
    },
    rpc: () => (state.writes++, Promise.resolve({ data: null, error: null })),
    auth: {
      admin: {
        listUsers: ({ page, perPage }: { page: number; perPage: number }) => {
          if (state.authError) return Promise.resolve({ data: null, error: state.authError });
          return Promise.resolve({ data: { users: state.users.slice((page - 1) * perPage, page * perPage) }, error: null });
        },
      },
    },
  };
  return { state, client };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => m.client) }));

import { AdminBillingStoreUnavailableError, createAdminBillingStore } from "./adminBillingStore";

const KEY = "eyJSECRET.SERVICE.ROLEKEYVALUE";
const env = { NEXT_PUBLIC_SUPABASE_URL: "https://private-project-ref.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY };
let logs: unknown[][];
beforeEach(() => {
  logs = [];
  Object.assign(m.state, { tables: {}, users: [], authError: null, selected: {}, writes: 0 });
  for (const l of ["error", "info", "log", "warn"] as const) vi.spyOn(console, l).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("members()", () => {
  it("joins Auth accounts with names, entitlements, billing and deletion state by account, and nothing else", async () => {
    m.state.users = [{ id: "u1", email: "one@x.test" }, { id: "u2", email: "two@x.test" }];
    m.state.tables = {
      profiles: [{ id: "u1", display_name: "One" }],
      account_entitlements: [{ user_id: "u1", tier: "premium", trial_ends_at: null }, { user_id: "ghost", tier: "premium", trial_ends_at: null }],
      account_billing: [{ user_id: "u2", subscription_status: "active", current_period_end: "2026-12-10T00:00:00Z", cancel_at_period_end: true, subscription_synced_at: "2026-11-20T04:00:00Z" }],
      account_deletions: [{ user_id: "u2", state: "pending" }],
    };
    const rows = await createAdminBillingStore(env).members();
    expect(rows).toEqual([
      { id: "u1", email: "one@x.test", displayName: "One", tier: "premium", trialEndsAt: null, status: null, periodEnd: null, cancelAtPeriodEnd: false, syncedAt: null, deletionState: null },
      { id: "u2", email: "two@x.test", displayName: null, tier: null, trialEndsAt: null, status: "active", periodEnd: "2026-12-10T00:00:00Z", cancelAtPeriodEnd: true, syncedAt: "2026-11-20T04:00:00Z", deletionState: "pending" },
    ]);
  });
  it("ignores unknown tiers/states and never selects a Stripe reference or payment column", async () => {
    m.state.users = [{ id: "u1", email: "one@x.test" }];
    m.state.tables = { account_entitlements: [{ user_id: "u1", tier: "gold", trial_ends_at: null }], account_deletions: [{ user_id: "u1", state: "weird" }] };
    const [row] = await createAdminBillingStore(env).members();
    expect(row).toMatchObject({ tier: null, deletionState: null });
    expect(Object.values(m.state.selected).join(" ")).not.toMatch(/customer|subscription_id|price|payment|card|secret|payload/i);
  });
  it("reads only (no write of any kind)", async () => {
    m.state.users = [{ id: "u1", email: "one@x.test" }];
    await createAdminBillingStore(env).members();
    expect(m.state.writes).toBe(0);
  });
  it("a query error is a generic unavailable error and the log carries no key, URL or message", async () => {
    m.state.tables = { account_billing: { error: { code: "42P01", message: "relation private-project-ref secret", hint: KEY }, status: 500 } };
    await expect(createAdminBillingStore(env).members()).rejects.toBeInstanceOf(AdminBillingStoreUnavailableError);
    const out = JSON.stringify(logs);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("private-project-ref");
    expect(out).toContain("42P01");
  });
  it("an Auth listing error is unavailable too", async () => {
    m.state.authError = { code: "x", message: "nope" };
    await expect(createAdminBillingStore(env).members()).rejects.toBeInstanceOf(AdminBillingStoreUnavailableError);
  });
  it("missing configuration is refused without leaking which value", async () => {
    expect(() => createAdminBillingStore({})).toThrow(AdminBillingStoreUnavailableError);
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });
});

describe("operations()", () => {
  it("returns webhook events (type/status/times only) and billing sync records identified by email", async () => {
    m.state.users = [{ id: "u1", email: "one@x.test" }];
    m.state.tables = {
      stripe_webhook_events: [
        { event_type: "invoice.paid", status: "processed", attempts: 1, last_error: null, received_at: "2026-11-20T10:00:00Z", claimed_at: "2026-11-20T10:00:00Z", processed_at: "2026-11-20T10:00:01Z" },
        { event_type: "bad", status: "weird", attempts: 1, last_error: null, received_at: "2026-11-20T10:00:00Z" },
      ],
      account_billing: [{ user_id: "u1", subscription_status: "active", cancel_at_period_end: false, subscription_synced_at: "2026-11-20T04:00:00Z", reconcile_failures: 2, reconcile_last_outcome: "missing", reconcile_last_failed_at: "2026-11-20T05:00:00Z", reconcile_next_attempt_at: "2026-11-21T05:00:00Z" }],
    };
    const r = await createAdminBillingStore(env).operations();
    expect(r.events).toEqual([{ type: "invoice.paid", status: "processed", attempts: 1, lastError: null, receivedAt: "2026-11-20T10:00:00Z", claimedAt: "2026-11-20T10:00:00Z", processedAt: "2026-11-20T10:00:01Z" }]);
    expect(r.records).toEqual([{ member: "one@x.test", status: "active", cancelAtPeriodEnd: false, syncedAt: "2026-11-20T04:00:00Z", reconcileFailures: 2, lastOutcome: "missing", lastFailedAt: "2026-11-20T05:00:00Z", nextAttemptAt: "2026-11-21T05:00:00Z" }]);
    expect(m.state.selected.stripe_webhook_events).not.toMatch(/payload|body|data|id\b/);
    expect(m.state.writes).toBe(0);
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, unknown[] | { error: unknown; status?: number }>,
    authUsers: 0,
    authError: null as unknown,
    calls: [] as string[],
    writes: 0,
  };
  const client = {
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        range: (from: number, to: number) => {
          state.calls.push(`${table}:${from}-${to}`);
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
          state.calls.push(`auth:${page}`);
          if (state.authError) return Promise.resolve({ data: null, error: state.authError });
          const start = (page - 1) * perPage;
          return Promise.resolve({ data: { users: Array.from({ length: Math.max(0, Math.min(perPage, state.authUsers - start)) }, (_, i) => ({ id: `secret-${start + i}`, email: `x${i}@example.com` })) }, error: null });
        },
        deleteUser: () => (state.writes++, Promise.resolve({ error: null })),
        createUser: () => (state.writes++, Promise.resolve({ error: null })),
        updateUserById: () => (state.writes++, Promise.resolve({ error: null })),
      },
    },
  };
  return { state, client };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => m.client) }));

import { OverviewStoreUnavailableError, createOverviewStore } from "./overviewStore";

const KEY = "eyJSECRET.SERVICE.ROLEKEYVALUE";
const URL_ = "https://private-project-ref.supabase.co";
const env = { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY };
let logs: unknown[][];
beforeEach(() => {
  logs = [];
  Object.assign(m.state, { tables: {}, authUsers: 12, authError: null, calls: [], writes: 0 });
  for (const l of ["error", "info", "log", "warn"] as const) vi.spyOn(console, l).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("load", () => {
  it("reads the account count and the three tables, and maps them to the typed rows", async () => {
    m.state.tables.account_entitlements = [{ user_id: "u1", tier: "premium", trial_ends_at: null }, { user_id: "u2", tier: "premium_trial", trial_ends_at: "2026-12-01T00:00:00Z" }];
    m.state.tables.account_billing = [{ user_id: "u3", subscription_status: "active", current_period_end: "2026-12-10T00:00:00Z", cancel_at_period_end: true }];
    m.state.tables.account_trial_history = [{ user_id: "u2" }];
    expect(await createOverviewStore(env).load()).toEqual({
      totalAccounts: 12,
      entitlements: [{ userId: "u1", tier: "premium", trialEndsAt: null }, { userId: "u2", tier: "premium_trial", trialEndsAt: "2026-12-01T00:00:00Z" }],
      billing: [{ userId: "u3", status: "active", periodEnd: "2026-12-10T00:00:00Z", cancelAtPeriodEnd: true }],
      trialHistoryUserIds: ["u2"],
    });
  });

  it("counts every Supabase Auth account (not just profiles), across pages, and keeps only the number: no ID or email from the user records is ever returned", async () => {
    m.state.authUsers = 2300;
    const r = await createOverviewStore(env).load();
    expect(r.totalAccounts).toBe(2300);
    expect(m.state.calls.filter((c) => c.startsWith("auth:"))).toEqual(["auth:1", "auth:2", "auth:3"]);
    expect(JSON.stringify(r)).not.toMatch(/secret-|@example\.com/);
    m.state.authUsers = 1000; // exactly one full page: one more (empty) page is asked for, then it stops
    m.state.calls = [];
    expect((await createOverviewStore(env).load()).totalAccounts).toBe(1000);
    expect(m.state.calls.filter((c) => c.startsWith("auth:"))).toEqual(["auth:1", "auth:2"]);
    m.state.authUsers = 0;
    expect((await createOverviewStore(env).load()).totalAccounts).toBe(0);
  });

  it("a failure listing accounts fails the whole load, with safe logging", async () => {
    m.state.authError = { code: "XX000", status: 500, message: `boom ${KEY} secret-user@example.com` };
    await expect(createOverviewStore(env).load()).rejects.toBeInstanceOf(OverviewStoreUnavailableError);
    expect(logs).toEqual([["admin overview store failure", { reason: "query_error", op: "accounts", code: "XX000", status: 500 }]]);
    expect(JSON.stringify(logs)).not.toMatch(/boom|secret-user|eyJ/);
  });

  it("pages through large tables (more than one page) and stops at a short page", async () => {
    m.state.tables.account_entitlements = Array.from({ length: 2300 }, (_, i) => ({ user_id: `u${i}`, tier: "free", trial_ends_at: null }));
    const r = await createOverviewStore(env).load();
    expect(r.entitlements).toHaveLength(2300);
    expect(m.state.calls.filter((c) => c.startsWith("account_entitlements"))).toEqual(["account_entitlements:0-999", "account_entitlements:1000-1999", "account_entitlements:2000-2999"]);
  });

  it("drops malformed rows and unknown tiers instead of guessing", async () => {
    m.state.tables.account_entitlements = [{ user_id: null, tier: "premium" }, { user_id: "u1", tier: "gold" }, { user_id: "", tier: "free" }];
    m.state.tables.account_billing = [{ subscription_status: "active" }, { user_id: "u2", subscription_status: 5, cancel_at_period_end: "yes" }];
    const r = await createOverviewStore(env).load();
    expect(r.entitlements).toEqual([{ userId: "u1", tier: null, trialEndsAt: null }]);
    expect(r.billing).toEqual([{ userId: "u2", status: null, periodEnd: null, cancelAtPeriodEnd: false }]);
  });

  it("READ-ONLY: it performs selects only, never an insert, update, delete, upsert or database function call", async () => {
    await createOverviewStore(env).load();
    expect(m.state.writes).toBe(0);
  });

  it("a database error fails the whole load (a partial count would mislead) and is logged with safe fields only", async () => {
    m.state.tables.account_billing = { error: { code: "42501", message: `denied ${KEY} ${URL_} user_secret` }, status: 403 };
    await expect(createOverviewStore(env).load()).rejects.toBeInstanceOf(OverviewStoreUnavailableError);
    expect(logs).toEqual([["admin overview store failure", { reason: "query_error", op: "billing", code: "42501", status: 403 }]]);
    for (const s of [KEY, URL_, "user_secret", "denied"]) expect(JSON.stringify(logs)).not.toContain(s);
  });

  it("refuses to start without the server configuration, naming variables but never values", () => {
    expect(() => createOverviewStore({})).toThrow(OverviewStoreUnavailableError);
    expect(logs).toEqual([["admin overview store failure", { reason: "missing_env", op: "init", missing: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] }]]);
  });
});

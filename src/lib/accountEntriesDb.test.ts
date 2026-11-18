import { describe, it, expect, vi, beforeEach } from "vitest";

// Database-helper tests with the Supabase client mocked: they pin what is asked for and sent, not what PostgreSQL does.
type Reply = { data: unknown; error: unknown };
const calls: { rpc: [string, Record<string, unknown>][]; from: string[]; steps: [string, ...unknown[]][] } = { rpc: [], from: [], steps: [] };
let rpcReply: Reply = { data: null, error: null };
let queryReply: Reply = { data: [], error: null };

vi.mock("@/lib/supabase/client", () => {
  const chainFor = (table: string) => {
    type Chain = {
      select: (cols: string) => Chain;
      eq: (col: string, val: unknown) => Chain;
      in: (col: string, vals: unknown[]) => Chain;
      order: (col: string, opts: unknown) => Promise<Reply>;
    };
    const chain: Chain = {
      select: (cols) => (calls.steps.push([`${table}.select`, cols]), chain),
      eq: (col, val) => (calls.steps.push([`${table}.eq`, col, val]), chain),
      in: (col, vals) => (calls.steps.push([`${table}.in`, col, vals]), chain),
      order: (col, opts) => (calls.steps.push([`${table}.order`, col, opts]), Promise.resolve(queryReply)),
    };
    return chain;
  };
  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => (calls.rpc.push([name, args]), Promise.resolve(rpcReply)),
      from: (table: string) => (calls.from.push(table), chainFor(table)),
    },
  };
});

import { getAccountEntries, reverseAccountEntry } from "./supabase/db";

const row = (over: Record<string, unknown> = {}) => ({
  id: "e1", account_id: "a1", kind: "interest", amount: "12.34", balance_delta: "12.34", balance_applied: true, entry_date: "2026-11-10", statement_date: "2026-11-01",
  reason: null, note: "APR", created_at: "2026-11-10T15:00:00Z", reversed_at: null, ...over,
});

beforeEach(() => {
  calls.rpc = [];
  calls.from = [];
  calls.steps = [];
  rpcReply = { data: null, error: null };
  queryReply = { data: [], error: null };
});

describe("getAccountEntries", () => {
  it("reads only this account's interest, fee and adjustment rows (checkpoints are excluded by the query), newest first", async () => {
    await getAccountEntries("a1");
    expect(calls.from).toEqual(["payment_account_entries"]);
    expect(calls.steps).toEqual(
      expect.arrayContaining([
        ["payment_account_entries.eq", "account_id", "a1"],
        ["payment_account_entries.in", "kind", ["interest", "fee", "adjustment"]],
        ["payment_account_entries.order", "created_at", { ascending: false }],
      ])
    );
    const kinds = calls.steps.find((s) => s[0] === "payment_account_entries.in")![2] as string[];
    expect(kinds).not.toContain("checkpoint");
  });
  it("maps rows to typed entries with numbers, dates and the reversed stamp", async () => {
    queryReply = { data: [row(), row({ id: "e2", kind: "adjustment", amount: "4.50", balance_delta: "-4.50", statement_date: null, reason: "Credit", note: null, reversed_at: "2026-11-11T00:00:00Z" })], error: null };
    expect(await getAccountEntries("a1")).toEqual([
      { id: "e1", accountId: "a1", kind: "interest", amount: 12.34, balanceDelta: 12.34, balanceApplied: true, entryDate: "2026-11-10", statementDate: "2026-11-01", reason: null, note: "APR", createdAt: "2026-11-10T15:00:00Z", reversedAt: null },
      { id: "e2", accountId: "a1", kind: "adjustment", amount: 4.5, balanceDelta: -4.5, balanceApplied: true, entryDate: "2026-11-10", statementDate: null, reason: "Credit", note: null, createdAt: "2026-11-10T15:00:00Z", reversedAt: "2026-11-11T00:00:00Z" },
    ]);
  });
  it("keeps an unapplied entry's zero balance effect and flag", async () => {
    queryReply = { data: [row({ kind: "fee", amount: "25.00", balance_delta: "0.00", balance_applied: false, statement_date: null })], error: null };
    expect(await getAccountEntries("a1")).toMatchObject([{ kind: "fee", amount: 25, balanceDelta: 0, balanceApplied: false }]);
  });
  it("returns an empty list for no rows and throws the database error otherwise", async () => {
    queryReply = { data: null, error: null };
    expect(await getAccountEntries("a1")).toEqual([]);
    queryReply = { data: null, error: { message: "denied" } };
    await expect(getAccountEntries("a1")).rejects.toMatchObject({ message: "denied" });
  });
  it("never writes: no rpc is called", async () => {
    await getAccountEntries("a1");
    expect(calls.rpc).toEqual([]);
  });
});

describe("reverseAccountEntry", () => {
  it("calls reverse_account_entry (and only that) with the entry id, and returns the resulting balance as a number", async () => {
    rpcReply = { data: "381.66", error: null };
    expect(await reverseAccountEntry("e1")).toBe(381.66);
    expect(calls.rpc).toEqual([["reverse_account_entry", { p_entry_id: "e1" }]]);
    expect(calls.rpc.some(([name]) => name === "reverse_payment")).toBe(false);
  });
  it("never touches a table directly", async () => {
    rpcReply = { data: 1, error: null };
    await reverseAccountEntry("e1");
    expect(calls.from).toEqual([]);
  });
  it("throws the database's error unchanged (for example an already-reversed entry)", async () => {
    rpcReply = { data: null, error: { message: "This entry has already been reversed" } };
    await expect(reverseAccountEntry("e1")).rejects.toMatchObject({ message: "This entry has already been reversed" });
  });
});

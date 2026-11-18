import { describe, it, expect, vi, beforeEach } from "vitest";

// Database-helper tests with the Supabase client mocked: they pin WHAT the helpers send and how they read results, not what PostgreSQL does.
type Reply = { data: unknown; error: unknown };
const calls: { rpc: [string, Record<string, unknown>][]; from: string[]; filters: [string, ...unknown[]][] } = { rpc: [], from: [], filters: [] };
let rpcReply: Reply = { data: null, error: null };
let accountReply: Reply = { data: null, error: null }; // payment_accounts .single()
let entryReply: Reply = { data: null, error: null }; // payment_account_entries .maybeSingle()

vi.mock("@/lib/supabase/client", () => {
  const chainFor = (table: string) => {
    type Chain = {
      select: (cols: string) => Chain;
      eq: (col: string, val: unknown) => Chain;
      order: (col: string, opts: unknown) => Chain;
      limit: (n: number) => Chain;
      single: () => Promise<Reply>;
      maybeSingle: () => Promise<Reply>;
    };
    const chain: Chain = {
      select: (cols) => (calls.filters.push([`${table}.select`, cols]), chain),
      eq: (col, val) => (calls.filters.push([`${table}.eq`, col, val]), chain),
      order: (col, opts) => (calls.filters.push([`${table}.order`, col, opts]), chain),
      limit: (n) => (calls.filters.push([`${table}.limit`, n]), chain),
      single: () => Promise.resolve(accountReply),
      maybeSingle: () => Promise.resolve(entryReply),
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

import { createOpeningCheckpoint, getOpeningCheckpointState } from "./supabase/db";

beforeEach(() => {
  calls.rpc = [];
  calls.from = [];
  calls.filters = [];
  rpcReply = { data: null, error: null };
  accountReply = { data: { balance: "394.00", ledger_version: 7 }, error: null };
  entryReply = { data: null, error: null };
});

describe("getOpeningCheckpointState", () => {
  it("returns the fresh balance and ledger version, and no checkpoint when there is none", async () => {
    expect(await getOpeningCheckpointState("a1")).toEqual({ balance: 394, ledgerVersion: 7, checkpoint: null });
    expect(calls.from).toEqual(["payment_accounts", "payment_account_entries"]);
  });
  it("asks only for the account's checkpoint rows, newest version first, one row", async () => {
    await getOpeningCheckpointState("a1");
    expect(calls.filters).toEqual(
      expect.arrayContaining([
        ["payment_account_entries.eq", "account_id", "a1"],
        ["payment_account_entries.eq", "kind", "checkpoint"],
        ["payment_account_entries.order", "ledger_version", { ascending: false }],
        ["payment_account_entries.limit", 1],
      ])
    );
  });
  it("maps an existing checkpoint to numbers and a date string", async () => {
    entryReply = { data: { balance_after: "300.00", statement_date: "2026-10-01", ledger_version: "3" }, error: null };
    expect(await getOpeningCheckpointState("a1")).toEqual({ balance: 394, ledgerVersion: 7, checkpoint: { balance: 300, statementDate: "2026-10-01", ledgerVersion: 3 } });
  });
  it("throws when either read fails (the dialog then shows its load error and never offers a confirmation)", async () => {
    accountReply = { data: null, error: { message: "no account" } };
    await expect(getOpeningCheckpointState("a1")).rejects.toMatchObject({ message: "no account" });
    accountReply = { data: { balance: 1, ledger_version: 1 }, error: null };
    entryReply = { data: null, error: { message: "no entries" } };
    await expect(getOpeningCheckpointState("a1")).rejects.toMatchObject({ message: "no entries" });
  });
});

describe("createOpeningCheckpoint", () => {
  const input = { accountId: "a1", confirmedBalance: 394, expectedLedgerVersion: 7, statementDate: "2026-11-03", note: "First check", clientKey: "k1" };

  it("calls create_opening_checkpoint with exactly the confirmed balance, the expected ledger version, the as-of date, the note and the key", async () => {
    rpcReply = { data: [{ entry_id: "e1", checkpoint_version: 8, account_balance: "394.00", was_duplicate: false }], error: null };
    const r = await createOpeningCheckpoint(input);
    expect(calls.rpc).toEqual([
      ["create_opening_checkpoint", { p_account_id: "a1", p_confirmed_balance: 394, p_expected_ledger_version: 7, p_statement_date: "2026-11-03", p_note: "First check", p_client_key: "k1" }],
    ]);
    expect(r).toEqual({ entryId: "e1", checkpointVersion: 8, balance: 394, wasDuplicate: false });
  });
  it("passes a null note through and reads a single-row (non-array) result, including a duplicate", async () => {
    rpcReply = { data: { entry_id: "e1", checkpoint_version: "8", account_balance: 394, was_duplicate: true }, error: null };
    const r = await createOpeningCheckpoint({ ...input, note: null });
    expect(calls.rpc[0][1].p_note).toBeNull();
    expect(r).toEqual({ entryId: "e1", checkpointVersion: 8, balance: 394, wasDuplicate: true });
  });
  it("throws the database's error unchanged so the caller can classify it", async () => {
    rpcReply = { data: null, error: { message: "The account changed since it was confirmed; review it and confirm again" } };
    await expect(createOpeningCheckpoint(input)).rejects.toMatchObject({ message: expect.stringMatching(/changed since it was confirmed/) });
  });
  it("never touches a table: the checkpoint is created only through the RPC", async () => {
    rpcReply = { data: [{ entry_id: "e1", checkpoint_version: 1, account_balance: 0, was_duplicate: false }], error: null };
    await createOpeningCheckpoint(input);
    expect(calls.from).toEqual([]);
  });
});

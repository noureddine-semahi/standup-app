import { describe, it, expect, vi, beforeEach } from "vitest";

// Database-helper tests with the Supabase client mocked: they pin exactly what is sent to the RPC, not what PostgreSQL does.
const calls: { rpc: [string, Record<string, unknown>][]; from: string[] } = { rpc: [], from: [] };
let reply: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => (calls.rpc.push([name, args]), Promise.resolve(reply)),
    from: (table: string) => (calls.from.push(table), {}),
  },
}));

import { recordInterestOrFee } from "./supabase/db";

const interest = { accountId: "a1", kind: "interest" as const, amount: 12.34, entryDate: "2026-11-17", statementDate: "2026-11-01", reason: null, note: "APR", applyBalance: null, clientKey: "k1" };
const fee = { accountId: "a1", kind: "fee" as const, amount: 25, entryDate: "2026-11-17", statementDate: null, reason: "Late fee", note: null, applyBalance: true, clientKey: "k2" };

beforeEach(() => {
  calls.rpc = [];
  calls.from = [];
  reply = { data: [{ entry_id: "e1", new_balance: "406.34", was_duplicate: false }], error: null };
});

describe("recordInterestOrFee", () => {
  it("calls record_account_entry as an interest entry: statement date and note, no direction, no reason, no expected version", async () => {
    const r = await recordInterestOrFee(interest);
    expect(calls.rpc).toEqual([
      [
        "record_account_entry",
        {
          p_account_id: "a1", p_kind: "interest", p_amount: 12.34, p_entry_date: "2026-11-17", p_statement_date: "2026-11-01", p_reason: null, p_note: "APR",
          p_direction: null, p_apply_balance: null, p_client_key: "k1", p_expected_ledger_version: null,
        },
      ],
    ]);
    expect(r).toEqual({ entryId: "e1", newBalance: 406.34, wasDuplicate: false });
  });

  it("calls it as a fee: the description travels as the reason, with no statement date, note or direction", async () => {
    await recordInterestOrFee(fee);
    expect(calls.rpc[0][1]).toEqual({
      p_account_id: "a1", p_kind: "fee", p_amount: 25, p_entry_date: "2026-11-17", p_statement_date: null, p_reason: "Late fee", p_note: null,
      p_direction: null, p_apply_balance: true, p_client_key: "k2", p_expected_ledger_version: null,
    });
  });

  it("only ever uses the interest and fee kinds (never an adjustment or a checkpoint)", async () => {
    await recordInterestOrFee(interest);
    await recordInterestOrFee(fee);
    expect(calls.rpc.map(([, args]) => args.p_kind)).toEqual(["interest", "fee"]);
  });

  it("passes an explicit apply flag through (false means 'record without balance effect' on a manual account)", async () => {
    await recordInterestOrFee({ ...fee, applyBalance: false });
    expect(calls.rpc[0][1].p_apply_balance).toBe(false);
  });

  it("reads a single-row (non-array) result and reports a duplicate", async () => {
    reply = { data: { entry_id: "e1", new_balance: 10, was_duplicate: true }, error: null };
    expect(await recordInterestOrFee(fee)).toEqual({ entryId: "e1", newBalance: 10, wasDuplicate: true });
  });

  it("throws the database error unchanged, and never writes a table directly", async () => {
    reply = { data: null, error: { message: "This request key was already used for a different entry" } };
    await expect(recordInterestOrFee(fee)).rejects.toMatchObject({ message: expect.stringMatching(/different entry/) });
    expect(calls.from).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Database-helper tests with the Supabase client mocked: they pin WHAT the helpers send, not what PostgreSQL does (that is verified on a disposable PostgreSQL).
const calls: { rpc: [string, Record<string, unknown>][]; from: string[]; update: Record<string, unknown>[] } = { rpc: [], from: [], update: [] };
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let selectResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock("@/lib/supabase/client", () => {
  type Chain = { select: () => Chain; eq: () => Chain; single: () => Promise<{ data: unknown; error: unknown }>; update: (patch: Record<string, unknown>) => Chain };
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve(selectResult),
    update: (patch: Record<string, unknown>) => {
      calls.update.push(patch);
      return chain;
    },
  };
  return {
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.rpc.push([name, args]);
        return Promise.resolve(rpcResult);
      },
      from: (table: string) => {
        calls.from.push(table);
        return chain;
      },
    },
  };
});

import { getPaymentAccountSnapshot, recordAccountAdjustment, updatePaymentAccount } from "./supabase/db";

beforeEach(() => {
  calls.rpc = [];
  calls.from = [];
  calls.update = [];
  rpcResult = { data: null, error: null };
  selectResult = { data: null, error: null };
});

describe("recordAccountAdjustment", () => {
  it("calls record_account_entry as an adjustment with the direction, the reason, the key and the expected ledger version", async () => {
    rpcResult = { data: [{ entry_id: "e1", new_balance: "350.50", was_duplicate: false }], error: null };
    const r = await recordAccountAdjustment({
      accountId: "a1", amount: 43.5, direction: "decrease", reason: "Matched my statement", entryDate: "2026-11-17", expectedLedgerVersion: 7, clientKey: "k1",
    });
    expect(calls.rpc).toEqual([
      [
        "record_account_entry",
        {
          p_account_id: "a1", p_kind: "adjustment", p_amount: 43.5, p_entry_date: "2026-11-17", p_statement_date: null, p_reason: "Matched my statement", p_note: null,
          p_direction: "decrease", p_apply_balance: null, p_client_key: "k1", p_expected_ledger_version: 7,
        },
      ],
    ]);
    expect(r).toEqual({ entryId: "e1", newBalance: 350.5, wasDuplicate: false });
  });
  it("accepts a single-row (non-array) result and surfaces a duplicate", async () => {
    rpcResult = { data: { entry_id: "e1", new_balance: 10, was_duplicate: true }, error: null };
    expect(await recordAccountAdjustment({ accountId: "a", amount: 1, direction: "increase", reason: "r", entryDate: "2026-01-01", expectedLedgerVersion: 0, clientKey: "k" })).toEqual({ entryId: "e1", newBalance: 10, wasDuplicate: true });
  });
  it("throws the database error (for example a stale version) instead of swallowing it", async () => {
    rpcResult = { data: null, error: { message: "The account changed since it was loaded; review it and try again" } };
    await expect(recordAccountAdjustment({ accountId: "a", amount: 1, direction: "increase", reason: "r", entryDate: "2026-01-01", expectedLedgerVersion: 3, clientKey: "k" })).rejects.toMatchObject({ message: expect.stringMatching(/changed since it was loaded/) });
  });
});

describe("getPaymentAccountSnapshot", () => {
  it("reads the balance and ledger version of one account as numbers", async () => {
    selectResult = { data: { balance: "394.00", ledger_version: 12 }, error: null };
    expect(await getPaymentAccountSnapshot("a1")).toEqual({ balance: 394, ledgerVersion: 12 });
    expect(calls.from).toEqual(["payment_accounts"]);
  });
  it("throws when the read fails", async () => {
    selectResult = { data: null, error: { message: "nope" } };
    await expect(getPaymentAccountSnapshot("a1")).rejects.toMatchObject({ message: "nope" });
  });
});

describe("updatePaymentAccount no longer writes the balance", () => {
  it("refuses a balance (even from an untyped caller) before touching the database", async () => {
    await expect(updatePaymentAccount("a1", { balance: 5 } as never)).rejects.toThrow(/cannot be edited directly/);
    expect(calls.from).toEqual([]);
    expect(calls.update).toEqual([]);
  });
  it("still sends metadata fields, and never a balance column", async () => {
    selectResult = { data: { id: "a1", name: "Visa", balance: 10, minimum_payment: 25, due_day: 5, remind_days_before: 3, last_reminder_due_date: null, created_at: "x", balance_mode: "auto" }, error: null };
    await updatePaymentAccount("a1", { name: " Visa ", minimumPayment: 25, dueDay: 5, remindDaysBefore: 3, balanceMode: "auto" });
    expect(calls.update).toEqual([{ name: "Visa", minimum_payment: 25, due_day: 5, remind_days_before: 3, balance_mode: "auto" }]);
    expect(Object.keys(calls.update[0])).not.toContain("balance");
  });
});

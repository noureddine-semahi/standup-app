import { describe, it, expect, vi, beforeEach } from "vitest";

// Database-helper tests with the Supabase client mocked: they pin what the helper sends and how it reads the RPC's row, not what PostgreSQL computes.
const calls: { rpc: [string, Record<string, unknown>][]; from: string[] } = { rpc: [], from: [] };
let reply: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => (calls.rpc.push([name, args]), Promise.resolve(reply)),
    from: (table: string) => (calls.from.push(table), {}),
  },
}));

import { reconcilePaymentAccount } from "./supabase/db";

const row = (over: Record<string, unknown> = {}) => ({
  checkpoint_id: "c1", checkpoint_version: "7", checkpoint_balance: "99.00", current_ledger_version: "9", calculated_balance: "94.50", tracked_balance: "94.50", statement_balance: null,
  tracked_difference: "0.00", statement_difference: null, version_gap: false, balance_write_path_open: false, reliable: true, status: "reconciled", ...over,
});

beforeEach(() => {
  calls.rpc = [];
  calls.from = [];
  reply = { data: [row()], error: null };
});

describe("reconcilePaymentAccount", () => {
  it("calls reconcile_payment_account with only the account id and the statement balance (null when none), and touches no table", async () => {
    await reconcilePaymentAccount("a1", null);
    await reconcilePaymentAccount("a1", 94.5);
    expect(calls.rpc).toEqual([
      ["reconcile_payment_account", { p_account_id: "a1", p_statement_balance: null }],
      ["reconcile_payment_account", { p_account_id: "a1", p_statement_balance: 94.5 }],
    ]);
    expect(calls.from).toEqual([]);
  });

  it("maps the database row to numbers and booleans without changing any value", async () => {
    expect(await reconcilePaymentAccount("a1", null)).toEqual({
      checkpointId: "c1", checkpointVersion: 7, checkpointBalance: 99, currentLedgerVersion: 9, calculatedBalance: 94.5, trackedBalance: 94.5, statementBalance: null,
      trackedDifference: 0, statementDifference: null, versionGap: false, balanceWritePathOpen: false, reliable: true, status: "reconciled",
    });
  });

  it("reads a single-row (non-array) result and a statement comparison", async () => {
    reply = { data: row({ statement_balance: "100.00", statement_difference: "5.50", status: "statement_mismatch" }), error: null };
    expect(await reconcilePaymentAccount("a1", 100)).toMatchObject({ statementBalance: 100, statementDifference: 5.5, status: "statement_mismatch" });
  });

  it("keeps the null numbers of an account with no checkpoint (nothing is invented)", async () => {
    reply = { data: [row({ checkpoint_id: null, checkpoint_version: null, checkpoint_balance: null, calculated_balance: null, tracked_difference: null, reliable: false, status: "no_checkpoint" })], error: null };
    expect(await reconcilePaymentAccount("a1", null)).toMatchObject({
      checkpointId: null, checkpointVersion: null, checkpointBalance: null, calculatedBalance: null, trackedDifference: null, reliable: false, status: "no_checkpoint",
    });
  });

  it("never reports reliable unless the database sent exactly true (a missing or odd value is NOT reliable)", async () => {
    for (const value of [undefined, null, "true", 1, "t"]) {
      reply = { data: [row({ reliable: value })], error: null };
      expect((await reconcilePaymentAccount("a1", null)).reliable, String(value)).toBe(false);
    }
  });

  it("carries the gap and write-path flags through, including an unreliable result with both set", async () => {
    reply = { data: [row({ version_gap: true, balance_write_path_open: true, reliable: false, status: "ledger_incomplete" })], error: null };
    expect(await reconcilePaymentAccount("a1", null)).toMatchObject({ versionGap: true, balanceWritePathOpen: true, reliable: false, status: "ledger_incomplete" });
  });

  it("accepts every status the database defines", async () => {
    for (const status of ["no_checkpoint", "ledger_incomplete", "tracked_mismatch", "statement_mismatch", "reconciled"]) {
      reply = { data: [row({ status })], error: null };
      expect((await reconcilePaymentAccount("a1", null)).status).toBe(status);
    }
  });

  it("rejects an unknown status or an empty result instead of guessing", async () => {
    reply = { data: [row({ status: "all_good" })], error: null };
    await expect(reconcilePaymentAccount("a1", null)).rejects.toThrow(/Unrecognized reconciliation result/);
    reply = { data: [], error: null };
    await expect(reconcilePaymentAccount("a1", null)).rejects.toThrow(/Unrecognized reconciliation result/);
    reply = { data: null, error: null };
    await expect(reconcilePaymentAccount("a1", null)).rejects.toThrow(/Unrecognized reconciliation result/);
  });

  it("throws the database error unchanged", async () => {
    reply = { data: null, error: { message: "Account not found" } };
    await expect(reconcilePaymentAccount("a1", null)).rejects.toMatchObject({ message: "Account not found" });
  });
});

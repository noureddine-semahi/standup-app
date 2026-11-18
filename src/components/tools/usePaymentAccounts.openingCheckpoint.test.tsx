import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { OpeningCheckpointInput } from "./PaymentsDashboard";

const api = vi.hoisted(() => ({
  getPaymentAccounts: vi.fn(),
  createPaymentAccount: vi.fn(),
  updatePaymentAccount: vi.fn(),
  recordPayment: vi.fn(),
  recordAccountAdjustment: vi.fn(),
  getPaymentAccountSnapshot: vi.fn(),
  getOpeningCheckpointState: vi.fn(),
  createOpeningCheckpoint: vi.fn(),
  toISODate: vi.fn(() => "2026-11-17"),
  reversePayment: vi.fn(),
  deletePaymentAccount: vi.fn(),
  getPaymentTransactions: vi.fn(),
}));
vi.mock("@/lib/supabase/db", () => api);

import { usePaymentAccounts } from "./usePaymentAccounts";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  for (const fn of Object.values(api)) fn.mockReset();
  api.toISODate.mockReturnValue("2026-11-17");
  api.getPaymentAccounts.mockResolvedValue([account]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const account: PaymentAccount = { id: "a1", name: "Visa", balance: 394, minimumPayment: 25, dueDay: 13, remindDaysBefore: 3, lastReminderDueDate: null, createdAt: "x", balanceMode: "auto" };
const input: OpeningCheckpointInput = { confirmedBalance: 394, expectedLedgerVersion: 7, statementDate: "2026-11-03", note: null, clientKey: "k1" };
const wrapper = ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

async function setup() {
  const view = renderHook(() => usePaymentAccounts(), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("usePaymentAccounts: opening checkpoint", () => {
  it("loading the dialog's state is a pure read through getOpeningCheckpointState", async () => {
    api.getOpeningCheckpointState.mockResolvedValue({ balance: 394, ledgerVersion: 7, checkpoint: null });
    const { result } = await setup();
    await expect(result.current.onLoadOpeningCheckpoint(account)).resolves.toEqual({ balance: 394, ledgerVersion: 7, checkpoint: null });
    expect(api.getOpeningCheckpointState).toHaveBeenCalledWith("a1");
    expect(api.createOpeningCheckpoint).not.toHaveBeenCalled();
  });

  it("success: creates through the RPC helper with exactly the dialog's input, then refreshes the accounts (balance untouched)", async () => {
    api.createOpeningCheckpoint.mockResolvedValue({ entryId: "e1", checkpointVersion: 8, balance: 394, wasDuplicate: false });
    const { result } = await setup();
    let r: unknown;
    await act(async () => {
      r = await result.current.onCreateOpeningCheckpoint(account, input);
    });
    expect(r).toEqual({ ok: true });
    expect(api.createOpeningCheckpoint).toHaveBeenCalledWith({ accountId: "a1", ...input });
    expect(api.getPaymentAccounts).toHaveBeenCalledTimes(2); // initial load + the refresh
    expect(result.current.accounts[0].balance).toBe(394);
    // it never edits the account or records any payment/adjustment
    expect(api.updatePaymentAccount).not.toHaveBeenCalled();
    expect(api.recordAccountAdjustment).not.toHaveBeenCalled();
    expect(api.recordPayment).not.toHaveBeenCalled();
  });

  it("a stale confirmation (version or balance moved) is classified 'stale' with a friendly message, and does not refresh", async () => {
    const { result } = await setup();
    for (const message of ["The account changed since it was confirmed; review it and confirm again", "The confirmed balance does not match the current tracked balance"]) {
      api.createOpeningCheckpoint.mockRejectedValueOnce({ message });
      let r: unknown;
      await act(async () => {
        r = await result.current.onCreateOpeningCheckpoint(account, input);
      });
      expect(r).toEqual({ ok: false, kind: "stale", message: expect.stringMatching(/changed since you opened this form/) });
    }
    expect(api.getPaymentAccounts).toHaveBeenCalledTimes(1);
  });

  it("an existing checkpoint is classified 'exists'", async () => {
    api.createOpeningCheckpoint.mockRejectedValue({ message: "This account already has an opening checkpoint" });
    const { result } = await setup();
    let r: unknown;
    await act(async () => {
      r = await result.current.onCreateOpeningCheckpoint(account, input);
    });
    expect(r).toEqual({ ok: false, kind: "exists", message: "This account already has an opening balance confirmed." });
  });

  it("the balance-write-path guard is shown as 'not available right now' (never the raw database text)", async () => {
    api.createOpeningCheckpoint.mockRejectedValue({ message: "Opening checkpoints are disabled while the balance can still be edited directly" });
    const { result } = await setup();
    let r: { ok: boolean; kind?: string; message?: string } | undefined;
    await act(async () => {
      r = await result.current.onCreateOpeningCheckpoint(account, input);
    });
    expect(r).toEqual({ ok: false, kind: "other", message: "Confirming an opening balance isn't available right now. Try again later." });
  });

  it("any other error keeps its original message; an error with no message falls back to a generic one", async () => {
    const { result } = await setup();
    api.createOpeningCheckpoint.mockRejectedValueOnce({ message: "Confirmed balance must be a valid amount with at most 2 decimal places" });
    api.createOpeningCheckpoint.mockRejectedValueOnce({});
    const out: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        out.push(await result.current.onCreateOpeningCheckpoint(account, input));
      });
    }
    expect(out).toEqual([
      { ok: false, kind: "other", message: "Confirmed balance must be a valid amount with at most 2 decimal places" },
      { ok: false, kind: "other", message: "Failed to confirm the opening balance" },
    ]);
  });

  it("a second request while one is in flight is refused without calling the database", async () => {
    let finish!: (v: unknown) => void;
    api.createOpeningCheckpoint.mockReturnValue(new Promise((r) => (finish = r)));
    const { result } = await setup();
    let first!: Promise<unknown>;
    await act(async () => {
      first = result.current.onCreateOpeningCheckpoint(account, input);
    });
    await waitFor(() => expect(result.current.busyIds.has("a1")).toBe(true));
    let second: unknown;
    await act(async () => {
      second = await result.current.onCreateOpeningCheckpoint(account, input);
    });
    expect(second).toEqual({ ok: false, kind: "other", message: "Another change to this account is in progress. Try again in a moment." });
    expect(api.createOpeningCheckpoint).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ entryId: "e1", checkpointVersion: 8, balance: 394, wasDuplicate: false });
      await first;
    });
    expect(result.current.busyIds.has("a1")).toBe(false);
  });

  it("a failed refresh after a saved checkpoint still reports success (and surfaces the refresh problem separately)", async () => {
    api.createOpeningCheckpoint.mockResolvedValue({ entryId: "e1", checkpointVersion: 8, balance: 394, wasDuplicate: false });
    const { result } = await setup();
    api.getPaymentAccounts.mockRejectedValueOnce({ message: "refresh failed" });
    let r: unknown;
    await act(async () => {
      r = await result.current.onCreateOpeningCheckpoint(account, input);
    });
    expect(r).toEqual({ ok: true });
    expect(result.current.message).toBe("refresh failed");
  });
});

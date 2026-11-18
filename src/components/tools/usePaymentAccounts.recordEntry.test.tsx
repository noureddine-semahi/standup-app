import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { AccountEntry, PaymentAccount } from "@/lib/supabase/db";
import type { RecordEntryInput } from "./PaymentsDashboard";

const api = vi.hoisted(() => ({
  getPaymentAccounts: vi.fn(),
  createPaymentAccount: vi.fn(),
  updatePaymentAccount: vi.fn(),
  recordPayment: vi.fn(),
  recordAccountAdjustment: vi.fn(),
  recordInterestOrFee: vi.fn(),
  getPaymentAccountSnapshot: vi.fn(),
  getOpeningCheckpointState: vi.fn(),
  createOpeningCheckpoint: vi.fn(),
  reconcilePaymentAccount: vi.fn(),
  getAccountEntries: vi.fn(),
  reverseAccountEntry: vi.fn(),
  toISODate: vi.fn(() => "2026-11-17"),
  reversePayment: vi.fn(),
  deletePaymentAccount: vi.fn(),
  getPaymentTransactions: vi.fn(),
}));
vi.mock("@/lib/supabase/db", () => api);

import { usePaymentAccounts } from "./usePaymentAccounts";

const account: PaymentAccount = { id: "a1", name: "Visa", balance: 400, minimumPayment: 25, dueDay: 13, remindDaysBefore: 3, lastReminderDueDate: null, createdAt: "x", balanceMode: "auto" };
const input: RecordEntryInput = { kind: "interest", amount: 12.34, entryDate: "2026-11-17", statementDate: "2026-11-01", reason: null, note: "APR", applyBalance: null, clientKey: "k1" };
const entry: AccountEntry = {
  id: "e1", accountId: "a1", kind: "interest", amount: 12.34, balanceDelta: 12.34, balanceApplied: true, entryDate: "2026-11-17", statementDate: "2026-11-01", reason: null, note: "APR",
  createdAt: "2026-11-17T15:00:00Z", reversedAt: null,
};
const wrapper = ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

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
  api.getPaymentTransactions.mockResolvedValue([]);
  api.getAccountEntries.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function setup() {
  const view = renderHook(() => usePaymentAccounts(), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("usePaymentAccounts: record interest / fee", () => {
  it("records through the RPC helper with exactly the form's input, takes the balance from the database, re-reads the accounts and refreshes an open History", async () => {
    api.recordInterestOrFee.mockResolvedValue({ entryId: "e1", newBalance: 412.34, wasDuplicate: false });
    api.getPaymentAccounts.mockResolvedValueOnce([account]).mockResolvedValueOnce([{ ...account, balance: 412.34 }]);
    api.getAccountEntries.mockResolvedValueOnce([]).mockResolvedValueOnce([entry]);
    const view = await setup();
    await act(async () => view.result.current.onToggleHistory(account)); // History opened, so it is "loaded"
    await waitFor(() => expect(view.result.current.entriesByAccount.a1).toEqual([]));
    let r: unknown = "unset";
    await act(async () => {
      r = await view.result.current.onRecordEntry(account, input);
    });
    expect(r).toBeNull();
    expect(api.recordInterestOrFee).toHaveBeenCalledTimes(1);
    expect(api.recordInterestOrFee).toHaveBeenCalledWith({ accountId: "a1", ...input });
    expect(view.result.current.accounts[0].balance).toBe(412.34);
    expect(api.getPaymentAccounts).toHaveBeenCalledTimes(2);
    expect(view.result.current.entriesByAccount.a1).toEqual([entry]); // the new entry is in History
    expect(view.result.current.busyIds.has("a1")).toBe(false);
  });

  it("it records nothing else: no adjustment, payment, checkpoint, reversal or direct account edit", async () => {
    api.recordInterestOrFee.mockResolvedValue({ entryId: "e1", newBalance: 412.34, wasDuplicate: false });
    const view = await setup();
    await act(async () => {
      await view.result.current.onRecordEntry(account, input);
    });
    for (const fn of [api.recordAccountAdjustment, api.recordPayment, api.createOpeningCheckpoint, api.reverseAccountEntry, api.reversePayment, api.updatePaymentAccount, api.createPaymentAccount])
      expect(fn).not.toHaveBeenCalled();
  });

  it("a fee on a manual account sends the apply flag through unchanged", async () => {
    api.recordInterestOrFee.mockResolvedValue({ entryId: "e2", newBalance: 400, wasDuplicate: false });
    const view = await setup();
    await act(async () => {
      await view.result.current.onRecordEntry(account, { ...input, kind: "fee", statementDate: null, reason: "Late fee", note: null, applyBalance: false });
    });
    expect(api.recordInterestOrFee).toHaveBeenCalledWith(expect.objectContaining({ kind: "fee", reason: "Late fee", applyBalance: false }));
  });

  it("a failed accounts re-read after a recorded entry still succeeds and keeps the database's balance", async () => {
    api.recordInterestOrFee.mockResolvedValue({ entryId: "e1", newBalance: 412.34, wasDuplicate: false });
    const view = await setup();
    api.getPaymentAccounts.mockRejectedValueOnce({ message: "reload failed" });
    let r: unknown = "unset";
    await act(async () => {
      r = await view.result.current.onRecordEntry(account, input);
    });
    expect(r).toBeNull();
    expect(view.result.current.accounts[0].balance).toBe(412.34);
  });

  it("a retry of an entry that was already saved comes back as a duplicate and is treated as success", async () => {
    api.recordInterestOrFee.mockResolvedValue({ entryId: "e1", newBalance: 412.34, wasDuplicate: true });
    const view = await setup();
    let r: unknown = "unset";
    await act(async () => {
      r = await view.result.current.onRecordEntry(account, input);
    });
    expect(r).toBeNull();
  });

  it("the database's 'key already used for a different entry' becomes a plain explanation (check History); any other error keeps its text, or a generic one", async () => {
    const view = await setup();
    api.recordInterestOrFee
      .mockRejectedValueOnce({ message: "This request key was already used for a different entry" })
      .mockRejectedValueOnce({ message: "Entry amount must be greater than zero" })
      .mockRejectedValueOnce({});
    const out: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        out.push(await view.result.current.onRecordEntry(account, input));
      });
    }
    expect(out).toEqual([
      "An earlier attempt from this form may already have been saved. Close this form and check History before trying again.",
      "Entry amount must be greater than zero",
      "Failed to record the entry",
    ]);
    expect(api.getPaymentAccounts).toHaveBeenCalledTimes(1); // a failure does not re-read
    expect(view.result.current.busyIds.has("a1")).toBe(false);
  });

  it("a second request while one is in flight is refused with a message and never reaches the database", async () => {
    let finish!: (v: unknown) => void;
    api.recordInterestOrFee.mockReturnValue(new Promise((r) => (finish = r)));
    const view = await setup();
    let first!: Promise<unknown>;
    await act(async () => {
      first = view.result.current.onRecordEntry(account, input);
    });
    await waitFor(() => expect(view.result.current.busyIds.has("a1")).toBe(true));
    let second: unknown;
    await act(async () => {
      second = await view.result.current.onRecordEntry(account, input);
    });
    expect(second).toBe("Another change to this account is in progress. Try again in a moment.");
    expect(api.recordInterestOrFee).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ entryId: "e1", newBalance: 412.34, wasDuplicate: false });
      await first;
    });
    expect(view.result.current.busyIds.has("a1")).toBe(false);
  });
});

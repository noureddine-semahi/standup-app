import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { AccountEntry, PaymentAccount, PaymentTransaction } from "@/lib/supabase/db";

const api = vi.hoisted(() => ({
  getPaymentAccounts: vi.fn(),
  createPaymentAccount: vi.fn(),
  updatePaymentAccount: vi.fn(),
  recordPayment: vi.fn(),
  recordAccountAdjustment: vi.fn(),
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
const txn: PaymentTransaction = { id: "t1", accountId: "a1", goalId: null, amount: 40, paidAt: "2026-11-09T12:00:00", note: null, balanceApplied: true, reversedAt: null };
const entry: AccountEntry = {
  id: "e1", accountId: "a1", kind: "fee", amount: 25, balanceDelta: 25, balanceApplied: true, entryDate: "2026-11-10", statementDate: null, reason: "Late fee", note: null,
  createdAt: "2026-11-10T15:00:00Z", reversedAt: null,
};
const reversedEntry: AccountEntry = { ...entry, reversedAt: "2026-11-12T00:00:00Z" };
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
  api.getPaymentTransactions.mockResolvedValue([txn]);
  api.getAccountEntries.mockResolvedValue([entry]);
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
async function openHistory(view: Awaited<ReturnType<typeof setup>>) {
  await act(async () => {
    view.result.current.onToggleHistory(account);
  });
  await waitFor(() => expect(view.result.current.historyLoadingId).toBeNull());
}

describe("usePaymentAccounts: History loads entries next to payments", () => {
  it("opening History reads both tables once, for this account, and exposes them separately", async () => {
    const view = await setup();
    await openHistory(view);
    expect(api.getPaymentTransactions).toHaveBeenCalledWith("a1");
    expect(api.getAccountEntries).toHaveBeenCalledWith("a1");
    expect(view.result.current.historyByAccount.a1).toEqual([txn]);
    expect(view.result.current.entriesByAccount.a1).toEqual([entry]);
    // closing and reopening does not re-read what is already loaded
    await act(async () => view.result.current.onToggleHistory(account));
    await act(async () => view.result.current.onToggleHistory(account));
    expect(api.getPaymentTransactions).toHaveBeenCalledTimes(1);
    expect(api.getAccountEntries).toHaveBeenCalledTimes(1);
  });

  it("if the entries can't be read, the payments still show, the problem is reported, and the next open tries the entries again", async () => {
    api.getAccountEntries.mockRejectedValueOnce({ message: "entries unavailable" });
    const view = await setup();
    await openHistory(view);
    expect(view.result.current.historyByAccount.a1).toEqual([txn]);
    expect(view.result.current.entriesByAccount.a1).toBeUndefined();
    expect(view.result.current.message).toBe("entries unavailable");
    await act(async () => view.result.current.onToggleHistory(account)); // close
    await act(async () => view.result.current.onToggleHistory(account)); // reopen
    await waitFor(() => expect(view.result.current.entriesByAccount.a1).toEqual([entry]));
    expect(api.getAccountEntries).toHaveBeenCalledTimes(2);
  });

  it("reversing a PAYMENT still uses reverse_payment only, and refreshes both lists", async () => {
    api.reversePayment.mockResolvedValue(360);
    const view = await setup();
    await openHistory(view);
    await act(async () => {
      expect(await view.result.current.onReversePayment(account, txn)).toBeNull();
    });
    expect(api.reversePayment).toHaveBeenCalledWith("t1");
    expect(api.reverseAccountEntry).not.toHaveBeenCalled();
    await waitFor(() => expect(api.getAccountEntries).toHaveBeenCalledTimes(2));
    expect(api.getPaymentTransactions).toHaveBeenCalledTimes(2);
  });
});

describe("usePaymentAccounts: reversing an entry", () => {
  it("goes through reverse_account_entry only, takes the balance from the database, re-reads the accounts and refreshes History", async () => {
    api.reverseAccountEntry.mockResolvedValue(375);
    api.getPaymentAccounts.mockResolvedValueOnce([account]).mockResolvedValueOnce([{ ...account, balance: 375 }]);
    api.getAccountEntries.mockResolvedValueOnce([entry]).mockResolvedValueOnce([reversedEntry]);
    const view = await setup();
    await openHistory(view);
    let r: unknown = "unset";
    await act(async () => {
      r = await view.result.current.onReverseEntry(account, entry);
    });
    expect(r).toBeNull();
    expect(api.reverseAccountEntry).toHaveBeenCalledTimes(1);
    expect(api.reverseAccountEntry).toHaveBeenCalledWith("e1");
    expect(api.reversePayment).not.toHaveBeenCalled();
    expect(view.result.current.accounts[0].balance).toBe(375);
    expect(api.getPaymentAccounts).toHaveBeenCalledTimes(2);
    expect(view.result.current.entriesByAccount.a1).toEqual([reversedEntry]);
    expect(view.result.current.busyIds.has("a1")).toBe(false);
    // nothing else was written
    for (const fn of [api.updatePaymentAccount, api.recordAccountAdjustment, api.createOpeningCheckpoint, api.recordPayment]) expect(fn).not.toHaveBeenCalled();
  });

  it("a failed accounts re-read after a completed reversal still succeeds and keeps the database's balance", async () => {
    api.reverseAccountEntry.mockResolvedValue(375);
    const view = await setup();
    api.getPaymentAccounts.mockRejectedValueOnce({ message: "reload failed" });
    let r: unknown = "unset";
    await act(async () => {
      r = await view.result.current.onReverseEntry(account, entry);
    });
    expect(r).toBeNull();
    expect(view.result.current.accounts[0].balance).toBe(375);
  });

  it("an entry already reversed elsewhere: a friendly message, the accounts and History re-read so it shows as reversed", async () => {
    api.reverseAccountEntry.mockRejectedValue({ message: "This entry has already been reversed" });
    api.getPaymentAccounts.mockResolvedValueOnce([account]).mockResolvedValueOnce([{ ...account, balance: 375 }]);
    api.getAccountEntries.mockResolvedValueOnce([entry]).mockResolvedValueOnce([reversedEntry]);
    const view = await setup();
    await openHistory(view);
    let r: unknown;
    await act(async () => {
      r = await view.result.current.onReverseEntry(account, entry);
    });
    expect(r).toBe("This entry was already reversed. History has been refreshed.");
    expect(view.result.current.entriesByAccount.a1).toEqual([reversedEntry]);
    expect(view.result.current.accounts[0].balance).toBe(375);
    expect(view.result.current.busyIds.has("a1")).toBe(false);
  });

  it("any other error is shown as the database sent it (generic text when none)", async () => {
    const view = await setup();
    const out: unknown[] = [];
    api.reverseAccountEntry.mockRejectedValueOnce({ message: "Entry not found" }).mockRejectedValueOnce({});
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        out.push(await view.result.current.onReverseEntry(account, entry));
      });
    }
    expect(out).toEqual(["Entry not found", "Failed to reverse the entry"]);
    expect(api.getPaymentAccounts).toHaveBeenCalledTimes(1); // a plain failure does not re-read
  });

  it("a second request while one is in flight is refused with a message and never reaches the database", async () => {
    let finish!: (v: number) => void;
    api.reverseAccountEntry.mockReturnValue(new Promise<number>((r) => (finish = r)));
    const view = await setup();
    let first!: Promise<unknown>;
    await act(async () => {
      first = view.result.current.onReverseEntry(account, entry);
    });
    await waitFor(() => expect(view.result.current.busyIds.has("a1")).toBe(true));
    let second: unknown;
    await act(async () => {
      second = await view.result.current.onReverseEntry(account, entry);
    });
    expect(second).toBe("Another change to this account is in progress. Try again in a moment.");
    expect(api.reverseAccountEntry).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(375);
      await first;
    });
    expect(view.result.current.busyIds.has("a1")).toBe(false);
  });
});

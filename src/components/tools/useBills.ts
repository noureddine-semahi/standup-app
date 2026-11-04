"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Bill,
  BillFormPayload,
  BillOccurrenceRecord,
  BillPaymentEntryPayload,
  OccurrenceMap,
} from "@/lib/bills";
import {
  archiveBill,
  createBill,
  getBillHistory,
  getBillOccurrenceWindow,
  getBills,
  isBillsUnavailableError,
  recordBillPayment,
  reverseBillPayment,
  setBillOccurrenceAmount,
  updateBill,
} from "@/lib/supabase/bills";

export type BillsLoadState = "loading" | "ready" | "unavailable" | "error";

/** Everything the Bills tab (and the Finances overview) needs; each action resolves to an error message, or null on success. */
export type BillsController = {
  state: BillsLoadState;
  loadError: string | null;
  bills: Bill[];
  occurrences: OccurrenceMap;
  historyOpenId: string | null;
  historyLoading: boolean;
  history: Record<string, BillOccurrenceRecord[]>;
  create: (payload: BillFormPayload) => Promise<string | null>;
  update: (bill: Bill, patch: Partial<BillFormPayload>) => Promise<string | null>;
  archive: (bill: Bill) => Promise<string | null>;
  recordPayment: (bill: Bill, dueDate: string, payload: BillPaymentEntryPayload, clientKey: string) => Promise<string | null>;
  setAmount: (bill: Bill, dueDate: string, amount: number) => Promise<string | null>;
  reversePayment: (bill: Bill, paymentId: string) => Promise<string | null>;
  toggleHistory: (bill: Bill) => void;
};

function errorMessage(e: unknown, fallback: string): string {
  // Supabase/PostgREST errors are plain objects with a message, not Error instances.
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : fallback;
}

export function useBills(todayISO: string, fallbackError: string): BillsController {
  const [state, setState] = useState<BillsLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [occurrences, setOccurrences] = useState<OccurrenceMap>({});
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<Record<string, BillOccurrenceRecord[]>>({});
  const billsRef = useRef<Bill[]>([]);
  const historyRef = useRef<Record<string, BillOccurrenceRecord[]>>({});
  useEffect(() => {
    billsRef.current = bills;
    historyRef.current = history;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getBills();
        const map = await getBillOccurrenceWindow(list, todayISO);
        if (cancelled) return;
        setBills(list);
        setOccurrences(map);
        setLoadError(null);
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        if (isBillsUnavailableError(e)) {
          setState("unavailable");
        } else {
          setLoadError(errorMessage(e, fallbackError));
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [todayISO, fallbackError]);

  const reloadAfterWrite = useCallback(
    async (billId: string) => {
      const map = await getBillOccurrenceWindow(billsRef.current, todayISO);
      setOccurrences(map);
      // Only refresh a history list that has actually been opened.
      if (historyRef.current[billId]) {
        try {
          const rows = await getBillHistory(billId);
          setHistory((p) => ({ ...p, [billId]: rows }));
        } catch {
          // The payment itself succeeded; a stale history list is not an error.
        }
      }
    },
    [todayISO]
  );

  const wrap = useCallback(
    async (fn: () => Promise<void>): Promise<string | null> => {
      try {
        await fn();
        return null;
      } catch (e) {
        return errorMessage(e, fallbackError);
      }
    },
    [fallbackError]
  );

  return {
    state,
    loadError,
    bills,
    occurrences,
    historyOpenId,
    historyLoading,
    history,
    create: (payload) =>
      wrap(async () => {
        const created = await createBill(payload);
        setBills((prev) => [...prev, created]);
      }),
    update: (bill, patch) =>
      wrap(async () => {
        const updated = await updateBill(bill.id, patch);
        setBills((prev) => prev.map((b) => (b.id === bill.id ? updated : b)));
      }),
    archive: (bill) =>
      wrap(async () => {
        await archiveBill(bill.id);
        setBills((prev) => prev.filter((b) => b.id !== bill.id));
        setHistoryOpenId((cur) => (cur === bill.id ? null : cur));
      }),
    recordPayment: (bill, dueDate, payload, clientKey) =>
      wrap(async () => {
        await recordBillPayment({
          billId: bill.id,
          dueDate,
          amount: payload.amount,
          paidAt: payload.paidAt,
          note: payload.note,
          amountDue: payload.amountDue,
          clientKey,
        });
        await reloadAfterWrite(bill.id);
      }),
    setAmount: (bill, dueDate, amount) =>
      wrap(async () => {
        await setBillOccurrenceAmount(bill.id, dueDate, amount);
        await reloadAfterWrite(bill.id);
      }),
    reversePayment: (bill, paymentId) =>
      wrap(async () => {
        await reverseBillPayment(paymentId);
        await reloadAfterWrite(bill.id);
      }),
    toggleHistory: (bill) => {
      if (historyOpenId === bill.id) {
        setHistoryOpenId(null);
        return;
      }
      setHistoryOpenId(bill.id);
      if (history[bill.id]) return;
      setHistoryLoading(true);
      getBillHistory(bill.id)
        .then((rows) => setHistory((prev) => ({ ...prev, [bill.id]: rows })))
        .catch(() => setHistory((prev) => ({ ...prev, [bill.id]: [] })))
        .finally(() => setHistoryLoading(false));
    },
  };
}

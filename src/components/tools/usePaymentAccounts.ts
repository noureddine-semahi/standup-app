"use client";

import { useEffect, useState } from "react";
import {
  getPaymentAccounts,
  createPaymentAccount,
  updatePaymentAccount,
  recordPayment,
  reversePayment,
  deletePaymentAccount,
  getPaymentTransactions,
  type PaymentAccount,
  type PaymentTransaction,
} from "@/lib/supabase/db";
import type { PaymentEntryPayload, PaymentFormPayload } from "@/lib/paymentSummary";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { PaymentsDashboardProps } from "./PaymentsDashboard";

function errorMessage(e: unknown, fallback: string): string {
  // Supabase/PostgREST errors are plain objects with a message, not Error instances.
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : fallback;
}

/**
 * Payment reminders (credit cards, bills): balance/minimum/due-day per account, no date of its own; the next due date
 * is computed on read (computeNextDueDate), never stored. Moved verbatim from the Tools page when Finances became its own
 * section; returns exactly the props PaymentsDashboard (and FinancesHub) take, minus todayISO.
 */
export function usePaymentAccounts(): Omit<PaymentsDashboardProps, "todayISO"> {
  const { t } = useLanguage();
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsMsg, setPaymentsMsg] = useState<string | null>(null);
  const [busyPaymentIds, setBusyPaymentIds] = useState<Set<string>>(new Set());

  // Payment history — collapsed by default per account, fetched lazily on
  // first expand rather than loading every account's whole ledger up
  // front (most accounts will never be expanded in a given visit).
  const [expandedPaymentHistoryId, setExpandedPaymentHistoryId] = useState<string | null>(null);
  const [paymentHistoryByAccount, setPaymentHistoryByAccount] = useState<Record<string, PaymentTransaction[]>>({});
  const [paymentHistoryLoadingId, setPaymentHistoryLoadingId] = useState<string | null>(null);

  useEffect(() => {
    refreshPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshPayments() {
    setPaymentsLoading(true);
    setPaymentsMsg(null);
    try {
      setPaymentAccounts(await getPaymentAccounts());
    } catch (e: any) {
      setPaymentsMsg(e?.message ?? t("backlog.failedLoadPayments"));
    } finally {
      setPaymentsLoading(false);
    }
  }

  function setPaymentBusy(id: string, busy: boolean) {
    setBusyPaymentIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // The dashboard's modals own the form values; these handlers keep the
  // original db calls and resolve to an error message (null on success) so a
  // failed save leaves the modal open with the message visible.
  async function handleAddPayment(payload: PaymentFormPayload): Promise<string | null> {
    setPaymentsMsg(null);
    try {
      const created = await createPaymentAccount(payload);
      setPaymentAccounts((prev) => [...prev, created]);
      return null;
    } catch (e: any) {
      return e?.message ?? t("backlog.failedAddPayment");
    }
  }

  async function handleUpdatePayment(account: PaymentAccount, patch: Partial<PaymentFormPayload>): Promise<string | null> {
    if (busyPaymentIds.has(account.id)) return null;
    setPaymentBusy(account.id, true);
    setPaymentsMsg(null);
    try {
      const updated = await updatePaymentAccount(account.id, patch);
      setPaymentAccounts((prev) => prev.map((a) => (a.id === account.id ? updated : a)));
      return null;
    } catch (e: any) {
      return e?.message ?? t("backlog.failedUpdatePayment");
    } finally {
      setPaymentBusy(account.id, false);
    }
  }

  async function handleDeletePayment(account: PaymentAccount): Promise<string | null> {
    if (busyPaymentIds.has(account.id)) return null;
    setPaymentBusy(account.id, true);
    setPaymentsMsg(null);
    try {
      await deletePaymentAccount(account.id);
      setPaymentAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setExpandedPaymentHistoryId((cur) => (cur === account.id ? null : cur));
      return null;
    } catch (e: any) {
      return e?.message ?? t("backlog.failedDeletePayment");
    } finally {
      setPaymentBusy(account.id, false);
    }
  }

  /** Re-reads one account's ledger after a record/reverse -- only if it has been loaded, so a never-opened history isn't fetched for nothing. */
  async function refreshHistoryIfLoaded(accountId: string) {
    if (!paymentHistoryByAccount[accountId]) return;
    try {
      const rows = await getPaymentTransactions(accountId);
      setPaymentHistoryByAccount((prev) => ({ ...prev, [accountId]: rows }));
    } catch (e) {
      setPaymentsMsg(errorMessage(e, t("backlog.failedLoadPaymentHistory")));
    }
  }

  // Record Payment goes through record_payment(): ledger row + (policy-driven)
  // balance change commit together server-side, and clientKey makes a
  // repeated tap or retry a no-op. The returned balance is applied locally so
  // the card updates without a refetch.
  async function handleRecordPayment(account: PaymentAccount, payload: PaymentEntryPayload, clientKey: string): Promise<string | null> {
    if (busyPaymentIds.has(account.id)) return null;
    setPaymentBusy(account.id, true);
    setPaymentsMsg(null);
    try {
      const result = await recordPayment({
        accountId: account.id,
        amount: payload.amount,
        paidAt: payload.paidAt,
        note: payload.note,
        applyBalance: payload.applyBalance,
        clientKey,
      });
      setPaymentAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, balance: result.newBalance } : a)));
      await refreshHistoryIfLoaded(account.id);
      return null;
    } catch (e) {
      return errorMessage(e, t("pay.failedRecord"));
    } finally {
      setPaymentBusy(account.id, false);
    }
  }

  async function handleReversePayment(account: PaymentAccount, txn: PaymentTransaction): Promise<string | null> {
    if (busyPaymentIds.has(account.id)) return null;
    setPaymentBusy(account.id, true);
    setPaymentsMsg(null);
    try {
      const newBalance = await reversePayment(txn.id);
      setPaymentAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, balance: newBalance } : a)));
      await refreshHistoryIfLoaded(account.id);
      return null;
    } catch (e) {
      return errorMessage(e, t("pay.failedReverse"));
    } finally {
      setPaymentBusy(account.id, false);
    }
  }

  function toggleHistory(account: PaymentAccount) {
    if (expandedPaymentHistoryId === account.id) {
      setExpandedPaymentHistoryId(null);
      return;
    }
    setExpandedPaymentHistoryId(account.id);
    if (paymentHistoryByAccount[account.id]) return; // already fetched once this visit
    setPaymentHistoryLoadingId(account.id);
    getPaymentTransactions(account.id)
      .then((rows) => setPaymentHistoryByAccount((prev) => ({ ...prev, [account.id]: rows })))
      .catch((e: any) => setPaymentsMsg(e?.message ?? t("backlog.failedLoadPaymentHistory")))
      .finally(() => setPaymentHistoryLoadingId((cur) => (cur === account.id ? null : cur)));
  }

  return {
    accounts: paymentAccounts,
    loading: paymentsLoading,
    message: paymentsMsg,
    busyIds: busyPaymentIds,
    onCreate: handleAddPayment,
    onUpdate: handleUpdatePayment,
    onDelete: handleDeletePayment,
    onRecordPayment: handleRecordPayment,
    onReversePayment: handleReversePayment,
    historyOpenId: expandedPaymentHistoryId,
    historyLoadingId: paymentHistoryLoadingId,
    historyByAccount: paymentHistoryByAccount,
    onToggleHistory: toggleHistory,
  };
}

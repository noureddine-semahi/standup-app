"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { getPaymentAccounts, confirmPaymentGoalCompletion, type Goal, type PaymentAccount } from "@/lib/supabase/db";

/**
 * Shared completion flow for any goal with source_payment_account_id set --
 * the single place this logic lives, so every UI entry point that can mark
 * a goal "completed" (Today's quick actions, Dashboard's broken-lineage
 * resolver, and any future one) opens the SAME confirm-amount prompt and
 * calls the SAME atomic confirm_payment_goal_completion() RPC, rather than
 * each reimplementing its own version of this check. Originally inline in
 * Today's page only -- extracted here because that was the one entry point
 * that actually gated completion on it; everything else just ran a plain
 * status update and silently skipped the payment workflow entirely (the
 * bug this hook fixes). The database itself also now rejects a payment-
 * linked goal reaching "completed" any other way (see the
 * guard_payment_goal_completion trigger), so this hook is the UI-level
 * half of that fix, not the only thing preventing a bypass.
 *
 * `onConfirmed` runs after the server call succeeds (point to refresh
 * whatever list the caller is showing); `beforeConfirm` runs first, for a
 * caller that needs its own side effect before the payment is recorded
 * (Today's page uses it to mark the goal reviewed + award the one-time
 * awareness bonus, exactly mirroring its normal completion path).
 * `onError`/`onSettled` are optional hooks into the same try/catch/finally
 * every caller already needs around this (busy-marking a goal card,
 * refreshing on failure too) -- `paymentError` is still set and returned
 * either way, these are only for a caller's own extra side effects.
 */
export function usePaymentGoalCompletion(options?: {
  beforeConfirm?: (goal: Goal) => Promise<void> | void;
  onConfirmed?: (goal: Goal, newBalance: number) => Promise<void> | void;
  onError?: (goal: Goal, error: unknown) => Promise<void> | void;
  onSettled?: (goal: Goal) => void;
}) {
  const { t } = useLanguage();
  const [payingGoal, setPayingGoal] = useState<Goal | null>(null);
  const [payingAccount, setPayingAccount] = useState<PaymentAccount | null>(null);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  function openPaymentConfirm(goal: Goal) {
    setPaymentError(null);
    setPayingAccount(null);
    setPayingGoal(goal);
    getPaymentAccounts()
      .then((accounts) => {
        const account = accounts.find((a) => a.id === goal.source_payment_account_id) ?? null;
        setPayingAccount(account);
      })
      .catch(() => {
        // Account fetch failing just leaves the modal's amount blank
        // (suggestedAmount falls back to 0) — the user can still type one
        // in manually rather than being blocked entirely.
      });
  }

  function cancelPaymentConfirm() {
    if (paymentSaving) return;
    setPayingGoal(null);
    setPayingAccount(null);
    setPaymentError(null);
  }

  async function confirmPayment(amount: number) {
    const goal = payingGoal;
    if (!goal || paymentSaving) return;

    setPaymentSaving(true);
    setPaymentError(null);

    try {
      await options?.beforeConfirm?.(goal);
      const newBalance = await confirmPaymentGoalCompletion(goal.id, amount);
      setPayingGoal(null);
      setPayingAccount(null);
      await options?.onConfirmed?.(goal, newBalance);
    } catch (e: any) {
      setPaymentError(e?.message ?? t("paymentConfirm.failed"));
      await options?.onError?.(goal, e);
    } finally {
      setPaymentSaving(false);
      options?.onSettled?.(goal);
    }
  }

  return {
    payingGoal,
    payingAccount,
    paymentSaving,
    paymentError,
    openPaymentConfirm,
    cancelPaymentConfirm,
    confirmPayment,
  };
}

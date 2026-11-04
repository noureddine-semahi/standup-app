"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyStatusAction,
  type StatusAction,
  type Subscription,
  type SubscriptionFormPayload,
  type SubscriptionPayment,
  type SubscriptionPaymentEntryPayload,
} from "@/lib/subscriptions";
import type { CancellationReportPayload, SubscriptionCancellation } from "@/lib/cancellation";
import {
  createSubscription,
  deleteSubscription,
  getSubscriptionCancellations,
  getSubscriptionPayments,
  getSubscriptions,
  isSubscriptionsUnavailableError,
  recordSubscriptionCancellation,
  recordSubscriptionPayment,
  reverseSubscriptionPayment,
  updateSubscription,
} from "@/lib/supabase/subscriptions";

export type SubscriptionsLoadState = "loading" | "ready" | "unavailable" | "error";

/** Everything the Subscriptions tab (and the Finances overview) needs; each action resolves to an error message, or null on success. */
export type SubscriptionsController = {
  state: SubscriptionsLoadState;
  loadError: string | null;
  subscriptions: Subscription[];
  /** Payments per subscription, newest first (reversed ones included, marked). */
  payments: Record<string, SubscriptionPayment[]>;
  create: (payload: SubscriptionFormPayload) => Promise<string | null>;
  update: (sub: Subscription, patch: Partial<SubscriptionFormPayload> & { canceledAt?: string | null }) => Promise<string | null>;
  /** Pause / resume / cancel / reactivate. Canceling keeps the record and its history. */
  changeStatus: (sub: Subscription, action: StatusAction, todayISO: string) => Promise<string | null>;
  remove: (sub: Subscription) => Promise<string | null>;
  recordPayment: (sub: Subscription, payload: SubscriptionPaymentEntryPayload, clientKey: string) => Promise<string | null>;
  reversePayment: (sub: Subscription, paymentId: string) => Promise<string | null>;
  /** Unsubscribe Me. "unavailable" until the cancellations migration is applied; the rest of the tab keeps working. */
  cancellationsState: "ready" | "unavailable";
  /** Cancellation requests per subscription, newest first (history; never deleted). */
  cancellations: Record<string, SubscriptionCancellation[]>;
  /** Saves the https cancellation page the user pasted for this service. */
  saveCancelUrl: (sub: Subscription, url: string | null) => Promise<string | null>;
  /** Logs that the user was sent to a cancellation page. This is a request, NOT a cancellation. */
  startAssistedCancellation: (sub: Subscription, guideUrl: string) => Promise<string | null>;
  /** The user says they canceled. Recorded as user-reported (never provider-confirmed) and marks the subscription canceled; history is kept. */
  reportCancellation: (sub: Subscription, report: CancellationReportPayload, requestId: string | null) => Promise<string | null>;
  /** The user says it didn't work; keeps the error text and leaves the subscription as it was. */
  reportCancellationFailure: (sub: Subscription, error: string, requestId: string | null) => Promise<string | null>;
};

function errorMessage(e: unknown, fallback: string): string {
  // Supabase/PostgREST errors are plain objects with a message, not Error instances.
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : fallback;
}

export function useSubscriptions(fallbackError: string): SubscriptionsController {
  const [state, setState] = useState<SubscriptionsLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [payments, setPayments] = useState<Record<string, SubscriptionPayment[]>>({});
  const [cancellations, setCancellations] = useState<Record<string, SubscriptionCancellation[]>>({});
  const [cancellationsState, setCancellationsState] = useState<"ready" | "unavailable">("ready");
  const subsRef = useRef<Subscription[]>([]);
  useEffect(() => {
    subsRef.current = subscriptions;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getSubscriptions();
        const pay = await getSubscriptionPayments(list.map((s) => s.id));
        // Separate from the core load: without the cancellations migration only Unsubscribe Me is unavailable.
        let cancels: Record<string, SubscriptionCancellation[]> = {};
        let cancelsOk = true;
        try {
          cancels = await getSubscriptionCancellations(list.map((s) => s.id));
        } catch {
          cancelsOk = false;
        }
        if (cancelled) return;
        setSubscriptions(list);
        setPayments(pay);
        setCancellations(cancels);
        setCancellationsState(cancelsOk ? "ready" : "unavailable");
        setLoadError(null);
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        if (isSubscriptionsUnavailableError(e)) {
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
  }, [fallbackError]);

  const reloadPayments = useCallback(async () => {
    setPayments(await getSubscriptionPayments(subsRef.current.map((s) => s.id)));
  }, []);

  // After a cancellation RPC the server may have changed the subscription too, so re-read both.
  const reloadCancellations = useCallback(async () => {
    const list = await getSubscriptions();
    setSubscriptions(list);
    setCancellations(await getSubscriptionCancellations(list.map((s) => s.id)));
  }, []);

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
    subscriptions,
    payments,
    cancellations,
    cancellationsState,
    saveCancelUrl: (sub, url) =>
      wrap(async () => {
        const updated = await updateSubscription(sub.id, { cancelUrl: url });
        setSubscriptions((prev) => prev.map((s) => (s.id === sub.id ? updated : s)));
      }),
    startAssistedCancellation: (sub, guideUrl) =>
      wrap(async () => {
        await recordSubscriptionCancellation({ subscriptionId: sub.id, mode: "assisted", status: "in_progress", guideUrl });
        await reloadCancellations();
      }),
    reportCancellation: (sub, report, requestId) =>
      wrap(async () => {
        await recordSubscriptionCancellation({
          subscriptionId: sub.id,
          mode: requestId ? "assisted" : "manual",
          status: "user_reported",
          requestId,
          completedOn: report.completedOn,
          note: report.note,
        });
        await reloadCancellations();
      }),
    reportCancellationFailure: (sub, error, requestId) =>
      wrap(async () => {
        await recordSubscriptionCancellation({
          subscriptionId: sub.id,
          mode: requestId ? "assisted" : "manual",
          status: "failed",
          requestId,
          error,
        });
        await reloadCancellations();
      }),
    create: (payload) =>
      wrap(async () => {
        const created = await createSubscription(payload);
        setSubscriptions((prev) => [...prev, created]);
      }),
    update: (sub, patch) =>
      wrap(async () => {
        const updated = await updateSubscription(sub.id, patch);
        setSubscriptions((prev) => prev.map((s) => (s.id === sub.id ? updated : s)));
      }),
    changeStatus: (sub, action, todayISO) =>
      wrap(async () => {
        const change = applyStatusAction(sub, action, todayISO);
        if (!change) throw new Error(fallbackError);
        const updated = await updateSubscription(sub.id, { status: change.status, canceledAt: change.canceledAt });
        setSubscriptions((prev) => prev.map((s) => (s.id === sub.id ? updated : s)));
      }),
    remove: (sub) =>
      wrap(async () => {
        await deleteSubscription(sub.id);
        setSubscriptions((prev) => prev.filter((s) => s.id !== sub.id));
        setPayments((prev) => {
          const rest = { ...prev };
          delete rest[sub.id];
          return rest;
        });
        setCancellations((prev) => {
          const rest = { ...prev };
          delete rest[sub.id];
          return rest;
        });
      }),
    recordPayment: (sub, payload, clientKey) =>
      wrap(async () => {
        await recordSubscriptionPayment({
          subscriptionId: sub.id,
          amount: payload.amount,
          paidAt: payload.paidAt,
          note: payload.note,
          billingDate: payload.billingDate,
          clientKey,
        });
        await reloadPayments();
      }),
    reversePayment: (sub, paymentId) =>
      wrap(async () => {
        await reverseSubscriptionPayment(paymentId);
        await reloadPayments();
      }),
  };
}

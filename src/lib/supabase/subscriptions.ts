import { supabase } from "@/lib/supabase/client";
import { formatDateDisplay, getCurrentUserId, getOrCreatePlan, type Goal } from "@/lib/supabase/db";
import { isBillsUnavailableError } from "@/lib/supabase/bills";
import type { CancellationMode, CancellationStatus, SubscriptionCancellation } from "@/lib/cancellation";
import {
  subscriptionSuggestionKey,
  suggestSubscriptionGoals,
  type CustomUnit,
  type SubFrequency,
  type SubStatus,
  type Subscription,
  type SubscriptionFormPayload,
  type SubscriptionPayment,
  type SubscriptionSuggestion,
} from "@/lib/subscriptions";

// Data access for Finances > Subscriptions. Reads are plain selects (RLS scopes
// them to the signed-in user); payments are written only through the SECURITY
// DEFINER functions record_subscription_payment / reverse_subscription_payment.
// Requires supabase/migrations/20261105000100_finance_subscriptions.sql.

/** True when the error means the Subscriptions tables/functions don't exist yet (migration not applied). */
export const isSubscriptionsUnavailableError = isBillsUnavailableError;

type SubscriptionRow = {
  id: string;
  name: string;
  provider: string | null;
  category: string | null;
  plan_name: string | null;
  amount: string | number | null;
  currency: string;
  frequency: SubFrequency;
  custom_interval: number | null;
  custom_unit: CustomUnit | null;
  next_billing_date: string;
  start_date: string | null;
  status: SubStatus;
  trial_ends_on: string | null;
  remind_days_before: number;
  notes: string | null;
  bill_id: string | null;
  canceled_at: string | null;
  cancel_url?: string | null;
  created_at: string;
  updated_at: string;
};
type PaymentRow = {
  id: string;
  subscription_id: string;
  amount: string | number;
  paid_at: string;
  note: string | null;
  billing_date: string | null;
  reversed_at: string | null;
};
type RpcPaymentRow = { r_payment_id: string; r_duplicate: boolean };

function rowToSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider ?? null,
    category: r.category ?? null,
    planName: r.plan_name ?? null,
    amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
    currency: r.currency,
    frequency: r.frequency,
    customInterval: r.custom_interval ?? null,
    customUnit: r.custom_unit ?? null,
    nextBillingDate: r.next_billing_date,
    startDate: r.start_date ?? null,
    status: r.status,
    trialEndsOn: r.trial_ends_on ?? null,
    remindDaysBefore: r.remind_days_before,
    notes: r.notes ?? null,
    billId: r.bill_id ?? null,
    canceledAt: r.canceled_at ?? null,
    cancelUrl: r.cancel_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToPayment(r: PaymentRow): SubscriptionPayment {
  return {
    id: r.id,
    subscriptionId: r.subscription_id,
    amount: Number(r.amount),
    paidAt: r.paid_at,
    note: r.note ?? null,
    billingDate: r.billing_date ?? null,
    reversedAt: r.reversed_at ?? null,
  };
}

/** Camel-case form payload (plus the status fields a status action changes) -> table columns. Only given keys are included. */
function toColumns(p: Partial<SubscriptionFormPayload> & { canceledAt?: string | null; cancelUrl?: string | null }): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (p.name !== undefined) c.name = p.name;
  if (p.provider !== undefined) c.provider = p.provider;
  if (p.planName !== undefined) c.plan_name = p.planName;
  if (p.category !== undefined) c.category = p.category;
  if (p.amount !== undefined) c.amount = p.amount;
  if (p.currency !== undefined) c.currency = p.currency;
  if (p.frequency !== undefined) c.frequency = p.frequency;
  if (p.customInterval !== undefined) c.custom_interval = p.customInterval;
  if (p.customUnit !== undefined) c.custom_unit = p.customUnit;
  if (p.nextBillingDate !== undefined) c.next_billing_date = p.nextBillingDate;
  if (p.startDate !== undefined) c.start_date = p.startDate;
  if (p.status !== undefined) c.status = p.status;
  if (p.trialEndsOn !== undefined) c.trial_ends_on = p.trialEndsOn;
  if (p.remindDaysBefore !== undefined) c.remind_days_before = p.remindDaysBefore;
  if (p.billId !== undefined) c.bill_id = p.billId;
  if (p.notes !== undefined) c.notes = p.notes;
  if (p.canceledAt !== undefined) c.canceled_at = p.canceledAt;
  if (p.cancelUrl !== undefined) c.cancel_url = p.cancelUrl;
  return c;
}

export async function getSubscriptions(): Promise<Subscription[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as SubscriptionRow[]).map(rowToSubscription);
}

export async function createSubscription(p: SubscriptionFormPayload): Promise<Subscription> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("subscriptions")
    .insert({ user_id: userId, ...toColumns(p), canceled_at: p.status === "canceled" ? new Date().toISOString() : null })
    .select()
    .single();
  if (error) throw error;
  return rowToSubscription(data as SubscriptionRow);
}

export async function updateSubscription(id: string, p: Partial<SubscriptionFormPayload> & { canceledAt?: string | null; cancelUrl?: string | null }): Promise<Subscription> {
  const { data, error } = await supabase.from("subscriptions").update(toColumns(p)).eq("id", id).select().single();
  if (error) throw error;
  return rowToSubscription(data as SubscriptionRow);
}

/** Permanently deletes the subscription AND its payment history (the UI asks for confirmation first). Canceling is the non-destructive alternative. */
export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await supabase.from("subscriptions").delete().eq("id", id);
  if (error) throw error;
}

/** Every recorded payment (reversed ones included, marked), newest first, grouped by subscription. */
export async function getSubscriptionPayments(subscriptionIds: string[]): Promise<Record<string, SubscriptionPayment[]>> {
  const out: Record<string, SubscriptionPayment[]> = {};
  if (subscriptionIds.length === 0) return out;
  const { data, error } = await supabase
    .from("subscription_payments")
    .select("*")
    .in("subscription_id", subscriptionIds)
    .order("paid_at", { ascending: false });
  if (error) throw error;
  for (const row of (data ?? []) as PaymentRow[]) {
    const p = rowToPayment(row);
    (out[p.subscriptionId] ??= []).push(p);
  }
  return out;
}

export type RecordSubscriptionPaymentParams = {
  subscriptionId: string;
  amount: number;
  paidAt: string;
  note: string | null;
  billingDate: string | null;
  clientKey: string;
};

/** Records one payment (idempotent per clientKey). Never changes the subscription or its schedule. */
export async function recordSubscriptionPayment(p: RecordSubscriptionPaymentParams): Promise<{ paymentId: string; wasDuplicate: boolean }> {
  const { data, error } = await supabase.rpc("record_subscription_payment", {
    p_subscription_id: p.subscriptionId,
    p_amount: p.amount,
    p_paid_at: p.paidAt,
    p_note: p.note,
    p_billing_date: p.billingDate,
    p_client_key: p.clientKey,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as RpcPaymentRow;
  return { paymentId: row.r_payment_id, wasDuplicate: !!row.r_duplicate };
}

/** Reverses a payment (row kept and marked; history is never deleted). */
export async function reverseSubscriptionPayment(paymentId: string): Promise<void> {
  const { error } = await supabase.rpc("reverse_subscription_payment", { p_payment_id: paymentId });
  if (error) throw error;
}

// ── Unsubscribe Me: cancellation requests ────────────────────────────────
// Reads are plain selects. Writes go only through record_subscription_cancellation,
// which accepts assisted/manual routes and in_progress / user_reported / failed
// outcomes. Nothing the client can call can write "provider_confirmed" or "automatic".
// Requires supabase/migrations/20261105000200_subscription_cancellations.sql.

type CancellationRow = {
  id: string;
  subscription_id: string;
  mode: CancellationMode;
  status: CancellationStatus;
  requested_at: string;
  completed_on: string | null;
  guide_url: string | null;
  provider_reference: string | null;
  error_message: string | null;
  note: string | null;
};

function rowToCancellation(r: CancellationRow): SubscriptionCancellation {
  return {
    id: r.id,
    subscriptionId: r.subscription_id,
    mode: r.mode,
    status: r.status,
    requestedAt: r.requested_at,
    completedOn: r.completed_on ?? null,
    guideUrl: r.guide_url ?? null,
    providerReference: r.provider_reference ?? null,
    errorMessage: r.error_message ?? null,
    note: r.note ?? null,
  };
}

/** Every cancellation request (history is never deleted), newest first, grouped by subscription. */
export async function getSubscriptionCancellations(subscriptionIds: string[]): Promise<Record<string, SubscriptionCancellation[]>> {
  const out: Record<string, SubscriptionCancellation[]> = {};
  if (subscriptionIds.length === 0) return out;
  const { data, error } = await supabase
    .from("subscription_cancellations")
    .select("*")
    .in("subscription_id", subscriptionIds)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  for (const row of (data ?? []) as CancellationRow[]) {
    const c = rowToCancellation(row);
    (out[c.subscriptionId] ??= []).push(c);
  }
  return out;
}

export type RecordCancellationParams = {
  subscriptionId: string;
  mode: "assisted" | "manual";
  status: "in_progress" | "user_reported" | "failed";
  /** Resolve this open assisted request instead of starting a new one. */
  requestId?: string | null;
  completedOn?: string | null;
  guideUrl?: string | null;
  error?: string | null;
  note?: string | null;
};

/** Records or resolves a cancellation request. A user_reported outcome also marks the subscription canceled (history kept) atomically. */
export async function recordSubscriptionCancellation(p: RecordCancellationParams): Promise<string> {
  const { data, error } = await supabase.rpc("record_subscription_cancellation", {
    p_subscription_id: p.subscriptionId,
    p_mode: p.mode,
    p_status: p.status,
    p_request_id: p.requestId ?? null,
    p_completed_on: p.completedOn ?? null,
    p_guide_url: p.guideUrl ?? null,
    p_error: p.error ?? null,
    p_note: p.note ?? null,
  });
  if (error) throw error;
  return data as string;
}

// ── Plan Tomorrow: tap-to-add suggestions ────────────────────────────────

/**
 * Renewal / trial-end events whose reminder window covers planDateISO, minus
 * those already paid, bill-covered or linked to a goal. Suggestions only --
 * nothing is created until the user taps one (addGoalFromSubscription).
 */
export async function getSuggestedSubscriptionReminders(planDateISO: string): Promise<SubscriptionSuggestion[]> {
  const subs = await getSubscriptions();
  if (subs.length === 0) return [];
  const payments = Object.values(await getSubscriptionPayments(subs.map((s) => s.id))).flat();

  const { data: linkedRows, error } = await supabase
    .from("goals")
    .select("source_subscription_id, source_subscription_event, source_subscription_date")
    .in("source_subscription_id", subs.map((s) => s.id));
  if (error) throw error;
  const linked = new Set<string>(
    ((linkedRows ?? []) as { source_subscription_id: string; source_subscription_event: "renewal" | "trial_end" | null; source_subscription_date: string | null }[])
      .filter((g) => g.source_subscription_event && g.source_subscription_date)
      .map((g) => subscriptionSuggestionKey(g.source_subscription_id, g.source_subscription_event!, g.source_subscription_date!))
  );
  return suggestSubscriptionGoals(subs, payments, planDateISO, linked);
}

/** The goal title a suggestion becomes (also the suggestion chip's label). */
export function subscriptionGoalTitle(s: SubscriptionSuggestion): string {
  const date = formatDateDisplay(s.date);
  if (s.event === "trial_end") return `Cancel or keep ${s.subscription.name} trial — ends ${date}`;
  const amount = s.amount === null ? "" : ` — ${s.subscription.currency === "USD" ? "$" : `${s.subscription.currency} `}${s.amount.toFixed(2)}`;
  return `Review ${s.subscription.name} renewal${amount} — ${date}`;
}

/**
 * Tap-to-add: creates an ordinary, not-yet-saved goal (same shape as
 * addGoalFromBill). It is linked to its subscription + event + date only so the
 * same event isn't suggested twice. Completing it does NOT record a payment or
 * cancel anything -- the user does that explicitly in Finances > Subscriptions.
 */
export async function addGoalFromSubscription(s: SubscriptionSuggestion, planDateISO: string): Promise<Goal> {
  const plan = await getOrCreatePlan(planDateISO);
  const { data: existing, error: existingErr } = await supabase
    .from("goals")
    .select("sort_order")
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (existingErr) throw existingErr;
  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const userId = await getCurrentUserId();
  const { data: created, error } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      title: subscriptionGoalTitle(s),
      status: "not_started",
      sort_order: nextSortOrder,
      priority: 2,
      source_subscription_id: s.subscription.id,
      source_subscription_event: s.event,
      source_subscription_date: s.date,
    })
    .select()
    .single();
  if (error) throw error;
  return created as Goal;
}

// Pure logic for Finances > Subscriptions: billing frequencies, annualization,
// renewal dates, trial handling, status transitions, summaries, bill-overlap
// detection, reminder suggestions and input validation. No I/O.
//
// Mirrors supabase/migrations/20261105000100_finance_subscriptions.sql.

import { addDaysISO, daysBetween, daysInMonth, isValidISODate, parseMoney, toCents, type Bill } from "@/lib/bills";

export type SubFrequency = "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
export type SubStatus = "active" | "paused" | "canceled" | "trial";
export type CustomUnit = "days" | "weeks" | "months";

export const SUB_FREQUENCIES: readonly SubFrequency[] = ["weekly", "monthly", "quarterly", "yearly", "custom"];
export const SUB_STATUSES: readonly SubStatus[] = ["active", "trial", "paused", "canceled"];
export const CUSTOM_UNITS: readonly CustomUnit[] = ["days", "weeks", "months"];

/** Totals are computed in this currency; subscriptions in any other currency are listed but excluded (and counted). */
export const BASE_CURRENCY = "USD";
export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "MXN"] as const;

export const MAX_CUSTOM_INTERVAL = 365;

export type Subscription = {
  id: string;
  name: string;
  provider: string | null;
  category: string | null;
  planName: string | null;
  /** Null until a price is known (a subscription can be tracked before that). */
  amount: number | null;
  currency: string;
  frequency: SubFrequency;
  customInterval: number | null;
  customUnit: CustomUnit | null;
  /** ANCHOR of the schedule. Later renewals are computed from it; it never needs updating. */
  nextBillingDate: string;
  startDate: string | null;
  status: SubStatus;
  trialEndsOn: string | null;
  remindDaysBefore: number;
  notes: string | null;
  /** Explicit "also tracked as this bill" link (never set automatically). */
  billId: string | null;
  canceledAt: string | null;
  /** An https cancellation page the user saved for this service (used by the assisted "Unsubscribe Me" route). */
  cancelUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionPayment = {
  id: string;
  subscriptionId: string;
  amount: number;
  paidAt: string;
  note: string | null;
  /** The renewal date this payment was recorded for (informational). */
  billingDate: string | null;
  reversedAt: string | null;
};

// ── Annualization ────────────────────────────────────────────────────────

/**
 * Payments per year: weekly 52, monthly 12, quarterly 4, yearly 1; custom is
 * derived from its interval (days: 365/n, weeks: 52/n, months: 12/n).
 */
export function paymentsPerYear(sub: Pick<Subscription, "frequency" | "customInterval" | "customUnit">): number | null {
  switch (sub.frequency) {
    case "weekly":
      return 52;
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "yearly":
      return 1;
    case "custom": {
      const n = sub.customInterval;
      if (!n || n < 1 || !sub.customUnit) return null;
      return sub.customUnit === "days" ? 365 / n : sub.customUnit === "weeks" ? 52 / n : 12 / n;
    }
  }
}

/** Annual cost in cents (rounded once, from the cent-exact price), or null when price/schedule is incomplete. */
export function annualCents(sub: Pick<Subscription, "amount" | "frequency" | "customInterval" | "customUnit">): number | null {
  const per = paymentsPerYear(sub);
  if (sub.amount === null || per === null) return null;
  return Math.round(toCents(sub.amount) * per);
}

/** Monthly-equivalent cost in cents (annual / 12, rounded once). */
export function monthlyCents(sub: Pick<Subscription, "amount" | "frequency" | "customInterval" | "customUnit">): number | null {
  const a = annualCents(sub);
  return a === null ? null : Math.round(a / 12);
}

// ── Dates ────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}
const monthsBetween = (a: string, b: string) => (parts(b).y - parts(a).y) * 12 + (parts(b).m - parts(a).m);

/**
 * `anchor` shifted by whole calendar months (negative allowed), keeping the
 * ANCHOR's day-of-month and clamping to the target month's last day. So an
 * anchor of Jan 31 gives Feb 28/29, Mar 31 (never drifting to the 28th), and a
 * Feb 29 yearly anchor falls on Feb 28 in non-leap years.
 */
export function shiftMonths(anchor: string, months: number): string {
  const { y, m, d } = parts(anchor);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

type Period = { kind: "days"; n: number } | { kind: "months"; n: number };

/** The schedule step: a number of days, or a number of calendar months. */
export function periodOf(sub: Pick<Subscription, "frequency" | "customInterval" | "customUnit">): Period | null {
  switch (sub.frequency) {
    case "weekly":
      return { kind: "days", n: 7 };
    case "monthly":
      return { kind: "months", n: 1 };
    case "quarterly":
      return { kind: "months", n: 3 };
    case "yearly":
      return { kind: "months", n: 12 };
    case "custom": {
      const n = sub.customInterval;
      if (!n || n < 1 || !sub.customUnit) return null;
      return sub.customUnit === "months" ? { kind: "months", n } : { kind: "days", n: sub.customUnit === "weeks" ? n * 7 : n };
    }
  }
}

function dateAt(anchor: string, p: Period, k: number): string {
  return p.kind === "days" ? addDaysISO(anchor, p.n * k) : shiftMonths(anchor, p.n * k);
}

/** Earliest date the schedule may produce: the start date when it is before the anchor, otherwise the anchor. A trial never bills before its first charge. */
function lowerBound(sub: Pick<Subscription, "nextBillingDate" | "startDate" | "status">): string {
  if (sub.status === "trial") return sub.nextBillingDate;
  return sub.startDate && sub.startDate < sub.nextBillingDate ? sub.startDate : sub.nextBillingDate;
}

/** Scheduled renewal dates within [fromISO, toISO], ascending (bounded). */
export function renewalDates(
  sub: Pick<Subscription, "nextBillingDate" | "startDate" | "status" | "frequency" | "customInterval" | "customUnit">,
  fromISO: string,
  toISO: string
): string[] {
  const p = periodOf(sub);
  if (!p || toISO < fromISO) return [];
  const anchor = sub.nextBillingDate;
  const lower = lowerBound(sub);
  let k = p.kind === "days" ? Math.floor(daysBetween(anchor, fromISO) / p.n) - 1 : Math.floor(monthsBetween(anchor, fromISO) / p.n) - 1;
  const out: string[] = [];
  for (let i = 0; i < 1500; i++, k++) {
    const d = dateAt(anchor, p, k);
    if (d > toISO) break;
    if (d >= fromISO && d >= lower) out.push(d);
  }
  return out;
}

/** Days to search so at least one period is covered. */
const periodWindowDays = (p: Period) => (p.kind === "days" ? p.n + 1 : p.n * 31 + 1);

// ── Status ───────────────────────────────────────────────────────────────

/**
 * The status to act on today. A trial whose end date has passed is treated as
 * ACTIVE (it converts to a paid subscription automatically); the stored row is
 * never rewritten behind the user's back.
 */
export function effectiveStatus(sub: Pick<Subscription, "status" | "trialEndsOn">, todayISO: string): { status: SubStatus; trialEnded: boolean } {
  if (sub.status === "trial" && sub.trialEndsOn && sub.trialEndsOn < todayISO) return { status: "active", trialEnded: true };
  return { status: sub.status, trialEnded: false };
}

export type StatusAction = "pause" | "resume" | "cancel" | "reactivate";

/**
 * The stored-field changes for a status action, or null when the action isn't
 * valid from the current status. Canceling keeps the record (and its payment
 * history); it only changes StandUp's tracking.
 */
export function applyStatusAction(
  sub: Pick<Subscription, "status" | "trialEndsOn">,
  action: StatusAction,
  todayISO: string,
  nowISO: string = new Date().toISOString()
): { status: SubStatus; canceledAt: string | null } | null {
  const { status } = sub;
  switch (action) {
    case "pause":
      return status === "active" || status === "trial" ? { status: "paused", canceledAt: null } : null;
    case "resume":
      if (status !== "paused") return null;
      return { status: sub.trialEndsOn && sub.trialEndsOn >= todayISO ? "trial" : "active", canceledAt: null };
    case "cancel":
      return status === "canceled" ? null : { status: "canceled", canceledAt: nowISO };
    case "reactivate":
      return status === "canceled" ? { status: sub.trialEndsOn && sub.trialEndsOn >= todayISO ? "trial" : "active", canceledAt: null } : null;
  }
}

export const isBilling = (sub: Pick<Subscription, "status" | "trialEndsOn">, todayISO: string) => effectiveStatus(sub, todayISO).status === "active";

// ── Next / previous renewal ──────────────────────────────────────────────

/**
 * The next charge: for an active subscription, the next scheduled renewal on or
 * after today; for a running trial, its first charge. Null when paused/canceled
 * or the schedule is incomplete. This is a PROJECTION -- nothing is "paid" just
 * because the date arrives.
 */
export function nextCharge(sub: Subscription, todayISO: string): string | null {
  const eff = effectiveStatus(sub, todayISO);
  if (eff.status === "paused" || eff.status === "canceled") return null;
  const p = periodOf(sub);
  if (!p) return null;
  if (eff.status === "trial") return sub.nextBillingDate >= todayISO ? sub.nextBillingDate : renewalDates(sub, todayISO, addDaysISO(todayISO, periodWindowDays(p)))[0] ?? null;
  const from = todayISO;
  return renewalDates(sub, from, addDaysISO(from, periodWindowDays(p)))[0] ?? null;
}

/** The most recent scheduled renewal on/before today (for "which renewal is this payment for"). */
export function previousRenewal(sub: Subscription, todayISO: string): string | null {
  const p = periodOf(sub);
  if (!p || sub.status === "trial") return null;
  const list = renewalDates(sub, addDaysISO(todayISO, -periodWindowDays(p)), todayISO);
  return list.length > 0 ? list[list.length - 1] : null;
}

// ── Reminder / upcoming events ───────────────────────────────────────────

export type SubEventKind = "renewal" | "trial_end";
export type SubEvent = { kind: SubEventKind; date: string; daysUntil: number };

/**
 * Events inside the subscription's own reminder window (today .. today + remind):
 * the next renewal of a billing subscription, and the end of a running trial
 * (the trial end IS its first charge, so a trial yields one event, not two).
 */
export function upcomingEvents(sub: Subscription, todayISO: string): SubEvent[] {
  const eff = effectiveStatus(sub, todayISO);
  const out: SubEvent[] = [];
  if (eff.status === "trial" && sub.trialEndsOn && sub.trialEndsOn >= todayISO) {
    const days = daysBetween(todayISO, sub.trialEndsOn);
    if (days <= sub.remindDaysBefore) out.push({ kind: "trial_end", date: sub.trialEndsOn, daysUntil: days });
  } else if (eff.status === "active") {
    const next = nextCharge(sub, todayISO);
    if (next) {
      const days = daysBetween(todayISO, next);
      if (days <= sub.remindDaysBefore) out.push({ kind: "renewal", date: next, daysUntil: days });
    }
  }
  return out;
}

// ── Summary ──────────────────────────────────────────────────────────────

export type SubscriptionsSummary = {
  /** Monthly-equivalent total of ACTIVE (paying) subscriptions in the base currency. */
  monthlyCost: number;
  /** Annual total of the same set (sum of per-subscription annual costs). */
  yearlyEstimate: number;
  /** Active (paying) subscriptions, whether or not their price is known. */
  activeCount: number;
  /** Subscriptions with a renewal or trial end inside their own reminder window. */
  upcomingRenewals: number;
  /** Same as upcomingRenewals but only subscriptions NOT linked to a bill (the Finances overview counts these, the bill covers the rest). */
  upcomingUnlinked: number;
  /** Active subscriptions with no price yet (left out of the totals, never counted as $0). */
  awaitingPrice: number;
  /** Active subscriptions in another currency (left out of the totals; they can't be added to USD). */
  otherCurrency: number;
  trialCount: number;
  pausedCount: number;
  canceledCount: number;
};

/**
 * Totals are built only from subscriptions that are actually billing today:
 * trials (not charged yet), paused and canceled ones are excluded. Each
 * subscription's annual cost is rounded once from its cent-exact price, the
 * yearly total is the sum of those, and the monthly total is that sum / 12
 * (rounded once) so the two tiles always agree.
 */
export function summarizeSubscriptions(subs: readonly Subscription[], todayISO: string): SubscriptionsSummary {
  let annual = 0;
  let active = 0;
  let upcoming = 0;
  let upcomingUnlinked = 0;
  let awaiting = 0;
  let other = 0;
  let trials = 0;
  let paused = 0;
  let canceled = 0;
  for (const s of subs) {
    const eff = effectiveStatus(s, todayISO);
    if (eff.status === "trial") trials += 1;
    else if (eff.status === "paused") paused += 1;
    else if (eff.status === "canceled") canceled += 1;
    else {
      active += 1;
      if (s.currency !== BASE_CURRENCY) other += 1;
      else {
        const a = annualCents(s);
        if (a === null) awaiting += 1;
        else annual += a;
      }
    }
    if (upcomingEvents(s, todayISO).length > 0) {
      upcoming += 1;
      if (!s.billId) upcomingUnlinked += 1;
    }
  }
  return {
    monthlyCost: Math.round(annual / 12) / 100,
    yearlyEstimate: annual / 100,
    activeCount: active,
    upcomingRenewals: upcoming,
    upcomingUnlinked,
    awaitingPrice: awaiting,
    otherCurrency: other,
    trialCount: trials,
    pausedCount: paused,
    canceledCount: canceled,
  };
}

// ── Overlap with Bills (surfaced, never auto-merged) ─────────────────────

export type PossibleOverlap = { subscriptionId: string; billId: string; billName: string };

const normalize = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Subscriptions that are NOT linked to a bill but whose name or provider matches
 * an active bill's name (either contains the other, at least 4 characters).
 * This only SURFACES a possible duplicate; the user decides whether to link it.
 * Canceled subscriptions and archived bills are ignored.
 */
export function findPossibleOverlaps(subs: readonly Subscription[], bills: readonly Bill[]): PossibleOverlap[] {
  const out: PossibleOverlap[] = [];
  for (const s of subs) {
    if (s.billId || s.status === "canceled") continue;
    const keys = [normalize(s.name), normalize(s.provider)].filter((k) => k.length >= 4);
    if (keys.length === 0) continue;
    for (const b of bills) {
      if (b.archivedAt) continue;
      const bn = normalize(b.name);
      if (bn.length < 4) continue;
      if (keys.some((k) => k.includes(bn) || bn.includes(k))) {
        out.push({ subscriptionId: s.id, billId: b.id, billName: b.name });
        break;
      }
    }
  }
  return out;
}

// ── Plan Tomorrow suggestions (tap-to-add; never automatic) ──────────────

export type SubscriptionSuggestion = {
  subscription: Subscription;
  event: SubEventKind;
  date: string;
  amount: number | null;
};

export const subscriptionSuggestionKey = (subId: string, event: SubEventKind, date: string) => `${subId}|${event}|${date}`;

/**
 * Renewal / trial-end events whose reminder window covers `planDateISO`
 * (event date - remindDaysBefore <= plan date <= event date), minus:
 *  - paused / canceled subscriptions,
 *  - renewals of a subscription linked to a bill (the bill's own reminder covers that charge),
 *  - renewals that already have a non-reversed payment recorded for that date,
 *  - events that already have a goal linked (`linked` holds subscriptionSuggestionKey values).
 */
export function suggestSubscriptionGoals(
  subs: readonly Subscription[],
  payments: readonly SubscriptionPayment[],
  planDateISO: string,
  linked: ReadonlySet<string>
): SubscriptionSuggestion[] {
  const out: SubscriptionSuggestion[] = [];
  for (const s of subs) {
    const eff = effectiveStatus(s, planDateISO);
    if (eff.status === "paused" || eff.status === "canceled") continue;
    const events: { kind: SubEventKind; date: string }[] = [];
    if (eff.status === "trial" && s.trialEndsOn) {
      events.push({ kind: "trial_end", date: s.trialEndsOn });
    } else if (eff.status === "active" && !s.billId) {
      for (const d of renewalDates(s, planDateISO, addDaysISO(planDateISO, s.remindDaysBefore))) events.push({ kind: "renewal", date: d });
    }
    for (const e of events) {
      const ahead = daysBetween(planDateISO, e.date);
      if (ahead < 0 || ahead > s.remindDaysBefore) continue;
      if (linked.has(subscriptionSuggestionKey(s.id, e.kind, e.date))) continue;
      if (e.kind === "renewal" && payments.some((p) => p.subscriptionId === s.id && !p.reversedAt && p.billingDate === e.date)) continue;
      out.push({ subscription: s, event: e.kind, date: e.date, amount: s.amount });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.subscription.name.localeCompare(b.subscription.name));
}

// ── Payments: totals ─────────────────────────────────────────────────────

/** Non-reversed payments only. */
export function totalPaid(payments: readonly SubscriptionPayment[]): number {
  return payments.reduce((sum, p) => (p.reversedAt ? sum : sum + toCents(p.amount)), 0) / 100;
}

/** Non-reversed payments whose payment date falls in the given calendar year. */
export function totalPaidInYear(payments: readonly SubscriptionPayment[], year: number): number {
  return (
    payments.reduce((sum, p) => (!p.reversedAt && new Date(p.paidAt).getFullYear() === year ? sum + toCents(p.amount) : sum), 0) / 100
  );
}

export function lastPayment(payments: readonly SubscriptionPayment[]): SubscriptionPayment | null {
  const live = payments.filter((p) => !p.reversedAt);
  if (live.length === 0) return null;
  return live.reduce((a, b) => (new Date(b.paidAt) > new Date(a.paidAt) ? b : a));
}

// ── Form validation ──────────────────────────────────────────────────────

export type SubscriptionFormValues = {
  name: string;
  provider: string;
  planName: string;
  category: string;
  amount: string;
  currency: string;
  frequency: SubFrequency;
  customInterval: string;
  customUnit: CustomUnit;
  nextBillingDate: string;
  startDate: string;
  status: SubStatus;
  trialEndsOn: string;
  remindDaysBefore: string;
  billId: string;
  notes: string;
};

export type SubscriptionFormPayload = {
  name: string;
  provider: string | null;
  planName: string | null;
  category: string | null;
  amount: number | null;
  currency: string;
  frequency: SubFrequency;
  customInterval: number | null;
  customUnit: CustomUnit | null;
  nextBillingDate: string;
  startDate: string | null;
  status: SubStatus;
  trialEndsOn: string | null;
  remindDaysBefore: number;
  billId: string | null;
  notes: string | null;
};

export type SubscriptionFormField =
  | "name" | "provider" | "planName" | "category" | "amount" | "currency" | "customInterval"
  | "nextBillingDate" | "startDate" | "trialEndsOn" | "remindDaysBefore" | "notes";
export type SubscriptionFormErrorCode =
  | "required" | "invalid" | "precision" | "negative" | "range" | "tooLong"
  | "firstChargeBeforeTrialEnd" | "startAfterNextBilling";
export type SubscriptionFormError = { field: SubscriptionFormField; code: SubscriptionFormErrorCode };

export function emptySubscriptionForm(todayISO: string): SubscriptionFormValues {
  return {
    name: "", provider: "", planName: "", category: "", amount: "", currency: BASE_CURRENCY,
    frequency: "monthly", customInterval: "1", customUnit: "months",
    nextBillingDate: todayISO, startDate: "", status: "active", trialEndsOn: "",
    remindDaysBefore: "3", billId: "", notes: "",
  };
}

export function subscriptionToFormValues(s: Subscription): SubscriptionFormValues {
  return {
    name: s.name,
    provider: s.provider ?? "",
    planName: s.planName ?? "",
    category: s.category ?? "",
    amount: s.amount === null ? "" : String(s.amount),
    currency: s.currency,
    frequency: s.frequency,
    customInterval: s.customInterval === null ? "1" : String(s.customInterval),
    customUnit: s.customUnit ?? "months",
    nextBillingDate: s.nextBillingDate,
    startDate: s.startDate ?? "",
    status: s.status,
    trialEndsOn: s.trialEndsOn ?? "",
    remindDaysBefore: String(s.remindDaysBefore),
    billId: s.billId ?? "",
    notes: s.notes ?? "",
  };
}

export function parseSubscriptionForm(
  v: SubscriptionFormValues
): { ok: true; payload: SubscriptionFormPayload } | { ok: false; errors: SubscriptionFormError[] } {
  const errors: SubscriptionFormError[] = [];
  const err = (field: SubscriptionFormField, code: SubscriptionFormErrorCode) => errors.push({ field, code });

  const name = v.name.trim();
  if (!name) err("name", "required");
  else if (name.length > 120) err("name", "tooLong");
  const provider = v.provider.trim();
  if (provider.length > 120) err("provider", "tooLong");
  const planName = v.planName.trim();
  if (planName.length > 120) err("planName", "tooLong");
  const category = v.category.trim();
  if (category.length > 60) err("category", "tooLong");

  // The price may be left blank (tracked before the price is known); when given it must be valid.
  let amount: number | null = null;
  if (v.amount.trim() !== "") {
    const m = parseMoney(v.amount);
    if (m.ok) amount = m.value;
    else err("amount", m.error);
  }
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(v.currency)) err("currency", "invalid");

  let customInterval: number | null = null;
  let customUnit: CustomUnit | null = null;
  if (v.frequency === "custom") {
    const raw = v.customInterval.trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1 || n > MAX_CUSTOM_INTERVAL) err("customInterval", raw === "" ? "required" : "invalid");
    else {
      customInterval = n;
      customUnit = v.customUnit;
    }
  }

  const next = v.nextBillingDate.trim();
  if (!isValidISODate(next)) err("nextBillingDate", next ? "invalid" : "required");
  const start = v.startDate.trim();
  if (start && !isValidISODate(start)) err("startDate", "invalid");
  else if (start && isValidISODate(next) && start > next) err("startDate", "startAfterNextBilling");

  const isTrial = v.status === "trial";
  const trialEnd = v.trialEndsOn.trim();
  if (isTrial) {
    if (!trialEnd) err("trialEndsOn", "required");
    else if (!isValidISODate(trialEnd)) err("trialEndsOn", "invalid");
    else if (isValidISODate(next) && next < trialEnd) err("nextBillingDate", "firstChargeBeforeTrialEnd");
  }

  const rd = v.remindDaysBefore.trim();
  const remind = rd === "" ? 0 : Number(rd);
  if (!/^\d*$/.test(rd) || !Number.isInteger(remind) || remind < 0 || remind > 60) err("remindDaysBefore", "invalid");
  const notes = v.notes.trim();
  if (notes.length > 1000) err("notes", "tooLong");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      name,
      provider: provider || null,
      planName: planName || null,
      category: category || null,
      amount,
      currency: v.currency,
      frequency: v.frequency,
      customInterval,
      customUnit,
      nextBillingDate: next,
      startDate: start || null,
      status: v.status,
      trialEndsOn: isTrial ? trialEnd : null,
      remindDaysBefore: remind,
      billId: v.billId || null,
      notes: notes || null,
    },
  };
}

export type SubscriptionPaymentEntryValues = { amount: string; date: string; note: string; billingDate: string };
export type SubscriptionPaymentEntryPayload = { amount: number; paidAt: string; note: string | null; billingDate: string | null };
export type SubscriptionPaymentEntryError = "amount" | "amountPrecision" | "date" | "dateFuture" | "note";

export function parseSubscriptionPaymentEntry(
  v: SubscriptionPaymentEntryValues,
  todayISO: string
): { ok: true; payload: SubscriptionPaymentEntryPayload } | { ok: false; error: SubscriptionPaymentEntryError } {
  const amt = parseMoney(v.amount);
  if (!amt.ok) return { ok: false, error: amt.error === "precision" ? "amountPrecision" : "amount" };
  if (!(amt.value > 0)) return { ok: false, error: "amount" };
  const date = v.date.trim();
  if (!isValidISODate(date)) return { ok: false, error: "date" };
  if (date > todayISO) return { ok: false, error: "dateFuture" };
  const note = v.note.trim();
  if (note.length > 500) return { ok: false, error: "note" };
  const { y, m, d } = parts(date);
  return {
    ok: true,
    payload: {
      amount: amt.value,
      paidAt: new Date(y, m - 1, d, 12, 0, 0).toISOString(),
      note: note || null,
      billingDate: v.billingDate.trim() && isValidISODate(v.billingDate.trim()) ? v.billingDate.trim() : null,
    },
  };
}

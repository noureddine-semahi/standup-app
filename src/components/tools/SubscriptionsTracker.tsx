"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { formatDateDisplay, toISODate } from "@/lib/supabase/db";
import { formatCurrency } from "@/lib/salary";
import { valueLenStyle } from "@/lib/toolsLayout";
import type { Bill } from "@/lib/bills";
import { cancellationBadge, effectiveCancellation, sortCancellations, summarizeSavings, type SubscriptionCancellation } from "@/lib/cancellation";
import {
  BASE_CURRENCY,
  CUSTOM_UNITS,
  SUB_FREQUENCIES,
  SUB_STATUSES,
  SUPPORTED_CURRENCIES,
  effectiveStatus,
  emptySubscriptionForm,
  findPossibleOverlaps,
  lastPayment,
  monthlyCents,
  nextCharge,
  parseSubscriptionForm,
  parseSubscriptionPaymentEntry,
  previousRenewal,
  subscriptionToFormValues,
  summarizeSubscriptions,
  totalPaid,
  totalPaidInYear,
  upcomingEvents,
  type StatusAction,
  type SubFrequency,
  type SubStatus,
  type Subscription,
  type SubscriptionFormError,
  type SubscriptionFormField,
  type SubscriptionFormPayload,
  type SubscriptionFormValues,
  type SubscriptionPayment,
  type SubscriptionPaymentEntryError,
  type SubscriptionPaymentEntryPayload,
  type SubscriptionPaymentEntryValues,
} from "@/lib/subscriptions";
import { ConfirmActionModal, FIELD_CLASS, newClientKey, useDialog } from "./PaymentsDashboard";
import type { SubscriptionsController } from "./useSubscriptions";
import UnsubscribeModal from "./UnsubscribeModal";

const FREQ_KEY: Record<SubFrequency, TranslationKey> = {
  weekly: "subs.freqWeekly",
  monthly: "subs.freqMonthly",
  quarterly: "subs.freqQuarterly",
  yearly: "subs.freqYearly",
  custom: "subs.freqCustom",
};
const UNIT_KEY = { days: "subs.unitDays", weeks: "subs.unitWeeks", months: "subs.unitMonths" } as const;
const STATUS_KEY: Record<SubStatus, TranslationKey> = {
  active: "subs.statusActive",
  trial: "subs.statusTrial",
  paused: "subs.statusPaused",
  canceled: "subs.statusCanceled",
};
const ERR_KEY: Record<SubscriptionFormError["code"], TranslationKey> = {
  required: "bills.errRequired",
  invalid: "bills.errInvalid",
  precision: "bills.errPrecision",
  negative: "bills.errNegative",
  range: "bills.errRange",
  tooLong: "bills.errTooLong",
  firstChargeBeforeTrialEnd: "subs.errFirstCharge",
  startAfterNextBilling: "subs.errStartAfter",
};
const PAY_ERR_KEY: Record<SubscriptionPaymentEntryError, TranslationKey> = {
  amount: "pay.errAmount",
  amountPrecision: "pay.errAmountPrecision",
  date: "pay.errDate",
  dateFuture: "pay.errDateFuture",
  note: "pay.errNote",
};
const CATEGORY_SUGGESTIONS = ["Streaming", "Music", "Software", "AI Tools", "Cloud Storage", "Gaming", "News", "Fitness", "Education", "Shopping", "Other"];

/** USD uses the app's existing currency formatting; other currencies use Intl. */
function money(amount: number, currency: string): string {
  if (currency === BASE_CURRENCY) return formatCurrency(amount);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// ── Add / Edit ───────────────────────────────────────────────────────────

function SubscriptionFormModal({
  subscription,
  todayISO,
  bills,
  onCancel,
  onSubmit,
}: {
  subscription: Subscription | null;
  todayISO: string;
  bills: readonly Bill[];
  onCancel: () => void;
  onSubmit: (payload: SubscriptionFormPayload) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [values, setValues] = useState<SubscriptionFormValues>(() =>
    subscription ? subscriptionToFormValues(subscription) : emptySubscriptionForm(todayISO)
  );
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, saving);

  const parsed = parseSubscriptionForm(values);
  const set = (k: keyof SubscriptionFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const isTrial = values.status === "trial";

  const message = (f: SubscriptionFormField): string | null => {
    if (!touched || parsed.ok) return null;
    const e = parsed.errors.find((x) => x.field === f);
    if (!e) return null;
    if (f === "customInterval") return t("subs.errInterval");
    if (f === "currency") return t("subs.errCurrency");
    return t(ERR_KEY[e.code]);
  };
  const err = (f: SubscriptionFormField) => {
    const m = message(f);
    return m ? (
      <p className="pay-field-error" role="alert">
        {m}
      </p>
    ) : null;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!parsed.ok || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const msg = await onSubmit(parsed.payload);
    if (msg) {
      setError(msg);
      savingRef.current = false;
      setSaving(false);
    }
  }

  const select = (id: string, value: string, onChange: React.ChangeEventHandler<HTMLSelectElement>, children: React.ReactNode) => (
    <select id={id} value={value} onChange={onChange} disabled={saving} className={`${FIELD_CLASS} pay-select`}>
      {children}
    </select>
  );

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="sub-form-title">
        <h2 id="sub-form-title" className="pay-modal-title">
          {subscription ? t("subs.formEdit") : t("subs.formAdd")}
        </h2>
        <form onSubmit={submit} noValidate>
          <div className="pay-form-grid">
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("subs.fieldName")}</span>
              <input type="text" autoFocus autoComplete="off" value={values.name} onChange={set("name")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("name")} />
              {err("name")}
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("subs.fieldProvider")}</span>
              <input type="text" autoComplete="off" value={values.provider} onChange={set("provider")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("provider")} />
              {err("provider")}
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("subs.fieldPlan")}</span>
              <input type="text" autoComplete="off" value={values.planName} onChange={set("planName")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("planName")} />
              {err("planName")}
            </label>
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("subs.fieldCategory")}</span>
              <input type="text" autoComplete="off" list="sub-category-suggestions" value={values.category} onChange={set("category")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("category")} />
              <datalist id="sub-category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {err("category")}
            </label>

            <label className="pay-field">
              <span className="pay-label">{isTrial ? t("subs.fieldAmountTrial") : t("subs.fieldAmount")}</span>
              <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values.amount} onChange={set("amount")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("amount")} />
              {err("amount")}
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("subs.fieldCurrency")}</span>
              {select("sub-currency", values.currency, set("currency"), SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              )))}
              {err("currency")}
            </label>

            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("subs.fieldFrequency")}</span>
              {select("sub-frequency", values.frequency, set("frequency"), SUB_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(FREQ_KEY[f])}
                </option>
              )))}
            </label>
            {values.frequency === "custom" && (
              <>
                <label className="pay-field">
                  <span className="pay-label">{t("subs.fieldCustomInterval")}</span>
                  <input type="number" inputMode="numeric" min={1} max={365} value={values.customInterval} onChange={set("customInterval")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("customInterval")} />
                  {err("customInterval")}
                </label>
                <label className="pay-field">
                  <span className="pay-label">{t("subs.fieldCustomUnit")}</span>
                  {select("sub-unit", values.customUnit, set("customUnit"), CUSTOM_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {t(UNIT_KEY[u])}
                    </option>
                  )))}
                </label>
              </>
            )}

            <label className="pay-field">
              <span className="pay-label">{t("subs.fieldStatus")}</span>
              {select("sub-status", values.status, set("status"), SUB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_KEY[s])}
                </option>
              )))}
            </label>
            {isTrial ? (
              <label className="pay-field">
                <span className="pay-label">{t("subs.fieldTrialEnds")}</span>
                <input type="date" value={values.trialEndsOn} onChange={set("trialEndsOn")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("trialEndsOn")} />
                {err("trialEndsOn")}
              </label>
            ) : (
              <label className="pay-field">
                <span className="pay-label">{t("subs.fieldStart")}</span>
                <input type="date" value={values.startDate} onChange={set("startDate")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("startDate")} />
                {err("startDate")}
              </label>
            )}

            <label className="pay-field">
              <span className="pay-label">{isTrial ? t("subs.fieldFirstCharge") : t("subs.fieldNextBilling")}</span>
              <input type="date" value={values.nextBillingDate} onChange={set("nextBillingDate")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("nextBillingDate")} />
              {err("nextBillingDate")}
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("subs.fieldRemind")}</span>
              <input type="number" inputMode="numeric" min={0} max={60} value={values.remindDaysBefore} onChange={set("remindDaysBefore")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("remindDaysBefore")} />
              {err("remindDaysBefore")}
            </label>
            {isTrial && (
              <label className="pay-field pay-field-wide">
                <span className="pay-label">{t("subs.fieldStart")}</span>
                <input type="date" value={values.startDate} onChange={set("startDate")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("startDate")} />
                {err("startDate")}
              </label>
            )}

            {bills.length > 0 && (
              <label className="pay-field pay-field-wide">
                <span className="pay-label">{t("subs.fieldLinkedBill")}</span>
                {select("sub-bill", values.billId, set("billId"), (
                  <>
                    <option value="">{t("subs.noLinkedBill")}</option>
                    {bills.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </>
                ))}
                <p className="pay-help">{t("subs.linkedBillHelp")}</p>
              </label>
            )}

            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("subs.fieldNotes")}</span>
              <textarea rows={2} value={values.notes} onChange={set("notes")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!message("notes")} />
              {err("notes")}
            </label>
          </div>

          {error && (
            <div role="alert" className="pay-error">
              {error}
            </div>
          )}

          <div className="pay-modal-actions">
            <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onCancel} disabled={saving}>
              {t("pay.cancel")}
            </button>
            <button type="submit" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" disabled={saving}>
              {saving ? t("subs.saving") : t("subs.save")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ── Record a payment ─────────────────────────────────────────────────────

function RecordPaymentModal({
  subscription,
  payments,
  todayISO,
  onCancel,
  onSubmit,
}: {
  subscription: Subscription;
  payments: readonly SubscriptionPayment[];
  todayISO: string;
  onCancel: () => void;
  onSubmit: (payload: SubscriptionPaymentEntryPayload, clientKey: string) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const prev = previousRenewal(subscription, todayISO);
  const next = nextCharge(subscription, todayISO);
  const paidFor = (d: string) => payments.some((p) => !p.reversedAt && p.billingDate === d);
  // Default to the latest renewal that has no payment yet, else the upcoming one, else none.
  const defaultRenewal = prev && !paidFor(prev) ? prev : next ?? "";
  const renewalOptions = [prev, next].filter((d, i, a): d is string => !!d && a.indexOf(d) === i);

  const [values, setValues] = useState<SubscriptionPaymentEntryValues>({
    amount: subscription.amount === null ? "" : String(subscription.amount),
    date: todayISO,
    note: "",
    billingDate: defaultRenewal,
  });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // One key per open modal: every submit from here is the same intent.
  const [clientKey] = useState(newClientKey);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, saving);

  const parsed = parseSubscriptionPaymentEntry(values, todayISO);
  const fieldError = !parsed.ok && (touched || values.amount.trim() !== "" || values.date !== todayISO) ? parsed.error : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!parsed.ok || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const msg = await onSubmit(parsed.payload, clientKey);
    if (msg) {
      setError(msg);
      savingRef.current = false;
      setSaving(false);
    }
  }

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="sub-record-title">
        <h2 id="sub-record-title" className="pay-modal-title">
          {t("subs.recordTitle")}
        </h2>
        <p className="pay-modal-sub">{subscription.name}</p>
        <form onSubmit={submit} noValidate>
          <div className="pay-form-grid">
            <label className="pay-field">
              <span className="pay-label">{t("subs.payAmount")} ({subscription.currency})</span>
              <input type="text" inputMode="decimal" autoFocus autoComplete="off" placeholder="0.00" value={values.amount} onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))} disabled={saving} className={FIELD_CLASS} aria-invalid={fieldError === "amount" || fieldError === "amountPrecision"} />
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("subs.payDate")}</span>
              <input type="date" max={todayISO} value={values.date} onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))} disabled={saving} className={FIELD_CLASS} aria-invalid={fieldError === "date" || fieldError === "dateFuture"} />
            </label>
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("subs.payRenewal")}</span>
              <select value={values.billingDate} onChange={(e) => setValues((v) => ({ ...v, billingDate: e.target.value }))} disabled={saving} className={`${FIELD_CLASS} pay-select`}>
                {renewalOptions.map((d) => (
                  <option key={d} value={d}>
                    {t("subs.renewalOption", { date: formatDateDisplay(d) })}
                  </option>
                ))}
                <option value="">{t("subs.payNoRenewal")}</option>
              </select>
            </label>
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("subs.payNote")}</span>
              <input type="text" autoComplete="off" value={values.note} onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))} disabled={saving} className={FIELD_CLASS} />
            </label>
          </div>

          {fieldError && <p className="pay-field-error" role="alert">{t(PAY_ERR_KEY[fieldError])}</p>}
          <p className="pay-help">{t("subs.projectedNote")}</p>

          {error && (
            <div role="alert" className="pay-error">
              {error}
            </div>
          )}

          <div className="pay-modal-actions">
            <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onCancel} disabled={saving}>
              {t("pay.cancel")}
            </button>
            <button type="submit" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" disabled={saving || !parsed.ok}>
              {saving ? t("subs.recording") : t("subs.record")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ── Tracker ──────────────────────────────────────────────────────────────

export default function SubscriptionsTracker({
  controller,
  todayISO,
  bills,
}: {
  controller: SubscriptionsController;
  todayISO: string;
  /** Active bills, for the explicit "also tracked as a bill" link and the overlap hint. */
  bills: readonly Bill[];
}) {
  const { t } = useLanguage();
  const c = controller;
  const [formFor, setFormFor] = useState<"new" | Subscription | null>(null);
  const [recordFor, setRecordFor] = useState<Subscription | null>(null);
  const [unsubId, setUnsubId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "cancel" | "delete"; sub: Subscription } | null>(null);
  const [reversing, setReversing] = useState<{ sub: Subscription; payment: SubscriptionPayment } | null>(null);
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const available = c.state === "ready";
  const summary = summarizeSubscriptions(c.subscriptions, todayISO);
  const overlaps = findPossibleOverlaps(c.subscriptions, bills);
  const overlapBySub = new Map(overlaps.map((o) => [o.subscriptionId, o]));
  const billName = (id: string | null) => bills.find((b) => b.id === id)?.name ?? null;

  const savings = summarizeSavings(c.subscriptions, c.cancellations);
  const hasSavings = savings.confirmed.count + savings.reported.count + savings.unpriced > 0;
  const unsubSub = unsubId ? c.subscriptions.find((x) => x.id === unsubId) ?? null : null;

  const cancelModeKey = { assisted: "unsub.modeAssisted", manual: "unsub.modeManual", automatic: "unsub.modeAutomatic" } as const;
  const cancelStatusKey = {
    in_progress: "unsub.stInProgress",
    user_reported: "unsub.stUserReported",
    provider_confirmed: "unsub.stProviderConfirmed",
    failed: "unsub.stFailed",
  } as const;
  const cancelDate = (x: SubscriptionCancellation) => formatDateDisplay((x.completedOn ?? x.requestedAt).slice(0, 10));
  /** The card's cancellation line; user-reported is always worded as such, never as provider-confirmed. */
  function cancelBadgeText(s: Subscription): { text: string; kind: string } | null {
    const list = c.cancellations[s.id] ?? [];
    const badge = cancellationBadge(list);
    if (!badge) return null;
    const newest = sortCancellations(list)[0];
    if (badge === "providerConfirmed") return s.status === "canceled" ? { text: t("unsub.badgeConfirmed"), kind: "confirmed" } : null;
    if (badge === "userReported") {
      const eff = effectiveCancellation(list);
      return s.status === "canceled" && eff ? { text: t("unsub.badgeReported", { date: cancelDate(eff) }), kind: "reported" } : null;
    }
    if (badge === "inProgress") return s.status === "canceled" ? null : { text: t("unsub.badgeProgress"), kind: "progress" };
    return s.status === "canceled" ? null : { text: t("unsub.badgeFailed", { error: newest.errorMessage ?? "" }), kind: "failed" };
  }

  const monthlyText = formatCurrency(summary.monthlyCost);
  const yearlyText = formatCurrency(summary.yearlyEstimate);

  // Order: billing / trial first by their next date, then paused, then canceled.
  const rank = (s: Subscription) => {
    const st = effectiveStatus(s, todayISO).status;
    return st === "paused" ? 1 : st === "canceled" ? 2 : 0;
  };
  const sorted = [...c.subscriptions].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (nextCharge(a, todayISO) ?? "9999").localeCompare(nextCharge(b, todayISO) ?? "9999") ||
      a.name.localeCompare(b.name)
  );

  async function submitForm(payload: SubscriptionFormPayload): Promise<string | null> {
    if (formFor === "new") {
      const msg = await c.create(payload);
      if (!msg) setFormFor(null);
      return msg;
    }
    if (formFor) {
      const patch: Partial<SubscriptionFormPayload> & { canceledAt?: string | null } = {};
      (Object.keys(payload) as (keyof SubscriptionFormPayload)[]).forEach((k) => {
        if (payload[k] !== formFor[k as keyof Subscription]) (patch as Record<string, unknown>)[k] = payload[k];
      });
      if (Object.keys(patch).length === 0) {
        setFormFor(null); // nothing changed -- no write
        return null;
      }
      if (patch.status !== undefined) patch.canceledAt = patch.status === "canceled" ? new Date().toISOString() : null;
      const msg = await c.update(formFor, patch);
      if (!msg) setFormFor(null);
      return msg;
    }
    return null;
  }

  async function runStatus(sub: Subscription, action: StatusAction) {
    setNotice(null);
    const msg = await c.changeStatus(sub, action, todayISO);
    if (msg) setNotice(msg);
    setMoreOpenId(null);
  }

  const priceLine = (s: Subscription): string => {
    if (s.amount === null) return t("subs.priceNotEntered");
    const amount = money(s.amount, s.currency);
    switch (s.frequency) {
      case "weekly":
        return t("subs.perWeek", { amount });
      case "monthly":
        return t("subs.perMonth", { amount });
      case "quarterly":
        return t("subs.perQuarter", { amount });
      case "yearly":
        return t("subs.perYear", { amount });
      case "custom": {
        const n = s.customInterval ?? 0;
        if (s.customUnit === "days") return n === 1 ? t("subs.everyDay", { amount }) : t("subs.everyDays", { amount, n });
        if (s.customUnit === "weeks") return n === 1 ? t("subs.everyWeek", { amount }) : t("subs.everyWeeks", { amount, n });
        return n === 1 ? t("subs.everyMonth", { amount }) : t("subs.everyMonths", { amount, n });
      }
    }
  };

  /** Chip text + colour, from the status and (for billing / trial) the reminder window. */
  const chipFor = (s: Subscription): { text: string; tier: string } => {
    const eff = effectiveStatus(s, todayISO);
    if (eff.status === "canceled") return { text: t("subs.statusCanceled"), tier: "later" };
    if (eff.status === "paused") return { text: t("subs.statusPaused"), tier: "later" };
    const ev = upcomingEvents(s, todayISO)[0];
    if (eff.status === "trial") {
      if (ev) {
        const text = ev.daysUntil === 0 ? t("subs.trialEndsToday") : ev.daysUntil === 1 ? t("subs.trialEndsTomorrow") : t("subs.trialEndsInDays", { days: ev.daysUntil });
        return { text, tier: "soon" };
      }
      return { text: t("subs.trialEndsOn", { date: formatDateDisplay(s.trialEndsOn ?? s.nextBillingDate) }), tier: "later" };
    }
    if (ev) {
      const text = ev.daysUntil === 0 ? t("subs.renewsToday") : ev.daysUntil === 1 ? t("subs.renewsTomorrow") : t("subs.renewsInDays", { days: ev.daysUntil });
      return { text, tier: "soon" };
    }
    return { text: t("subs.statusActive"), tier: "paid" };
  };

  const renewLine = (s: Subscription): string => {
    const eff = effectiveStatus(s, todayISO);
    if (eff.status === "paused") return t("subs.noRenewalPaused");
    if (eff.status === "canceled") return t("subs.noRenewalCanceled");
    const next = nextCharge(s, todayISO);
    if (!next) return t("subs.noSchedule");
    return eff.status === "trial" ? t("subs.firstCharge", { date: formatDateDisplay(next) }) : t("subs.nextRenewal", { date: formatDateDisplay(next) });
  };

  const txnDate = (p: SubscriptionPayment) => formatDateDisplay(toISODate(new Date(p.paidAt)));

  return (
    <div className="pay-panel bills-panel subs-panel">
      <div className="fin-section-head">
        <h3 className="text-lg font-bold">{t("subs.title")}</h3>
        <p className="text-sm text-white/70">{t("subs.subtitle")}</p>
      </div>

      <button
        type="button"
        className="btn standup-metal-btn standup-metal-btn--accent pay-add-btn"
        disabled={!available}
        onClick={() => {
          setNotice(null);
          setFormFor("new");
        }}
      >
        <Plus size={16} aria-hidden="true" />
        {t("subs.add")}
      </button>

      {c.state === "unavailable" && (
        <div role="status" className="pay-error pay-error-page" data-testid="subs-unavailable">
          {t("subs.unavailable")}
        </div>
      )}
      {c.state === "error" && (
        <div role="alert" className="pay-error pay-error-page">
          {c.loadError ?? t("subs.failed")}
        </div>
      )}
      {notice && (
        <div role="status" className="pay-notice">
          {notice}
        </div>
      )}
      {available && overlaps.length > 0 && (
        <div role="note" className="sub-notice" data-testid="subs-overlap-notice">
          {overlaps.length === 1 ? t("subs.overlapNoticeOne") : t("subs.overlapNoticeMany", { count: overlaps.length })}
        </div>
      )}

      {available && (
        <section className="pay-summary fin-overview" aria-label={t("subs.summary")}>
          <div className="pay-stat" data-kind="balance">
            <div className="pay-stat-label">{t("subs.monthlyCost")}</div>
            <div className="pay-stat-value" style={valueLenStyle(monthlyText) as React.CSSProperties} data-testid="subs-monthly">
              {monthlyText}
            </div>
            {summary.awaitingPrice > 0 && (
              <div className="bill-stat-note" data-testid="subs-awaiting">
                {summary.awaitingPrice === 1 ? t("subs.awaitingPriceOne") : t("subs.awaitingPriceMany", { count: summary.awaitingPrice })}
              </div>
            )}
            {summary.otherCurrency > 0 && <div className="bill-stat-note">{t("subs.otherCurrencies", { count: summary.otherCurrency })}</div>}
            {overlaps.length > 0 && (
              <div className="bill-stat-note">{overlaps.length === 1 ? t("subs.mayOverlapOne") : t("subs.mayOverlapMany", { count: overlaps.length })}</div>
            )}
          </div>
          <div className="pay-stat" data-kind="minimums">
            <div className="pay-stat-label">{t("subs.yearlyEstimate")}</div>
            <div className="pay-stat-value" style={valueLenStyle(yearlyText) as React.CSSProperties} data-testid="subs-yearly">
              {yearlyText}
            </div>
          </div>
          <div className="pay-stat" data-kind="paid">
            <div className="pay-stat-label">{t("subs.activeCount")}</div>
            <div className="pay-stat-value" style={valueLenStyle(String(summary.activeCount)) as React.CSSProperties} data-testid="subs-active">
              {summary.activeCount}
            </div>
          </div>
          <div className="pay-stat" data-kind="upcoming">
            <div className="pay-stat-label">{t("subs.upcomingRenewals")}</div>
            <div className="pay-stat-value" style={valueLenStyle(String(summary.upcomingRenewals)) as React.CSSProperties} data-testid="subs-upcoming">
              {summary.upcomingRenewals}
            </div>
          </div>
        </section>
      )}

      {available && hasSavings && (
        <section className="sub-savings" aria-label={t("unsub.savingsTitle")} data-testid="subs-savings">
          <h3 className="sub-savings-title">{t("unsub.savingsTitle")}</h3>
          {savings.reported.count > 0 && (
            <p data-testid="subs-savings-reported">
              {t("unsub.savingsReported", { monthly: formatCurrency(savings.reported.monthly), yearly: formatCurrency(savings.reported.yearly), count: savings.reported.count })}
            </p>
          )}
          {savings.confirmed.count > 0 && (
            <p data-testid="subs-savings-confirmed">
              {t("unsub.savingsConfirmed", { monthly: formatCurrency(savings.confirmed.monthly), yearly: formatCurrency(savings.confirmed.yearly), count: savings.confirmed.count })}
            </p>
          )}
          {savings.unpriced > 0 && <p>{t("unsub.savingsUnpriced", { count: savings.unpriced })}</p>}
          <p className="sub-savings-note">{t("unsub.savingsNote")}</p>
        </section>
      )}

      {available && <h3 className="pay-section-title">{t("subs.sectionTitle")}</h3>}

      {c.state === "loading" ? (
        <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>
      ) : available && sorted.length === 0 ? (
        <p className="text-sm text-white/50 italic">{t("subs.empty")}</p>
      ) : (
        available && (
          <ul className="pay-list bill-list">
            {sorted.map((s) => {
              const chip = chipFor(s);
              const eff = effectiveStatus(s, todayISO);
              const subPayments = c.payments[s.id] ?? [];
              const last = lastPayment(subPayments);
              const monthly = monthlyCents(s);
              const moreOpen = moreOpenId === s.id;
              const historyOpen = historyOpenId === s.id;
              const sub2 = [s.planName, s.category].filter(Boolean).join(" · ");
              const linkedName = billName(s.billId);
              const overlap = overlapBySub.get(s.id);
              const cancelBadgeInfo = cancelBadgeText(s);
              const cancelList = sortCancellations(c.cancellations[s.id] ?? []);
              return (
                <li key={s.id} className="pay-card bill-card sub-card" data-testid="sub-card" data-status={eff.status}>
                  <div className="pay-card-head">
                    <div className="bill-title">
                      <h3 className="pay-card-name">{s.name}</h3>
                      {sub2 && <span className="bill-category">{sub2}</span>}
                    </div>
                    <span className="pay-due bill-chip" data-tier={chip.tier}>
                      {chip.text}
                    </span>
                  </div>

                  <div className="bill-info">
                    <div className="bill-info-row">
                      <span className="bill-amount">{priceLine(s)}</span>
                      {s.frequency !== "monthly" && monthly !== null && (
                        <span className="bill-recur">{t("subs.monthlyEquiv", { amount: money(monthly / 100, s.currency) })}</span>
                      )}
                    </div>
                    <div className="bill-info-row">
                      <span className="bill-due">{renewLine(s)}</span>
                      {eff.trialEnded && <span className="bill-recur">{t("subs.trialEnded")}</span>}
                    </div>
                    <div className="bill-info-row">
                      <span className={last ? "bill-paid" : "bill-due"}>
                        {last ? t("subs.lastPaid", { amount: money(last.amount, s.currency), date: txnDate(last) }) : t("subs.noPayments")}
                      </span>
                    </div>
                    {cancelBadgeInfo && (
                      <div className="bill-info-row">
                        <span className="sub-link-note sub-cancel-note" data-kind={cancelBadgeInfo.kind} data-testid="sub-cancel-badge">
                          {cancelBadgeInfo.text}
                        </span>
                      </div>
                    )}
                    {(linkedName || overlap) && (
                      <div className="bill-info-row">
                        <span className="sub-link-note" data-testid="sub-link-note">
                          {linkedName ? t("subs.trackedInBills", { name: linkedName }) : t("subs.possibleOverlap", { name: overlap!.billName })}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="pay-card-actions">
                    <button
                      type="button"
                      className="btn standup-metal-btn standup-metal-btn--accent pay-action-btn pay-action-wide"
                      onClick={() => {
                        setNotice(null);
                        setRecordFor(s);
                      }}
                      aria-label={`${t("subs.recordPayment")} ${s.name}`}
                    >
                      <Receipt size={14} aria-hidden="true" />
                      {t("subs.recordPayment")}
                    </button>
                    <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => setHistoryOpenId(historyOpen ? null : s.id)} aria-expanded={historyOpen} aria-label={`${t("subs.history")} ${s.name}`}>
                      <History size={14} aria-hidden="true" />
                      {t("subs.history")}
                    </button>
                    <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => setFormFor(s)} aria-label={`${t("subs.edit")} ${s.name}`}>
                      <Pencil size={14} aria-hidden="true" />
                      {t("subs.edit")}
                    </button>
                    <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => setMoreOpenId(moreOpen ? null : s.id)} aria-expanded={moreOpen} aria-label={`${t("subs.more")} ${s.name}`}>
                      <MoreHorizontal size={16} aria-hidden="true" />
                      {t("subs.more")}
                    </button>
                  </div>

                  {moreOpen && (
                    <div className="pay-more sub-more" role="group" aria-label={`${t("subs.more")} ${s.name}`}>
                      {(s.status === "active" || s.status === "trial") && (
                        <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => runStatus(s, "pause")}>
                          {t("subs.pause")}
                        </button>
                      )}
                      {s.status === "paused" && (
                        <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => runStatus(s, "resume")}>
                          {t("subs.resume")}
                        </button>
                      )}
                      {s.status !== "canceled" && (
                        <button
                          type="button"
                          className="btn standup-metal-btn standup-metal-btn--accent pay-action-btn"
                          data-testid="sub-unsubscribe"
                          onClick={() => {
                            setNotice(null);
                            setMoreOpenId(null);
                            setUnsubId(s.id);
                          }}
                        >
                          {t("unsub.action")}
                        </button>
                      )}
                      {s.status === "canceled" ? (
                        <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => runStatus(s, "reactivate")}>
                          {t("subs.reactivate")}
                        </button>
                      ) : (
                        <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => setConfirm({ kind: "cancel", sub: s })}>
                          {t("subs.cancel")}
                        </button>
                      )}
                      <button type="button" className="btn standup-metal-btn standup-metal-btn--danger pay-action-btn" onClick={() => setConfirm({ kind: "delete", sub: s })}>
                        <Trash2 size={14} aria-hidden="true" />
                        {t("subs.delete")}
                      </button>
                    </div>
                  )}

                  {historyOpen && (
                    <div className="pay-history" data-testid="sub-history">
                      {subPayments.length === 0 ? (
                        <p className="text-xs text-white/50 italic">{t("subs.historyEmpty")}</p>
                      ) : (
                        <>
                          <p className="sub-totals">
                            <span>{t("subs.historyTotal", { amount: money(totalPaid(subPayments), s.currency) })}</span>
                            <span>{t("subs.historyYear", { amount: money(totalPaidInYear(subPayments, Number(todayISO.slice(0, 4))), s.currency) })}</span>
                          </p>
                          <ul className="pay-history-list">
                            {subPayments.map((p) => (
                              <li key={p.id} className="pay-txn" data-reversed={!!p.reversedAt}>
                                <div className="pay-txn-main">
                                  <span className="pay-txn-amount">{money(p.amount, s.currency)}</span>
                                  <span className="pay-txn-date">{txnDate(p)}</span>
                                  {p.reversedAt && <span className="pay-txn-badge">{t("pay.reversedBadge")}</span>}
                                </div>
                                {p.billingDate && <p className="pay-txn-note">{t("subs.forRenewal", { date: formatDateDisplay(p.billingDate) })}</p>}
                                {p.note && <p className="pay-txn-note">{p.note}</p>}
                                {!p.reversedAt && (
                                  <button
                                    type="button"
                                    className="btn standup-metal-btn pay-txn-reverse"
                                    onClick={() => setReversing({ sub: s, payment: p })}
                                    aria-label={`${t("subs.reverse")} ${money(p.amount, s.currency)} ${txnDate(p)}`}
                                  >
                                    {t("subs.reverse")}
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {cancelList.length > 0 && (
                        <div data-testid="sub-cancel-history">
                          <h4 className="sub-history-h">{t("unsub.historyTitle")}</h4>
                          <ul className="pay-history-list">
                            {cancelList.map((x) => (
                              <li key={x.id} className="pay-txn">
                                <div className="pay-txn-main">
                                  <span className="pay-txn-date">
                                    {t("unsub.historyRow", { mode: t(cancelModeKey[x.mode]), status: t(cancelStatusKey[x.status]), date: cancelDate(x) })}
                                  </span>
                                </div>
                                {x.errorMessage && <p className="pay-txn-note">{x.errorMessage}</p>}
                                {x.note && <p className="pay-txn-note">{x.note}</p>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}

      {formFor && (
        <SubscriptionFormModal
          key={formFor === "new" ? "new" : formFor.id}
          subscription={formFor === "new" ? null : formFor}
          todayISO={todayISO}
          bills={bills}
          onCancel={() => setFormFor(null)}
          onSubmit={submitForm}
        />
      )}
      {recordFor && (
        <RecordPaymentModal
          key={recordFor.id}
          subscription={recordFor}
          payments={c.payments[recordFor.id] ?? []}
          todayISO={todayISO}
          onCancel={() => setRecordFor(null)}
          onSubmit={async (payload, clientKey) => {
            const msg = await c.recordPayment(recordFor, payload, clientKey);
            if (!msg) {
              setRecordFor(null);
              setNotice(t("subs.recorded"));
            }
            return msg;
          }}
        />
      )}
      {unsubSub && (
        <UnsubscribeModal
          key={unsubSub.id}
          subscription={unsubSub}
          cancellations={c.cancellations[unsubSub.id] ?? []}
          controller={c}
          todayISO={todayISO}
          onClose={() => setUnsubId(null)}
          onDone={(message) => {
            setUnsubId(null);
            setNotice(message);
          }}
        />
      )}
      {confirm && (
        <ConfirmActionModal
          title={confirm.kind === "cancel" ? t("subs.cancelTitle", { name: confirm.sub.name }) : t("subs.deleteTitle")}
          body={confirm.kind === "cancel" ? t("subs.cancelBody") : t("subs.deleteBody", { name: confirm.sub.name })}
          confirmLabel={confirm.kind === "cancel" ? t("subs.cancelConfirm") : t("subs.deleteConfirm")}
          busyLabel={confirm.kind === "cancel" ? t("subs.saving") : t("subs.deleting")}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const msg = confirm.kind === "cancel" ? await c.changeStatus(confirm.sub, "cancel", todayISO) : await c.remove(confirm.sub);
            if (!msg) {
              setConfirm(null);
              setMoreOpenId(null);
              if (confirm.kind === "delete") setHistoryOpenId((cur) => (cur === confirm.sub.id ? null : cur));
            }
            return msg;
          }}
        />
      )}
      {reversing && (
        <ConfirmActionModal
          title={t("subs.reverseTitle")}
          body={t("subs.reverseBody", { amount: money(reversing.payment.amount, reversing.sub.currency), date: txnDate(reversing.payment) })}
          confirmLabel={t("pay.reverseConfirm")}
          busyLabel={t("pay.reversing")}
          onCancel={() => setReversing(null)}
          onConfirm={async () => {
            const msg = await c.reversePayment(reversing.sub, reversing.payment.id);
            if (!msg) {
              setReversing(null);
              setNotice(t("subs.reversedDone"));
            }
            return msg;
          }}
        />
      )}
    </div>
  );
}


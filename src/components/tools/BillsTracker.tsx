"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { formatDateDisplay } from "@/lib/supabase/db";
import { formatCurrency } from "@/lib/salary";
import { valueLenStyle } from "@/lib/toolsLayout";
import {
  BILL_CATEGORIES,
  OTHER_CATEGORY,
  billToFormValues,
  currentOccurrence,
  isPredefinedCategory,
  describeDueSummary,
  emptyBillForm,
  parseBillForm,
  parseBillPaymentEntry,
  parseMoney,
  resolveOccurrence,
  statusLabel,
  summarizeBills,
  type Bill,
  type BillAmountType,
  type BillFormError,
  type BillFormField,
  type BillFormPayload,
  type BillFormValues,
  type BillPaymentEntryPayload,
  type BillPaymentEntryValues,
  type BillRecurrence,
  type OccurrenceView,
  BILL_RECURRENCES,
} from "@/lib/bills";
import { ConfirmActionModal, FIELD_CLASS, newClientKey, useDialog } from "./PaymentsDashboard";
import type { BillsController } from "./useBills";

const RECUR_KEY: Record<BillRecurrence, TranslationKey> = {
  once: "bills.recurOnce",
  weekly: "bills.recurWeekly",
  biweekly: "bills.recurBiweekly",
  monthly: "bills.recurMonthly",
  quarterly: "bills.recurQuarterly",
  annually: "bills.recurAnnually",
};

const CATEGORY_KEY: Record<(typeof BILL_CATEGORIES)[number], TranslationKey> = {
  Utilities: "bills.catUtilities",
  Internet: "bills.catInternet",
  "Mobile / Phone": "bills.catMobile",
  "Rent / Mortgage": "bills.catRent",
  Insurance: "bills.catInsurance",
  "Auto / Transportation": "bills.catAuto",
  Groceries: "bills.catGroceries",
  Healthcare: "bills.catHealthcare",
  "Education / Childcare": "bills.catEducation",
  "Home Maintenance": "bills.catHome",
  "Taxes / Government": "bills.catTaxes",
  Memberships: "bills.catMemberships",
  Entertainment: "bills.catEntertainment",
  Other: "bills.catOther",
};

const ERR_KEY: Record<BillFormError["code"], TranslationKey> = {
  required: "bills.errRequired",
  invalid: "bills.errInvalid",
  precision: "bills.errPrecision",
  negative: "bills.errNegative",
  range: "bills.errRange",
  tooLong: "bills.errTooLong",
};

const PAY_ERR_KEY = {
  amount: "pay.errAmount",
  amountPrecision: "pay.errAmountPrecision",
  amountDue: "bills.errAmountDue",
  date: "pay.errDate",
  dateFuture: "pay.errDateFuture",
  note: "pay.errNote",
} as const;

// ── Add / Edit bill ──────────────────────────────────────────────────────

function BillFormModal({
  bill,
  todayISO,
  onCancel,
  onSubmit,
}: {
  bill: Bill | null;
  todayISO: string;
  onCancel: () => void;
  onSubmit: (payload: BillFormPayload) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [values, setValues] = useState<BillFormValues>(() => (bill ? billToFormValues(bill) : emptyBillForm(todayISO)));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, saving);

  const parsed = parseBillForm(values);
  const fieldError = (f: BillFormField) => {
    if (!touched || parsed.ok) return null;
    const e = parsed.errors.find((x) => x.field === f);
    return e ? t(ERR_KEY[e.code]) : null;
  };
  const set = (k: keyof BillFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!parsed.ok || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const err = await onSubmit(parsed.payload);
    if (err) {
      setError(err);
      savingRef.current = false;
      setSaving(false);
    }
  }

  const err = (f: BillFormField) => {
    const m = fieldError(f);
    return m ? (
      <p className="pay-field-error" role="alert">
        {m}
      </p>
    ) : null;
  };

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="bill-form-title">
        <h2 id="bill-form-title" className="pay-modal-title">
          {bill ? t("bills.formEdit") : t("bills.formAdd")}
        </h2>
        <form onSubmit={submit} noValidate>
          <div className="pay-form-grid">
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("bills.fieldName")}</span>
              <input type="text" autoFocus autoComplete="off" value={values.name} onChange={set("name")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!fieldError("name")} />
              {err("name")}
            </label>

            <div className="pay-field pay-field-wide">
              <span className="pay-label" id="bill-type-label">{t("bills.fieldType")}</span>
              <div className="pay-seg" role="group" aria-labelledby="bill-type-label">
                {(["fixed", "variable"] as BillAmountType[]).map((ty) => (
                  <button
                    key={ty}
                    type="button"
                    className="btn goal-toolbar-btn salary-basis-btn pay-seg-btn"
                    aria-pressed={values.amountType === ty}
                    disabled={saving}
                    onClick={() => setValues((v) => ({ ...v, amountType: ty }))}
                  >
                    {ty === "fixed" ? t("bills.typeFixed") : t("bills.typeVariable")}
                  </button>
                ))}
              </div>
              <p className="pay-help">{values.amountType === "fixed" ? t("bills.typeFixedHelp") : t("bills.typeVariableHelp")}</p>
            </div>

            <label className="pay-field pay-field-wide">
              <span className="pay-label">{values.amountType === "fixed" ? t("bills.fieldAmount") : t("bills.fieldEstimate")}</span>
              <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values.amount} onChange={set("amount")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!fieldError("amount")} />
              {err("amount")}
            </label>

            <label className="pay-field">
              <span className="pay-label">{t("bills.fieldFirstDue")}</span>
              <input type="date" value={values.firstDueDate} onChange={set("firstDueDate")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!fieldError("firstDueDate")} />
              {err("firstDueDate")}
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("bills.fieldRecurrence")}</span>
              <select value={values.recurrence} onChange={set("recurrence")} disabled={saving} className={`${FIELD_CLASS} pay-select`}>
                {BILL_RECURRENCES.map((r) => (
                  <option key={r} value={r}>
                    {t(RECUR_KEY[r])}
                  </option>
                ))}
              </select>
            </label>
            {bill && <p className="pay-help pay-field-wide" style={{ marginTop: 0 }}>{t("bills.scheduleNote")}</p>}

            <label className="pay-field">
              <span className="pay-label">{t("bills.fieldRemind")}</span>
              <input type="number" inputMode="numeric" min={0} max={60} value={values.remindDaysBefore} onChange={set("remindDaysBefore")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!fieldError("remindDaysBefore")} />
              {err("remindDaysBefore")}
            </label>
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("bills.fieldCategory")}</span>
              <select
                value={values.categoryChoice}
                onChange={(e) => setValues((v) => ({ ...v, categoryChoice: e.target.value }))}
                disabled={saving}
                className={`${FIELD_CLASS} pay-select`}
              >
                <option value="">{t("bills.catNone")}</option>
                {BILL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(CATEGORY_KEY[c])}
                  </option>
                ))}
              </select>
            </label>
            {values.categoryChoice === OTHER_CATEGORY && (
              <label className="pay-field pay-field-wide">
                <span className="pay-label">{t("bills.fieldCustomCategory")}</span>
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={80}
                  placeholder={t("bills.customCategoryPlaceholder")}
                  value={values.categoryCustom}
                  onChange={(e) => setValues((v) => ({ ...v, categoryCustom: e.target.value }))}
                  disabled={saving}
                  className={FIELD_CLASS}
                  aria-invalid={!!fieldError("category")}
                />
                {err("category")}
              </label>
            )}
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("bills.fieldNotes")}</span>
              <textarea rows={2} value={values.notes} onChange={set("notes")} disabled={saving} className={FIELD_CLASS} aria-invalid={!!fieldError("notes")} />
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
              {saving ? t("bills.saving") : t("bills.save")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ── Record a payment ─────────────────────────────────────────────────────

function RecordBillPaymentModal({
  bill,
  view,
  todayISO,
  onCancel,
  onSubmit,
}: {
  bill: Bill;
  view: OccurrenceView;
  todayISO: string;
  onCancel: () => void;
  onSubmit: (payload: BillPaymentEntryPayload, clientKey: string) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const needsActual = bill.amountType === "variable";
  const [values, setValues] = useState<BillPaymentEntryValues>({
    amount: view.outstanding !== null && view.outstanding > 0 ? String(view.outstanding) : "",
    date: todayISO,
    note: "",
    amountDue: view.amountDue === null ? "" : String(view.amountDue),
  });
  // A variable bill whose amount isn't known yet and has no payments so far:
  // paying it is most often paying it in full, so offer that as an explicit,
  // visible choice (on by default, one tap to turn off for a partial payment).
  const [fullPay, setFullPay] = useState(needsActual && view.amountDue === null && view.paid === 0);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // One key per open modal: every submit from here is the same intent.
  const [clientKey] = useState(newClientKey);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, saving);

  const showFullPay = needsActual && (view.amountDue === null || view.paid === 0);
  const useFullPay = showFullPay && fullPay;
  const parsed = parseBillPaymentEntry(useFullPay ? { ...values, amountDue: "" } : values, todayISO);
  const fieldError = !parsed.ok && (touched || values.amount.trim() !== "" || values.amountDue !== (view.amountDue === null ? "" : String(view.amountDue))) ? parsed.error : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!parsed.ok || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    // A fixed bill's amount due is the snapshot already on the cycle -- never resend it.
    // "Full amount" sets the cycle's actual amount due to exactly what was paid.
    const amountDue = !needsActual ? null : useFullPay ? parsed.payload.amount : parsed.payload.amountDue;
    const err = await onSubmit({ ...parsed.payload, amountDue }, clientKey);
    if (err) {
      setError(err);
      savingRef.current = false;
      setSaving(false);
    }
  }

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="bill-record-title">
        <h2 id="bill-record-title" className="pay-modal-title">
          {t("bills.recordTitle")}
        </h2>
        <p className="pay-modal-sub">{t("bills.recordFor", { name: bill.name, date: formatDateDisplay(view.dueDate) })}</p>
        <form onSubmit={submit} noValidate>
          <div className="pay-form-grid">
            <label className="pay-field">
              <span className="pay-label">{t("bills.payAmount")}</span>
              <input type="text" inputMode="decimal" autoFocus autoComplete="off" placeholder="0.00" value={values.amount} onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))} disabled={saving} className={FIELD_CLASS} aria-invalid={fieldError === "amount" || fieldError === "amountPrecision"} />
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("bills.payDate")}</span>
              <input type="date" max={todayISO} value={values.date} onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))} disabled={saving} className={FIELD_CLASS} aria-invalid={fieldError === "date" || fieldError === "dateFuture"} />
            </label>
            {showFullPay && (
              <label className="pay-check pay-field-wide">
                <input type="checkbox" checked={fullPay} onChange={(e) => setFullPay(e.target.checked)} disabled={saving} />
                <span>{t("bills.fullPay")}</span>
              </label>
            )}
            {useFullPay && <p className="pay-help pay-field-wide" style={{ marginTop: 0 }}>{t("bills.fullPayHelp")}</p>}
            {needsActual && !useFullPay && (
              <label className="pay-field pay-field-wide">
                <span className="pay-label">{t("bills.actualDue")}</span>
                <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values.amountDue} onChange={(e) => setValues((v) => ({ ...v, amountDue: e.target.value }))} disabled={saving} className={FIELD_CLASS} aria-invalid={fieldError === "amountDue"} />
                {view.amountDue === null && <p className="pay-help">{t("bills.actualDueHelp")}</p>}
              </label>
            )}
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("bills.payNote")}</span>
              <input type="text" autoComplete="off" value={values.note} onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))} disabled={saving} className={FIELD_CLASS} />
            </label>
          </div>

          {fieldError && <p className="pay-field-error" role="alert">{t(PAY_ERR_KEY[fieldError])}</p>}
          <p className="pay-help">{t("bills.noBalanceNote")}</p>

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
              {saving ? t("bills.recording") : t("bills.record")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ── Set the actual amount due (variable bills) ───────────────────────────

function SetAmountModal({
  bill,
  view,
  onCancel,
  onSubmit,
}: {
  bill: Bill;
  view: OccurrenceView;
  onCancel: () => void;
  onSubmit: (amount: number) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [raw, setRaw] = useState(view.amountDue === null ? "" : String(view.amountDue));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, saving);
  const parsed = parseMoney(raw);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed.ok || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const err = await onSubmit(parsed.value);
    if (err) {
      setError(err);
      savingRef.current = false;
      setSaving(false);
    }
  }

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="bill-amount-title">
        <h2 id="bill-amount-title" className="pay-modal-title">
          {t("bills.setAmountTitle")}
        </h2>
        <p className="pay-modal-sub">{t("bills.recordFor", { name: bill.name, date: formatDateDisplay(view.dueDate) })}</p>
        <form onSubmit={submit} noValidate>
          <label className="pay-field">
            <span className="pay-label">{t("bills.amountDueLabel")}</span>
            <input type="text" inputMode="decimal" autoFocus autoComplete="off" placeholder="0.00" value={raw} onChange={(e) => setRaw(e.target.value)} disabled={saving} className={FIELD_CLASS} aria-invalid={raw.trim() !== "" && !parsed.ok} />
          </label>
          {raw.trim() !== "" && !parsed.ok && <p className="pay-field-error" role="alert">{t(ERR_KEY[parsed.error === "negative" ? "negative" : parsed.error === "precision" ? "precision" : parsed.error === "range" ? "range" : "invalid"])}</p>}
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
              {saving ? t("bills.saving") : t("bills.save")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ── Tracker ──────────────────────────────────────────────────────────────

/** Ten-segment progress read-out: how much of the amount due has been paid. */
function Segments({ paid, due }: { paid: number; due: number }) {
  const filled = due > 0 ? Math.min(10, Math.floor((paid / due) * 10 + 1e-9)) : 0;
  return (
    <div className="bill-seg" role="img" aria-label={`${Math.round(Math.min(1, due > 0 ? paid / due : 0) * 100)}%`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className="bill-seg-cell" data-on={i < filled} />
      ))}
    </div>
  );
}

export default function BillsTracker({ controller, todayISO }: { controller: BillsController; todayISO: string }) {
  const { t } = useLanguage();
  const c = controller;
  const [formFor, setFormFor] = useState<"new" | Bill | null>(null);
  const [recordFor, setRecordFor] = useState<{ bill: Bill; view: OccurrenceView } | null>(null);
  const [amountFor, setAmountFor] = useState<{ bill: Bill; view: OccurrenceView } | null>(null);
  const [removing, setRemoving] = useState<Bill | null>(null);
  const [reversing, setReversing] = useState<{ bill: Bill; paymentId: string; amount: number; date: string } | null>(null);
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const available = c.state === "ready";
  const summary = summarizeBills(c.bills, c.occurrences, todayISO);
  const expectedText = formatCurrency(summary.expectedThisMonth);
  const remainingText = formatCurrency(summary.remainingThisMonth);
  const paidText = formatCurrency(summary.paidThisMonth);
  const dueDisplay = describeDueSummary(summary);
  // Caveats shared by the Expected and Remaining panels (both are built from estimates when no actual exists).
  const estimateNote = dueDisplay.includesEstimates ? <div className="bill-stat-note">{t("bills.includesEstimates")}</div> : null;

  // Cards: each bill's current occurrence, unpaid ones first in due-date order.
  const cards = c.bills
    .map((bill) => ({ bill, view: currentOccurrence(bill, c.occurrences, todayISO) }))
    .filter((x): x is { bill: Bill; view: OccurrenceView } => x.view !== null)
    .sort((a, b) => {
      const ap = a.view.status === "paid" ? 1 : 0;
      const bp = b.view.status === "paid" ? 1 : 0;
      return ap - bp || a.view.dueDate.localeCompare(b.view.dueDate) || a.bill.name.localeCompare(b.bill.name);
    });

  async function submitForm(payload: BillFormPayload): Promise<string | null> {
    if (formFor === "new") {
      const err = await c.create(payload);
      if (!err) setFormFor(null);
      return err;
    }
    if (formFor) {
      const patch: Partial<BillFormPayload> = {};
      (Object.keys(payload) as (keyof BillFormPayload)[]).forEach((k) => {
        if (payload[k] !== formFor[k as keyof Bill]) (patch as Record<string, unknown>)[k] = payload[k];
      });
      if (Object.keys(patch).length === 0) {
        setFormFor(null); // nothing changed -- no write
        return null;
      }
      const err = await c.update(formFor, patch);
      if (!err) setFormFor(null);
      return err;
    }
    return null;
  }

  const statusChip = (v: OccurrenceView) => {
    switch (statusLabel(v)) {
      case "paid":
        return t("bills.statusPaid");
      case "overdue":
        return t("bills.statusOverdue");
      case "pending":
        return t("bills.amountPending");
      case "partial":
        return t("bills.statusPartial");
      default:
        return t("bills.dueOn", { date: formatDateDisplay(v.dueDate) });
    }
  };
  /** A predefined category is shown in the current language; anything else (custom or legacy text) exactly as saved. */
  const categoryLabel = (stored: string): string => (isPredefinedCategory(stored) ? t(CATEGORY_KEY[stored]) : stored);
  /** Chip colour: pending needs attention (amber), overdue red, paid teal, otherwise by how soon. */
  const chipTier = (v: OccurrenceView) => {
    const l = statusLabel(v);
    return l === "overdue" ? "today" : l === "paid" ? "paid" : l === "pending" ? "soon" : v.tier;
  };
  /** Recorded payments, kept separate from the amount due. */
  const paymentsLine = (v: OccurrenceView): string | null => {
    if (v.paid <= 0) return null;
    if (v.amountDue === null) return t("bills.recordedPayments", { paid: formatCurrency(v.paid) });
    if (v.paid > v.amountDue) return t("bills.paidOver", { paid: formatCurrency(v.paid), over: formatCurrency(v.paid - v.amountDue) });
    if (v.outstanding !== null && v.outstanding > 0) return t("bills.paidLeft", { paid: formatCurrency(v.paid), left: formatCurrency(v.outstanding) });
    return t("bills.paidSoFar", { paid: formatCurrency(v.paid) });
  };

  return (
    <div className="pay-panel bills-panel">
      <div className="fin-section-head">
        <h3 className="text-lg font-bold">{t("bills.title")}</h3>
        <p className="text-sm text-white/70">{t("bills.subtitle")}</p>
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
        {t("bills.add")}
      </button>

      {c.state === "unavailable" && (
        <div role="status" className="pay-error pay-error-page" data-testid="bills-unavailable">
          {t("bills.unavailable")}
        </div>
      )}
      {c.state === "error" && (
        <div role="alert" className="pay-error pay-error-page">
          {c.loadError ?? t("bills.failed")}
        </div>
      )}
      {notice && (
        <div role="status" className="pay-notice">
          {notice}
        </div>
      )}

      {available && (
        <section className="pay-summary fin-overview bill-summary" aria-label={t("bills.summary")}>
          <div className="pay-stat" data-kind="balance">
            <div className="pay-stat-label">{t("bills.expectedThisMonth")}</div>
            <div className="pay-stat-value" style={valueLenStyle(dueDisplay.allPending ? "" : expectedText) as React.CSSProperties} data-pending={dueDisplay.allPending ? "true" : undefined} data-testid="bills-expected">
              {dueDisplay.allPending ? t("bills.amountPendingShort") : expectedText}
            </div>
            {estimateNote}
            {dueDisplay.knownOnly && <div className="bill-stat-note">{t("bills.knownOnly")}</div>}
            {dueDisplay.awaiting > 0 && (
              <div className="bill-stat-note" data-testid="bills-unknown">
                {dueDisplay.awaiting === 1 ? t("bills.awaitingOne") : t("bills.awaitingMany", { count: dueDisplay.awaiting })}
              </div>
            )}
          </div>
          <div className="pay-stat" data-kind="paid">
            <div className="pay-stat-label">{t("bills.paidThisMonth")}</div>
            <div className="pay-stat-value" style={valueLenStyle(paidText) as React.CSSProperties} data-testid="bills-paid">
              {paidText}
            </div>
          </div>
          <div className="pay-stat" data-kind="remaining">
            <div className="pay-stat-label">{t("bills.remainingThisMonth")}</div>
            <div className="pay-stat-value" style={valueLenStyle(dueDisplay.allPending ? "" : remainingText) as React.CSSProperties} data-pending={dueDisplay.allPending ? "true" : undefined} data-testid="bills-remaining">
              {dueDisplay.allPending ? t("bills.amountPendingShort") : remainingText}
            </div>
            {estimateNote}
          </div>
          <div className="pay-stat" data-kind="minimums">
            <div className="pay-stat-label">{t("bills.upcoming")}</div>
            <div className="pay-stat-value" style={valueLenStyle(String(summary.upcoming)) as React.CSSProperties} data-testid="bills-upcoming">
              {summary.upcoming}
            </div>
          </div>
          <div className="pay-stat" data-kind="overdue">
            <div className="pay-stat-label">{t("bills.overdue")}</div>
            <div className="pay-stat-value" style={valueLenStyle(String(summary.overdue)) as React.CSSProperties} data-testid="bills-overdue">
              {summary.overdue}
            </div>
          </div>
        </section>
      )}

      {available && <h3 className="pay-section-title">{t("bills.sectionTitle")}</h3>}

      {c.state === "loading" ? (
        <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>
      ) : available && cards.length === 0 ? (
        <p className="text-sm text-white/50 italic">{t("bills.empty")}</p>
      ) : (
        available && (
          <ul className="pay-list bill-list">
            {cards.map(({ bill, view }) => {
              const moreOpen = moreOpenId === bill.id;
              const historyOpen = c.historyOpenId === bill.id;
              const records = c.history[bill.id] ?? [];
              const amountLine =
                view.amountDue !== null
                  ? t("bills.amountDue", { amount: formatCurrency(view.amountDue) })
                  : view.estimate !== null
                  ? t("bills.estimated", { amount: formatCurrency(view.estimate) })
                  : t("bills.amountNotEntered");
              return (
                <li key={bill.id} className="pay-card bill-card" data-testid="bill-card" data-tier={view.tier}>
                  <div className="pay-card-head">
                    <div className="bill-title">
                      <h3 className="pay-card-name">{bill.name}</h3>
                      {bill.category && <span className="bill-category">{categoryLabel(bill.category)}</span>}
                    </div>
                    <span className="pay-due bill-chip" data-tier={chipTier(view)}>
                      {statusChip(view)}
                    </span>
                  </div>

                  <div className="bill-info">
                    <div className="bill-info-row">
                      <span className="bill-amount">{amountLine}</span>
                      <span className="bill-recur">{t(RECUR_KEY[bill.recurrence])}</span>
                    </div>
                    <div className="bill-info-row">
                      <span className="bill-due">{t("bills.dueOn", { date: formatDateDisplay(view.dueDate) })}</span>
                      {view.amountDue === null && bill.amountType === "variable" && (
                        <button type="button" className="bill-link-btn" onClick={() => setAmountFor({ bill, view })} aria-label={`${t("bills.setAmount")} ${bill.name}`}>
                          {t("bills.setAmount")}
                        </button>
                      )}
                    </div>
                    {paymentsLine(view) && (
                      <div className="bill-info-row">
                        <span className="bill-paid">{paymentsLine(view)}</span>
                      </div>
                    )}
                  </div>
                  {view.amountDue !== null && view.amountDue > 0 && <Segments paid={view.paid} due={view.amountDue} />}

                  <div className="pay-card-actions">
                    <button
                      type="button"
                      className="btn standup-metal-btn standup-metal-btn--accent pay-action-btn pay-action-wide"
                      onClick={() => {
                        setNotice(null);
                        setRecordFor({ bill, view });
                      }}
                      aria-label={`${t("bills.recordPayment")} ${bill.name}`}
                    >
                      <Receipt size={14} aria-hidden="true" />
                      {t("bills.recordPayment")}
                    </button>
                    <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => c.toggleHistory(bill)} aria-expanded={historyOpen} aria-label={`${t("bills.history")} ${bill.name}`}>
                      <History size={14} aria-hidden="true" />
                      {t("bills.history")}
                    </button>
                    <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => setFormFor(bill)} aria-label={`${t("bills.edit")} ${bill.name}`}>
                      <Pencil size={14} aria-hidden="true" />
                      {t("bills.edit")}
                    </button>
                    <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => setMoreOpenId(moreOpen ? null : bill.id)} aria-expanded={moreOpen} aria-label={`${t("bills.more")} ${bill.name}`}>
                      <MoreHorizontal size={16} aria-hidden="true" />
                      {t("bills.more")}
                    </button>
                  </div>

                  {moreOpen && (
                    <div className="pay-more" role="group" aria-label={`${t("bills.more")} ${bill.name}`}>
                      {bill.amountType === "variable" && view.amountDue !== null && (
                        <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => setAmountFor({ bill, view })}>
                          {t("bills.setAmount")}
                        </button>
                      )}
                      <button type="button" className="btn standup-metal-btn standup-metal-btn--danger pay-action-btn" onClick={() => setRemoving(bill)}>
                        <Trash2 size={14} aria-hidden="true" />
                        {t("bills.remove")}
                      </button>
                    </div>
                  )}

                  {historyOpen && (
                    <div className="pay-history" data-testid="bill-history">
                      {c.historyLoading && !c.history[bill.id] ? (
                        <p className="text-xs text-white/50">{t("backlog.paymentHistoryLoading")}</p>
                      ) : records.length === 0 ? (
                        <p className="text-xs text-white/50 italic">{t("bills.historyEmpty")}</p>
                      ) : (
                        <ul className="pay-history-list">
                          {records.map((rec) => {
                            const v = resolveOccurrence(bill, rec.dueDate, rec, todayISO);
                            return (
                              <li key={rec.id} className="bill-cycle" data-status={v.status}>
                                <div className="bill-cycle-head">
                                  <span className="pay-txn-amount">{formatDateDisplay(rec.dueDate)}</span>
                                  <span className="pay-txn-badge">{statusChip(v)}</span>
                                </div>
                                <div className="pay-txn-date">
                                  {v.amountDue === null ? t("bills.amountPending") : t("bills.amountDue", { amount: formatCurrency(v.amountDue) })}
                                  {" · "}
                                  {t("bills.historyPaid")} {formatCurrency(v.paid)}
                                  {v.outstanding !== null && (
                                    <>
                                      {" · "}
                                      {t("bills.historyOutstanding")} {formatCurrency(v.outstanding)}
                                    </>
                                  )}
                                </div>
                                <ul className="pay-history-list" style={{ marginTop: 6 }}>
                                  {rec.payments.map((p) => {
                                    const d = formatDateDisplay(new Date(p.paidAt).toISOString().slice(0, 10));
                                    return (
                                      <li key={p.id} className="pay-txn" data-reversed={!!p.reversedAt}>
                                        <div className="pay-txn-main">
                                          <span className="pay-txn-amount">{formatCurrency(p.amount)}</span>
                                          <span className="pay-txn-date">{d}</span>
                                          {p.reversedAt && <span className="pay-txn-badge">{t("pay.reversedBadge")}</span>}
                                        </div>
                                        {p.note && <p className="pay-txn-note">{p.note}</p>}
                                        {!p.reversedAt && (
                                          <button
                                            type="button"
                                            className="btn standup-metal-btn pay-txn-reverse"
                                            onClick={() => setReversing({ bill, paymentId: p.id, amount: p.amount, date: d })}
                                            aria-label={`${t("bills.reverse")} ${formatCurrency(p.amount)} ${d}`}
                                          >
                                            {t("bills.reverse")}
                                          </button>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </li>
                            );
                          })}
                        </ul>
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
        <BillFormModal
          key={formFor === "new" ? "new" : formFor.id}
          bill={formFor === "new" ? null : formFor}
          todayISO={todayISO}
          onCancel={() => setFormFor(null)}
          onSubmit={submitForm}
        />
      )}
      {recordFor && (
        <RecordBillPaymentModal
          key={`${recordFor.bill.id}-${recordFor.view.dueDate}`}
          bill={recordFor.bill}
          view={recordFor.view}
          todayISO={todayISO}
          onCancel={() => setRecordFor(null)}
          onSubmit={async (payload, clientKey) => {
            const err = await c.recordPayment(recordFor.bill, recordFor.view.dueDate, payload, clientKey);
            if (!err) {
              setRecordFor(null);
              setNotice(t("bills.recorded"));
            }
            return err;
          }}
        />
      )}
      {amountFor && (
        <SetAmountModal
          bill={amountFor.bill}
          view={amountFor.view}
          onCancel={() => setAmountFor(null)}
          onSubmit={async (amount) => {
            const err = await c.setAmount(amountFor.bill, amountFor.view.dueDate, amount);
            if (!err) {
              setAmountFor(null);
              setMoreOpenId(null);
            }
            return err;
          }}
        />
      )}
      {removing && (
        <ConfirmActionModal
          title={t("bills.removeTitle")}
          body={t("bills.removeBody", { name: removing.name })}
          confirmLabel={t("bills.removeConfirm")}
          busyLabel={t("pay.removing")}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const err = await c.archive(removing);
            if (!err) {
              setRemoving(null);
              setMoreOpenId(null);
            }
            return err;
          }}
        />
      )}
      {reversing && (
        <ConfirmActionModal
          title={t("bills.reverseTitle")}
          body={t("bills.reverseBody", { amount: formatCurrency(reversing.amount), date: reversing.date })}
          confirmLabel={t("pay.reverseConfirm")}
          busyLabel={t("pay.reversing")}
          onCancel={() => setReversing(null)}
          onConfirm={async () => {
            const err = await c.reversePayment(reversing.bill, reversing.paymentId);
            if (!err) {
              setReversing(null);
              setNotice(t("bills.reversedDone"));
            }
            return err;
          }}
        />
      )}
    </div>
  );
}

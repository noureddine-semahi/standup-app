"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, History, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatDateDisplay, toISODate, type PaymentAccount, type PaymentTransaction } from "@/lib/supabase/db";
import { formatCurrency } from "@/lib/salary";
import {
  EMPTY_PAYMENT_FORM,
  diffPaymentPayload,
  getPaymentDueInfo,
  parsePaymentEntry,
  parsePaymentForm,
  paymentToFormValues,
  previewBalanceAfter,
  type BalanceMode,
  type PaymentEntryPayload,
  type PaymentEntryValues,
  type PaymentFormPayload,
  type PaymentFormValues,
} from "@/lib/paymentSummary";

// Presentation + form layer for Finances -> Payments. All data work stays in
// the page's handlers; each callback resolves to an error message, or null on
// success, so a failed save keeps its modal open with the message shown.
export type PaymentsDashboardProps = {
  accounts: PaymentAccount[];
  loading: boolean;
  message: string | null;
  todayISO: string;
  busyIds: ReadonlySet<string>;
  onCreate: (payload: PaymentFormPayload) => Promise<string | null>;
  onUpdate: (account: PaymentAccount, patch: Partial<PaymentFormPayload>) => Promise<string | null>;
  onDelete: (account: PaymentAccount) => Promise<string | null>;
  /** `clientKey` is stable for one open modal, so a repeated tap or retry can never pay twice. */
  onRecordPayment: (account: PaymentAccount, payload: PaymentEntryPayload, clientKey: string) => Promise<string | null>;
  onReversePayment: (account: PaymentAccount, txn: PaymentTransaction) => Promise<string | null>;
  historyOpenId: string | null;
  historyLoadingId: string | null;
  historyByAccount: Record<string, PaymentTransaction[]>;
  onToggleHistory: (account: PaymentAccount) => void;
};

export const FIELD_CLASS =
  "pay-input w-full min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40";

export function newClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for very old webviews: still unique enough for an idempotency key.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Shared dialog behaviour: Escape closes, Tab stays inside, focus returns to the opener. */
export function useDialog(dialogRef: React.RefObject<HTMLDivElement | null>, onClose: () => void, locked: boolean) {
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  // Keep the latest callbacks without re-binding the key listener.
  useEffect(() => {
    closeRef.current = onClose;
    lockedRef.current = locked;
  });

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !lockedRef.current) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>("button, input, textarea, [href], select, [tabindex]:not([tabindex='-1'])")
      ).filter((el) => !(el as HTMLButtonElement).disabled);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      returnTo?.focus?.();
    };
  }, [dialogRef]);
}

function PaymentFormModal({
  account,
  onCancel,
  onSubmit,
}: {
  account: PaymentAccount | null;
  onCancel: () => void;
  onSubmit: (payload: PaymentFormPayload) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [values, setValues] = useState<PaymentFormValues>(() => (account ? paymentToFormValues(account) : EMPTY_PAYMENT_FORM));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, saving);

  const payload = parsePaymentForm(values);
  const set = (k: Exclude<keyof PaymentFormValues, "balanceMode">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const setMode = (m: BalanceMode) => setValues((v) => ({ ...v, balanceMode: m }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!payload || saving) return;
    setSaving(true);
    setError(null);
    const err = await onSubmit(payload);
    if (err) {
      setError(err);
      setSaving(false);
    }
    // On success the parent unmounts this modal.
  }

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-form-title">
        <h2 id="pay-form-title" className="pay-modal-title">
          {account ? t("pay.editTitle") : t("pay.addTitle")}
        </h2>
        <form onSubmit={submit} noValidate>
          <div className="pay-form-grid">
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("pay.fieldName")}</span>
              <input
                type="text"
                autoFocus
                autoComplete="off"
                value={values.name}
                onChange={set("name")}
                placeholder={t("backlog.paymentNamePlaceholder")}
                disabled={saving}
                className={FIELD_CLASS}
              />
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("backlog.paymentBalanceLabel")}</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={values.balance}
                onChange={set("balance")}
                placeholder="0.00"
                disabled={saving}
                className={FIELD_CLASS}
              />
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("backlog.paymentMinimumLabel")}</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={values.minimumPayment}
                onChange={set("minimumPayment")}
                placeholder="0.00"
                disabled={saving}
                className={FIELD_CLASS}
              />
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("backlog.paymentDueDayLabel")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={values.dueDay}
                onChange={set("dueDay")}
                placeholder="1-31"
                disabled={saving}
                className={FIELD_CLASS}
              />
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("backlog.paymentRemindLabel")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={values.remindDaysBefore}
                onChange={set("remindDaysBefore")}
                disabled={saving}
                className={FIELD_CLASS}
              />
            </label>
            <div className="pay-field pay-field-wide">
              <span className="pay-label" id="pay-mode-label">{t("pay.balanceTracking")}</span>
              <div className="pay-seg" role="group" aria-labelledby="pay-mode-label">
                {(["manual", "auto"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="btn goal-toolbar-btn salary-basis-btn pay-seg-btn"
                    aria-pressed={values.balanceMode === m}
                    disabled={saving}
                    onClick={() => setMode(m)}
                  >
                    {m === "auto" ? t("pay.modeAuto") : t("pay.modeManual")}
                  </button>
                ))}
              </div>
              <p className="pay-help">{values.balanceMode === "auto" ? t("pay.modeAutoHelp") : t("pay.modeManualHelp")}</p>
            </div>
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
            <button type="submit" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" disabled={saving || !payload}>
              {saving ? t("pay.saving") : t("pay.save")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

const ENTRY_ERROR_KEY = {
  amount: "pay.errAmount",
  amountPrecision: "pay.errAmountPrecision",
  date: "pay.errDate",
  dateFuture: "pay.errDateFuture",
  note: "pay.errNote",
} as const;

function RecordPaymentModal({
  account,
  todayISO,
  onCancel,
  onSubmit,
}: {
  account: PaymentAccount;
  todayISO: string;
  onCancel: () => void;
  onSubmit: (payload: PaymentEntryPayload, clientKey: string) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [values, setValues] = useState<PaymentEntryValues>({ amount: "", date: todayISO, note: "", applyBalance: false });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // One key per open modal: every submit from this modal is the same intent.
  const [clientKey] = useState(newClientKey);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, saving);

  const isAuto = account.balanceMode === "auto";
  const parsed = parsePaymentEntry({ ...values, applyBalance: isAuto || values.applyBalance }, todayISO);
  const fieldError = !parsed.ok && (touched || values.amount.trim() !== "" || values.date !== todayISO) ? parsed.error : null;
  const willReduce = isAuto || values.applyBalance;
  const preview = parsed.ok && willReduce ? previewBalanceAfter(account.balance, parsed.payload.amount) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    // The ref blocks a second tap in the same tick, before `saving` re-renders.
    if (!parsed.ok || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const err = await onSubmit(parsed.payload, clientKey);
    if (err) {
      setError(err);
      savingRef.current = false;
      setSaving(false);
    }
  }

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-record-title">
        <h2 id="pay-record-title" className="pay-modal-title">
          {t("pay.recordTitle")}
        </h2>
        <p className="pay-modal-sub">{account.name}</p>
        <form onSubmit={submit} noValidate>
          <div className="pay-form-grid">
            <label className="pay-field">
              <span className="pay-label">{t("pay.amount")}</span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                autoComplete="off"
                value={values.amount}
                onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))}
                placeholder="0.00"
                disabled={saving}
                aria-invalid={fieldError === "amount" || fieldError === "amountPrecision"}
                className={FIELD_CLASS}
              />
            </label>
            <label className="pay-field">
              <span className="pay-label">{t("pay.date")}</span>
              <input
                type="date"
                max={todayISO}
                value={values.date}
                onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
                disabled={saving}
                aria-invalid={fieldError === "date" || fieldError === "dateFuture"}
                className={FIELD_CLASS}
              />
            </label>
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("pay.note")}</span>
              <input
                type="text"
                autoComplete="off"
                value={values.note}
                onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
                disabled={saving}
                className={FIELD_CLASS}
              />
            </label>
          </div>

          {fieldError && <p className="pay-field-error" role="alert">{t(ENTRY_ERROR_KEY[fieldError])}</p>}

          {isAuto ? (
            <p className="pay-help">{t("pay.autoBalanceNote")}</p>
          ) : (
            <>
              <label className="pay-check">
                <input
                  type="checkbox"
                  checked={values.applyBalance}
                  onChange={(e) => setValues((v) => ({ ...v, applyBalance: e.target.checked }))}
                  disabled={saving}
                />
                <span>{t("pay.applyBalance")}</span>
              </label>
              {!values.applyBalance && <p className="pay-help">{t("pay.manualBalanceNote")}</p>}
            </>
          )}
          {preview !== null && <p className="pay-preview">{t("pay.balanceAfter", { amount: formatCurrency(preview) })}</p>}

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
              {saving ? t("pay.recording") : t("pay.recordSave")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

/** Destructive-style confirmation used for Remove account and Reverse payment. */
export function ConfirmActionModal({
  title,
  body,
  confirmLabel,
  busyLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialog(dialogRef, onCancel, busy);
  useEffect(() => cancelRef.current?.focus(), []);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const err = await onConfirm();
    if (err) {
      setError(err);
      busyRef.current = false;
      setBusy(false);
    }
  }

  return createPortal(
    <div className="confirm-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div
        ref={dialogRef}
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pay-confirm-title"
        aria-describedby="pay-confirm-body"
      >
        <div className="confirm-modal-icon" aria-hidden="true">
          <AlertTriangle size={22} strokeWidth={2.4} />
        </div>
        <h2 id="pay-confirm-title" className="confirm-modal-title">
          {title}
        </h2>
        <p id="pay-confirm-body" className="confirm-modal-body">
          {body}
        </p>
        {error && (
          <div role="alert" className="pay-error">
            {error}
          </div>
        )}
        <div className="confirm-modal-actions">
          <button ref={cancelRef} type="button" className="btn standup-metal-btn confirm-modal-btn" onClick={onCancel} disabled={busy}>
            {t("pay.cancel")}
          </button>
          <button
            type="button"
            className="btn standup-metal-btn standup-metal-btn--danger confirm-modal-btn"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function PaymentsDashboard({
  accounts,
  loading,
  message,
  todayISO,
  busyIds,
  onCreate,
  onUpdate,
  onDelete,
  onRecordPayment,
  onReversePayment,
  historyOpenId,
  historyLoadingId,
  historyByAccount,
  onToggleHistory,
}: PaymentsDashboardProps) {
  const { t } = useLanguage();
  const [formFor, setFormFor] = useState<"new" | PaymentAccount | null>(null);
  const [removing, setRemoving] = useState<PaymentAccount | null>(null);
  const [recordingFor, setRecordingFor] = useState<PaymentAccount | null>(null);
  const [reversing, setReversing] = useState<{ account: PaymentAccount; txn: PaymentTransaction } | null>(null);
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submitForm(payload: PaymentFormPayload): Promise<string | null> {
    if (formFor === "new") {
      const err = await onCreate(payload);
      if (!err) setFormFor(null);
      return err;
    }
    if (formFor) {
      const patch = diffPaymentPayload(formFor, payload);
      if (Object.keys(patch).length === 0) {
        setFormFor(null); // nothing changed -- no write
        return null;
      }
      const err = await onUpdate(formFor, patch);
      if (!err) setFormFor(null);
      return err;
    }
    return null;
  }

  const txnDate = (txn: PaymentTransaction) => formatDateDisplay(toISODate(new Date(txn.paidAt)));

  return (
    <div className="pay-panel">
      <button
        type="button"
        className="btn standup-metal-btn standup-metal-btn--accent pay-add-btn"
        onClick={() => {
          setNotice(null);
          setFormFor("new");
        }}
      >
        <Plus size={16} aria-hidden="true" />
        {t("backlog.addPayment").replace(/^\+\s*/, "")}
      </button>

      {message && (
        <div role="alert" className="pay-error pay-error-page">
          {message}
        </div>
      )}
      {notice && (
        <div role="status" className="pay-notice">
          {notice}
        </div>
      )}

      <h3 className="pay-section-title">{t("pay.upcoming")}</h3>

      {loading ? (
        <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-white/50 italic">{t("backlog.noPaymentsYet")}</p>
      ) : (
        <ul className="pay-list">
          {accounts.map((account) => {
            const due = getPaymentDueInfo(account, todayISO);
            const busy = busyIds.has(account.id);
            const moreOpen = moreOpenId === account.id;
            const historyOpen = historyOpenId === account.id;
            const history = historyByAccount[account.id] ?? [];
            return (
              <li key={account.id} className="pay-card" data-testid="pay-card">
                <div className="pay-card-head">
                  <h3 className="pay-card-name">{account.name}</h3>
                  <span className="pay-due" data-tier={due.tier}>
                    {due.tier === "today" ? t("backlog.paymentDueToday") : t("backlog.paymentDueOn", { date: formatDateDisplay(due.dueDate) })}
                  </span>
                </div>

                <dl className="pay-rows">
                  <div className="pay-row">
                    <dt>{t("backlog.paymentBalanceLabel")}</dt>
                    <dd>{formatCurrency(account.balance)}</dd>
                  </div>
                  <div className="pay-row">
                    <dt>{t("backlog.paymentMinimumLabel")}</dt>
                    <dd>{formatCurrency(account.minimumPayment)}</dd>
                  </div>
                </dl>
                <p className="pay-tag" data-mode={account.balanceMode}>
                  {account.balanceMode === "auto" ? t("pay.tagAuto") : t("pay.tagManual")}
                </p>

                <div className="pay-card-actions">
                  <button
                    type="button"
                    className="btn standup-metal-btn standup-metal-btn--accent pay-action-btn pay-action-wide"
                    onClick={() => {
                      setNotice(null);
                      setRecordingFor(account);
                    }}
                    disabled={busy}
                    aria-label={`${t("pay.recordPayment")} ${account.name}`}
                  >
                    <Receipt size={14} aria-hidden="true" />
                    {t("pay.recordPayment")}
                  </button>
                  <button
                    type="button"
                    className="btn standup-metal-btn pay-action-btn"
                    onClick={() => onToggleHistory(account)}
                    aria-expanded={historyOpen}
                    aria-label={`${t("pay.history")} ${account.name}`}
                  >
                    <History size={14} aria-hidden="true" />
                    {t("pay.history")}
                  </button>
                  <button
                    type="button"
                    className="btn standup-metal-btn pay-action-btn"
                    onClick={() => setFormFor(account)}
                    disabled={busy}
                    aria-label={`${t("pay.edit")} ${account.name}`}
                  >
                    <Pencil size={14} aria-hidden="true" />
                    {t("pay.edit")}
                  </button>
                  <button
                    type="button"
                    className="btn standup-metal-btn pay-action-btn"
                    onClick={() => setMoreOpenId(moreOpen ? null : account.id)}
                    aria-expanded={moreOpen}
                    aria-label={`${t("pay.more")} ${account.name}`}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                    {t("pay.more")}
                  </button>
                </div>

                {moreOpen && (
                  <div className="pay-more" role="group" aria-label={`${t("pay.more")} ${account.name}`}>
                    <button
                      type="button"
                      className="btn standup-metal-btn standup-metal-btn--danger pay-action-btn"
                      onClick={() => setRemoving(account)}
                      disabled={busy}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {t("pay.remove")}
                    </button>
                  </div>
                )}

                {historyOpen && (
                  <div className="pay-history" data-testid="pay-history">
                    {historyLoadingId === account.id ? (
                      <p className="text-xs text-white/50">{t("backlog.paymentHistoryLoading")}</p>
                    ) : history.length === 0 ? (
                      <p className="text-xs text-white/50 italic">{t("backlog.paymentHistoryEmpty")}</p>
                    ) : (
                      <ul className="pay-history-list">
                        {history.map((txn) => (
                          <li key={txn.id} className="pay-txn" data-reversed={!!txn.reversedAt}>
                            <div className="pay-txn-main">
                              <span className="pay-txn-amount">{formatCurrency(txn.amount)}</span>
                              <span className="pay-txn-date">{txnDate(txn)}</span>
                              {txn.reversedAt && <span className="pay-txn-badge">{t("pay.reversedBadge")}</span>}
                            </div>
                            {txn.note && <p className="pay-txn-note">{txn.note}</p>}
                            {!txn.reversedAt && (
                              <button
                                type="button"
                                className="btn standup-metal-btn pay-txn-reverse"
                                onClick={() => setReversing({ account, txn })}
                                aria-label={`${t("pay.reverse")} ${formatCurrency(txn.amount)} ${txnDate(txn)}`}
                              >
                                {t("pay.reverse")}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="pay-note">{t("backlog.paymentsSubtitle")}</p>

      {formFor && (
        <PaymentFormModal
          key={formFor === "new" ? "new" : formFor.id}
          account={formFor === "new" ? null : formFor}
          onCancel={() => setFormFor(null)}
          onSubmit={submitForm}
        />
      )}
      {recordingFor && (
        <RecordPaymentModal
          key={recordingFor.id}
          // Always the live record, so the balance preview reflects the latest value.
          account={accounts.find((a) => a.id === recordingFor.id) ?? recordingFor}
          todayISO={todayISO}
          onCancel={() => setRecordingFor(null)}
          onSubmit={async (payload, clientKey) => {
            const err = await onRecordPayment(recordingFor, payload, clientKey);
            if (!err) {
              setRecordingFor(null);
              setNotice(t("pay.recorded"));
            }
            return err;
          }}
        />
      )}
      {removing && (
        <ConfirmActionModal
          title={t("pay.removeTitle")}
          body={t("pay.removeBody", { name: removing.name })}
          confirmLabel={t("pay.removeConfirm")}
          busyLabel={t("pay.removing")}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const err = await onDelete(removing);
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
          title={t("pay.reverseTitle")}
          body={t(reversing.txn.balanceApplied ? "pay.reverseBodyApplied" : "pay.reverseBodyNotApplied", {
            amount: formatCurrency(reversing.txn.amount),
            date: txnDate(reversing.txn),
          })}
          confirmLabel={t("pay.reverseConfirm")}
          busyLabel={t("pay.reversing")}
          onCancel={() => setReversing(null)}
          onConfirm={async () => {
            const err = await onReversePayment(reversing.account, reversing.txn);
            if (!err) {
              setReversing(null);
              setNotice(t("pay.reversedDone"));
            }
            return err;
          }}
        />
      )}
    </div>
  );
}

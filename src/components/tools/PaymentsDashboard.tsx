"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, History, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatDateDisplay, formatDateTimeDisplay, type PaymentAccount, type PaymentTransaction } from "@/lib/supabase/db";
import { formatCurrency } from "@/lib/salary";
import {
  EMPTY_PAYMENT_FORM,
  diffPaymentPayload,
  getPaymentDueInfo,
  parsePaymentForm,
  paymentToFormValues,
  summarizePayments,
  type PaymentFormPayload,
  type PaymentFormValues,
} from "@/lib/paymentSummary";

// Presentation layer for Tools -> Payments. All data work stays in the page's
// existing handlers (createPaymentAccount / updatePaymentAccount /
// deletePaymentAccount); each callback resolves to an error message, or null
// on success, so a failed save keeps its modal open with the message shown.
export type PaymentsDashboardProps = {
  accounts: PaymentAccount[];
  loading: boolean;
  message: string | null;
  todayISO: string;
  busyIds: ReadonlySet<string>;
  onCreate: (payload: PaymentFormPayload) => Promise<string | null>;
  onUpdate: (account: PaymentAccount, patch: Partial<PaymentFormPayload>) => Promise<string | null>;
  onDelete: (account: PaymentAccount) => Promise<string | null>;
  historyOpenId: string | null;
  historyLoadingId: string | null;
  historyByAccount: Record<string, PaymentTransaction[]>;
  onToggleHistory: (account: PaymentAccount) => void;
};

const FIELD_CLASS =
  "pay-input w-full min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white placeholder:text-white/40 outline-none focus:border-white/40";

/** Shared dialog behaviour: Escape closes, Tab stays inside, focus returns to the opener. */
function useDialog(dialogRef: React.RefObject<HTMLDivElement | null>, onClose: () => void, locked: boolean) {
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
        dialogRef.current.querySelectorAll<HTMLElement>("button, input, [href], select, textarea, [tabindex]:not([tabindex='-1'])")
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
  const set = (k: keyof PaymentFormValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

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

function RemoveAccountModal({
  account,
  onCancel,
  onConfirm,
}: {
  account: PaymentAccount;
  onCancel: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialog(dialogRef, onCancel, busy);
  useEffect(() => cancelRef.current?.focus(), []);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onConfirm();
    if (err) {
      setError(err);
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
        aria-labelledby="pay-remove-title"
        aria-describedby="pay-remove-body"
      >
        <div className="confirm-modal-icon" aria-hidden="true">
          <AlertTriangle size={22} strokeWidth={2.4} />
        </div>
        <h2 id="pay-remove-title" className="confirm-modal-title">
          {t("pay.removeTitle")}
        </h2>
        <p id="pay-remove-body" className="confirm-modal-body">
          {t("pay.removeBody", { name: account.name })}
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
            {busy ? t("pay.removing") : t("pay.removeConfirm")}
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
  historyOpenId,
  historyLoadingId,
  historyByAccount,
  onToggleHistory,
}: PaymentsDashboardProps) {
  const { t } = useLanguage();
  const [formFor, setFormFor] = useState<"new" | PaymentAccount | null>(null);
  const [removing, setRemoving] = useState<PaymentAccount | null>(null);
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);

  const summary = summarizePayments(accounts);
  const balanceText = formatCurrency(summary.totalBalance);
  const minimumsText = formatCurrency(summary.monthlyMinimums);
  // Both panels step down together so the two figures stay visually matched.
  const longValues = balanceText.length > 10 || minimumsText.length > 10;

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

  return (
    <div className="card card-highlight pay-root">
      <div className="pay-head">
        <div>
          <h2 className="text-xl font-bold mb-1">{t("pay.title")}</h2>
          <p className="text-sm text-white/70">{t("pay.subtitle")}</p>
        </div>
      </div>

      <button
        type="button"
        className="btn standup-metal-btn standup-metal-btn--accent pay-add-btn"
        onClick={() => setFormFor("new")}
      >
        <Plus size={16} aria-hidden="true" />
        {t("backlog.addPayment").replace(/^\+\s*/, "")}
      </button>

      {message && (
        <div role="alert" className="pay-error pay-error-page">
          {message}
        </div>
      )}

      <section className="pay-summary" aria-label={t("pay.summary")}>
        <div className="pay-stat" data-kind="balance">
          <div className="pay-stat-label">{t("pay.totalBalance")}</div>
          <div className="pay-stat-value" data-long={longValues} data-testid="pay-total-balance">
            {balanceText}
          </div>
        </div>
        <div className="pay-stat" data-kind="minimums">
          <div className="pay-stat-label">{t("pay.monthlyMinimums")}</div>
          <div className="pay-stat-value" data-long={longValues} data-testid="pay-monthly-minimums">
            {minimumsText}
          </div>
        </div>
      </section>

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

                <div className="pay-card-actions">
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
                      className="btn standup-metal-btn pay-action-btn"
                      onClick={() => onToggleHistory(account)}
                      aria-pressed={historyOpen}
                    >
                      <History size={14} aria-hidden="true" />
                      {t("backlog.paymentHistoryToggle")}
                    </button>
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
                  <div className="pay-history">
                    {historyLoadingId === account.id ? (
                      <p className="text-xs text-white/50">{t("backlog.paymentHistoryLoading")}</p>
                    ) : (historyByAccount[account.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-white/50 italic">{t("backlog.paymentHistoryEmpty")}</p>
                    ) : (
                      <div className="space-y-1">
                        {historyByAccount[account.id].map((txn) => (
                          <div key={txn.id} className="flex items-center justify-between gap-3 text-xs text-white/70">
                            <span>{formatDateTimeDisplay(txn.paidAt)}</span>
                            <span className="font-medium">{formatCurrency(txn.amount)}</span>
                          </div>
                        ))}
                      </div>
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
      {removing && (
        <RemoveAccountModal
          account={removing}
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
    </div>
  );
}

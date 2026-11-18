"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, History, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatDateDisplay, toISODate, type AccountEntry, type OpeningCheckpointState, type PaymentAccount, type PaymentTransaction, type ReconciliationResult } from "@/lib/supabase/db";
import { formatCurrency } from "@/lib/salary";
import {
  EMPTY_PAYMENT_FORM,
  buildHistoryItems,
  diffPaymentPayload,
  getPaymentDueInfo,
  parsePaymentEntry,
  parsePaymentForm,
  paymentToFormValues,
  previewBalanceAfter,
  toCents,
  type BalanceMode,
  type PaymentEntryPayload,
  type PaymentEntryValues,
  type PaymentFormPayload,
  type PaymentFormValues,
} from "@/lib/paymentSummary";

// Presentation + form layer for Finances -> Payments. All data work stays in
// the page's handlers; each callback resolves to an error message, or null on
// success, so a failed save keeps its modal open with the message shown.
/** What the opening-checkpoint dialog sends: the balance and ledger version it SHOWED the user, the user's as-of date and optional note, and a key stable for one open dialog. */
export type OpeningCheckpointInput = { confirmedBalance: number; expectedLedgerVersion: number; statementDate: string; note: string | null; clientKey: string };
/** 'stale' = the account changed since the dialog loaded it; 'exists' = it already has a checkpoint; 'other' = anything else (the message is shown as is). */
export type OpeningCheckpointResult = { ok: true } | { ok: false; kind: "stale" | "exists" | "other"; message: string };

export type PaymentsDashboardProps = {
  accounts: PaymentAccount[];
  loading: boolean;
  message: string | null;
  todayISO: string;
  busyIds: ReadonlySet<string>;
  onCreate: (payload: PaymentFormPayload) => Promise<string | null>;
  /** Account METADATA only (name, minimum, due day, reminder days, balance mode): the balance is never part of this patch. */
  onUpdate: (account: PaymentAccount, patch: Partial<Omit<PaymentFormPayload, "balance">>) => Promise<string | null>;
  /** A balance edit, recorded as an adjustment with a required reason. `clientKey` is stable for one open form, so a repeat can never adjust twice. */
  onAdjustBalance: (account: PaymentAccount, requestedBalance: number, reason: string, clientKey: string) => Promise<string | null>;
  onDelete: (account: PaymentAccount) => Promise<string | null>;
  /** A fresh read of the account's balance, ledger version and checkpoint, for the opening-balance dialog. Rejects if it can't be read. */
  onLoadOpeningCheckpoint: (account: PaymentAccount) => Promise<OpeningCheckpointState>;
  /** Confirms the opening balance. Never changes the balance; the database refuses a stale confirmation or a second checkpoint. */
  onCreateOpeningCheckpoint: (account: PaymentAccount, input: OpeningCheckpointInput) => Promise<OpeningCheckpointResult>;
  /** Read-only reconciliation (reconcile_payment_account). `statementBalance` is the user's balance for the account NOW, or null. Rejects if it can't run. */
  onReconcile: (account: PaymentAccount, statementBalance: number | null) => Promise<ReconciliationResult>;
  /** `clientKey` is stable for one open modal, so a repeated tap or retry can never pay twice. */
  onRecordPayment: (account: PaymentAccount, payload: PaymentEntryPayload, clientKey: string) => Promise<string | null>;
  onReversePayment: (account: PaymentAccount, txn: PaymentTransaction) => Promise<string | null>;
  historyOpenId: string | null;
  historyLoadingId: string | null;
  historyByAccount: Record<string, PaymentTransaction[]>;
  /** Interest / fee / adjustment entries per account, loaded with the history. A different table from the payments above, so a different type and a different reversal. */
  entriesByAccount: Record<string, AccountEntry[]>;
  /** Reverses an ENTRY (never a payment). Resolves to an error message, or null on success. */
  onReverseEntry: (account: PaymentAccount, entry: AccountEntry) => Promise<string | null>;
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
  onSubmit: (payload: PaymentFormPayload, adjustment: { reason: string; clientKey: string }) => Promise<string | null>;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");
  const [clientKey] = useState(newClientKey);
  const [values, setValues] = useState<PaymentFormValues>(() => (account ? paymentToFormValues(account) : EMPTY_PAYMENT_FORM));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, saving);

  const payload = parsePaymentForm(values);
  // Editing an existing account: a changed balance is saved as an adjustment, which needs a reason.
  const balanceChanged = !!account && !!payload && payload.balance !== account.balance;
  const reasonMissing = balanceChanged && reason.trim() === "";
  const set = (k: Exclude<keyof PaymentFormValues, "balanceMode">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const setMode = (m: BalanceMode) => setValues((v) => ({ ...v, balanceMode: m }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!payload || saving) return;
    if (reasonMissing) {
      setError(t("pay.errAdjustReason"));
      return;
    }
    setSaving(true);
    setError(null);
    const err = await onSubmit(payload, { reason: reason.trim(), clientKey });
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

          {balanceChanged && (
            <div className="pay-field pay-field-wide">
              <label className="pay-field pay-field-wide">
                <span className="pay-label">{t("pay.adjustReasonLabel")}</span>
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("pay.adjustReasonPlaceholder")}
                  disabled={saving}
                  className={FIELD_CLASS}
                />
              </label>
              <p className="pay-help">{t("pay.adjustHelp")}</p>
            </div>
          )}

          {error && (
            <div role="alert" className="pay-error">
              {error}
            </div>
          )}

          <div className="pay-modal-actions">
            <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onCancel} disabled={saving}>
              {t("pay.cancel")}
            </button>
            <button type="submit" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" disabled={saving || !payload || reasonMissing}>
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
const BALANCE_TEXT = /^-?(\d+(\.\d{1,2})?|\.\d{1,2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The user's explicit confirmation of an account's balance as its opening checkpoint. It loads a FRESH balance and ledger version, shows both, and only enables
 * Confirm once the user has typed that exact balance. What it sends is what it showed (never a later value), so the database can refuse a stale confirmation.
 * It never edits the balance and never runs on its own.
 */
function OpeningCheckpointModal({
  account,
  todayISO,
  onLoad,
  onSubmit,
  onCancel,
}: {
  account: PaymentAccount;
  todayISO: string;
  onLoad: (account: PaymentAccount) => Promise<OpeningCheckpointState>;
  onSubmit: (input: OpeningCheckpointInput) => Promise<OpeningCheckpointResult>;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [load, setLoad] = useState<{ status: "loading" } | { status: "failed" } | { status: "ready"; data: OpeningCheckpointState }>({ status: "loading" });
  const [reloads, setReloads] = useState(0);
  const [typed, setTyped] = useState("");
  const [date, setDate] = useState(todayISO);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientKey] = useState(newClientKey);
  const dialogRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  useDialog(dialogRef, onCancel, saving);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    onLoad(account).then(
      (data) => {
        if (!cancelled) setLoad({ status: "ready", data });
      },
      () => {
        if (!cancelled) setLoad({ status: "failed" });
      }
    );
    return () => {
      cancelled = true;
    };
    // Reload only when the user asks (Refresh); onLoad/account identity changes must not re-read mid-confirmation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloads]);

  const data = load.status === "ready" ? load.data : null;
  const typedMatches = !!data && BALANCE_TEXT.test(typed.trim()) && toCents(Number(typed.trim())) === toCents(data.balance);
  const dateValid = ISO_DATE.test(date) && !Number.isNaN(new Date(`${date}T00:00:00`).getTime()) && date <= todayISO;
  const canConfirm = !!data && !data.checkpoint && typedMatches && dateValid && !saving;

  function refresh() {
    setTyped("");
    setError(null);
    setReloads((n) => n + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canConfirm || !data || savingRef.current) return;
    savingRef.current = true; // a second tap before React re-renders must not send a second request
    setSaving(true);
    setError(null);
    const result = await onSubmit({
      confirmedBalance: data.balance,
      expectedLedgerVersion: data.ledgerVersion,
      statementDate: date,
      note: note.trim() === "" ? null : note.trim(),
      clientKey,
    });
    if (!result.ok) {
      savingRef.current = false;
      setSaving(false);
      setError(result.message);
      if (result.kind === "exists") refresh(); // show the checkpoint that is already there
    }
    // On success the parent closes this dialog.
  }

  const showForm = !!data && !data.checkpoint;
  const canRefresh = error !== null && !!data && !data.checkpoint;

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-opening-title">
        <h2 id="pay-opening-title" className="pay-modal-title">
          {t("pay.openingTitle")}
        </h2>
        <p className="pay-help">{account.name}</p>

        {load.status === "loading" && <p className="text-sm text-white/60">{t("pay.openingLoading")}</p>}
        {load.status === "failed" && (
          <div role="alert" className="pay-error">
            {t("pay.openingLoadFailed")}
          </div>
        )}

        {data && (
          <dl className="pay-rows">
            <div className="pay-row">
              <dt>{t("pay.openingCurrent")}</dt>
              <dd data-testid="opening-balance">{formatCurrency(data.balance)}</dd>
            </div>
            <div className="pay-row">
              <dt>{t("pay.openingVersion")}</dt>
              <dd data-testid="opening-version">{data.ledgerVersion}</dd>
            </div>
          </dl>
        )}

        {data?.checkpoint && (
          <p role="status" className="pay-notice">
            {t("pay.openingExists", { amount: formatCurrency(data.checkpoint.balance), date: formatDateDisplay(data.checkpoint.statementDate) })}
          </p>
        )}

        {showForm && (
          <form onSubmit={submit} noValidate>
            <p className="pay-help">{t("pay.openingIntro")}</p>
            <p className="pay-help">{t("pay.openingScope")}</p>
            <div className="pay-form-grid">
              <label className="pay-field pay-field-wide">
                <span className="pay-label">{t("pay.openingTypeLabel")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="0.00"
                  disabled={saving}
                  className={FIELD_CLASS}
                />
              </label>
              <p className="pay-help pay-field-wide">
                {typed.trim() !== "" && !typedMatches ? t("pay.openingMismatch") : t("pay.openingTypeHelp")}
              </p>
              <label className="pay-field">
                <span className="pay-label">{t("pay.openingDateLabel")}</span>
                <input type="date" value={date} max={todayISO} onChange={(e) => setDate(e.target.value)} disabled={saving} className={FIELD_CLASS} />
              </label>
              <label className="pay-field pay-field-wide">
                <span className="pay-label">{t("pay.openingNoteLabel")}</span>
                <input type="text" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} className={FIELD_CLASS} />
              </label>
              <p className="pay-help pay-field-wide">{!dateValid ? t("pay.errOpeningDate") : t("pay.openingDateHelp")}</p>
            </div>

            {error && (
              <div role="alert" className="pay-error">
                {error}
              </div>
            )}

            <div className="pay-modal-actions">
              {canRefresh && (
                <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={refresh} disabled={saving}>
                  {t("pay.openingRefresh")}
                </button>
              )}
              <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onCancel} disabled={saving}>
                {t("pay.cancel")}
              </button>
              <button type="submit" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" disabled={!canConfirm}>
                {saving ? t("pay.openingConfirming") : t("pay.openingConfirm")}
              </button>
            </div>
          </form>
        )}

        {!showForm && (
          <div className="pay-modal-actions">
            <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onCancel}>
              {t("pay.openingClose")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

const MAX_LEDGER_AMOUNT = 99999999.99;

/** +$5.50 / −$5.50 / $0.00 (cents-exact, so floating-point noise never shows as a difference). */
function formatSignedCurrency(n: number): string {
  const cents = toCents(n);
  if (cents === 0) return formatCurrency(0);
  return `${cents > 0 ? "+" : "−"}${formatCurrency(Math.abs(cents) / 100)}`;
}

/** Which headline the result deserves. It follows the database's status; 'reconciled' is only a plain success when the database also says it is reliable. */
function reconciliationView(r: ReconciliationResult): { key: "None" | "Ok" | "OkUnreliable" | "Tracked" | "Statement" | "Incomplete"; tone: "neutral" | "ok" | "warn" | "bad" } {
  switch (r.status) {
    case "no_checkpoint":
      return { key: "None", tone: "neutral" };
    case "ledger_incomplete":
      return { key: "Incomplete", tone: "bad" };
    case "tracked_mismatch":
      return { key: "Tracked", tone: "bad" };
    case "statement_mismatch":
      return { key: "Statement", tone: "warn" };
    default:
      return r.reliable ? { key: "Ok", tone: "ok" } : { key: "OkUnreliable", tone: "warn" };
  }
}

/**
 * A read-only reconciliation of one account against its opening checkpoint. It shows exactly what the database reports, never claims reliability the database
 * doesn't, never edits a balance, an entry or a checkpoint, and never creates a checkpoint. A result is hidden while a refresh is running.
 */
function ReconcileModal({
  account,
  onReconcile,
  onCancel,
}: {
  account: PaymentAccount;
  onReconcile: (account: PaymentAccount, statementBalance: number | null) => Promise<ReconciliationResult>;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [load, setLoad] = useState<{ status: "loading" } | { status: "failed" } | { status: "ready"; result: ReconciliationResult }>({ status: "loading" });
  const [run, setRun] = useState<{ n: number; statement: number | null }>({ n: 0, statement: null });
  const [statementText, setStatementText] = useState("");
  const [statementError, setStatementError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onCancel, false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    onReconcile(account, run.statement).then(
      (result) => {
        if (!cancelled) setLoad({ status: "ready", result });
      },
      () => {
        if (!cancelled) setLoad({ status: "failed" });
      }
    );
    return () => {
      cancelled = true;
    };
    // Re-run only when the user refreshes; callback/account identity changes must not trigger another read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.n]);

  function refresh() {
    if (load.status === "loading") return;
    const text = statementText.trim();
    if (text === "") {
      setStatementError(false);
      setRun((r) => ({ n: r.n + 1, statement: null }));
      return;
    }
    const value = Number(text);
    if (!BALANCE_TEXT.test(text) || !Number.isFinite(value) || Math.abs(value) > MAX_LEDGER_AMOUNT) {
      setStatementError(true);
      return;
    }
    setStatementError(false);
    setRun((r) => ({ n: r.n + 1, statement: value }));
  }

  const result = load.status === "ready" ? load.result : null;
  const view = result ? reconciliationView(result) : null;
  const hasCheckpoint = !!result && result.status !== "no_checkpoint";
  const reasons: string[] = [];
  if (result && !result.reliable) {
    if (result.versionGap) reasons.push(t("pay.reconWhyGap"));
    if (result.balanceWritePathOpen) reasons.push(t("pay.reconWhyEditable"));
    if (reasons.length === 0) reasons.push(t("pay.reconWhyGeneric"));
  }

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-recon-title">
        <h2 id="pay-recon-title" className="pay-modal-title">
          {t("pay.reconTitle")}
        </h2>
        <p className="pay-help">{account.name}</p>
        <p className="pay-help">{t("pay.reconIntro")}</p>

        {load.status === "loading" && <p className="text-sm text-white/60">{t("pay.reconLoading")}</p>}
        {load.status === "failed" && (
          <div role="alert" className="pay-error">
            {t("pay.reconFailed")}
          </div>
        )}

        {result && view && (
          <>
            <div role="status" data-testid="recon-headline" data-status={result.status} data-tone={view.tone} className={view.tone === "ok" || view.tone === "neutral" ? "pay-notice" : "pay-error"}>
              <strong>{t(`pay.recon${view.key}Title` as "pay.reconOkTitle")}</strong>
              <div>{t(`pay.recon${view.key}Body` as "pay.reconOkBody")}</div>
            </div>

            <dl className="pay-rows">
              <div className="pay-row">
                <dt>{t("pay.reconCurrent")}</dt>
                <dd data-testid="recon-tracked">{formatCurrency(result.trackedBalance)}</dd>
              </div>
              {hasCheckpoint && result.calculatedBalance !== null && result.trackedDifference !== null && (
                <>
                  <div className="pay-row">
                    <dt>{t("pay.reconCalculated")}</dt>
                    <dd data-testid="recon-calculated">{formatCurrency(result.calculatedBalance)}</dd>
                  </div>
                  <div className="pay-row">
                    <dt>{t("pay.reconDifference")}</dt>
                    <dd data-testid="recon-difference">{formatSignedCurrency(result.trackedDifference)}</dd>
                  </div>
                </>
              )}
              {result.statementBalance !== null && (
                <>
                  <div className="pay-row">
                    <dt>{t("pay.reconStatementRow")}</dt>
                    <dd data-testid="recon-statement">{formatCurrency(result.statementBalance)}</dd>
                  </div>
                  {result.statementDifference !== null && (
                    <div className="pay-row">
                      <dt>{t("pay.reconStatementDiff")}</dt>
                      <dd data-testid="recon-statement-diff">{formatSignedCurrency(result.statementDifference)}</dd>
                    </div>
                  )}
                </>
              )}
              {hasCheckpoint && result.checkpointBalance !== null && result.checkpointVersion !== null && (
                <>
                  <div className="pay-row">
                    <dt>{t("pay.reconCheckpoint")}</dt>
                    <dd data-testid="recon-checkpoint">{formatCurrency(result.checkpointBalance)}</dd>
                  </div>
                  <div className="pay-row">
                    <dt>{t("pay.reconCheckpointVersion")}</dt>
                    <dd data-testid="recon-checkpoint-version">{result.checkpointVersion}</dd>
                  </div>
                </>
              )}
              <div className="pay-row">
                <dt>{t("pay.reconVersion")}</dt>
                <dd data-testid="recon-version">{result.currentLedgerVersion}</dd>
              </div>
              {hasCheckpoint && (
                <div className="pay-row">
                  <dt>{t("pay.reconGaps")}</dt>
                  <dd data-testid="recon-gaps">{result.versionGap ? t("pay.reconGapsFound") : t("pay.reconGapsNone")}</dd>
                </div>
              )}
              <div className="pay-row">
                <dt>{t("pay.reconReliability")}</dt>
                <dd data-testid="recon-reliability" data-reliable={result.reliable}>
                  {result.reliable ? t("pay.reconReliable") : t("pay.reconNotReliable")}
                </dd>
              </div>
            </dl>

            {reasons.length > 0 && (
              <ul className="pay-help" data-testid="recon-reasons">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="pay-form-grid">
          <label className="pay-field pay-field-wide">
            <span className="pay-label">{t("pay.reconStatementLabel")}</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={statementText}
              onChange={(e) => setStatementText(e.target.value)}
              placeholder="0.00"
              className={FIELD_CLASS}
            />
          </label>
          <p className="pay-help pay-field-wide">{statementError ? t("pay.errReconStatement") : t("pay.reconStatementHelp")}</p>
        </div>

        <div className="pay-modal-actions">
          <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onCancel}>
            {t("pay.reconClose")}
          </button>
          <button type="button" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" onClick={refresh} disabled={load.status === "loading"}>
            {t("pay.reconRefresh")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

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
  onAdjustBalance,
  onLoadOpeningCheckpoint,
  onCreateOpeningCheckpoint,
  onReconcile,
  onDelete,
  onRecordPayment,
  onReversePayment,
  historyOpenId,
  historyLoadingId,
  historyByAccount,
  entriesByAccount,
  onReverseEntry,
  onToggleHistory,
}: PaymentsDashboardProps) {
  const { t } = useLanguage();
  const [formFor, setFormFor] = useState<"new" | PaymentAccount | null>(null);
  const [removing, setRemoving] = useState<PaymentAccount | null>(null);
  const [openingFor, setOpeningFor] = useState<PaymentAccount | null>(null);
  const [reconcilingFor, setReconcilingFor] = useState<PaymentAccount | null>(null);
  const [recordingFor, setRecordingFor] = useState<PaymentAccount | null>(null);
  const [reversing, setReversing] = useState<{ account: PaymentAccount; txn: PaymentTransaction } | null>(null);
  const [reversingEntry, setReversingEntry] = useState<{ account: PaymentAccount; entry: AccountEntry } | null>(null);
  const [moreOpenId, setMoreOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submitForm(payload: PaymentFormPayload, adjustment: { reason: string; clientKey: string }): Promise<string | null> {
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
      // Metadata and balance are saved separately: the balance never goes through onUpdate. Metadata first, because re-sending it is harmless
      // if the adjustment then fails and the form is submitted again.
      const { balance, ...metadata } = patch;
      if (balance !== undefined && adjustment.reason === "") return t("pay.errAdjustReason");
      const savedMetadata = Object.keys(metadata).length > 0;
      if (savedMetadata) {
        const metaErr = await onUpdate(formFor, metadata);
        if (metaErr) return metaErr;
      }
      if (balance !== undefined) {
        const adjustErr = await onAdjustBalance(formFor, balance, adjustment.reason, adjustment.clientKey);
        // The details above are already saved: say so, and keep the original explanation of why the balance was not.
        if (adjustErr) return savedMetadata ? t("pay.errPartialAdjust", { reason: adjustErr }) : adjustErr;
      }
      setFormFor(null);
      return null;
    }
    return null;
  }

  const txnDate = (txn: PaymentTransaction) => formatDateDisplay(toISODate(new Date(txn.paidAt)));
  const entryLabel = (entry: AccountEntry) =>
    entry.kind === "interest" ? t("pay.entryInterest") : entry.kind === "fee" ? t("pay.entryFee") : entry.balanceDelta >= 0 ? t("pay.entryAdjustmentUp") : t("pay.entryAdjustmentDown");
  // What the row shows as its amount: the signed balance effect when it changed the balance, otherwise the plain magnitude (it is tagged "not applied").
  const entryAmount = (entry: AccountEntry) => (entry.balanceApplied ? formatSignedCurrency(entry.balanceDelta) : formatCurrency(entry.amount));

  return (
    <div className="pay-panel">
      <div className="fin-section-head">
        <h3 className="text-lg font-bold">{t("pay.sectionTitle")}</h3>
        <p className="text-sm text-white/70">{t("pay.sectionSubtitle")}</p>
      </div>

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
            const entries = entriesByAccount[account.id] ?? [];
            const historyItems = buildHistoryItems(history, entries);
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
                      className="btn standup-metal-btn pay-action-btn"
                      onClick={() => {
                        setNotice(null);
                        setOpeningFor(account);
                        setMoreOpenId(null);
                      }}
                      disabled={busy}
                    >
                      {t("pay.openingMenu")}
                    </button>
                    <button
                      type="button"
                      className="btn standup-metal-btn pay-action-btn"
                      onClick={() => {
                        setNotice(null);
                        setReconcilingFor(account);
                        setMoreOpenId(null);
                      }}
                    >
                      {t("pay.reconMenu")}
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
                  <div className="pay-history" data-testid="pay-history">
                    {historyLoadingId === account.id ? (
                      <p className="text-xs text-white/50">{t("backlog.paymentHistoryLoading")}</p>
                    ) : historyItems.length === 0 ? (
                      <p className="text-xs text-white/50 italic">{t("backlog.paymentHistoryEmpty")}</p>
                    ) : (
                      <ul className="pay-history-list">
                        {historyItems.map((item) => {
                          if (item.type === "payment") {
                            const txn = item.txn;
                            return (
                              <li key={item.key} className="pay-txn" data-reversed={!!txn.reversedAt}>
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
                            );
                          }
                          const entry = item.entry;
                          const when = formatDateDisplay(entry.entryDate);
                          return (
                            <li key={item.key} className="pay-txn" data-testid="pay-entry" data-entry-kind={entry.kind} data-reversed={!!entry.reversedAt}>
                              <div className="pay-txn-main">
                                <span className="pay-txn-amount">{entryAmount(entry)}</span>
                                <span className="pay-txn-date">{when}</span>
                                <span className="pay-txn-badge">{entryLabel(entry)}</span>
                                {!entry.balanceApplied && <span className="pay-txn-badge">{t("pay.entryNotApplied")}</span>}
                                {entry.reversedAt && <span className="pay-txn-badge">{t("pay.reversedBadge")}</span>}
                              </div>
                              {entry.statementDate && <p className="pay-txn-note">{t("pay.entryStatement", { date: formatDateDisplay(entry.statementDate) })}</p>}
                              {entry.reason && <p className="pay-txn-note">{entry.reason}</p>}
                              {entry.note && <p className="pay-txn-note">{entry.note}</p>}
                              {!entry.reversedAt && (
                                <button
                                  type="button"
                                  className="btn standup-metal-btn pay-txn-reverse"
                                  onClick={() => setReversingEntry({ account, entry })}
                                  aria-label={`${t("pay.reverse")} ${entryLabel(entry)} ${entryAmount(entry)} ${when}`}
                                >
                                  {t("pay.reverse")}
                                </button>
                              )}
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
      {openingFor && (
        <OpeningCheckpointModal
          key={openingFor.id}
          account={openingFor}
          todayISO={todayISO}
          onLoad={onLoadOpeningCheckpoint}
          onCancel={() => setOpeningFor(null)}
          onSubmit={async (input) => {
            const result = await onCreateOpeningCheckpoint(openingFor, input);
            if (result.ok) {
              setOpeningFor(null);
              setNotice(t("pay.openingDone"));
            }
            return result;
          }}
        />
      )}
      {reconcilingFor && <ReconcileModal key={reconcilingFor.id} account={reconcilingFor} onReconcile={onReconcile} onCancel={() => setReconcilingFor(null)} />}
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
      {reversingEntry && (
        <ConfirmActionModal
          title={t("pay.entryReverseTitle")}
          body={t(reversingEntry.entry.balanceApplied ? "pay.entryReverseBodyApplied" : "pay.entryReverseBodyNotApplied", {
            label: entryLabel(reversingEntry.entry),
            amount: formatCurrency(reversingEntry.entry.amount),
            date: formatDateDisplay(reversingEntry.entry.entryDate),
            effect: formatSignedCurrency(-reversingEntry.entry.balanceDelta),
          })}
          confirmLabel={t("pay.entryReverseConfirm")}
          busyLabel={t("pay.reversing")}
          onCancel={() => setReversingEntry(null)}
          onConfirm={async () => {
            const err = await onReverseEntry(reversingEntry.account, reversingEntry.entry);
            if (!err) {
              setReversingEntry(null);
              setNotice(t("pay.entryReverseDone"));
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

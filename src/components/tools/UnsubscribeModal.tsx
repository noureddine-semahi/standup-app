"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatDateDisplay } from "@/lib/supabase/db";
import {
  cancellationOptions,
  parseCancellationFailure,
  parseCancellationReport,
  pendingRequest,
  safeCancelUrl,
  type SubscriptionCancellation,
} from "@/lib/cancellation";
import type { Subscription } from "@/lib/subscriptions";
import { FIELD_CLASS, useDialog } from "./PaymentsDashboard";
import type { SubscriptionsController } from "./useSubscriptions";

// "Unsubscribe Me": a compact choice, then only the chosen workflow.
//  - Help me cancel (guided): opens a cancellation page and logs a request. It never
//    claims the cancellation happened; the user reports back.
//  - I've already canceled (manual): the user records a cancellation they completed,
//    saved as user-reported.
//  - Automatic cancellation stays unavailable until an authorized provider integration
//    exists (see CANCELLATION_INTEGRATIONS); it is never simulated.
// No password field exists anywhere in this flow.

type View = "choose" | "help" | "done" | "failed";

export default function UnsubscribeModal({
  subscription,
  cancellations,
  controller,
  todayISO,
  onClose,
  onDone,
}: {
  subscription: Subscription;
  cancellations: readonly SubscriptionCancellation[];
  controller: SubscriptionsController;
  todayISO: string;
  onClose: () => void;
  /** Called after a report/failure is saved, with the message to show on the tab. */
  onDone: (message: string) => void;
}) {
  const { t } = useLanguage();
  const c = controller;
  const sub = subscription;
  const options = cancellationOptions(sub);
  const pending = pendingRequest(cancellations);
  const available = c.cancellationsState === "ready";

  const [view, setView] = useState<View>("choose");
  const [backTo, setBackTo] = useState<View>("choose");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [date, setDate] = useState(todayISO);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [touched, setTouched] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onClose, busy);

  const go = (next: View) => {
    setError(null);
    setTouched(false);
    setBackTo(next === "help" || next === "choose" ? "choose" : view);
    setView(next);
  };

  async function run(fn: () => Promise<string | null>, doneMessage: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const msg = await fn();
    busyRef.current = false;
    setBusy(false);
    if (msg) setError(msg);
    else onDone(doneMessage);
  }

  async function saveLink() {
    const url = safeCancelUrl(linkText);
    if (!url) {
      setLinkError(true);
      return;
    }
    setLinkError(false);
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const msg = await c.saveCancelUrl(sub, url);
    busyRef.current = false;
    setBusy(false);
    if (msg) setError(msg);
    else {
      setLinkText("");
      setEditingLink(false);
    }
  }

  // Logging the request must not block the navigation: the link opens either way.
  async function logOpened(url: string) {
    if (pending || busyRef.current) return;
    const msg = await c.startAssistedCancellation(sub, url);
    if (msg) setError(msg);
    else setLogged(true);
  }

  const reportParsed = parseCancellationReport({ date, note }, todayISO);
  const failureParsed = parseCancellationFailure(problem);
  const reportError = !reportParsed.ok ? reportParsed.error : null;
  const failureError = !failureParsed.ok ? failureParsed.error : null;
  const errText = { date: t("unsub.errDate"), dateFuture: t("unsub.errDateFuture"), note: t("unsub.errNote") };

  const showLinkField = !options.assisted.url || editingLink;
  const canReportBack = !!pending || logged;
  const pendingNote = pending ? t("unsub.pendingBody", { date: formatDateDisplay(pending.requestedAt.slice(0, 10)) }) : null;

  const backButton = (
    <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={() => go(backTo)} disabled={busy}>
      {t("unsub.back")}
    </button>
  );

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="unsub-title" data-testid="unsub-modal">
        <h2 id="unsub-title" className="pay-modal-title">
          {t("unsub.title", { name: sub.name })}
        </h2>

        {!available ? (
          <>
            <p className="pay-help" role="status" data-testid="unsub-unavailable">
              {t("unsub.unavailable")}
            </p>
            <div className="pay-modal-actions">
              <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onClose}>
                {t("unsub.close")}
              </button>
            </div>
          </>
        ) : view === "choose" ? (
          <div className="unsub-body">
            <p className="pay-help">{t("unsub.intro")}</p>
            {pendingNote && (
              <p className="unsub-pending" data-testid="unsub-pending" role="status">
                {pendingNote}
              </p>
            )}
            <button type="button" className="unsub-choice" data-testid="unsub-choose-help" onClick={() => go("help")}>
              <span className="unsub-choice-title">{t("unsub.chooseHelp")}</span>
              <span className="unsub-choice-sub">{t("unsub.chooseHelpSub")}</span>
            </button>
            <button type="button" className="unsub-choice" data-testid="unsub-choose-done" onClick={() => go("done")}>
              <span className="unsub-choice-title">{t("unsub.chooseDone")}</span>
              <span className="unsub-choice-sub">{t("unsub.chooseDoneSub")}</span>
            </button>
            {!options.automatic.available && (
              <p className="unsub-auto-note" data-testid="unsub-auto">
                {t("unsub.autoUnavailable", { name: sub.name })}
              </p>
            )}
            <div className="pay-modal-actions">
              <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onClose}>
                {t("unsub.close")}
              </button>
            </div>
          </div>
        ) : view === "help" ? (
          <div className="unsub-body" data-testid="unsub-help">
            <h3 className="unsub-h">{t("unsub.chooseHelp")}</h3>
            {pendingNote && <p className="unsub-pending" data-testid="unsub-pending" role="status">{pendingNote}</p>}
            {showLinkField ? (
              <>
                {!options.assisted.url && <p className="pay-help">{t("unsub.assistNoLink")}</p>}
                <label className="pay-field pay-field-wide">
                  <span className="pay-label">{t("unsub.assistLinkLabel")}</span>
                  <input type="url" inputMode="url" autoComplete="off" placeholder="https://" value={linkText} onChange={(e) => setLinkText(e.target.value)} disabled={busy} className={FIELD_CLASS} aria-invalid={linkError} />
                </label>
                {linkError && <p className="pay-field-error" role="alert">{t("unsub.assistLinkInvalid")}</p>}
                <div className="unsub-actions">
                  <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={saveLink} disabled={busy}>
                    {t("unsub.assistLinkSave")}
                  </button>
                  {editingLink && (
                    <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => { setEditingLink(false); setLinkError(false); }} disabled={busy}>
                      {t("pay.cancel")}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="pay-help">
                  {options.assisted.source === "verified"
                    ? t("unsub.assistVerified", { date: formatDateDisplay(options.assisted.verifiedOn ?? "") })
                    : t("unsub.assistSaved")}
                </p>
                <p className="pay-help">{t("unsub.assistSteps")}</p>
                <a
                  href={options.assisted.url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn standup-metal-btn standup-metal-btn--accent pay-action-btn unsub-open"
                  data-testid="unsub-open"
                  onClick={() => logOpened(options.assisted.url!)}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("unsub.assistOpen")}
                </a>
                {options.assisted.source === "saved" && (
                  <button type="button" className="unsub-link-btn" onClick={() => setEditingLink(true)}>
                    {t("unsub.linkChange")}
                  </button>
                )}
                {logged && <p className="pay-help" role="status">{t("unsub.assistLogged")}</p>}
              </>
            )}
            {canReportBack && !showLinkField && (
              <div className="unsub-actions">
                <button type="button" className="btn standup-metal-btn standup-metal-btn--accent pay-action-btn" onClick={() => go("done")}>
                  {t("unsub.iCanceledIt")}
                </button>
                <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => go("failed")}>
                  {t("unsub.failTitle")}
                </button>
              </div>
            )}
            {error && <div role="alert" className="pay-error">{error}</div>}
            <div className="pay-modal-actions">
              {backButton}
              <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onClose} disabled={busy}>
                {t("unsub.close")}
              </button>
            </div>
          </div>
        ) : view === "done" ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (!reportParsed.ok) return;
              const payload = reportParsed.payload;
              void run(() => c.reportCancellation(sub, payload, pending?.id ?? null), t("unsub.badgeReported", { date: formatDateDisplay(payload.completedOn) }));
            }}
          >
            <h3 className="unsub-h">{t("unsub.chooseDone")}</h3>
            <p className="pay-help">{t("unsub.manualBody")}</p>
            <div className="pay-form-grid">
              <label className="pay-field">
                <span className="pay-label">{t("unsub.dateLabel")}</span>
                <input type="date" max={todayISO} autoFocus value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} className={FIELD_CLASS} aria-invalid={touched && !!reportError} />
              </label>
              <label className="pay-field pay-field-wide">
                <span className="pay-label">{t("unsub.noteLabel")}</span>
                <input type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} className={FIELD_CLASS} />
              </label>
            </div>
            {reportError && <p className="pay-field-error" role="alert">{errText[reportError]}</p>}
            {error && <div role="alert" className="pay-error">{error}</div>}
            <div className="pay-modal-actions">
              {backButton}
              <button type="submit" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" disabled={busy || !reportParsed.ok}>
                {busy ? t("unsub.saving") : t("unsub.reportConfirm")}
              </button>
            </div>
          </form>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (!failureParsed.ok) return;
              const text = failureParsed.error;
              void run(() => c.reportCancellationFailure(sub, text, pending?.id ?? null), t("unsub.badgeFailed", { error: text }));
            }}
          >
            <h3 className="unsub-h">{t("unsub.failTitle")}</h3>
            <p className="pay-help">{t("unsub.failBody")}</p>
            <label className="pay-field pay-field-wide">
              <span className="pay-label">{t("unsub.errorLabel")}</span>
              <input type="text" autoComplete="off" autoFocus value={problem} onChange={(e) => setProblem(e.target.value)} disabled={busy} className={FIELD_CLASS} aria-invalid={touched && !!failureError} />
            </label>
            {touched && failureError && (
              <p className="pay-field-error" role="alert">{failureError === "required" ? t("unsub.errRequired") : t("unsub.errTooLong")}</p>
            )}
            {error && <div role="alert" className="pay-error">{error}</div>}
            <div className="pay-modal-actions">
              {backButton}
              <button type="submit" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" disabled={busy || !failureParsed.ok}>
                {busy ? t("unsub.saving") : t("unsub.failConfirm")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

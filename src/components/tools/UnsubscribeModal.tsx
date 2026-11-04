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

// "Unsubscribe Me": three honest routes.
//  - Automatic: only through an authorized provider integration that returns an
//    acknowledgment. None exist, so this is shown as unavailable and never simulated.
//  - Guided: opens a cancellation page and logs a request. It never claims the
//    cancellation happened.
//  - Manual: the user records a cancellation they completed, saved as user-reported.
// No password field exists anywhere in this flow.

type View = "choose" | "manual" | "failed";

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
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [date, setDate] = useState(todayISO);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [touched, setTouched] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, onClose, busy);

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
    else setLinkText("");
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

  const errText = {
    date: t("unsub.errDate"),
    dateFuture: t("unsub.errDateFuture"),
    note: t("unsub.errNote"),
  };

  return createPortal(
    <div className="pay-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} className="pay-modal" role="dialog" aria-modal="true" aria-labelledby="unsub-title" data-testid="unsub-modal">
        <h2 id="unsub-title" className="pay-modal-title">
          {t("unsub.title", { name: sub.name })}
        </h2>

        {!available ? (
          <p className="pay-help" role="status" data-testid="unsub-unavailable">
            {t("unsub.unavailable")}
          </p>
        ) : view === "choose" ? (
          <div className="unsub-body">
            <p className="pay-help">{t("unsub.intro")}</p>

            <section className="unsub-section" data-testid="unsub-auto" aria-labelledby="unsub-auto-h">
              <h3 id="unsub-auto-h" className="unsub-h">{t("unsub.autoTitle")}</h3>
              {!options.automatic.available && <p className="pay-help">{t("unsub.autoUnavailable", { name: sub.name })}</p>}
            </section>

            <section className="unsub-section" data-testid="unsub-assisted" aria-labelledby="unsub-assist-h">
              <h3 id="unsub-assist-h" className="unsub-h">{t("unsub.assistTitle")}</h3>
              {options.assisted.url ? (
                <>
                  <p className="pay-help">
                    {options.assisted.source === "verified"
                      ? t("unsub.assistVerified", { date: formatDateDisplay(options.assisted.verifiedOn ?? "") })
                      : t("unsub.assistSaved")}
                  </p>
                  <p className="pay-help">{t("unsub.assistSteps")}</p>
                  <a
                    href={options.assisted.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn standup-metal-btn standup-metal-btn--accent pay-action-btn unsub-open"
                    data-testid="unsub-open"
                    onClick={() => logOpened(options.assisted.url!)}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    {t("unsub.assistOpen")}
                  </a>
                  {logged && <p className="pay-help" role="status">{t("unsub.assistLogged")}</p>}
                </>
              ) : (
                <>
                  <p className="pay-help">{t("unsub.assistNoLink")}</p>
                  <label className="pay-field pay-field-wide">
                    <span className="pay-label">{t("unsub.assistLinkLabel")}</span>
                    <input type="url" inputMode="url" autoComplete="off" placeholder="https://" value={linkText} onChange={(e) => setLinkText(e.target.value)} disabled={busy} className={FIELD_CLASS} aria-invalid={linkError} />
                  </label>
                  {linkError && <p className="pay-field-error" role="alert">{t("unsub.assistLinkInvalid")}</p>}
                  <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={saveLink} disabled={busy}>
                    {t("unsub.assistLinkSave")}
                  </button>
                </>
              )}
            </section>

            {pending && (
              <section className="unsub-section" data-testid="unsub-pending" aria-labelledby="unsub-pending-h">
                <h3 id="unsub-pending-h" className="unsub-h">{t("unsub.pendingTitle")}</h3>
                <p className="pay-help">{t("unsub.pendingBody", { date: formatDateDisplay(pending.requestedAt.slice(0, 10)) })}</p>
              </section>
            )}

            <section className="unsub-section" data-testid="unsub-manual" aria-labelledby="unsub-manual-h">
              <h3 id="unsub-manual-h" className="unsub-h">{t("unsub.manualTitle")}</h3>
              <p className="pay-help">{t("unsub.manualBody")}</p>
              <div className="unsub-actions">
                <button type="button" className="btn standup-metal-btn standup-metal-btn--accent pay-action-btn" onClick={() => { setError(null); setView("manual"); }}>
                  {t("unsub.manualTitle")}
                </button>
                {(pending || logged) && (
                  <button type="button" className="btn standup-metal-btn pay-action-btn" onClick={() => { setError(null); setView("failed"); }}>
                    {t("unsub.failTitle")}
                  </button>
                )}
              </div>
            </section>
          </div>
        ) : view === "manual" ? (
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
            {touched && reportError && <p className="pay-field-error" role="alert">{errText[reportError]}</p>}
            {error && <div role="alert" className="pay-error">{error}</div>}
            <div className="pay-modal-actions">
              <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={() => setView("choose")} disabled={busy}>
                {t("unsub.back")}
              </button>
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
              <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={() => setView("choose")} disabled={busy}>
                {t("unsub.back")}
              </button>
              <button type="submit" className="btn standup-metal-btn standup-metal-btn--accent pay-modal-btn" disabled={busy || !failureParsed.ok}>
                {busy ? t("unsub.saving") : t("unsub.failConfirm")}
              </button>
            </div>
          </form>
        )}

        {view === "choose" && error && <div role="alert" className="pay-error">{error}</div>}
        {(view === "choose" || !available) && (
          <div className="pay-modal-actions">
            <button type="button" className="btn standup-metal-btn pay-modal-btn" onClick={onClose} disabled={busy}>
              {t("unsub.close")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { supabase } from "@/lib/supabase/client";
import { getBillingOperations } from "@/lib/admin/billingAdminClient";
import type { OperationsOverview } from "@/lib/admin/billingOperations";

// Admin > Premium & Billing > Billing operations. READ-ONLY: webhook processing, reconciliation health, retry backoff and unresolved synchronization.
// The server authorises (System Admin only). Nothing here changes a subscription, retries a record or talks to Stripe.

const deps = { getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null };
type Phase = "loading" | "ready" | "error";
const OUTCOMES = ["missing", "conflict", "stripe_error", "ignored"] as const;

export default function AdminBillingOperations() {
  const { t, language } = useLanguage();
  const locale = language === "es" ? "es" : "en";
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<OperationsOverview | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getBillingOperations(deps);
      if (!alive) return;
      if (r.kind === "ok") {
        setData(r.data);
        setPhase("ready");
      } else setPhase("error");
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = () => {
    setPhase("loading");
    setAttempt((x) => x + 1);
  };

  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const when = (iso: string | null) => {
    if (!iso) return t("adminBillOps.dash");
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? t("adminBillOps.dash") : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
  };
  const outcomeText = (o: string | null) => ((OUTCOMES as readonly string[]).includes(o ?? "") ? t(`adminBillOps.outcome.${o}` as "adminBillOps.outcome.missing") : t("adminBillOps.dash"));

  const rc = data?.reconciliation;
  return (
    <section className="card space-y-5" data-testid="adminops-ops" aria-labelledby="adminops-ops-title">
      <div>
        <h2 id="adminops-ops-title" className="text-lg font-semibold">{t("adminBillOps.ops.title")}</h2>
        <p className="text-sm text-white/60 mt-1">{t("adminBillOps.ops.subtitle")}</p>
      </div>

      {phase === "loading" && <p className="text-sm text-white/50" role="status" data-testid="adminops-ops-loading">{t("adminBillOps.ops.loading")}</p>}
      {phase === "error" && (
        <p className="text-sm text-red-300" role="alert" data-testid="adminops-ops-error">
          {t("adminBillOps.ops.error")}{" "}
          <button type="button" className="underline" onClick={retry} data-testid="adminops-ops-retry">{t("premium.retry")}</button>
        </p>
      )}

      {phase === "ready" && data && rc && (
        <>
          <p className="text-xs text-white/40">{t("adminBillOps.ops.generated", { when: when(data.generatedAt) })}</p>

          <div className="space-y-2" data-testid="adminops-webhooks">
            <h3 className="font-medium">{t("adminBillOps.webhooks.title")}</h3>
            {data.webhooks.totalRecorded === 0 ? (
              <p className="text-sm text-white/60" data-testid="adminops-webhooks-empty">{t("adminBillOps.webhooks.none")}</p>
            ) : (
              <>
                <p className="text-sm" data-testid="adminops-webhooks-24h">{t("adminBillOps.webhooks.last24h", { processed: n(data.webhooks.last24h.processed), failed: n(data.webhooks.last24h.failed), processing: n(data.webhooks.last24h.processing) })}</p>
                <p className="text-sm text-white/60">{t("adminBillOps.webhooks.lastProcessed", { when: when(data.webhooks.lastProcessedAt) })}</p>
                <p className="text-xs text-white/50 pt-1">{t("adminBillOps.webhooks.recent")}</p>
                <ul className="space-y-2">
                  {data.webhooks.recent.map((e, i) => (
                    <li key={i} className="rounded-lg border border-white/10 bg-white/5 p-2.5 text-sm grid gap-1 sm:grid-cols-4" data-testid="adminops-webhook">
                      <span className="break-all font-mono text-xs sm:col-span-1">{e.type}</span>
                      <span className={e.status === "failed" ? "text-red-300" : e.status === "processing" ? "text-amber-300" : "text-emerald-300"}>
                        {t(`adminBillOps.webhooks.status.${e.status}` as "adminBillOps.webhooks.status.processed")}
                        {e.error ? ` (${e.error})` : ""}
                      </span>
                      <span className="text-white/60">{t("adminBillOps.webhooks.col.attempts")}: {n(e.attempts)}</span>
                      <span className="text-white/60">{when(e.receivedAt)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="space-y-2" data-testid="adminops-recon">
            <h3 className="font-medium">{t("adminBillOps.recon.title")}</h3>
            <p className="text-xs text-white/50">{t("adminBillOps.recon.note")}</p>
            {rc.tracked === 0 ? (
              <p className="text-sm text-white/60" data-testid="adminops-recon-empty">{t("adminBillOps.recon.empty")}</p>
            ) : (
              <>
                <dl className="grid gap-3 grid-cols-2 lg:grid-cols-4 text-sm">
                  {[
                    ["tracked", n(rc.tracked)],
                    ["fresh", n(rc.freshWithin24h)],
                    ["stale", n(rc.stale)],
                    ["never", n(rc.neverSynced)],
                    ["failing", n(rc.failing)],
                    ["waiting", n(rc.waitingInBackoff)],
                    ["lastCheck", when(rc.lastCheckAt)],
                    ["oldest", when(rc.oldestCheckAt)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-white/5 p-2.5">
                      <dt className="text-xs text-white/50">{t(`adminBillOps.recon.${k}` as "adminBillOps.recon.tracked")}</dt>
                      <dd className="font-medium" data-testid={`adminops-recon-${k}`}>{v}</dd>
                    </div>
                  ))}
                </dl>
                {rc.failing > 0 && (
                  <p className="text-sm text-white/70" data-testid="adminops-recon-outcomes">
                    {t("adminBillOps.recon.outcomes")}: {OUTCOMES.filter((o) => rc.byOutcome[o] > 0).map((o) => `${t(`adminBillOps.outcome.${o}` as "adminBillOps.outcome.missing")} ${n(rc.byOutcome[o])}`).join(" · ")}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="space-y-2" data-testid="adminops-backoff">
            <h3 className="font-medium">{t("adminBillOps.backoff.title")}</h3>
            {data.backoff.length === 0 ? (
              <p className="text-sm text-white/60" data-testid="adminops-backoff-empty">{t("adminBillOps.backoff.none")}</p>
            ) : (
              <ul className="space-y-2">
                {data.backoff.map((b, i) => (
                  <li key={i} className="rounded-lg border border-white/10 bg-white/5 p-2.5 text-sm grid gap-1 sm:grid-cols-2 lg:grid-cols-5" data-testid="adminops-backoff-item">
                    <span className="break-all">{b.member ?? t("adminBillOps.dash")}</span>
                    <span>{t("adminBillOps.backoff.col.outcome")}: {outcomeText(b.outcome)}</span>
                    <span>{t("adminBillOps.backoff.col.failures")}: {n(b.failures)}</span>
                    <span className="text-white/60">{t("adminBillOps.backoff.col.lastFailed")}: {when(b.lastFailedAt)}</span>
                    <span className={b.waiting ? "text-amber-300" : "text-white/60"}>{t("adminBillOps.backoff.col.next")}: {b.waiting ? when(b.nextAttemptAt) : t("adminBillOps.backoff.due")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2" data-testid="adminops-unresolved">
            <h3 className="font-medium">{t("adminBillOps.unresolved.title")}</h3>
            {data.unresolved.total === 0 ? (
              <p className="text-sm text-white/60" data-testid="adminops-unresolved-empty">{t("adminBillOps.unresolved.none")}</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {data.unresolved.items.map((u, i) => (
                    <li key={i} className="rounded-lg border border-white/10 bg-white/5 p-2.5 text-sm grid gap-1 sm:grid-cols-3" data-testid="adminops-unresolved-item">
                      <span>{t(`adminBillOps.unresolved.${u.kind}` as "adminBillOps.unresolved.webhook_failed")}</span>
                      <span className="break-all text-white/70">{u.subject ?? t("adminBillOps.dash")}{u.detail ? ` (${u.detail})` : ""}</span>
                      <span className="text-white/60">{when(u.at)}</span>
                    </li>
                  ))}
                </ul>
                {data.unresolved.total > data.unresolved.items.length && (
                  <p className="text-xs text-white/50" data-testid="adminops-unresolved-more">{t("adminBillOps.unresolved.more", { shown: n(data.unresolved.items.length), total: n(data.unresolved.total) })}</p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

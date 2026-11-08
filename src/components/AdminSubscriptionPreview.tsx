"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { FREE_LIMITS, PRICING, TRIAL_DAYS, formatPriceCents } from "@/lib/entitlements";
import { billingView } from "@/lib/billingStatusView";
import { portalEligible } from "@/lib/billing/subscriptionStates";
import { trialView } from "@/lib/trialView";
import { PREVIEW_IDS, previewStates, type PreviewId } from "@/lib/admin/previewStates";

// Admin-only, READ-ONLY preview of what a member sees in each subscription situation. It renders SAMPLE data from lib/admin/previewStates.ts through the
// SAME pure helpers the member screens use (billingView for the Subscription section and its wording, trialView for the trial lines) and the same
// translation keys, so the words match the real thing.
//
// It cannot do anything: it imports no sign-in client, no Checkout or Customer Portal helper, no navigation and no network code, and every action button is
// a disabled placeholder with no handler. Nothing here creates a Checkout session, starts a trial, changes a plan or opens Stripe.

export default function AdminSubscriptionPreview({ now }: { now?: number }) {
  const { t, language } = useLanguage();
  const [selected, setSelected] = useState<PreviewId>("free");
  const [clock] = useState(() => now ?? Date.now()); // fixed when the preview opens, so the sample dates stay stable while an admin switches situations
  const states = useMemo(() => previewStates(clock), [clock]);
  const state = states.find((s) => s.id === selected) ?? states[0];

  const fmt = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(language === "es" ? "es" : "en", { dateStyle: "long" }).format(d);
    } catch {
      return d.toLocaleDateString();
    }
  };

  const view = trialView({ tier: state.tier, trialEndsAt: state.trialEndsAt, trialStartedAt: state.trialStartedAt, trialUsed: state.trialUsed }, clock);
  const bill = billingView(state.billing);
  const tierLabel = state.tier === "premium" ? t("premium.tierPremium") : state.tier === "premium_trial" ? t("premium.tierTrial") : t("premium.tierFree");
  const hasLiveSubscription = portalEligible(state.billing?.status);
  const showSubscribe = state.tier !== "premium" && !hasLiveSubscription;
  const showTrial = view.canStart;
  const showManage = hasLiveSubscription;

  const placeholder = (label: string, testid: string) => (
    <button type="button" disabled aria-disabled="true" title={t("adminBill.preview.disabledHint")} className="btn standup-metal-btn opacity-50 cursor-not-allowed" data-testid={testid}>
      {label}
    </button>
  );

  return (
    <section className="card" aria-labelledby="adminbill-preview-title" data-testid="adminbill-preview">
      <h2 id="adminbill-preview-title" className="text-lg font-semibold mb-1">
        {t("adminBill.preview.title")}
      </h2>
      <p className="text-sm text-white/60 mb-3">{t("adminBill.preview.subtitle")}</p>

      <p role="note" className="rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm text-amber-100 mb-4" data-testid="adminbill-preview-banner">
        {t("adminBill.preview.banner")}
      </p>

      <div role="radiogroup" aria-label={t("adminBill.preview.choose")} className="flex flex-wrap gap-2 mb-4">
        {PREVIEW_IDS.map((id) => {
          const s = states.find((x) => x.id === id)!;
          const on = id === selected;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(id)}
              className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${on ? "border-amber-400/80 bg-white/10 ring-1 ring-amber-400/50" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
              data-testid={`adminbill-preview-${id}`}
            >
              {t(s.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-dashed border-white/25 p-4 space-y-3" data-testid="adminbill-preview-panel" data-state={state.id}>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">{t("adminBill.preview.badge")}</p>

        <p className="text-sm text-white/70">
          {t("premium.currentPlan")}: <strong data-testid="adminbill-preview-tier">{tierLabel}</strong>
        </p>
        {state.tier === "premium_trial" && (
          <p className="text-sm text-white/70" data-testid="adminbill-preview-trial">
            {t("premium.trialEnds", { date: fmt(view.endsAt) })} · {t("premium.daysLeft", { days: view.daysLeft })}
          </p>
        )}
        {view.trialEnded && (
          <p className="text-sm text-white/70" data-testid="adminbill-preview-trial-ended">
            {t("premium.trialEnded")}
          </p>
        )}
        {showTrial && (
          <p className="text-sm text-white/70" data-testid="adminbill-preview-offer">
            {t("premium.offer", { days: TRIAL_DAYS })}
          </p>
        )}

        {bill && (
          <div className="space-y-2 pt-3 border-t border-white/10" data-testid="adminbill-preview-subscription">
            <h3 className="text-sm font-semibold">{t("billing.title")}</h3>
            {bill.access && <p className="text-sm text-white/70">{t(bill.access.key, { date: fmt(bill.access.date) })}</p>}
            {bill.subscription && (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-white/50">{t("billing.planLabel")}</dt>
                  <dd data-testid="adminbill-preview-plan">{t(bill.subscription.planKey)}</dd>
                  <dt className="text-white/50">{t("billing.statusLabel")}</dt>
                  <dd data-testid="adminbill-preview-status">{t(bill.subscription.statusKey)}</dd>
                  <dt className="text-white/50">{t("billing.premiumFromSub")}</dt>
                  <dd>{bill.subscription.grantsPremium ? t("billing.on") : t("billing.off")}</dd>
                </dl>
                <p className="text-sm text-white/70" data-testid="adminbill-preview-explain">
                  {t(bill.subscription.explainKey, { date: fmt(bill.subscription.date) })}
                </p>
              </>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-white/10 space-y-2" data-testid="adminbill-preview-pricing">
          <h3 className="text-sm font-semibold">{t("premium.plans.title")}</h3>
          <p className="text-sm text-white/70">
            {t("premium.plans.free1", { n: FREE_LIMITS.structuredGoals })} · {t("premium.plans.free2", { n: FREE_LIMITS.routines })} · {t("premium.plans.free3", { n: FREE_LIMITS.notes })}
          </p>
          <p className="text-sm text-white/70">
            <span className="whitespace-nowrap">{t("premium.plans.monthly")}: {formatPriceCents(PRICING.monthly.amountCents)} {t("premium.plans.perMonth")}</span>
            {" · "}
            <span className="whitespace-nowrap">{t("premium.plans.annual")}: {formatPriceCents(PRICING.yearly.amountCents)} {t("premium.plans.perYear")}</span>
          </p>
        </div>

        <div className="pt-3 border-t border-white/10 space-y-2">
          <div className="flex flex-wrap gap-2" data-testid="adminbill-preview-actions">
            {showTrial && placeholder(t("premium.start", { days: TRIAL_DAYS }), "adminbill-preview-action-trial")}
            {showSubscribe && placeholder(t("checkout.subscribe", { plan: t("premium.plans.monthly") }), "adminbill-preview-action-subscribe")}
            {showManage && placeholder(t("portal.manage"), "adminbill-preview-action-manage")}
          </div>
          <p className="text-xs text-white/50">{t("adminBill.preview.disabledNote")}</p>
        </div>
      </div>
    </section>
  );
}

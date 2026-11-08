"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { billingView } from "@/lib/billingStatusView";
import { getMyBillingStatus, type BillingStatus as Status } from "@/lib/supabase/billingStatus";

// Settings > Premium > Subscription. READ-ONLY: it shows the member's own plan, subscription status, renewal or end date, cancellation, the
// 7-day payment grace period, and WHY they have Premium (subscription, admin grant or free trial). There are deliberately no Checkout,
// cancel or portal actions here. It shows nothing for a plain Free account, and nothing at all if the status can't be read: it never
// guesses, and it never describes a subscription as active just because the member has Premium from somewhere else.

export default function BillingStatus() {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    void getMyBillingStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const view = billingView(status);
  if (!view) return null;

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

  return (
    <section className="space-y-2 pt-3 border-t border-white/10" data-testid="billing-status" aria-labelledby="billing-status-title">
      <h3 id="billing-status-title" className="text-sm font-semibold">
        {t("billing.title")}
      </h3>

      {view.access && (
        <p className="text-sm text-white/70" data-testid="billing-access">
          {t(view.access.key, { date: fmt(view.access.date) })}
        </p>
      )}

      {view.subscription && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-white/50">{t("billing.planLabel")}</dt>
            <dd data-testid="billing-plan">{t(view.subscription.planKey)}</dd>
            <dt className="text-white/50">{t("billing.statusLabel")}</dt>
            <dd data-testid="billing-status-label">{t(view.subscription.statusKey)}</dd>
            <dt className="text-white/50">{t("billing.premiumFromSub")}</dt>
            <dd data-testid="billing-grants">{view.subscription.grantsPremium ? t("billing.on") : t("billing.off")}</dd>
          </dl>
          <p className="text-sm text-white/70" data-testid="billing-explain">
            {t(view.subscription.explainKey, { date: fmt(view.subscription.date) })}
          </p>
        </>
      )}
    </section>
  );
}

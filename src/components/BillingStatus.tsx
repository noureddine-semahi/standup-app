"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { billingView } from "@/lib/billingStatusView";
import { getMyBillingStatus, type BillingStatus as Status } from "@/lib/supabase/billingStatus";
import { portalEligible } from "@/lib/billing/subscriptionStates";
import { portalErrorMessageKey } from "@/lib/portalMessages";
import { loginUrlWithReturn } from "@/lib/safeReturn";
import { navigateTo } from "@/lib/navigate";
import { startPortal } from "@/lib/startPortal";
import { supabase } from "@/lib/supabase/client";
import type { TranslationKey } from "@/lib/i18n/en";

// Settings > Premium > Subscription. It SHOWS the member's own plan, subscription status, renewal or end date, cancellation, the 7-day payment
// grace period, and WHY they have Premium (subscription, admin grant or free trial). It shows nothing for a plain Free account, and nothing at
// all if the status can't be read: it never guesses, and it never describes a subscription as active just because the member has Premium from
// somewhere else.
//
// The one action is "Manage subscription", for a member whose subscription has something to manage (portalEligible) while the monetization
// flags permit it: it asks the server (startPortal) for Stripe's hosted Customer Portal and leaves for it. The page sends no customer or
// subscription ID; the server finds them. Nothing here changes access: cancellations and card updates reach StandUp only as verified webhooks.

export default function BillingStatus({ portalEnabled = false }: { portalEnabled?: boolean }) {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  useEffect(() => {
    let alive = true;
    void getMyBillingStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function manage() {
    if (busy) return; // one request at a time from this screen
    setBusy(true);
    setErrorKey(null);
    const result = await startPortal({ getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null });
    if (result.kind === "redirect") {
      navigateTo(result.url); // stay busy while the browser leaves for Stripe
      return;
    }
    if (result.kind === "login") {
      setErrorKey("portal.signInAgain");
      navigateTo(loginUrlWithReturn("/standup/settings")); // sign in again, then straight back here
      return;
    }
    setErrorKey(portalErrorMessageKey(result.code));
    setBusy(false);
  }

  const view = billingView(status);
  if (!view) return null;
  const canManage = portalEnabled && portalEligible(status?.status);

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

      {canManage && (
        <div className="space-y-2" data-testid="billing-manage">
          <button type="button" className="btn standup-metal-btn" disabled={busy} onClick={() => void manage()} data-testid="billing-manage-button">
            {busy ? t("portal.opening") : t("portal.manage")}
          </button>
          <p className="text-xs text-white/50">{t("portal.note")}</p>
          {errorKey && (
            <p className="text-sm text-amber-300" role="alert" data-testid="billing-manage-error">
              {t(errorKey)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

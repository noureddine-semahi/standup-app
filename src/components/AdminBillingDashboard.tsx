"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { PRICING, TRIAL_DAYS, formatPriceCents, yearlyPerMonthCents, yearlySavingsPercent } from "@/lib/entitlements";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import type { BillingOverviewResponse } from "@/lib/admin/billingOverview";
import type { TranslationKey } from "@/lib/i18n/en";

// The admin Premium & Billing numbers. Presentational: it shows what the server returned (aggregate counts and the three flag values) and nothing else.
// The feature flags are DISPLAY-ONLY: there is no toggle, button or form anywhere in this component.

function Stat({ label, value, testid, hint }: { label: string; value: string; testid: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 min-w-0">
      <div className="text-2xl font-bold tabular-nums" data-testid={testid}>
        {value}
      </div>
      <div className="text-xs text-white/60 mt-1 break-words">{label}</div>
      {hint && <div className="text-xs text-white/40 mt-1 break-words">{hint}</div>}
    </div>
  );
}

const FLAG_KEY: Record<(typeof FEATURE_FLAGS)[number], TranslationKey> = {
  premium_promotion_enabled: "adminBill.flag.premium_promotion_enabled",
  premium_trial_activation_enabled: "adminBill.flag.premium_trial_activation_enabled",
  billing_checkout_enabled: "adminBill.flag.billing_checkout_enabled",
};

export default function AdminBillingDashboard({ data }: { data: BillingOverviewResponse }) {
  const { t, language } = useLanguage();
  const n = (v: number) => new Intl.NumberFormat(language === "es" ? "es" : "en").format(v);
  const when = (() => {
    try {
      return new Intl.DateTimeFormat(language === "es" ? "es" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.generatedAt));
    } catch {
      return data.generatedAt;
    }
  })();
  const { accounts: a, subscriptions: s, premiumSources: p, flags } = data;
  const anyOn = FEATURE_FLAGS.some((f) => flags[f]);

  return (
    <div className="space-y-6" data-testid="adminbill-dashboard">
      <section className="card" aria-labelledby="adminbill-accounts-title">
        <h2 id="adminbill-accounts-title" className="text-lg font-semibold mb-1">{t("adminBill.accounts.title")}</h2>
        <p className="text-sm text-white/50 mb-4">{t("adminBill.accounts.subtitle")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={t("adminBill.accounts.total")} value={n(a.total)} testid="adminbill-accounts-total" />
          <Stat label={t("adminBill.accounts.free")} value={n(a.free)} testid="adminbill-accounts-free" hint={t("adminBill.accounts.trialAvailable", { count: n(a.trialAvailable) })} />
          <Stat label={t("adminBill.accounts.trial")} value={n(a.trial)} testid="adminbill-accounts-trial" />
          <Stat label={t("adminBill.accounts.premium")} value={n(a.premium)} testid="adminbill-accounts-premium" />
        </div>
      </section>

      <section className="card" aria-labelledby="adminbill-subs-title">
        <h2 id="adminbill-subs-title" className="text-lg font-semibold mb-1">{t("adminBill.subs.title")}</h2>
        <p className="text-sm text-white/50 mb-4">{t("adminBill.subs.subtitle", { count: n(s.total) })}</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label={t("adminBill.subs.active")} value={n(s.active)} testid="adminbill-subs-active" />
          <Stat label={t("adminBill.subs.scheduled")} value={n(s.scheduledCancellation)} testid="adminbill-subs-scheduled" />
          <Stat label={t("adminBill.subs.pastDue")} value={n(s.pastDue)} testid="adminbill-subs-pastdue" />
          <Stat label={t("adminBill.subs.canceled")} value={n(s.canceled)} testid="adminbill-subs-canceled" />
          <Stat label={t("adminBill.subs.other")} value={n(s.other)} testid="adminbill-subs-other" />
        </div>
      </section>

      <section className="card" aria-labelledby="adminbill-sources-title">
        <h2 id="adminbill-sources-title" className="text-lg font-semibold mb-1">{t("adminBill.sources.title")}</h2>
        <p className="text-sm text-white/50 mb-4">{t("adminBill.sources.subtitle")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat label={t("adminBill.sources.manual")} value={n(p.manualGrants)} testid="adminbill-sources-manual" hint={t("adminBill.sources.manualHint")} />
          <Stat label={t("adminBill.sources.stripe")} value={n(p.stripeSubscriptions)} testid="adminbill-sources-stripe" hint={t("adminBill.sources.stripeHint")} />
          <Stat label={t("adminBill.sources.both")} value={n(p.both)} testid="adminbill-sources-both" hint={t("adminBill.sources.bothHint")} />
        </div>
      </section>

      <section className="card" aria-labelledby="adminbill-pricing-title">
        <h2 id="adminbill-pricing-title" className="text-lg font-semibold mb-1">{t("adminBill.pricing.title")}</h2>
        <p className="text-sm text-white/50 mb-4">{t("adminBill.pricing.subtitle")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="adminbill-pricing">
          <Stat label={`${t("premium.plans.monthly")} (${t("premium.plans.perMonth")})`} value={formatPriceCents(PRICING.monthly.amountCents)} testid="adminbill-price-monthly" />
          <Stat label={`${t("premium.plans.annual")} (${t("premium.plans.perYear")})`} value={formatPriceCents(PRICING.yearly.amountCents)} testid="adminbill-price-annual" hint={t("premium.plans.annualHint", { price: formatPriceCents(yearlyPerMonthCents()), percent: yearlySavingsPercent() })} />
          <Stat label={t("adminBill.pricing.trial")} value={t("adminBill.pricing.trialDays", { days: TRIAL_DAYS })} testid="adminbill-trial-days" />
        </div>
      </section>

      <section className="card" aria-labelledby="adminbill-flags-title">
        <h2 id="adminbill-flags-title" className="text-lg font-semibold mb-1">{t("adminBill.flags.title")}</h2>
        <p className="text-sm text-white/50 mb-4">{t("adminBill.flags.subtitle")}</p>
        <ul className="space-y-2" data-testid="adminbill-flags">
          {FEATURE_FLAGS.map((f) => (
            <li key={f} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2" data-testid={`adminbill-flag-${f}`}>
              <span className="text-sm min-w-0 break-words">
                {t(FLAG_KEY[f])} <code className="text-xs text-white/40 break-all">{f}</code>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${flags[f] ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/70"}`} data-testid={`adminbill-flag-${f}-state`}>
                {flags[f] ? t("adminBill.flags.on") : t("adminBill.flags.off")}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-white/50" data-testid="adminbill-flags-note">
          {anyOn ? t("adminBill.flags.someOn") : t("adminBill.flags.allOff")}
        </p>
      </section>

      <p className="text-xs text-white/40" data-testid="adminbill-generated">
        {t("adminBill.generated", { when })}
      </p>
    </div>
  );
}

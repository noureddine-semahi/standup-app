"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { FREE_LIMITS, PRICING, formatPriceCents, yearlyPerMonthCents, yearlySavingsPercent } from "@/lib/entitlements";

// Settings > Premium: what Free and Premium include, and the two planned billing options. INFORMATION ONLY: choosing Monthly or Annual
// is a local view choice. It starts no payment and changes no entitlement, and there is deliberately no Subscribe button: paid
// subscriptions don't exist yet. (The free trial in the card above is the only way to get Premium from this screen.)

type Billing = "monthly" | "annual";

export default function PremiumPlans() {
  const { t } = useLanguage();
  const [billing, setBilling] = useState<Billing>("annual");

  const freeItems = [
    t("premium.plans.free1", { n: FREE_LIMITS.structuredGoals }),
    t("premium.plans.free2", { n: FREE_LIMITS.routines }),
    t("premium.plans.free3", { n: FREE_LIMITS.notes }),
    t("premium.plans.freeAlways"),
  ];
  const premiumItems = [t("premium.plans.prem1"), t("premium.plans.prem2"), t("premium.plans.prem3"), t("premium.plans.prem4")];

  const options: { id: Billing; label: string; price: string }[] = [
    { id: "monthly", label: t("premium.plans.monthly"), price: t("premium.plans.perMonth", { price: formatPriceCents(PRICING.monthly.amountCents) }) },
    { id: "annual", label: t("premium.plans.annual"), price: t("premium.plans.perYear", { price: formatPriceCents(PRICING.yearly.amountCents) }) },
  ];

  return (
    <section className="space-y-3 pt-3 border-t border-white/10" data-testid="premium-plans" aria-labelledby="premium-plans-title">
      <h3 id="premium-plans-title" className="text-sm font-semibold">
        {t("premium.plans.title")}
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/5 p-3" data-testid="premium-plans-free">
          <p className="text-sm font-semibold mb-2">{t("premium.tierFree")}</p>
          <ul className="space-y-1.5 text-sm text-white/70">
            {freeItems.map((item) => (
              <li key={item} className="flex gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-white/40" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-white/20 bg-white/10 p-3" data-testid="premium-plans-premium">
          <p className="text-sm font-semibold mb-2">{t("premium.tierPremium")}</p>
          <ul className="space-y-1.5 text-sm text-white/80">
            {premiumItems.map((item) => (
              <li key={item} className="flex gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div role="radiogroup" aria-label={t("premium.plans.billing")} className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const selected = billing === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setBilling(o.id)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-white/50 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
              data-testid={`premium-billing-${o.id}`}
            >
              <span className="block text-xs text-white/60">{o.label}</span>
              <span className="block text-sm font-semibold">{o.price}</span>
            </button>
          );
        })}
      </div>
      {billing === "annual" && (
        <p className="text-sm text-emerald-300" data-testid="premium-annual-hint">
          {t("premium.plans.annualHint", { price: formatPriceCents(yearlyPerMonthCents()), percent: yearlySavingsPercent() })}
        </p>
      )}

      <p className="text-sm text-white/60" role="note" data-testid="premium-not-available">
        {t("premium.plans.notAvailable")}
      </p>
    </section>
  );
}

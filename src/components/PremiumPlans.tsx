"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { FREE_LIMITS, PRICING, formatPriceCents, yearlyPerMonthCents, yearlySavingsPercent } from "@/lib/entitlements";
import type { TranslationKey } from "@/lib/i18n/en";
import { blocksNewCheckout } from "@/lib/billing/subscriptionStates";
import { checkoutErrorMessageKey } from "@/lib/checkoutMessages";
import { loginUrlWithReturn } from "@/lib/safeReturn";
import { navigateTo } from "@/lib/navigate";
import { startCheckout } from "@/lib/startCheckout";
import { supabase } from "@/lib/supabase/client";
import { getMyBillingStatus } from "@/lib/supabase/billingStatus";

// Settings > Premium: what Free and Premium include, and the two billing options. Choosing Monthly or Annual is a local view choice and
// changes nothing by itself. The Subscribe button appears ONLY when the card says checkout is allowed (both beta flags on); otherwise the
// section just says paid subscriptions aren't available yet. The button goes through the existing server endpoint (startCheckout), which
// re-checks the sign-in, both flags and the duplicate-subscription guard: hiding the button here is a courtesy, never the protection.
// Nothing here grants Premium; that only ever follows a verified payment (see CheckoutReturn).

type Billing = "monthly" | "annual";

export default function PremiumPlans({ checkoutEnabled = false }: { checkoutEnabled?: boolean }) {
  const { t } = useLanguage();
  const [billing, setBilling] = useState<Billing>("annual");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  // A friendly hint only: a member who already has a subscription isn't offered the button. The server refuses a second one regardless.
  useEffect(() => {
    if (!checkoutEnabled) return;
    let alive = true;
    void getMyBillingStatus().then((s) => {
      if (alive && s && s.status !== null && blocksNewCheckout(s.status)) setSubscribed(true);
    });
    return () => {
      alive = false;
    };
  }, [checkoutEnabled]);

  async function subscribe() {
    if (busy) return; // one request at a time from this screen (the server guards duplicates anyway)
    setBusy(true);
    setErrorKey(null);
    const result = await startCheckout(billing === "annual" ? "annual" : "monthly", {
      getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    });
    if (result.kind === "redirect") {
      navigateTo(result.url); // stay busy while the browser leaves for Stripe
      return;
    }
    if (result.kind === "login") {
      setErrorKey("checkout.signInAgain");
      navigateTo(loginUrlWithReturn("/standup/settings")); // sign in again, then straight back here
      return;
    }
    if (result.code === "already_subscribed") setSubscribed(true);
    setErrorKey(checkoutErrorMessageKey(result.code));
    setBusy(false);
  }

  const freeItems = [
    t("premium.plans.free1", { n: FREE_LIMITS.structuredGoals }),
    t("premium.plans.free2", { n: FREE_LIMITS.routines }),
    t("premium.plans.free3", { n: FREE_LIMITS.notes }),
    t("premium.plans.freeAlways"),
  ];
  const premiumItems = [t("premium.plans.prem1"), t("premium.plans.prem2"), t("premium.plans.prem3"), t("premium.plans.prem4")];

  // The amount and its period are separate no-wrap pieces, so a narrow box wraps between them and never inside "$5.99 / month".
  const options: { id: Billing; label: string; amount: string; period: string }[] = [
    { id: "monthly", label: t("premium.plans.monthly"), amount: formatPriceCents(PRICING.monthly.amountCents), period: t("premium.plans.perMonth") },
    { id: "annual", label: t("premium.plans.annual"), amount: formatPriceCents(PRICING.yearly.amountCents), period: t("premium.plans.perYear") },
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
              className={`relative rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-amber-400/80 bg-white/10 ring-1 ring-amber-400/50" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
              data-testid={`premium-billing-${o.id}`}
            >
              {selected && <Check size={14} className="absolute right-2 top-2 text-amber-400" aria-hidden="true" />}
              <span className="block text-xs text-white/60">{o.label}</span>
              <span className="flex flex-wrap items-baseline gap-x-1 text-sm font-semibold">
                <span className="whitespace-nowrap">{o.amount}</span> <span className="whitespace-nowrap text-xs font-normal text-white/70">{o.period}</span>
              </span>
            </button>
          );
        })}
      </div>
      {billing === "annual" && (
        <p className="text-sm text-emerald-300" data-testid="premium-annual-hint">
          {t("premium.plans.annualHint", { price: formatPriceCents(yearlyPerMonthCents()), percent: yearlySavingsPercent() })}
        </p>
      )}

      {checkoutEnabled ? (
        <div className="space-y-2" data-testid="premium-subscribe">
          {subscribed ? (
            <p className="text-sm text-white/70" data-testid="premium-have-subscription">
              {t("checkout.haveSubscription")}
            </p>
          ) : (
            <>
              <button type="button" className="btn standup-metal-btn standup-metal-btn--accent" disabled={busy} onClick={() => void subscribe()} data-testid="premium-subscribe-button">
                {busy ? t("checkout.opening") : t("checkout.subscribe", { plan: billing === "annual" ? t("premium.plans.annual") : t("premium.plans.monthly") })}
              </button>
              <p className="text-xs text-white/50">{t("checkout.secureNote")}</p>
            </>
          )}
          {errorKey && (
            <p className="text-sm text-amber-300" role="alert" data-testid="premium-subscribe-error">
              {t(errorKey)}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-white/60" role="note" data-testid="premium-not-available">
          {t("premium.plans.notAvailable")}
        </p>
      )}
    </section>
  );
}

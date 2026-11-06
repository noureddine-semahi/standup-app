"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { TRIAL_DAYS } from "@/lib/entitlements";
import { trialView } from "@/lib/trialView";
import { TrialNotAvailableError, getMyEntitlement, getMyTrialHistory, isEntitlementsUnavailableError, startMyTrial, type AccountEntitlement, type TrialHistory } from "@/lib/supabase/entitlements";
import { ConfirmActionModal } from "@/components/tools/PaymentsDashboard";
import PremiumPlans from "@/components/PremiumPlans";
import { showPremiumPromotion, showTrialOffer } from "@/lib/featureFlags";
import { useFeatureFlags } from "@/lib/useFeatureFlags";

// Account settings > Premium. Shows the current plan and, if the one-time trial is still available, a "Start 14-Day Free Trial"
// action. The trial starts ONLY when the user confirms in the dialog; nothing here runs on page load or at signup. No payment is
// involved: this calls the database's trial function and nothing else.

type Phase = "loading" | "ready" | "error";

export default function PremiumTrialCard() {
  const { t, language } = useLanguage();
  const flags = useFeatureFlags(); // all off until the server says otherwise: the free beta shows no Premium promotion
  const [phase, setPhase] = useState<Phase>("loading");
  const [ent, setEnt] = useState<AccountEntitlement | null>(null);
  const [history, setHistory] = useState<TrialHistory | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, h] = await Promise.all([getMyEntitlement(), getMyTrialHistory()]);
      setEnt(e);
      setHistory(h);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const view = useMemo(() => (ent && history ? trialView({ tier: ent.tier, trialEndsAt: ent.trialEndsAt, trialStartedAt: ent.trialStartedAt, trialUsed: history.used || ent.storedTier === "premium_trial" }) : null), [ent, history]);

  const formatDate = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(language === "es" ? "es" : "en", { dateStyle: "long" }).format(d);
    } catch {
      return d.toLocaleDateString();
    }
  };

  async function activate(): Promise<string | null> {
    try {
      await startMyTrial();
    } catch (e) {
      if (e instanceof TrialNotAvailableError) {
        await load(); // the truth may differ from what was on screen (used elsewhere, or already Premium)
        if (e.reason === "already_used") return t("premium.alreadyUsed");
        if (e.reason === "already_premium") return t("premium.alreadyPremium");
        if (e.reason === "activation_disabled") return t("premium.activationDisabled");
        return t("premium.startFailed");
      }
      return isEntitlementsUnavailableError(e) ? t("premium.unavailable") : t("premium.startFailed");
    }
    await load(); // show the new plan and its end date
    return null;
  }

  const tierLabel = view ? (view.tier === "premium" ? t("premium.tierPremium") : view.tier === "premium_trial" ? t("premium.tierTrial") : t("premium.tierFree")) : "";

  return (
    <div className="card" data-testid="premium-card">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
        <Sparkles size={16} aria-hidden="true" /> {t("premium.title")}
      </h2>

      {phase === "loading" && (
        <p className="text-sm text-white/50" role="status" data-testid="premium-loading">
          {t("premium.loading")}
        </p>
      )}
      {phase === "error" && (
        <p className="text-sm text-red-300" role="alert" data-testid="premium-error">
          {t("premium.loadFailed")}{" "}
          <button type="button" className="underline" onClick={() => void load()} data-testid="premium-retry">
            {t("premium.retry")}
          </button>
        </p>
      )}

      {phase === "ready" && view && (
        <div className="space-y-3">
          <p className="text-sm text-white/70">
            {t("premium.currentPlan")}: <strong data-testid="premium-tier">{tierLabel}</strong>
          </p>

          {view.tier === "premium_trial" && (
            <p className="text-sm text-white/70" data-testid="premium-trial-info">
              {t("premium.trialEnds", { date: formatDate(view.endsAt) })} · {t("premium.daysLeft", { days: view.daysLeft })}
            </p>
          )}
          {view.tier === "premium" && <p className="text-sm text-white/70">{t("premium.premiumNote")}</p>}
          {view.trialEnded && (
            <p className="text-sm text-white/70" data-testid="premium-trial-ended">
              {t("premium.trialEnded")}
            </p>
          )}

          {view.canStart && showTrialOffer(flags) && (
            <div className="space-y-2">
              <p className="text-sm text-white/70" data-testid="premium-offer">
                {t("premium.offer", { days: TRIAL_DAYS })}
              </p>
              <button type="button" className="btn standup-metal-btn standup-metal-btn--accent" onClick={() => setConfirming(true)} data-testid="premium-start">
                {t("premium.start", { days: TRIAL_DAYS })}
              </button>
            </div>
          )}

          {view.tier !== "premium" && showPremiumPromotion(flags) && <PremiumPlans />}
        </div>
      )}

      {confirming && (
        <ConfirmActionModal
          title={t("premium.confirmTitle", { days: TRIAL_DAYS })}
          body={t("premium.confirmBody", { days: TRIAL_DAYS })}
          confirmLabel={t("premium.confirm")}
          busyLabel={t("premium.starting")}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            const err = await activate();
            if (!err) setConfirming(false);
            return err;
          }}
        />
      )}
    </div>
  );
}

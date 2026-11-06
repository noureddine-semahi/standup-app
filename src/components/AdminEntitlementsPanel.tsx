"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { AdminEntitlementError, getAdminEntitlement, setAdminEntitlement, type AdminEntitlement, type AdminSettableTier } from "@/lib/supabase/adminEntitlements";
import { ConfirmActionModal } from "@/components/tools/PaymentsDashboard";

// Admin > Plans. Pick a member to see their stored and effective plan and trial status; Sys Admins can grant Premium or set the plan
// back to Free. Who may do what is enforced by the database; `canChange` only decides whether the buttons are offered. Every change is
// recorded in the admin audit log below, and nothing a member has created is touched.

type Member = { id: string; email: string; displayName: string | null };

export default function AdminEntitlementsPanel({ members, canChange }: { members: readonly Member[]; canChange: boolean }) {
  const { t, language } = useLanguage();
  const [userId, setUserId] = useState("");
  const [ent, setEnt] = useState<AdminEntitlement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminSettableTier | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const member = members.find((m) => m.id === userId) ?? null;

  const refusalText = useCallback(
    (e: unknown) => {
      if (e instanceof AdminEntitlementError) {
        if (e.reason === "not_admin" || e.reason === "not_sys_admin") return t("adminEnt.forbidden");
        if (e.reason === "user_not_found") return t("adminEnt.userNotFound");
      }
      return t("adminEnt.failed");
    },
    [t]
  );

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        setEnt(await getAdminEntitlement(id));
      } catch (e) {
        setEnt(null);
        setError(refusalText(e));
      } finally {
        setLoading(false);
      }
    },
    [refusalText]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (userId) void load(userId);
    else setEnt(null);
  }, [userId, load]);

  const tierName = (tier: string) => (tier === "premium" ? t("premium.tierPremium") : tier === "premium_trial" ? t("premium.tierTrial") : t("premium.tierFree"));
  const fmt = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    try {
      return new Intl.DateTimeFormat(language === "es" ? "es" : "en", { dateStyle: "medium", timeStyle: "short" }).format(d);
    } catch {
      return d.toLocaleString();
    }
  };

  return (
    <div className="card space-y-4" data-testid="admin-ent">
      <div>
        <h2 className="text-lg font-semibold mb-1">{t("adminEnt.title")}</h2>
        <p className="text-sm text-white/50">{canChange ? t("adminEnt.subtitleSys") : t("adminEnt.subtitleView")}</p>
      </div>

      <label className="block text-sm">
        <span className="text-white/70">{t("adminEnt.member")}</span>
        <select
          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setNotice(null);
          }}
          data-testid="admin-ent-member"
        >
          <option value="">{t("adminEnt.choose")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName ? `${m.displayName} (${m.email})` : m.email}
            </option>
          ))}
        </select>
      </label>

      {loading && (
        <p className="text-sm text-white/50" role="status">
          {t("adminEnt.loading")}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-300" role="alert" data-testid="admin-ent-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-emerald-300" role="status" data-testid="admin-ent-notice">
          {notice}
        </p>
      )}

      {ent && member && !loading && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-testid="admin-ent-view">
          <dt className="text-white/50">{t("adminEnt.effective")}</dt>
          <dd data-testid="admin-ent-effective">{tierName(ent.effectiveTier)}</dd>
          <dt className="text-white/50">{t("adminEnt.stored")}</dt>
          <dd data-testid="admin-ent-stored">{tierName(ent.storedTier)}</dd>
          <dt className="text-white/50">{t("adminEnt.trial")}</dt>
          <dd data-testid="admin-ent-trial">
            {ent.trialUsed ? (ent.effectiveTier === "premium_trial" ? t("adminEnt.trialActive") : t("adminEnt.trialUsed")) : t("adminEnt.trialNever")}
          </dd>
          <dt className="text-white/50">{t("adminEnt.trialStart")}</dt>
          <dd>{fmt(ent.trialStartedAt)}</dd>
          <dt className="text-white/50">{t("adminEnt.expires")}</dt>
          <dd data-testid="admin-ent-expires">{fmt(ent.trialEndsAt)}</dd>
        </dl>
      )}

      {ent && member && canChange && !loading && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn standup-metal-btn standup-metal-btn--accent" disabled={ent.storedTier === "premium"} onClick={() => setPending("premium")} data-testid="admin-ent-grant">
            {t("adminEnt.grant")}
          </button>
          <button type="button" className="btn standup-metal-btn" disabled={ent.storedTier === "free"} onClick={() => setPending("free")} data-testid="admin-ent-revoke">
            {t("adminEnt.revoke")}
          </button>
        </div>
      )}

      {pending && member && (
        <ConfirmActionModal
          title={pending === "premium" ? t("adminEnt.confirmGrantTitle") : t("adminEnt.confirmRevokeTitle")}
          body={(pending === "premium" ? t("adminEnt.confirmGrantBody") : t("adminEnt.confirmRevokeBody"))
            .replace("{name}", member.displayName || member.email)}
          confirmLabel={pending === "premium" ? t("adminEnt.grant") : t("adminEnt.revoke")}
          busyLabel={t("adminEnt.saving")}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            try {
              setEnt(await setAdminEntitlement(member.id, pending));
              setNotice(pending === "premium" ? t("adminEnt.granted") : t("adminEnt.revoked"));
              setPending(null);
              return null;
            } catch (e) {
              return refusalText(e);
            }
          }}
        />
      )}
    </div>
  );
}

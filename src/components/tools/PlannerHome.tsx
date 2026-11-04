"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { Bill } from "@/lib/bills";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { Subscription } from "@/lib/subscriptions";
import { emptyProfile, profileCompletion } from "@/lib/financialPlanner";
import { DEFAULT_PARTNER_NAME, MAX_PARTNER_NAME, parsePartnerName, type PlannerPerson } from "@/lib/household";
import FinancialPlanner from "./FinancialPlanner";
import { ConfirmActionModal, FIELD_CLASS } from "./PaymentsDashboard";
import type { FinancialProfileController } from "./useFinancialProfile";
import { partnerAsController, type HouseholdController } from "./useHousehold";

// Tools > Planner, household Phase 1. A Me / Partner / Household switcher above the same Planner screens:
//  - Me: the signed-in user's own profile, exactly as before.
//  - Partner: one optional partner whose profile the signed-in user manages (no StandUp account needed).
//  - Household: a labelled placeholder. No household totals exist yet, and none are shown or implied.

export default function PlannerHome({
  me,
  household,
  bills,
  accounts,
  subscriptions,
  todayISO,
}: {
  me: FinancialProfileController;
  household: HouseholdController;
  bills: readonly Bill[];
  accounts: readonly PaymentAccount[];
  subscriptions: readonly Subscription[];
  todayISO: string;
}) {
  const { t } = useLanguage();
  const [person, setPerson] = useState<PlannerPerson>("me");
  const partner = household.partner;
  const partnerName = partner?.name ?? DEFAULT_PARTNER_NAME;

  const tabs: { key: PlannerPerson; label: string }[] = [
    { key: "me", label: t("plan.personMe") },
    { key: "partner", label: partner ? partner.name : t("plan.personPartner") },
    { key: "household", label: t("plan.personHousehold") },
  ];

  return (
    <div className="pay-panel plan-panel plan-root plan-home">
      <div className="plan-people" role="tablist" aria-label={t("plan.peopleLabel")}>
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={person === x.key} className="plan-people-btn" data-testid={`plan-person-${x.key}`} title={x.label} onClick={() => setPerson(x.key)}>
            {x.label}
          </button>
        ))}
      </div>

      {person === "me" && <FinancialPlanner key="me" embedded controller={me} bills={bills} accounts={accounts} subscriptions={subscriptions} todayISO={todayISO} />}

      {person === "partner" && <PartnerView household={household} bills={bills} accounts={accounts} subscriptions={subscriptions} todayISO={todayISO} partnerName={partnerName} />}

      {person === "household" && (
        <section className="plan-glass plan-empty-card" data-testid="plan-household-soon" aria-label={t("plan.householdTitle")}>
          <h4>{t("plan.householdTitle")}</h4>
          <p>{t("plan.householdSoon")}</p>
          <div>
            <p className="plan-card-title">{t("plan.householdProgress")}</p>
            <ul className="plan-status-list">
              <li data-testid="plan-household-me">{t("plan.householdMeProgress", { pct: profileCompletion(me.profile).percent })}</li>
              {partner ? (
                <li data-testid="plan-household-partner">{t("plan.householdPartnerProgress", { name: partner.name, pct: profileCompletion(partner.profile, "partner").percent })}</li>
              ) : (
                <li>{t("plan.householdNoPartner")}</li>
              )}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function PartnerView({
  household,
  bills,
  accounts,
  subscriptions,
  todayISO,
  partnerName,
}: {
  household: HouseholdController;
  bills: readonly Bill[];
  accounts: readonly PaymentAccount[];
  subscriptions: readonly Subscription[];
  todayISO: string;
  partnerName: string;
}) {
  const { t } = useLanguage();
  const h = household;
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (h.state === "loading") return <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>;
  if (h.state === "unavailable")
    return (
      <div role="status" className="pay-error pay-error-page" data-testid="plan-partner-unavailable">
        {t("plan.partnerUnavailable")}
      </div>
    );
  if (h.state === "error")
    return (
      <div role="alert" className="pay-error pay-error-page">
        {h.loadError ?? t("plan.failed")}
      </div>
    );

  async function add() {
    const parsed = parsePartnerName(name);
    if (!parsed.ok) return setNameError(t("plan.partnerNameError"));
    setNameError(null);
    setAdding(true);
    setError(null);
    const msg = await h.addPartner(parsed.name);
    setAdding(false);
    if (msg) setError(msg);
    else setName("");
  }

  async function saveName() {
    const parsed = parsePartnerName(renameText);
    if (!parsed.ok) return setNameError(t("plan.partnerNameError"));
    setNameError(null);
    const msg = await h.renamePartner(parsed.name);
    if (msg) setError(msg);
    else setRenaming(false);
  }

  // ── no partner yet ──
  if (!h.partner) {
    return (
      <section className="plan-glass plan-empty-card" data-testid="plan-partner-empty" aria-label={t("plan.partnerEmptyTitle")}>
        <h4>{t("plan.partnerEmptyTitle")}</h4>
        <p>{t("plan.partnerEmptyBody")}</p>
        <label className="pay-field">
          <span className="pay-label">{t("plan.partnerNameLabel")}</span>
          <input type="text" autoComplete="off" maxLength={MAX_PARTNER_NAME + 20} placeholder={DEFAULT_PARTNER_NAME} value={name} onChange={(e) => setName(e.target.value)} disabled={adding} className={FIELD_CLASS} aria-invalid={!!nameError} />
          {nameError && (
            <span className="pay-field-error" role="alert">
              {nameError}
            </span>
          )}
        </label>
        {error && (
          <div role="alert" className="pay-error">
            {error}
          </div>
        )}
        <button type="button" className="plan-btn plan-gold" onClick={add} disabled={adding} data-testid="plan-partner-add">
          <UserPlus size={16} aria-hidden="true" />
          {adding ? t("plan.partnerAdding") : t("plan.partnerAdd")}
        </button>
      </section>
    );
  }

  // ── partner exists ──
  const partner = h.partner;
  return (
    <>
      <div className="plan-partner-bar" data-testid="plan-partner-bar">
        {renaming ? (
          <>
            <label className="pay-field plan-partner-bar-name">
              <span className="pay-label">{t("plan.partnerNameLabel")}</span>
              <input type="text" autoComplete="off" value={renameText} onChange={(e) => setRenameText(e.target.value)} className={FIELD_CLASS} aria-invalid={!!nameError} autoFocus />
              {nameError && (
                <span className="pay-field-error" role="alert">
                  {nameError}
                </span>
              )}
            </label>
            <button type="button" className="plan-btn plan-gold" onClick={saveName} data-testid="plan-partner-rename-save">
              {t("plan.partnerRenameSave")}
            </button>
          </>
        ) : (
          <>
            <span className="plan-partner-bar-name" data-testid="plan-partner-name">
              {partner.name}
            </span>
            <button
              type="button"
              className="plan-btn"
              onClick={() => {
                setRenameText(partner.name);
                setNameError(null);
                setError(null);
                setRenaming(true);
              }}
              data-testid="plan-partner-rename"
            >
              {t("plan.partnerRename")}
            </button>
            <button type="button" className="plan-btn" onClick={() => setConfirmRemove(true)} data-testid="plan-partner-remove">
              {t("plan.partnerRemove")}
            </button>
          </>
        )}
      </div>
      {error && (
        <div role="alert" className="pay-error">
          {error}
        </div>
      )}

      <FinancialPlanner key={partner.id} embedded person="partner" personName={partnerName} controller={partnerAsController(h, emptyProfile())} bills={bills} accounts={accounts} subscriptions={subscriptions} todayISO={todayISO} />

      {confirmRemove && (
        <ConfirmActionModal
          title={t("plan.partnerRemoveTitle", { name: partner.name })}
          body={t("plan.partnerRemoveBody", { name: partner.name })}
          confirmLabel={t("plan.partnerRemoveConfirm")}
          busyLabel={t("plan.partnerRemoving")}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            const msg = await h.removePartner();
            if (!msg) setConfirmRemove(false);
            return msg;
          }}
        />
      )}
    </>
  );
}

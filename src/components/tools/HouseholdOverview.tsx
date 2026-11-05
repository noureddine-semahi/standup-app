"use client";

import { useMemo, useState } from "react";
import { Coins, Home, Receipt, Users, Wallet } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { valueLenStyle } from "@/lib/toolsLayout";
import type { Bill } from "@/lib/bills";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { Subscription } from "@/lib/subscriptions";
import { buildHouseholdPlan, emptyComposition, emptyShared, type HouseholdPlan } from "@/lib/householdPlan";
import { buildOverview, type Figure, type OverviewModel } from "@/lib/householdOverview";
import { buildPlanView, type PlanView } from "@/lib/householdPlanView";
import HouseholdPlanDashboard from "./HouseholdPlanDashboard";
import type { FinancialProfileController } from "./useFinancialProfile";
import type { HouseholdController } from "./useHousehold";
import { useHouseholdOverview } from "./useHouseholdOverview";
import SharedTab from "./SharedTab";
import { DuplicatesCard, IntegrityAlert, ProvisionalNotice, Responsibility, WarningsCard, fmt, sizePartsText, textOf } from "./HouseholdParts";

// Tools > Planner > Household. Phase 2, Step 3: the Overview. Everything shown comes from buildHouseholdPlan (the one
// calculation module) through buildOverview (display rules only). This screen never saves shared household data: the
// only write it can make is the partner's include_in_household switch. Shared and Plan are labelled placeholders.


type Section = "overview" | "shared" | "plan";

export default function HouseholdOverview({
  me,
  household,
  bills,
  accounts,
  subscriptions,
  todayISO,
  onAddPartner,
}: {
  me: FinancialProfileController;
  household: HouseholdController;
  bills: readonly Bill[];
  accounts: readonly PaymentAccount[];
  subscriptions: readonly Subscription[];
  todayISO: string;
  onAddPartner: () => void;
}) {
  const { t } = useLanguage();
  const [section, setSection] = useState<Section>("overview");
  const partner = household.partner;
  const ctl = useHouseholdOverview(partner?.id ?? null, t("hh.loadFailed"));
  const data = ctl.data;

  const built = useMemo<{ plan: HouseholdPlan; model: OverviewModel; planView: PlanView } | null>(() => {
    if (data.phase !== "ready") return null;
    const shared = data.shared;
    const plan = buildHouseholdPlan({
      me: { profile: me.profile },
      partner: partner ? { profile: partner.profile, name: partner.name, included: data.included } : null,
      shared: shared ? shared.shared : emptyShared(),
      composition: shared ? shared.composition : emptyComposition(),
      records: { bills, accounts, subscriptions },
      todayISO,
    });
    const model = buildOverview({
      plan,
      shared: shared ? shared.shared : emptyShared(),
      integrity: shared ? shared.integrity : { ok: true, issues: [], fingerprint: "" },
      droppedItems: shared ? shared.droppedItems : 0,
      meName: t("plan.personMe"),
      partnerName: partner ? partner.name : null,
      subscriptions,
    });
    const planView = buildPlanView({ plan, model, shared: shared ? shared.shared : emptyShared(), profiles: { me: me.profile, partner: partner ? partner.profile : null }, unreadable: !!shared && !shared.integrity.ok });
    return { plan, model, planView };
  }, [data, me.profile, partner, bills, accounts, subscriptions, todayISO, t]);
  const model = built ? built.model : null;

  const tabs: { key: Section; label: string }[] = [
    { key: "overview", label: t("hh.navOverview") },
    { key: "shared", label: t("hh.navShared") },
    { key: "plan", label: t("hh.navPlan") },
  ];

  // The Me and Partner profiles are the foundation. If either can't load, say so instead of showing figures.
  if (me.state === "loading" || household.state === "loading") return <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>;
  if (me.state === "unavailable")
    return (
      <div role="status" className="pay-error pay-error-page" data-testid="hh-me-unavailable">
        {t("plan.unavailable")}
      </div>
    );
  if (household.state === "unavailable")
    return (
      <div role="status" className="pay-error pay-error-page" data-testid="hh-partner-unavailable">
        {t("plan.partnerUnavailable")}
      </div>
    );
  if (me.state === "error" || household.state === "error")
    return (
      <div role="alert" className="pay-error pay-error-page">
        {me.loadError ?? household.loadError ?? t("plan.failed")}
      </div>
    );

  const heading = !partner ? t("hh.headingMe") : data.phase === "ready" && !data.included ? t("hh.headingExcluded", { name: partner.name }) : t("hh.headingBoth", { name: partner.name });

  return (
    <div className="hh-root" data-testid="hh-root">
      <div className="plan-header">
        <div>
          <h3 className="plan-title" data-testid="hh-title">
            {t("hh.title")}
          </h3>
          <p className="plan-subtitle" data-testid="hh-heading">
            {heading}
          </p>
        </div>
      </div>

      {partner ? (
        <section className="plan-source hh-include" data-checked={data.phase === "ready" && data.included} data-testid="hh-include">
          <label className="plan-check">
            <input
              type="checkbox"
              data-testid="hh-include-toggle"
              checked={data.phase === "ready" ? data.included : true}
              disabled={data.phase !== "ready" || ctl.saving}
              onChange={(e) => void ctl.setIncluded(e.target.checked)}
            />
            <span>{ctl.saving ? t("hh.includeSaving") : t("hh.includeLabel", { name: partner.name })}</span>
          </label>
          <p className="plan-row-note plan-source-note">{t("hh.includeHelp", { name: partner.name })}</p>
          {ctl.includeError && (
            <div role="alert" className="pay-error" data-testid="hh-include-error">
              {t("hh.includeError")}
            </div>
          )}
        </section>
      ) : (
        <section className="plan-note hh-nopartner" data-testid="hh-no-partner">
          <span>{t("hh.noPartner")}</span>{" "}
          <button type="button" className="plan-link" onClick={onAddPartner} data-testid="hh-add-partner">
            {t("hh.addPartner")}
          </button>
        </section>
      )}

      <div className="plan-seg" role="tablist" aria-label={t("hh.navLabel")}>
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={section === x.key} data-testid={`hh-nav-${x.key}`} className="plan-seg-btn" onClick={() => setSection(x.key)}>
            {x.label}
          </button>
        ))}
      </div>

      {section === "shared" && data.phase === "loading" && <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>}
      {section === "shared" && data.phase === "error" && (
        <div role="alert" className="pay-error pay-error-page" data-testid="hh-load-error">
          {data.message}{" "}
          <button type="button" className="plan-link" onClick={ctl.reload} data-testid="hh-retry">
            {t("hh.retry")}
          </button>
        </div>
      )}
      {section === "shared" && data.phase === "ready" && (data.shared && built ? (
        <SharedTab ctl={ctl} state={data.shared} included={data.included} plan={built.plan} model={built.model} me={me.profile} partner={partner} bills={bills} accounts={accounts} subscriptions={subscriptions} todayISO={todayISO} />
      ) : (
        <div role="status" className="plan-note" data-testid="se-unavailable">
          {t("se.unavailable")}
        </div>
      ))}
      {section === "plan" && data.phase === "ready" && built && (
        <HouseholdPlanDashboard plan={built.plan} model={built.model} view={built.planView} sharedUnavailable={data.shared === null} state={data.shared} />
      )}

      {section !== "shared" && data.phase === "loading" && <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>}
      {section !== "shared" && data.phase === "error" && (
        <div role="alert" className="pay-error pay-error-page" data-testid="hh-load-error">
          {data.message}{" "}
          <button type="button" className="plan-link" onClick={ctl.reload} data-testid="hh-retry">
            {t("hh.retry")}
          </button>
        </div>
      )}
      {section === "overview" && data.phase === "ready" && model && (
        <Overview model={model} sharedUnavailable={data.shared === null} stored={data.shared ? { stored: data.shared.stored, integrity: data.shared.integrity } : null} />
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────

function Overview({ model, sharedUnavailable, stored }: { model: OverviewModel; sharedUnavailable: boolean; stored: { stored: Parameters<typeof IntegrityAlert>[0]["stored"]; integrity: Parameters<typeof IntegrityAlert>[0]["integrity"] } | null }) {
  const { t } = useLanguage();
  const dash = t("plan.dash");
  const m = model;

  type Tile = { key: string; Icon: typeof Wallet; tone: string; label: string; f: Figure; notes: string[]; testId: string };
  const incomeNotes: string[] = [];
  if (m.income.figure.kind === "unknown") incomeNotes.push(t("hh.noteNotEntered"));
  else if (m.income.figure.kind === "atLeast") incomeNotes.push(t("hh.notePartial"));
  if (m.income.figure.kind !== "unknown" && m.income.figure.estimate) incomeNotes.push(t("hh.noteEstimate"));
  if (m.income.lowCents !== null && m.income.figure.kind === "amount") incomeNotes.push(t("hh.noteLowMonth", { amount: fmt(m.income.lowCents) }));
  const spendNotes: string[] = [];
  if (m.spending.figure.kind === "unknown") spendNotes.push(t("hh.noteNotEntered"));
  else if (m.spending.figure.kind === "atLeast") spendNotes.push(t("hh.notePartial"));
  else spendNotes.push(t("hh.noteTotalAll"));
  if (m.spending.figure.kind !== "unknown" && m.spending.figure.estimate) spendNotes.push(t("hh.noteEstimate"));
  const sharedNotes: string[] = [];
  const sharedCount = m.shared.expenseCount + m.shared.debtCount;
  if (m.shared.figure.kind === "unknown") sharedNotes.push(t("hh.noteNotEntered"));
  else if (m.shared.figure.kind === "atLeast") sharedNotes.push(t("hh.notePartial"));
  if (sharedCount > 0) sharedNotes.push(t("hh.noteSharedItems", { count: sharedCount }));
  else if (m.shared.answered.expenses && m.shared.answered.debts) sharedNotes.push(t("hh.noteSharedNone"));
  if (m.shared.representedCount > 0) sharedNotes.push(t("hh.noteRepresented", { count: m.shared.representedCount }));
  if (m.shared.figure.kind !== "unknown" && m.shared.figure.estimate) sharedNotes.push(t("hh.noteEstimate"));
  const sizeFig: Figure = m.size.status === "complete" && m.size.total !== null ? { kind: "amount", cents: m.size.total, estimate: false } : m.size.status === "partial" && m.size.knownTotal > 0 ? { kind: "atLeast", cents: m.size.knownTotal, estimate: false } : { kind: "unknown" };

  const tiles: Tile[] = [
    { key: "income", Icon: Wallet, tone: "green", label: t("hh.tileIncome"), f: m.income.figure, notes: incomeNotes, testId: "hh-income" },
    { key: "spending", Icon: Receipt, tone: "blue", label: t("hh.tileSpending"), f: m.spending.figure, notes: spendNotes, testId: "hh-spending" },
    { key: "shared", Icon: Home, tone: "gold", label: t("hh.tileShared"), f: m.shared.figure, notes: sharedNotes, testId: "hh-shared-total" },
  ];

  const avail = m.available;
  const availTone = avail.kind === "definitive" ? avail.tone : "none";
  const availText = avail.kind === "unknown" ? dash : fmt(avail.cents);

  const parts = m.size.parts;
  const sizeNote =
    sizeFig.kind === "unknown"
      ? t("hh.sizeLater")
      : sizeFig.kind === "atLeast"
        ? t("hh.sizeLaterPartial")
        : sizePartsText(parts, t);

  return (
    <>
      {sharedUnavailable && (
        <div role="status" className="plan-note" data-testid="hh-shared-unavailable">
          {t("hh.sharedUnavailable")}
        </div>
      )}
      {!m.integrity.ok && stored && <IntegrityAlert model={m} stored={stored.stored} integrity={stored.integrity} />}

      <section className="plan-tiles" aria-label={t("hh.title")}>
        {tiles.map((tile) => (
          <div key={tile.key} className="plan-tile" data-tone={tile.tone} data-tile={tile.key}>
            <span className="plan-icon-chip" data-tone={tile.tone}>
              <tile.Icon size={20} aria-hidden="true" />
            </span>
            <div className="plan-tile-body">
              <div className="plan-tile-label">{tile.label}</div>
              {tile.f.kind === "atLeast" && <div className="hh-qual">{t("hh.atLeast")}</div>}
              <div className="plan-tile-value" style={valueLenStyle(textOf(tile.f, dash)) as React.CSSProperties} data-kind={tile.f.kind} data-testid={tile.testId}>
                {textOf(tile.f, dash)}
              </div>
              {tile.notes.map((n) => (
                <div key={n} className="plan-tile-note">
                  {n}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="plan-tile" data-tone="violet" data-tile="size">
          <span className="plan-icon-chip" data-tone="violet">
            <Users size={20} aria-hidden="true" />
          </span>
          <div className="plan-tile-body">
            <div className="plan-tile-label">{t("hh.tileSize")}</div>
            {sizeFig.kind === "atLeast" && <div className="hh-qual">{t("hh.atLeast")}</div>}
            <div className="plan-tile-value" style={valueLenStyle(sizeFig.kind === "unknown" ? dash : String(sizeFig.cents)) as React.CSSProperties} data-kind={sizeFig.kind} data-testid="hh-size">
              {sizeFig.kind === "unknown" ? dash : sizeFig.cents}
            </div>
            {sizeNote && <div className="plan-tile-note">{sizeNote}</div>}
          </div>
        </div>
      </section>

      <section className="plan-avail" data-tone={availTone} data-kind={avail.kind} data-tile="available" aria-label={t("hh.availTitle")} data-testid="hh-available-card">
        <span className="plan-icon-chip plan-icon-lg" data-tone={availTone === "negative" ? "red" : availTone === "positive" ? "green" : "none"}>
          <Coins size={26} aria-hidden="true" />
        </span>
        <div className="plan-avail-body">
          <div className="plan-tile-label">
            {t("hh.availTitle")}
            {avail.kind === "provisional" && (
              <>
                {" "}
                <span className="plan-chip" data-status="partial" data-testid="hh-available-provisional">
                  {t("hh.availProvisional")}
                </span>
              </>
            )}
          </div>
          <div className="plan-avail-line">
            <span className="plan-avail-value" style={valueLenStyle(availText) as React.CSSProperties} data-testid="hh-available" data-kind={avail.kind}>
              {availText}
            </span>
            {avail.kind !== "unknown" && <span className="plan-avail-unit">{t("plan.perMonth")}</span>}
          </div>
          {avail.kind === "provisional" && (
            <ProvisionalNotice model={m} assumptions={avail.assumptions} prefix="hh" />
          )}
          {avail.kind === "unknown" && <div className="plan-tile-note">{t("hh.availUnknownBody")}</div>}
          {avail.kind !== "unknown" && avail.estimate && <div className="plan-tile-note">{t("hh.noteEstimate")}</div>}
          {m.shortfall === "definite" && (
            <div className="plan-warn" role="status" data-testid="hh-shortfall">
              {t("hh.availShortfall")}
            </div>
          )}
        </div>
      </section>

      <Responsibility model={m} />

      {m.informational.length > 0 && (
        <section className="plan-glass" data-testid="hh-informational" aria-label={t("hh.infoTitle")}>
          <h4 className="plan-card-title">{t("hh.infoTitle")}</h4>
          <p className="plan-row-note">{t("hh.infoBody")}</p>
          <ul className="hh-list">
            {m.informational.map((i) => (
              <li key={i.id}>
                {t("hh.infoLine", { label: i.label, meName: m.names.me, meAmount: fmt(i.meCents), partnerName: m.names.partner ?? "", partnerAmount: fmt(i.partnerCents) })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <WarningsCard model={m} />

      <DuplicatesCard model={m} />
    </>
  );
}

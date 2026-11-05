"use client";

import { Coins, Landmark, PiggyBank, Receipt, Wallet } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { HouseholdPlan } from "@/lib/householdPlan";
import type { OverviewModel } from "@/lib/householdOverview";
import type { ChartSegment, ChartView, GoalRow, PlanView, SegmentKey } from "@/lib/householdPlanView";
import type { ReadyState } from "@/lib/supabase/householdShared";
import type { Figure } from "@/lib/householdOverview";
import { IntegrityAlert, PartialList, ProvisionalNotice, Responsibility, Value, WarningsCard, fmt } from "./HouseholdParts";
import { percentText } from "@/lib/plannerView";
import { hintFor, statusLabel } from "./SharedGoalsEditor";
import type { TFn } from "./SharedEditorParts";

// Tools > Planner > Household > Plan (Phase 2, Step 5). Every figure comes from the household calculation module through
// the Overview and Plan view-models; this component only lays them out. Charts are drawn only when complete (otherwise a
// plain explanation replaces them), unknown stays "—", an explicit $0 stays $0, assigned responsibility and planned
// contributions are labelled as plans (not payments), and savings and debt balances are shown apart from spending.

const SEG_TONE: Record<SegmentKey, string> = {
  mePersonal: "blue",
  partnerPersonal: "violet",
  shared: "gold",
  debtPayments: "green",
  me: "blue",
  partner: "violet",
  excludedPartner: "none",
  unassigned: "gold",
};

/** "Includes estimates": the same wording the Overview uses, shown for any figure whose inputs include an estimate. */
function EstimateNote({ estimate, testId }: { estimate: boolean; testId: string }) {
  const { t } = useLanguage();
  if (!estimate) return null;
  return (
    <span className="plan-row-note" data-testid={testId}>
      {t("hh.noteEstimate")}
    </span>
  );
}
const hasEstimate = (f: Figure) => f.kind !== "unknown" && f.estimate;

export default function HouseholdPlanDashboard({
  plan,
  model,
  view,
  sharedUnavailable,
  state,
}: {
  plan: HouseholdPlan;
  model: OverviewModel;
  view: PlanView;
  sharedUnavailable: boolean;
  state: ReadyState | null;
}) {
  const { t } = useLanguage();
  const dash = t("plan.dash");
  const partnerName = model.names.partner ?? "";
  const meName = t("plan.personMe");
  const avail = view.available;
  const availTone = avail.kind === "definitive" ? avail.tone : "none";
  const availText = avail.kind === "unknown" ? dash : fmt(avail.cents);

  const rowLabel = (k: PlanView["flow"]["rows"][number]["key"]) =>
    k === "mePersonal" ? t("hp.rowOwn", { name: meName }) : k === "partnerPersonal" ? t("hp.rowOwn", { name: partnerName }) : k === "shared" ? t("hp.rowShared") : t("hp.rowDebtPayments");
  const segLabel = (k: SegmentKey) => {
    switch (k) {
      case "mePersonal": return t("hp.rowOwn", { name: meName });
      case "partnerPersonal": return t("hp.rowOwn", { name: partnerName });
      case "shared": return t("hp.rowShared");
      case "debtPayments": return t("hp.rowDebtPayments");
      case "me": return meName;
      case "partner": return partnerName;
      case "excludedPartner": return t("hh.respExcluded", { name: partnerName });
      case "unassigned": return t("hh.unassignedTitle");
    }
  };

  return (
    <div className="hp-root" data-testid="hp-root">
      <section className="plan-glass" aria-label={t("hp.title")}>
        <h4 className="plan-card-title">{t("hp.title")}</h4>
        <p className="plan-row-note">{t("hp.intro")}</p>
      </section>

      {sharedUnavailable && (
        <div role="status" className="plan-note" data-testid="hp-shared-unavailable">
          {t("hh.sharedUnavailable")}
        </div>
      )}
      {!model.integrity.ok && state && <IntegrityAlert model={model} stored={state.stored} integrity={state.integrity} />}

      {view.provisional && (
        <div role="status" className="plan-note hh-prov-wrap" data-testid="hp-provisional">
          {avail.kind === "provisional" ? <ProvisionalNotice model={model} assumptions={avail.assumptions} prefix="hp" /> : <div>{t("hp.unknownBody")}</div>}
        </div>
      )}

      {/* ── monthly cash flow ── */}
      <section className="plan-glass" data-testid="hp-flow" aria-label={t("hp.flowTitle")}>
        <h4 className="plan-card-title">
          <Wallet size={16} aria-hidden="true" /> {t("hp.flowTitle")}
        </h4>
        <dl className="plan-rows">
          <div className="plan-row" data-tone="green">
            <dt>
              {t("hp.flowIncome")}
              <EstimateNote estimate={hasEstimate(view.flow.income)} testId="hp-est-income" />
            </dt>
            <dd>
              <Value f={view.flow.income} testId="hp-income" />
            </dd>
          </div>
          <div className="plan-row">
            <dt>
              <span aria-hidden="true">− </span>
              {t("hp.flowSpending")}
              <EstimateNote estimate={hasEstimate(view.flow.spending)} testId="hp-est-spending" />
            </dt>
            <dd>
              <Value f={view.flow.spending} testId="hp-spending" />
            </dd>
          </div>
          {view.flow.rows.map((r) => (
            <div key={r.key} className="plan-row plan-row-extra" data-testid={`hp-row-${r.key}`}>
              <dt>
                {rowLabel(r.key)}
                <EstimateNote estimate={hasEstimate(r.figure)} testId={`hp-est-row-${r.key}`} />
              </dt>
              <dd>
                <Value f={r.figure} testId={`hp-row-${r.key}-value`} />
              </dd>
            </div>
          ))}
          <div className="plan-row" data-strong="true" data-tone={availTone}>
            <dt>
              <span aria-hidden="true">= </span>
              {t("hp.flowAvailable")}{" "}
              {view.provisional && avail.kind === "provisional" && (
                <span className="plan-chip" data-status="partial" data-testid="hp-available-provisional">
                  {t("hh.availProvisional")}
                </span>
              )}
              <EstimateNote estimate={avail.kind !== "unknown" && avail.estimate} testId="hp-est-available" />
            </dt>
            <dd data-testid="hp-available" data-kind={avail.kind}>
              {availText}
            </dd>
          </div>
        </dl>
        {view.shortfall === "definite" && (
          <p className="plan-warn" role="status" data-testid="hp-shortfall">
            {t("hh.availShortfall")}
          </p>
        )}
        {model.hasPartner && !model.partnerIncluded && partnerName && (
          <p className="plan-row-note" data-testid="hp-excluded-note">
            {t("hp.excludedNote", { name: partnerName })}
          </p>
        )}
        <p className="plan-fineprint">{t("hp.flowNote")}</p>
      </section>

      {/* ── who covers what (assigned, excluded, unassigned) + distribution ── */}
      {!view.distribution.shown && <Responsibility model={model} />}
      <ChartCard idp="resp" icon={<Coins size={16} aria-hidden="true" />} title={t("hp.respChartTitle")} note={t("hp.respChartNote")} chart={view.distribution} label={segLabel} partnerName={partnerName} t={t} />
      {view.distribution.shown && <PartialList model={model} />}

      {/* ── spending breakdown ── */}
      <ChartCard idp="spend" icon={<Receipt size={16} aria-hidden="true" />} title={t("hp.spendChartTitle")} chart={view.breakdown} label={segLabel} partnerName={partnerName} t={t} />

      {/* ── savings and shared goals ── */}
      <section className="plan-glass" data-testid="hp-savings" aria-label={t("hp.savingsTitle")}>
        <h4 className="plan-card-title">
          <PiggyBank size={16} aria-hidden="true" /> {t("hp.savingsTitle")}
        </h4>
        <p className="plan-row-note">{t("hp.savingsNote")}</p>
        <dl className="plan-rows">
          <div className="plan-row">
            <dt>{t("hp.savingsPlanners")}</dt>
            <dd>
              <Value f={view.savings.inPlanners} testId="hp-savings-planners" />
            </dd>
          </div>
          {plan.goals.length > 0 && (
            <>
              <div className="plan-row">
                <dt>
                  {t("hp.savingsGoalsPlanned")}
                  <span className="plan-row-note">{t("hp.savingsGoalsPlannedNote")}</span>
                </dt>
                <dd>
                  <Value f={view.savings.goalsPlanned} testId="hp-savings-goals-planned" />
                </dd>
              </div>
              <div className="plan-row" data-tone="none">
                <dt>{t("hp.savingsGoalsCounted")}</dt>
                <dd>
                  <Value f={view.savings.goalsCounted} testId="hp-savings-goals-counted" />
                </dd>
              </div>
            </>
          )}
          <div className="plan-row" data-strong="true">
            <dt>{t("hp.savingsAfter")}</dt>
            <dd data-testid="hp-after-savings" data-kind={view.savings.afterSavings.kind}>
              {view.savings.afterSavings.kind === "amount" ? fmt(view.savings.afterSavings.cents) : dash}
            </dd>
          </div>
        </dl>
        {view.savings.afterSavings.kind === "unknown" && (
          <p className="plan-row-note" data-testid="hp-after-unknown">
            {t("hp.savingsAfterUnknown")}
          </p>
        )}
        {view.savings.shortfallAfterSavings && (
          <p className="plan-warn" role="status" data-testid="hp-savings-short">
            {t("hp.savingsShort")}
          </p>
        )}

        {view.goals.length === 0 ? (
          <p className="plan-row-note" data-testid="hp-goals-none">
            {t("hp.goalsNone")}
          </p>
        ) : (
          <div className="hp-goals" data-testid="hp-goals">
            {view.goals.map((g) => (
              <GoalCard key={g.id} g={g} plan={plan} partnerName={partnerName} t={t} />
            ))}
          </div>
        )}
      </section>

      {/* ── debt balances (never spending) ── */}
      <section className="plan-glass" data-testid="hp-debts" aria-label={t("hp.debtTitle")}>
        <h4 className="plan-card-title">
          <Landmark size={16} aria-hidden="true" /> {t("hp.debtTitle")}
        </h4>
        <p className="plan-row-note">{t("hp.debtNote")}</p>
        <dl className="plan-rows">
          <div className="plan-row">
            <dt>{t("hp.debtJoint")}</dt>
            <dd>
              <Value f={view.debts.joint} testId="hp-debt-joint" />
            </dd>
          </div>
          <div className="plan-row">
            <dt>{t("hp.debtPersonal")}</dt>
            <dd>
              <Value f={view.debts.personal} testId="hp-debt-personal" />
            </dd>
          </div>
          <div className="plan-row" data-strong="true">
            <dt>{t("hp.debtTotal")}</dt>
            <dd>
              <Value f={view.debts.total} testId="hp-debt-total" />
            </dd>
          </div>
        </dl>
        {view.debts.someUnknown && (
          <p className="plan-warn" role="status" data-testid="hp-debt-unknown">
            {t("hp.debtUnknown")}
          </p>
        )}
      </section>

      <WarningsCard model={model} hideMissingInfo={view.provisional && avail.kind === "provisional"} />
      {model.duplicates.length > 0 && (
        <p className="plan-row-note" data-testid="hp-duplicates-pointer">
          {t("hp.duplicatesPointer", { count: model.duplicates.length })}
        </p>
      )}
    </div>
  );
}

function ChartCard({ idp, icon, title, note, chart, label, partnerName, t }: { idp: string; icon: React.ReactNode; title: string; note?: string; chart: ChartView; label: (k: SegmentKey) => string; partnerName: string; t: TFn }) {
  const drawn = chart.segments.filter((s) => s.cents > 0);
  const summary = chart.shown ? [...chart.segments.map((s) => `${label(s.key)} ${percentText(s.cents, chart.totalCents ?? 0, s.percent)}`), ...chart.omitted.map((k) => `${label(k)}: ${t("hp.legendNothing")}`)].join(", ") : "";
  return (
    <section className="plan-glass" data-testid={`hp-${idp}-chart`} aria-label={title} data-shown={chart.shown}>
      <h4 className="plan-card-title">
        {icon} {title}
      </h4>
      {note && <p className="plan-row-note">{note}</p>}
      {chart.shown ? (
        <>
          <div className="hp-bar" role="img" aria-label={`${title}: ${summary}`} data-testid={`hp-${idp}-bar`}>
            {drawn.map((s) => (
              <span key={s.key} data-seg={s.key} data-tone={SEG_TONE[s.key]} data-hatch={s.key === "unassigned"} style={{ flexGrow: s.cents }} />
            ))}
          </div>
          <ul className="hp-legend" data-testid={`hp-${idp}-legend`}>
            {chart.segments.map((s: ChartSegment) => (
              <li key={s.key} data-seg={s.key}>
                <span className="hp-swatch" data-tone={SEG_TONE[s.key]} data-hatch={s.key === "unassigned"} aria-hidden="true" />
                <span className="hp-name">{label(s.key)}</span>
                <span className="hp-amt" data-testid={`hp-${idp}-amt-${s.key}`}>
                  {fmt(s.cents)}
                </span>
                <span className="hp-pct" data-testid={`hp-${idp}-pct-${s.key}`}>
                  {percentText(s.cents, chart.totalCents ?? 0, s.percent)}
                </span>
              </li>
            ))}
            {chart.omitted.map((k) => (
              <li key={k} data-seg={k} data-omitted="true" data-testid={`hp-${idp}-omitted-${k}`}>
                <span className="hp-swatch hp-swatch-none" aria-hidden="true" />
                <span className="hp-name">{label(k)}</span>
                <span className="hp-nothing">{t("hp.legendNothing")}</span>
              </li>
            ))}
          </ul>
          {chart.omitted.length > 0 && (
            <p className="plan-row-note" data-testid={`hp-${idp}-omitted-note`}>
              {t("hp.respChartOmitted", { name: partnerName })}
            </p>
          )}
        </>
      ) : (
        <p className="plan-row-note" data-testid={`hp-${idp}-hidden`} data-reason={chart.hiddenReason}>
          {chart.hiddenReason === "empty" ? t("hp.chartEmpty") : t("hp.chartHidden")}
        </p>
      )}
    </section>
  );
}

function GoalCard({ g, plan, partnerName, t }: { g: GoalRow; plan: HouseholdPlan; partnerName: string; t: TFn }) {
  const r = plan.goals.find((x) => x.id === g.id);
  if (!r) return null;
  const hint = hintFor(r, t);
  return (
    <article className="hp-goal" data-testid={`hp-goal-${g.id}`}>
      <div className="se-card-head">
        <div className="se-card-title">
          <strong>{g.name}</strong>
        </div>
        <span className="plan-chip" data-status={g.tone} data-testid={`hp-goal-chip-${g.id}`}>
          {statusLabel(r, t)}
        </span>
      </div>
      {g.percent !== null ? (
        <div className="sg-progress" role="img" aria-label={`${g.percent}%`} data-testid={`hp-goal-bar-${g.id}`}>
          <span style={{ width: `${Math.min(100, g.percent)}%` }} />
        </div>
      ) : (
        <p className="plan-row-note" data-testid={`hp-goal-nopct-${g.id}`}>
          {t("hp.goalNoPercent")}
        </p>
      )}
      <ul className="hh-list se-who">
        {g.percent !== null && <li data-testid={`hp-goal-pct-${g.id}`}>{t("hp.legendPct", { percent: g.percent })}</li>}
        {g.requiredCents !== null && <li data-testid={`hp-goal-required-${g.id}`}>{t("sg.required", { amount: fmt(g.requiredCents) })}</li>}
        <li data-testid={`hp-goal-planned-${g.id}`}>{g.plannedStated ? t("sg.planned", { amount: fmt(g.plannedCents) }) : t("hp.goalPlannedNone")}</li>
        {g.timing && (
          <li data-testid={`hp-goal-timing-${g.id}`}>
            {t("sg.timing", { from: g.timing.fromMonth, to: g.timing.toMonth, count: g.timing.monthsLeft })}
            {g.timing.laterDayThisMonthCountsAsOne ? ` ${t("sg.timingLater")}` : ""}
          </li>
        )}
        {g.counted.me && <li>{t("sg.countedMe")}</li>}
        {g.counted.partner && partnerName && <li>{t("sg.counted", { name: partnerName })}</li>}
      </ul>
      {g.aheadByCents > 0 && (
        <p className="plan-row-note" data-testid={`hp-goal-ahead-${g.id}`}>
          {t("hp.goalAhead", { amount: fmt(g.aheadByCents) })}
        </p>
      )}
      {g.savedUnknownAssumption && (
        <p className="plan-warn" data-testid={`hp-goal-saved-unknown-${g.id}`}>
          {t("sg.savedUnknown")}
        </p>
      )}
      {hint && (
        <p className="plan-warn" data-testid={`hp-goal-hint-${g.id}`}>
          {hint}
        </p>
      )}
    </article>
  );
}

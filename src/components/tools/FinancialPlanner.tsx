"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Baby,
  BarChart3,
  Car,
  Check,
  ChevronRight,
  Coins,
  FileText,
  HeartPulse,
  Home,
  Landmark,
  MapPin,
  MoreHorizontal,
  Repeat,
  ShieldCheck,
  ShoppingCart,
  Target,
  Wallet,
  Zap,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { formatCurrency } from "@/lib/salary";
import { valueLenStyle } from "@/lib/toolsLayout";
import type { Bill } from "@/lib/bills";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { Subscription } from "@/lib/subscriptions";
import {
  EXPENSE_CATEGORIES,
  MAX_DEBTS,
  MAX_GOALS,
  PAY_FREQUENCIES,
  PLANNER_STEPS,
  buildPlan,
  moneyText,
  obligationsKnown,
  optionalMoney,
  parseDebtsStep,
  parseExpensesStep,
  parseGoalsStep,
  parseHouseholdStep,
  parseIncomeStep,
  profileCompletion,
  summarizeExpenses,
  type Basis,
  type DebtValues,
  type ExpenseCategory,
  type ExpenseValues,
  type FinancialProfile,
  type GoalValues,
  type MissingKey,
  type PayFrequency,
  type PlannerStep,
  type StepError,
  type StepStatus,
} from "@/lib/financialPlanner";
import { nextSteps, percentText, spendingBreakdown, type NextStep, type SegmentKey } from "@/lib/plannerView";
import type { Person } from "@/lib/household";
import { FIELD_CLASS, newClientKey } from "./PaymentsDashboard";
import type { FinancialProfileController } from "./useFinancialProfile";

// Tools > Planner. Three views (Overview, Profile, Plan) and a five-step guided profile that saves after every
// step. Read-only toward Bills / Payments / Subscriptions: it only ever writes the user's own profile.
// All styling is scoped under .plan-root (globals.css).

const fmt = (cents: number) => formatCurrency(cents / 100);

type Icon = typeof Wallet;

const ERR_KEY: Record<StepError["code"], TranslationKey> = {
  invalid: "plan.errMoney",
  precision: "plan.errMoney",
  negative: "plan.errNegative",
  range: "plan.errRange",
  required: "plan.errRequired",
  tooLong: "plan.errTooLong",
  frequency: "plan.errFrequency",
  lowAboveTypical: "plan.errLow",
  integer: "plan.errInteger",
  numRange: "plan.errNumRange",
  date: "plan.errDate",
  tooMany: "plan.errTooMany",
};

const FREQ_KEY: Record<PayFrequency, TranslationKey> = {
  weekly: "plan.freqWeekly",
  biweekly: "plan.freqBiweekly",
  semimonthly: "plan.freqSemimonthly",
  monthly: "plan.freqMonthly",
  irregular: "plan.freqIrregular",
};

const EXPENSE_KEY: Record<ExpenseCategory, TranslationKey> = {
  housing: "plan.expHousing",
  utilities: "plan.expUtilities",
  groceries: "plan.expGroceries",
  transportation: "plan.expTransportation",
  insurance: "plan.expInsurance",
  healthcare: "plan.expHealthcare",
  childcare: "plan.expChildcare",
  other: "plan.expOther",
};

const EXPENSE_ICON: Record<ExpenseCategory, Icon> = {
  housing: Home,
  utilities: Zap,
  groceries: ShoppingCart,
  transportation: Car,
  insurance: ShieldCheck,
  healthcare: HeartPulse,
  childcare: Baby,
  other: MoreHorizontal,
};

const STEP_KEY: Record<PlannerStep, TranslationKey> = {
  1: "plan.stepName1",
  2: "plan.stepName2",
  3: "plan.stepName3",
  4: "plan.stepName4",
  5: "plan.stepName5",
};

/** A partner's step 2 is just "Location": household size is a household-level answer, not theirs. */
function stepTitle(t: (k: TranslationKey) => string, step: PlannerStep, person: Person): string {
  return step === 2 && person === "partner" ? t("plan.stepName2Partner") : t(STEP_KEY[step]);
}

const STEP_ICON: Record<PlannerStep, Icon> = { 1: Wallet, 2: MapPin, 3: ShoppingCart, 4: Landmark, 5: Target };

const STATUS_KEY: Record<StepStatus, TranslationKey> = {
  complete: "plan.statusComplete",
  partial: "plan.statusPartial",
  skipped: "plan.statusSkipped",
  todo: "plan.statusTodo",
};

const MISSING_KEY: Record<MissingKey, TranslationKey> = {
  income: "plan.missingIncome",
  expenses: "plan.missingExpenses",
  obligations: "plan.missingObligations",
  subscriptions: "plan.missingSubscriptions",
  billAmounts: "plan.missingBillAmounts",
  subscriptionPrices: "plan.missingSubscriptionPrices",
  debtPayments: "plan.missingDebtPayments",
};

const SEGMENT_KEY: Record<SegmentKey, TranslationKey> = {
  ...EXPENSE_KEY,
  obligations: "plan.segObligations",
  subscriptions: "plan.segSubscriptions",
};

/** One fixed colour per slice, so a category keeps its colour as the numbers change. */
const SEGMENT_COLOR: Record<SegmentKey, string> = {
  housing: "#3b82f6",
  groceries: "#22c55e",
  utilities: "#facc15",
  transportation: "#fb923c",
  insurance: "#a78bfa",
  healthcare: "#ec4899",
  childcare: "#14b8a6",
  other: "#94a3b8",
  obligations: "#06b6d4",
  subscriptions: "#f43f5e",
};

// ── Small pieces ─────────────────────────────────────────────────────────

function Field({ label, error, wide, children }: { label: string; error?: string | null; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`pay-field${wide ? " pay-field-wide" : ""}`}>
      <span className="pay-label">{label}</span>
      {children}
      {error && (
        <span className="pay-field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function BasisSelect({ value, onChange, label, actualLabel, estimateLabel }: { value: Basis; onChange: (b: Basis) => void; label: string; actualLabel?: string; estimateLabel?: string }) {
  const { t } = useLanguage();
  return (
    <Field label={label} wide>
      <select value={value} onChange={(e) => onChange(e.target.value as Basis)} className={`${FIELD_CLASS} pay-select`}>
        <option value="estimate">{estimateLabel ?? t("plan.basisEstimate")}</option>
        <option value="actual">{actualLabel ?? t("plan.basisActual")}</option>
      </select>
    </Field>
  );
}

/** Circular completion indicator. */
function Ring({ percent, testId }: { percent: number; testId: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="plan-ring" role="img" aria-label={`${percent}%`}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle className="plan-ring-track" cx="40" cy="40" r={r} />
        <circle className="plan-ring-bar" cx="40" cy="40" r={r} strokeDasharray={`${(percent / 100) * c} ${c}`} transform="rotate(-90 40 40)" />
      </svg>
      <span className="plan-ring-text" data-testid={testId}>
        {percent}%
      </span>
    </div>
  );
}

/** Donut chart of the spending breakdown (decorative: the legend and the aria-label carry the same data). */
function Donut({ segments, totalText, label }: { segments: { key: SegmentKey; cents: number; percent: number }[]; totalText: string; label: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.cents, 0);
  // Where each slice starts along the circle (computed up front so rendering stays pure).
  const starts = segments.map((_, i) => segments.slice(0, i).reduce((acc, s) => acc + (s.cents / total) * c, 0));
  return (
    <div className="plan-donut" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="plan-donut-track" cx="60" cy="60" r={r} />
        {segments.map((s, i) => {
          const len = (s.cents / total) * c;
          return (
            <circle
              key={s.key}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={SEGMENT_COLOR[s.key]}
              strokeWidth="16"
              strokeDasharray={`${Math.max(len - 0.8, 0)} ${c}`}
              strokeDashoffset={-starts[i]}
              transform="rotate(-90 60 60)"
            />
          );
        })}
      </svg>
      <div className="plan-donut-center">
        <span className="plan-donut-value" style={valueLenStyle(totalText) as React.CSSProperties} data-testid="plan-donut-total">
          {totalText}
        </span>
      </div>
    </div>
  );
}

/** The five-step progress track. Completed steps are checked, the current one is gold. */
function Stepper({ step, statuses }: { step: PlannerStep; statuses: Record<PlannerStep, StepStatus> }) {
  const { t } = useLanguage();
  return (
    <ol className="plan-stepper" aria-label={t("plan.stepsLabel")} data-testid="plan-stepper">
      {PLANNER_STEPS.map((s) => {
        const done = s !== step && statuses[s] === "complete";
        const current = s === step;
        return (
          <li key={s} className="plan-stepper-item" data-state={current ? "current" : done ? "done" : "later"} aria-current={current ? "step" : undefined} aria-label={t(current ? "plan.stepNow" : done ? "plan.stepDone" : "plan.stepLater", { n: s })}>
            <span className="plan-stepper-dot">{done ? <Check size={15} aria-hidden="true" /> : s}</span>
          </li>
        );
      })}
    </ol>
  );
}

type StepProps = {
  profile: FinancialProfile;
  /** Whose profile this wizard edits. A partner's wizard has no household-size or records questions. */
  person: Person;
  personName: string;
  statuses: Record<PlannerStep, StepStatus>;
  saving: boolean;
  error: string | null;
  onExit: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onSave: (patch: Partial<FinancialProfile>, exit?: boolean) => void;
};

/** Wraps a step: header, five-step track, the fields, an optional total panel, and Back / Save & Exit / Next. */
function StepFrame({
  step,
  person,
  statuses,
  subtitle,
  saving,
  error,
  onExit,
  onPrev,
  onSkip,
  onSubmit,
  total,
  children,
}: {
  step: PlannerStep;
  person: Person;
  statuses: Record<PlannerStep, StepStatus>;
  subtitle: string;
  saving: boolean;
  error: string | null;
  onExit: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onSubmit: (exit: boolean) => void;
  total?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const Icon = STEP_ICON[step];
  return (
    <form
      className="plan-step"
      data-testid={`plan-step-${step}`}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(false);
      }}
    >
      <div className="plan-step-head">
        <button type="button" className="plan-iconbtn" onClick={onExit} disabled={saving} aria-label={t("plan.backToOverview")}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <div>
          <h3 className="plan-step-title">{t("plan.profileCardsTitle")}</h3>
          <p className="plan-step-count">{t("plan.stepOf", { n: step })}</p>
        </div>
      </div>
      <Stepper step={step} statuses={statuses} />
      <div className="plan-glass plan-step-card">
        <span className="plan-icon-chip" data-tone="gold">
          <Icon size={22} aria-hidden="true" />
        </span>
        <div className="plan-step-card-text">
          <h4>{stepTitle(t, step, person)}</h4>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
      {total}
      {error && (
        <div role="alert" className="pay-error">
          {error}
        </div>
      )}
      <div className="plan-actions">
        <button type="button" className="plan-btn" onClick={step === 1 ? onExit : onPrev} disabled={saving}>
          {t("plan.back")}
        </button>
        <button type="button" className="plan-btn" onClick={() => onSubmit(true)} disabled={saving} data-testid="plan-save-exit">
          {t("plan.saveExit")}
        </button>
        <button type="submit" className="plan-btn plan-gold" disabled={saving} data-testid="plan-next">
          {saving ? t("plan.saving") : step === 5 ? t("plan.saveFinish") : t("plan.next")}
          {!saving && step !== 5 && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </div>
      <button type="button" className="plan-link plan-skip" onClick={onSkip} disabled={saving} data-testid="plan-skip">
        {t("plan.skip")}
      </button>
    </form>
  );
}

function useErrors() {
  const { t } = useLanguage();
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (list: StepError[]) => setErrs(Object.fromEntries(list.map((e) => [e.field, t(ERR_KEY[e.code])])));
  return { errs, set };
}

// ── Step 1: income ───────────────────────────────────────────────────────

function IncomeStep({ profile, statuses, ...rest }: StepProps) {
  const { t } = useLanguage();
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [frequency, setFrequency] = useState<PayFrequency | "">(profile.payFrequency ?? "");
  const [takeHome, setTakeHome] = useState(moneyText(profile.takeHome));
  const [typical, setTypical] = useState(moneyText(profile.incomeTypical));
  const [low, setLow] = useState(moneyText(profile.incomeLow));
  const [basis, setBasis] = useState<Basis>(profile.incomeBasis);
  const irregular = frequency === "irregular";
  return (
    <StepFrame
      step={1}
      person={rest.person}
      statuses={statuses}
      subtitle={t("plan.s1Help")}
      saving={rest.saving}
      error={rest.error}
      onExit={rest.onExit}
      onPrev={rest.onPrev}
      onSkip={rest.onSkip}
      onSubmit={(exit) => {
        // Next / Save & Exit need the pay frequency and the take-home amount. (Skip for now never gets here.)
        const r = parseIncomeStep({ frequency, takeHome, typical, low, basis }, { required: true });
        if (!r.ok) {
          setErrs(
            Object.fromEntries(
              r.errors.map((e) => [
                e.field,
                e.code === "required" ? t(e.field === "frequency" ? "plan.errChooseFrequency" : "plan.errEnterAmount") : t(ERR_KEY[e.code]),
              ])
            )
          );
          return;
        }
        setErrs({});
        rest.onSave(r.patch, exit);
      }}
    >
      <div className="plan-glass plan-fields plan-income">
        <div className="pay-form-grid">
          <Field label={t("plan.freq")} wide error={errs.frequency}>
            <select
              id="plan-frequency"
              value={frequency}
              onChange={(e) => {
                setFrequency(e.target.value as PayFrequency | "");
                setErrs({});
              }}
              className={`${FIELD_CLASS} pay-select`}
              aria-invalid={!!errs.frequency}
            >
              <option value="">{t("plan.freqChoose")}</option>
              {PAY_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(FREQ_KEY[f])}
                </option>
              ))}
            </select>
          </Field>
          {irregular ? (
            <>
              <p className="pay-help plan-lead pay-field-wide">{t("plan.irregularHelp")}</p>
              <Field label={t("plan.typical")} error={errs.typical}>
                <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={typical} onChange={(e) => setTypical(e.target.value)} className={FIELD_CLASS} aria-invalid={!!errs.typical} />
              </Field>
              <Field label={t("plan.low")} error={errs.low}>
                <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={low} onChange={(e) => setLow(e.target.value)} className={FIELD_CLASS} />
              </Field>
            </>
          ) : (
            // The amount is always on screen so it is never a surprise: until a frequency is chosen it is
            // disabled with a hint, then it becomes the per-paycheck field.
            <>
            <Field label={frequency === "" ? t("plan.takeHomeGeneric") : t("plan.takeHome")} wide error={errs.takeHome}>
              <input
                id="plan-take-home"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={takeHome}
                onChange={(e) => setTakeHome(e.target.value)}
                disabled={frequency === ""}
                aria-describedby={frequency === "" ? "plan-amount-hint" : undefined}
                aria-invalid={!!errs.takeHome}
                className={FIELD_CLASS}
              />
            </Field>
            {frequency === "" && (
              <p id="plan-amount-hint" className="plan-hint pay-field-wide">
                {t("plan.amountHint")}
              </p>
            )}
            </>
          )}
          <BasisSelect value={basis} onChange={setBasis} label={t("plan.incomeType")} actualLabel={t("plan.incomeActual")} estimateLabel={t("plan.incomeEstimate")} />
        </div>
      </div>
    </StepFrame>
  );
}

// ── Step 2: location and household ───────────────────────────────────────

function HouseholdStep({ profile, statuses, person, ...rest }: StepProps) {
  const { t } = useLanguage();
  const { errs, set } = useErrors();
  const [country, setCountry] = useState(profile.country ?? "");
  const [region, setRegion] = useState(profile.region ?? "");
  const [adults, setAdults] = useState(profile.adults === null ? "" : String(profile.adults));
  const [dependents, setDependents] = useState(profile.dependents === null ? "" : String(profile.dependents));
  return (
    <StepFrame
      step={2}
      person={person}
      statuses={statuses}
      subtitle={person === "me" ? t("plan.s2Help") : t("plan.s2HelpPartner", { name: rest.personName })}
      saving={rest.saving}
      error={rest.error}
      onExit={rest.onExit}
      onPrev={rest.onPrev}
      onSkip={rest.onSkip}
      onSubmit={(exit) => {
        const r = parseHouseholdStep({ country, region, adults, dependents });
        if (!r.ok) return set(r.errors);
        set([]);
        // A partner row has no household-size columns, so only location is saved for them.
        rest.onSave(person === "me" ? r.patch : { country: r.patch.country, region: r.patch.region }, exit);
      }}
    >
      <div className="plan-glass plan-fields">
        <div className="pay-form-grid">
          <Field label={t("plan.country")} error={errs.country}>
            <input type="text" autoComplete="country-name" value={country} onChange={(e) => setCountry(e.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t("plan.region")} error={errs.region}>
            <input type="text" autoComplete="address-level1" value={region} onChange={(e) => setRegion(e.target.value)} className={FIELD_CLASS} />
          </Field>
          {person === "me" && (
            <>
              <Field label={t("plan.adults")} error={errs.adults}>
                <input type="text" inputMode="numeric" autoComplete="off" value={adults} onChange={(e) => setAdults(e.target.value)} className={FIELD_CLASS} />
              </Field>
              <Field label={t("plan.dependents")} error={errs.dependents}>
                <input type="text" inputMode="numeric" autoComplete="off" value={dependents} onChange={(e) => setDependents(e.target.value)} className={FIELD_CLASS} />
              </Field>
            </>
          )}
        </div>
      </div>
    </StepFrame>
  );
}

// ── Step 3: living expenses ──────────────────────────────────────────────

function ExpensesStep({ profile, statuses, overlaps, person, ...rest }: StepProps & { overlaps: readonly ExpenseCategory[] }) {
  const { t } = useLanguage();
  const { errs, set } = useErrors();
  const [values, setValues] = useState<ExpenseValues>(() => {
    const v = {} as ExpenseValues;
    for (const c of EXPENSE_CATEGORIES) {
      const e = profile.expenses[c];
      v[c] = { amount: e ? String(e.amount) : "", basis: e?.basis ?? "estimate", covered: !!e?.covered };
    }
    return v;
  });
  const patchRow = (c: ExpenseCategory, p: Partial<ExpenseValues[ExpenseCategory]>) => setValues((v) => ({ ...v, [c]: { ...v[c], ...p } }));

  // The running total uses the same summarizer as the plan, over the rows that currently hold a valid amount.
  const live: FinancialProfile["expenses"] = {};
  for (const c of EXPENSE_CATEGORIES) {
    const m = optionalMoney(values[c].amount);
    if (m.ok && m.value !== null) live[c] = { amount: m.value, basis: values[c].basis, ...(values[c].covered ? { covered: true } : {}) };
  }
  const totals = summarizeExpenses(live, profile.useBills);
  // No amounts yet -> no total (not $0.00). Some -> a partial total. Every category given (an explicit 0 counts) -> the full total.
  const totalState: "none" | "partial" | "complete" = totals.providedCount === 0 ? "none" : totals.missing.length > 0 ? "partial" : "complete";

  return (
    <StepFrame
      step={3}
      person={person}
      statuses={statuses}
      subtitle={person === "me" ? t("plan.s3Help") : t("plan.s3HelpPartner", { name: rest.personName })}
      saving={rest.saving}
      error={rest.error}
      onExit={rest.onExit}
      onPrev={rest.onPrev}
      onSkip={rest.onSkip}
      onSubmit={(exit) => {
        const r = parseExpensesStep(values);
        if (!r.ok) return set(r.errors);
        set([]);
        rest.onSave(r.patch, exit);
      }}
      total={
        <div className="plan-total" data-testid="plan-expense-total" data-state={totalState}>
          <div className="plan-total-row">
            <span>{totalState === "partial" ? t("plan.totalPartial") : t("plan.profileTotal")}</span>
            <strong data-testid="plan-expense-total-value">{totalState === "none" ? t("plan.dash") : fmt(totals.totalCents)}</strong>
          </div>
          {totalState === "none" && <p className="plan-total-note">{t("plan.totalUnavailable")}</p>}
          {totalState === "partial" && <p className="plan-total-note">{t("plan.totalBlank", { count: totals.missing.length })}</p>}
          {totals.coveredCents > 0 && <p className="plan-total-note">{t("plan.totalCovered", { amount: fmt(totals.coveredCents) })}</p>}
        </div>
      }
    >
      <div className="plan-glass plan-fields plan-expense-list">
        {EXPENSE_CATEGORIES.map((c) => {
          const RowIcon = EXPENSE_ICON[c];
          return (
            <div key={c} className="plan-expense" data-testid={`plan-expense-${c}`}>
              <span className="plan-icon-chip plan-icon-sm" data-tone="gold">
                <RowIcon size={17} aria-hidden="true" />
              </span>
              <Field label={t(EXPENSE_KEY[c])} error={errs[c]}>
                <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values[c].amount} onChange={(e) => patchRow(c, { amount: e.target.value })} className={`${FIELD_CLASS} plan-amount`} />
              </Field>
              <div className="plan-expense-opts">
                {/* Stays focusable and keeps its saved choice; it just reads as inactive until an amount is typed. */}
                <label className="plan-check" data-empty={values[c].amount.trim() === ""}>
                  <input type="checkbox" checked={values[c].basis === "estimate"} onChange={(e) => patchRow(c, { basis: e.target.checked ? "estimate" : "actual" })} />
                  <span>{t("plan.isEstimate")}</span>
                </label>
                {overlaps.includes(c) && (
                  <label className="plan-check">
                    <input type="checkbox" checked={values[c].covered} onChange={(e) => patchRow(c, { covered: e.target.checked })} />
                    <span>{t("plan.coveredByBills")}</span>
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </StepFrame>
  );
}

// ── Step 4: debts and savings ────────────────────────────────────────────

function DebtsStep({ profile, statuses, accounts, ...rest }: StepProps & { accounts: readonly PaymentAccount[] }) {
  const { t } = useLanguage();
  const { errs, set } = useErrors();
  const [noDebts, setNoDebts] = useState(profile.noDebts);
  const [debts, setDebts] = useState<DebtValues[]>(
    profile.debts.map((d) => ({ id: d.id, name: d.name, balance: moneyText(d.balance), payment: moneyText(d.monthlyPayment), basis: d.basis, accountId: d.accountId ?? "" }))
  );
  const [savingsBalance, setSavingsBalance] = useState(moneyText(profile.savingsBalance));
  const [savingsMonthly, setSavingsMonthly] = useState(moneyText(profile.savingsMonthly));
  const [savingsBasis, setSavingsBasis] = useState<Basis>(profile.savingsBasis);
  const patchDebt = (id: string, p: Partial<DebtValues>) => setDebts((list) => list.map((d) => (d.id === id ? { ...d, ...p } : d)));
  return (
    <StepFrame
      step={4}
      person={rest.person}
      statuses={statuses}
      subtitle={t("plan.s4Help")}
      saving={rest.saving}
      error={rest.error}
      onExit={rest.onExit}
      onPrev={rest.onPrev}
      onSkip={rest.onSkip}
      onSubmit={(exit) => {
        const r = parseDebtsStep({ noDebts, debts, savingsBalance, savingsMonthly, savingsBasis });
        if (!r.ok) return set(r.errors);
        set([]);
        rest.onSave(r.patch, exit);
      }}
    >
      <div className="plan-glass plan-fields">
        <label className="plan-check plan-check-wide">
          <input type="checkbox" checked={noDebts} onChange={(e) => setNoDebts(e.target.checked)} />
          <span>{t("plan.noDebts")}</span>
        </label>
        {!noDebts && debts.length === 0 && (
          <div className="plan-empty-state" data-testid="plan-debts-empty">
            <p>{t("plan.debtsEmpty")}</p>
            <button type="button" className="plan-btn" onClick={() => setDebts([{ id: newClientKey(), name: "", balance: "", payment: "", basis: "estimate", accountId: "" }])}>
              {t("plan.addDebt")}
            </button>
          </div>
        )}
        {!noDebts && debts.length > 0 && (
          <div className="plan-rows-form">
            {debts.map((d, i) => (
              <div key={d.id} className="plan-sub" data-testid="plan-debt">
                <div className="pay-form-grid">
                  <Field label={t("plan.debtName")} wide error={errs[`debt${i}.name`]}>
                    <input type="text" autoComplete="off" value={d.name} onChange={(e) => patchDebt(d.id, { name: e.target.value })} className={FIELD_CLASS} />
                  </Field>
                  <Field label={t("plan.debtBalance")} error={errs[`debt${i}.balance`]}>
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={d.balance} onChange={(e) => patchDebt(d.id, { balance: e.target.value })} className={FIELD_CLASS} />
                  </Field>
                  <Field label={t("plan.debtPayment")} error={errs[`debt${i}.payment`]}>
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={d.payment} onChange={(e) => patchDebt(d.id, { payment: e.target.value })} className={FIELD_CLASS} />
                  </Field>
                  <BasisSelect value={d.basis} onChange={(b) => patchDebt(d.id, { basis: b })} label={t("plan.basis")} />
                  {accounts.length > 0 && (
                    <Field label={t("plan.debtLink")} wide>
                      <select value={d.accountId} onChange={(e) => patchDebt(d.id, { accountId: e.target.value })} className={`${FIELD_CLASS} pay-select`}>
                        <option value="">{t("plan.debtNoLink")}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
                <button type="button" className="plan-link" onClick={() => setDebts((list) => list.filter((x) => x.id !== d.id))}>
                  {t("plan.removeDebt")}
                </button>
              </div>
            ))}
            {errs.debts && (
              <p className="pay-field-error" role="alert">
                {errs.debts}
              </p>
            )}
            {accounts.length > 0 && <p className="pay-help">{t("plan.debtLinkHelp")}</p>}
            <button
              type="button"
              className="plan-btn"
              disabled={debts.length >= MAX_DEBTS}
              onClick={() => setDebts((list) => [...list, { id: newClientKey(), name: "", balance: "", payment: "", basis: "estimate", accountId: "" }])}
            >
              {t("plan.addDebt")}
            </button>
          </div>
        )}
        <div className="plan-divider" role="separator" />
        <h4 className="plan-subhead" id="plan-savings-heading">
          {t("plan.savingsHeading")}
        </h4>
        <p className="plan-subhint">{t("plan.savingsHint")}</p>
        <div className="pay-form-grid plan-savings" role="group" aria-labelledby="plan-savings-heading">
          <Field label={t("plan.savingsBalance")} error={errs.savingsBalance}>
            <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={savingsBalance} onChange={(e) => setSavingsBalance(e.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t("plan.savingsMonthly")} error={errs.savingsMonthly}>
            <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={savingsMonthly} onChange={(e) => setSavingsMonthly(e.target.value)} className={FIELD_CLASS} />
          </Field>
          <BasisSelect value={savingsBasis} onChange={setSavingsBasis} label={t("plan.basis")} />
        </div>
      </div>
    </StepFrame>
  );
}

// ── Step 5: goals ────────────────────────────────────────────────────────

function GoalsStep({ profile, statuses, ...rest }: StepProps) {
  const { t } = useLanguage();
  const { errs, set } = useErrors();
  const [goals, setGoals] = useState<GoalValues[]>(profile.goals.map((g) => ({ id: g.id, name: g.name, targetAmount: moneyText(g.targetAmount), targetDate: g.targetDate ?? "" })));
  const patchGoal = (id: string, p: Partial<GoalValues>) => setGoals((list) => list.map((g) => (g.id === id ? { ...g, ...p } : g)));
  return (
    <StepFrame
      step={5}
      person={rest.person}
      statuses={statuses}
      subtitle={t("plan.s5Help")}
      saving={rest.saving}
      error={rest.error}
      onExit={rest.onExit}
      onPrev={rest.onPrev}
      onSkip={rest.onSkip}
      onSubmit={(exit) => {
        const r = parseGoalsStep(goals);
        if (!r.ok) return set(r.errors);
        set([]);
        rest.onSave(r.patch, exit);
      }}
    >
      <div className="plan-glass plan-fields">
        <div className="plan-rows-form">
          {goals.map((g, i) => (
            <div key={g.id} className="plan-sub" data-testid="plan-goal">
              <div className="pay-form-grid">
                <Field label={t("plan.goalName")} wide error={errs[`goal${i}.name`]}>
                  <input type="text" autoComplete="off" value={g.name} onChange={(e) => patchGoal(g.id, { name: e.target.value })} className={FIELD_CLASS} />
                </Field>
                <Field label={t("plan.goalTarget")} error={errs[`goal${i}.amount`]}>
                  <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={g.targetAmount} onChange={(e) => patchGoal(g.id, { targetAmount: e.target.value })} className={FIELD_CLASS} />
                </Field>
                <Field label={t("plan.goalDate")} error={errs[`goal${i}.date`]}>
                  <input type="date" value={g.targetDate} onChange={(e) => patchGoal(g.id, { targetDate: e.target.value })} className={FIELD_CLASS} />
                </Field>
              </div>
              <button type="button" className="plan-link" onClick={() => setGoals((list) => list.filter((x) => x.id !== g.id))}>
                {t("plan.removeGoal")}
              </button>
            </div>
          ))}
          {errs.goals && (
            <p className="pay-field-error" role="alert">
              {errs.goals}
            </p>
          )}
          <button
            type="button"
            className="plan-btn"
            disabled={goals.length >= MAX_GOALS}
            onClick={() => setGoals((list) => [...list, { id: newClientKey(), name: "", targetAmount: "", targetDate: "" }])}
          >
            {t("plan.addGoal")}
          </button>
        </div>
      </div>
    </StepFrame>
  );
}

// ── The tool ─────────────────────────────────────────────────────────────

type Section = "overview" | "profile" | "plan";

export default function FinancialPlanner({
  controller,
  bills,
  accounts,
  subscriptions,
  todayISO,
  person = "me",
  personName = "",
  embedded = false,
}: {
  controller: FinancialProfileController;
  bills: readonly Bill[];
  accounts: readonly PaymentAccount[];
  subscriptions: readonly Subscription[];
  todayISO: string;
  /** "me" is the signed-in user's own profile (the default). "partner" plans a partner's own income and expenses. */
  person?: Person;
  personName?: string;
  /** Render without the outer card (the household switcher supplies it). */
  embedded?: boolean;
}) {
  const { t } = useLanguage();
  const c = controller;
  const profile = c.profile;
  const [section, setSection] = useState<Section>("overview");
  const [view, setView] = useState<"dashboard" | PlannerStep>("dashboard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const available = c.state === "ready";

  // Bills, Payments and Subscriptions belong to the signed-in user, so they only feed "me". A partner's plan is built
  // from the partner's own answers: no records are read and none are assumed (their subscription gap isn't reported
  // as missing because there are no partner records to include; a note on the screen says so).
  const isMe = person === "me";
  const planProfile: FinancialProfile = isMe ? profile : { ...profile, useBills: false, useAccounts: false, useSubscriptions: true };
  const plan = buildPlan({ profile: planProfile, bills: isMe ? bills : [], accounts: isMe ? accounts : [], subscriptions: isMe ? subscriptions : [], todayISO });
  const completion = profileCompletion(profile, person);
  const rootClass = embedded ? "plan-embedded" : "pay-panel plan-panel plan-root";
  const incomeKnown = plan.income.monthlyCents !== null;

  // ── actions ──
  async function persist(patch: Partial<FinancialProfile>, next: "dashboard" | PlannerStep) {
    setSaving(true);
    setError(null);
    const msg = await c.save(patch);
    setSaving(false);
    if (msg) {
      setError(msg);
      return;
    }
    setNotice(next === "dashboard" ? t("plan.saved") : null);
    setView(next);
  }
  const after = (step: PlannerStep): "dashboard" | PlannerStep => (step === 5 ? "dashboard" : ((step + 1) as PlannerStep));
  const withoutSkip = (step: PlannerStep) => profile.skippedSteps.filter((s) => s !== step);
  const saveStep = (step: PlannerStep) => (patch: Partial<FinancialProfile>, exit?: boolean) => {
    const next = exit ? "dashboard" : after(step);
    void persist({ ...patch, skippedSteps: withoutSkip(step), currentStep: next === "dashboard" ? step : next }, next);
  };
  const skipStep = (step: PlannerStep) => () => {
    const next = after(step);
    const skipped = profile.skippedSteps.includes(step) ? profile.skippedSteps : [...profile.skippedSteps, step];
    void persist({ skippedSteps: skipped, currentStep: next === "dashboard" ? step : next }, next);
  };
  const open = (step: PlannerStep) => {
    setError(null);
    setNotice(null);
    setView(step);
  };
  const toggle = (key: "useBills" | "useAccounts" | "useSubscriptions", value: boolean) => {
    setNotice(null);
    void c.save({ [key]: value }).then((msg) => msg && setError(msg));
  };

  // ── step views ──
  if (available && view !== "dashboard") {
    const step = view;
    const common: StepProps = {
      profile,
      person,
      personName,
      statuses: completion.statuses,
      saving,
      error,
      onExit: () => setView("dashboard"),
      onPrev: () => setView((step === 1 ? 1 : step - 1) as PlannerStep),
      onSkip: skipStep(step),
      onSave: saveStep(step),
    };
    return (
      <div className={rootClass}>
        {step === 1 && <IncomeStep key="s1" {...common} />}
        {step === 2 && <HouseholdStep key="s2" {...common} />}
        {step === 3 && <ExpensesStep key="s3" {...common} overlaps={plan.overlapCategories} />}
        {step === 4 && <DebtsStep key="s4" {...common} accounts={isMe ? accounts : []} />}
        {step === 5 && <GoalsStep key="s5" {...common} />}
      </div>
    );
  }

  // ── derived display ──
  const obligationsShown = obligationsKnown(profile);
  const expensesShown = plan.expenses.providedCount > 0;
  const missingItems = plan.missing.map((m) => t(MISSING_KEY[m])).join(", ");
  const started = profile.updatedAt !== null;
  // Resume at the first step that isn't complete (skipped steps included, so they can be revisited).
  const ctaStep: PlannerStep = PLANNER_STEPS.find((s) => completion.statuses[s] !== "complete") ?? 1;
  const profileDone = completion.completeCount === PLANNER_STEPS.length;

  type Tile = { key: string; Icon: Icon; tone: string; label: string; value: string; notes: string[]; testId: string };
  const allTiles: Tile[] = [
    {
      key: "income",
      Icon: Wallet,
      tone: "green",
      label: t("plan.tileIncome"),
      value: incomeKnown ? fmt(plan.income.monthlyCents!) : t("plan.dash"),
      notes: incomeKnown
        ? [plan.income.irregular ? t("plan.noteTypicalMonth") : "", plan.income.basis === "estimate" ? t("plan.noteEstimate") : t("plan.noteActual")].filter(Boolean)
        : [t("plan.noteAddIncome")],
      testId: "plan-income",
    },
    {
      key: "obligations",
      Icon: FileText,
      tone: "blue",
      label: t("plan.tileObligations"),
      value: obligationsShown ? fmt(plan.obligationsCents) : t("plan.dash"),
      notes: obligationsShown ? (plan.bills.missingCount > 0 || plan.debts.missingPayments > 0 ? [t("plan.noteIncomplete")] : []) : [t("plan.noteUseRecords")],
      testId: "plan-obligations",
    },
    {
      key: "subscriptions",
      Icon: Repeat,
      tone: "violet",
      label: t("plan.tileSubscriptions"),
      value: profile.useSubscriptions ? fmt(plan.subscriptions.monthlyCents) : t("plan.dash"),
      notes: profile.useSubscriptions ? (plan.subscriptions.missingCount > 0 ? [t("plan.noteIncomplete")] : []) : [t("plan.notIncluded")],
      testId: "plan-subscriptions",
    },
    {
      key: "expenses",
      Icon: Home,
      tone: "gold",
      label: t("plan.tileExpenses"),
      value: expensesShown ? fmt(plan.expenses.totalCents) : t("plan.dash"),
      notes: expensesShown
        ? [
            ...(plan.expenses.missing.length > 0 ? [t("plan.noteCategories", { count: plan.expenses.providedCount, total: EXPENSE_CATEGORIES.length })] : []),
            ...(plan.expenses.includesEstimates ? [t("plan.noteEstimate")] : []),
          ]
        : [t("plan.notProvided")],
      testId: "plan-expenses",
    },
  ];

  const tiles = isMe ? allTiles : allTiles.filter((x) => x.key !== "subscriptions");
  const availTone = plan.availableCents === null ? "none" : plan.availableCents < 0 ? "negative" : "positive";
  const availText = plan.availableCents === null ? t("plan.dash") : fmt(plan.availableCents);
  const availNotes =
    plan.availableCents === null
      ? [t("plan.noteAddIncome")]
      : [...(plan.incomplete ? [t("plan.noteIncomplete")] : []), ...(plan.includesEstimates ? [t("plan.noteIncludesEstimates")] : []), ...(plan.shortfall ? [t("plan.noteShortfall")] : [])];

  const rows: { key: string; label: string; value: string; sign?: string; testId: string; tone?: string }[] = [
    { key: "income", label: t("plan.rowIncome"), value: incomeKnown ? fmt(plan.income.monthlyCents!) : t("plan.notProvided"), testId: "plan-row-income", tone: incomeKnown ? "green" : "none" },
    { key: "obligations", label: t("plan.rowObligations"), sign: "−", value: obligationsShown ? fmt(plan.obligationsCents) : t("plan.notProvided"), testId: "plan-row-obligations" },
    { key: "expenses", label: t("plan.rowExpenses"), sign: "−", value: expensesShown ? fmt(plan.expenses.totalCents) : t("plan.notProvided"), testId: "plan-row-expenses" },
    { key: "subs", label: t("plan.rowSubscriptions"), sign: "−", value: profile.useSubscriptions ? fmt(plan.subscriptions.monthlyCents) : t("plan.notIncluded"), testId: "plan-row-subscriptions" },
    { key: "available", label: t("plan.rowAvailable"), sign: "=", value: plan.availableCents === null ? t("plan.notProvided") : fmt(plan.availableCents), testId: "plan-row-available", tone: availTone },
  ];
  const flowRows = isMe ? rows : rows.filter((r) => r.key !== "subs");
  const extraRows: { key: string; label: string; value: string; testId: string; note?: string }[] = [];
  if (plan.lowAvailableCents !== null) extraRows.push({ key: "low", label: t("plan.rowLowMonth"), value: fmt(plan.lowAvailableCents), testId: "plan-row-low" });
  if (profile.savingsMonthly !== null) extraRows.push({ key: "planned", label: t("plan.rowPlannedSavings"), value: fmt(plan.plannedSavingsCents), testId: "plan-row-planned" });
  if (plan.savingsCapacityCents !== null) extraRows.push({ key: "capacity", label: t("plan.rowCapacity"), value: fmt(plan.savingsCapacityCents), testId: "plan-row-capacity" });
  if (profile.noDebts || profile.debts.length > 0 || profile.useAccounts)
    extraRows.push({ key: "debt", label: t("plan.rowDebtBalance"), value: fmt(plan.debtBalanceCents), testId: "plan-row-debt", note: t("plan.rowDebtBalanceNote") });

  const sources: { key: "useBills" | "useAccounts" | "useSubscriptions"; label: string; checked: boolean; notes: string[]; testId: string }[] = [
    {
      key: "useBills",
      label: t("plan.useBills", { count: bills.filter((b) => !b.archivedAt).length }),
      checked: profile.useBills,
      notes: [
        ...(profile.useBills && (plan.bills.oneTimeCount ?? 0) > 0 ? [t("plan.billsOneTime", { count: plan.bills.oneTimeCount ?? 0 })] : []),
        ...(profile.useBills && plan.bills.missingCount > 0 ? [t("plan.billsMissing", { count: plan.bills.missingCount })] : []),
      ],
      testId: "plan-use-bills",
    },
    {
      key: "useAccounts",
      label: t("plan.useAccounts", { count: accounts.length }),
      checked: profile.useAccounts,
      notes: profile.useAccounts && plan.debts.trackedElsewhere > 0 ? [t("plan.debtsTracked", { count: plan.debts.trackedElsewhere })] : [],
      testId: "plan-use-accounts",
    },
    {
      key: "useSubscriptions",
      label: t("plan.useSubscriptions", { count: subscriptions.filter((s) => s.status !== "canceled").length }),
      checked: profile.useSubscriptions,
      notes: [
        ...(profile.useSubscriptions && plan.subscriptions.linkedSkipped > 0 ? [t("plan.subsLinked", { count: plan.subscriptions.linkedSkipped })] : []),
        ...(profile.useSubscriptions && plan.subscriptions.otherCurrency > 0 ? [t("plan.subsOtherCurrency", { count: plan.subscriptions.otherCurrency })] : []),
      ],
      testId: "plan-use-subscriptions",
    },
  ];

  const sections: { key: Section; label: string }[] = [
    { key: "overview", label: t("plan.navOverview") },
    { key: "profile", label: t("plan.navProfile") },
    { key: "plan", label: t("plan.navPlan") },
  ];

  // Plan view data
  const breakdown = spendingBreakdown(plan, profile);
  const steps = nextSteps(plan);
  const stepLabel = (s: NextStep): string => {
    switch (s.kind) {
      case "addIncome":
        return t("plan.nextAddIncome");
      case "addExpenses":
        return t("plan.nextExpenses", { count: s.count });
      case "addObligations":
        return isMe ? t("plan.nextObligations") : t("plan.nextObligationsPartner", { name: personName });
      case "includeSubscriptions":
        return t("plan.nextSubscriptions");
      case "billAmounts":
        return t("plan.nextBillAmounts", { count: s.count });
      case "shortfall":
        return t("plan.nextShortfall");
      case "capacity":
        return t("plan.nextCapacity", { amount: fmt(s.cents) });
      case "debtBalance":
        return t("plan.nextDebt", { amount: fmt(s.cents) });
    }
  };
  const chartLabel = t("plan.breakdownLabel", {
    total: fmt(breakdown.totalCents),
    items: breakdown.segments.map((s) => `${t(SEGMENT_KEY[s.key])} ${percentText(s.cents, breakdown.totalCents, s.percent)} (${fmt(s.cents)})`).join(", "),
  });

  return (
    <div className={rootClass}>
      <header className="plan-header">
        <span className="plan-icon-chip plan-icon-lg" data-tone="gold">
          {section === "plan" ? <BarChart3 size={26} aria-hidden="true" /> : <Coins size={26} aria-hidden="true" />}
        </span>
        <div>
          <h3 className="plan-title">{section === "plan" ? t("plan.planTitle") : t("plan.title")}</h3>
          <p className="plan-subtitle">{!isMe ? t("plan.forPerson", { name: personName }) : section === "plan" ? t("plan.planSubtitle") : t("plan.subtitle")}</p>
        </div>
      </header>

      {available && (
        <div className="plan-seg" role="tablist" aria-label={t("plan.navLabel")}>
          {sections.map((s) => (
            <button key={s.key} type="button" role="tab" aria-selected={section === s.key} data-testid={`plan-nav-${s.key}`} className="plan-seg-btn" onClick={() => setSection(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {c.state === "unavailable" && (
        <div role="status" className="pay-error pay-error-page" data-testid="plan-unavailable">
          {t("plan.unavailable")}
        </div>
      )}
      {c.state === "error" && (
        <div role="alert" className="pay-error pay-error-page">
          {c.loadError ?? t("plan.failed")}
        </div>
      )}
      {c.state === "loading" && <div className="text-white/60 text-center py-6">{t("backlog.loading")}</div>}
      {notice && (
        <div role="status" className="pay-notice">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="pay-error">
          {error}
        </div>
      )}

      {available && section === "overview" && (
        <>
          <section className="plan-glass plan-complete" aria-label={t("plan.completeTitle")}>
            <Ring percent={completion.percent} testId="plan-completion" />
            <div className="plan-complete-body">
              <h4>{profileDone ? t("plan.completeDone") : t("plan.completeTitle")}</h4>
              <p>{profileDone ? t("plan.noteStepsDone", { done: completion.completeCount }) : t("plan.completeBody")}</p>
              {!profileDone && (
                <button type="button" className="plan-btn plan-gold" data-testid="plan-cta" onClick={() => open(ctaStep)}>
                  {started ? t("plan.continueSetup") : t("plan.setup")}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </section>

          {plan.incomplete && missingItems && (
            <div role="note" className="plan-note" data-testid="plan-incomplete">
              {t("plan.incompleteBanner", { items: missingItems })}
            </div>
          )}
          {plan.overlapCategories.length > 0 && (
            <div role="note" className="plan-note" data-testid="plan-overlap">
              {t("plan.overlapNote", { categories: plan.overlapCategories.map((cat) => t(EXPENSE_KEY[cat])).join(", ") })}
            </div>
          )}

          <h4 className="plan-section-title">{t("plan.snapshotTitle")}</h4>
          <section className="plan-tiles" aria-label={t("plan.snapshotTitle")}>
            {tiles.map((tile) => (
              <div key={tile.key} className="plan-tile" data-tone={tile.tone} data-tile={tile.key}>
                <span className="plan-icon-chip" data-tone={tile.tone}>
                  <tile.Icon size={20} aria-hidden="true" />
                </span>
                <div className="plan-tile-body">
                  <div className="plan-tile-label">{tile.label}</div>
                  <div className="plan-tile-value" style={valueLenStyle(tile.value) as React.CSSProperties} data-testid={tile.testId}>
                    {tile.value}
                  </div>
                  {tile.notes.map((n) => (
                    <div key={n} className="plan-tile-note">
                      {n}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="plan-avail" data-tone={availTone} data-tile="available" aria-label={t("plan.availableTitle")}>
            <span className="plan-icon-chip plan-icon-lg" data-tone={availTone === "negative" ? "red" : availTone === "positive" ? "green" : "none"}>
              <Coins size={26} aria-hidden="true" />
            </span>
            <div className="plan-avail-body">
              <div className="plan-tile-label">{t("plan.availableTitle")}</div>
              <div className="plan-avail-line">
                <span className="plan-avail-value" style={valueLenStyle(availText) as React.CSSProperties} data-testid="plan-available">
                  {availText}
                </span>
                {plan.availableCents !== null && <span className="plan-avail-unit">{t("plan.perMonth")}</span>}
              </div>
              {availNotes.map((n) => (
                <div key={n} className="plan-tile-note">
                  {n}
                </div>
              ))}
            </div>
          </section>

          <section className="plan-glass plan-flow" aria-label={t("plan.flowTitle")} data-testid="plan-flow">
            <h4 className="plan-card-title">{t("plan.flowTitle")}</h4>
            <dl className="plan-rows">
              {flowRows.map((r) => (
                <div key={r.key} className="plan-row" data-strong={r.key === "available"} data-tone={r.tone}>
                  <dt>
                    {r.sign && <span aria-hidden="true">{r.sign} </span>}
                    {r.label}
                  </dt>
                  <dd data-testid={r.testId}>{r.value}</dd>
                </div>
              ))}
              {extraRows.map((r) => (
                <div key={r.key} className="plan-row plan-row-extra">
                  <dt>
                    {r.label}
                    {r.note && <span className="plan-row-note">{r.note}</span>}
                  </dt>
                  <dd data-testid={r.testId}>{r.value}</dd>
                </div>
              ))}
            </dl>
            {plan.shortfall && (
              <p className="plan-warn" role="status">
                {t("plan.shortfall")}
              </p>
            )}
            <p className="plan-fineprint">{t("plan.flowNote")}</p>
          </section>

          {!isMe && (
            <p className="plan-note" data-testid="plan-partner-records-note">
              {t("plan.partnerRecordsNote", { name: personName })}
            </p>
          )}
          {isMe && (
          <section className="plan-glass plan-sources" aria-label={t("plan.sourcesTitle")}>
            <h4 className="plan-card-title">{t("plan.sourcesTitle")}</h4>
            <p className="plan-fineprint">{t("plan.sourcesHelp")}</p>
            {sources.map((s) => (
              <div key={s.key} className="plan-source" data-checked={s.checked}>
                <label className="plan-check plan-check-wide">
                  <input type="checkbox" checked={s.checked} onChange={(e) => toggle(s.key, e.target.checked)} data-testid={s.testId} />
                  <span>{s.label}</span>
                </label>
                {s.notes.map((n) => (
                  <p key={n} className="plan-fineprint plan-source-note">
                    {n}
                  </p>
                ))}
              </div>
            ))}
          </section>
          )}
        </>
      )}

      {available && section === "profile" && (
        <section className="plan-profile" aria-label={t("plan.profileCardsTitle")}>
          <div className="plan-glass plan-complete">
            <Ring percent={completion.percent} testId="plan-completion-profile" />
            <div className="plan-complete-body">
              <h4>{t("plan.profileCardsTitle")}</h4>
              <p>{t("plan.profileCardsHelp")}</p>
            </div>
          </div>
          <ul className="plan-steps">
            {PLANNER_STEPS.map((s) => {
              const status = completion.statuses[s];
              const Icon = STEP_ICON[s];
              const action = status === "complete" ? t("plan.edit") : status === "partial" ? t("plan.continue") : t("plan.start");
              return (
                <li key={s} className="plan-glass plan-step-row" data-status={status} data-testid={`plan-step-row-${s}`}>
                  <span className="plan-icon-chip" data-tone={status === "complete" ? "green" : "gold"}>
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <div className="plan-step-row-text">
                    <span className="plan-step-num">{t("plan.stepOf", { n: s })}</span>
                    <span className="plan-step-name">{stepTitle(t, s, person)}</span>
                    <span className="plan-chip" data-status={status}>
                      {t(STATUS_KEY[status])}
                    </span>
                  </div>
                  <button type="button" className="plan-btn plan-step-btn" onClick={() => open(s)} aria-label={`${action} ${stepTitle(t, s, person)}`}>
                    {action}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {available && section === "plan" && (
        <>
          <section className="plan-glass plan-cf" aria-label={t("plan.cfTitle")} data-testid="plan-cf">
            <h4 className="plan-card-title">{t("plan.cfTitle")}</h4>
            <div className="plan-cf-grid">
              <div className="plan-cf-col" data-tone="green">
                <span className="plan-cf-value" style={valueLenStyle(incomeKnown ? fmt(plan.income.monthlyCents!) : "—") as React.CSSProperties} data-testid="plan-cf-income">
                  {incomeKnown ? fmt(plan.income.monthlyCents!) : t("plan.dash")}
                </span>
                <span className="plan-cf-label">{t("plan.cfIncome")}</span>
              </div>
              <div className="plan-cf-col">
                <span className="plan-cf-value" style={valueLenStyle(fmt(plan.outflowCents)) as React.CSSProperties} data-testid="plan-cf-expenses">
                  {fmt(plan.outflowCents)}
                </span>
                <span className="plan-cf-label">{t("plan.cfExpenses")}</span>
              </div>
              <div className="plan-cf-col" data-tone={availTone}>
                <span className="plan-cf-value" style={valueLenStyle(availText) as React.CSSProperties} data-testid="plan-cf-available">
                  {availText}
                </span>
                <span className="plan-cf-label">{t("plan.cfAvailable")}</span>
              </div>
            </div>
            <p className="plan-fineprint">{t("plan.cfNote")}</p>
            {plan.incomplete && missingItems && (
              <p className="plan-warn" data-testid="plan-cf-incomplete">
                {t("plan.incompleteBanner", { items: missingItems })}
              </p>
            )}
          </section>

          <section className="plan-glass plan-breakdown" aria-label={t("plan.breakdownTitle")} data-testid="plan-breakdown">
            <h4 className="plan-card-title">{t("plan.breakdownTitle")}</h4>
            {breakdown.segments.length === 0 ? (
              <p className="plan-empty" data-testid="plan-breakdown-empty">
                {t("plan.breakdownEmpty")}
              </p>
            ) : (
              <div className="plan-breakdown-body">
                <Donut segments={breakdown.segments} totalText={fmt(breakdown.totalCents)} label={chartLabel} />
                <ul className="plan-legend" aria-label={t("plan.breakdownTitle")}>
                  {breakdown.segments.map((s) => (
                    <li key={s.key} aria-label={`${t(SEGMENT_KEY[s.key])}: ${percentText(s.cents, breakdown.totalCents, s.percent)}, ${fmt(s.cents)}`} data-testid={`plan-legend-${s.key}`}>
                      <span className="plan-swatch" style={{ background: SEGMENT_COLOR[s.key] }} aria-hidden="true" />
                      <span className="plan-legend-name">{t(SEGMENT_KEY[s.key])}</span>
                      <span className="plan-legend-pct">{percentText(s.cents, breakdown.totalCents, s.percent)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="plan-glass plan-next" aria-label={t("plan.nextTitle")} data-testid="plan-next-steps">
            <h4 className="plan-card-title">
              <Target size={18} aria-hidden="true" /> {t("plan.nextTitle")}
            </h4>
            {steps.length === 0 ? (
              <p className="plan-empty">{t("plan.nextAllSet")}</p>
            ) : (
              <ul className="plan-next-list">
                {steps.map((s) => {
                  const target = "step" in s ? s.step : null;
                  const label = stepLabel(s);
                  return (
                    <li key={s.kind}>
                      {target ? (
                        <button type="button" className="plan-next-item" onClick={() => open(target)} data-testid={`plan-next-${s.kind}`}>
                          <span>{label}</span>
                          <ChevronRight size={18} aria-hidden="true" />
                        </button>
                      ) : (
                        <div className="plan-next-item" data-static="true" data-testid={`plan-next-${s.kind}`}>
                          <span>{label}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="plan-glass plan-goals-note" aria-label={t("plan.goalsTitle")} data-testid="plan-goals-unavailable">
            <Target size={20} aria-hidden="true" />
            <p>
              <strong>{t("plan.goalsTitle")}</strong> {t("plan.goalsUnavailable")}
            </p>
          </section>
        </>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { toCents } from "@/lib/bills";
import { buildHouseholdPlan, type GoalResult, type SharedGoal } from "@/lib/householdPlan";
import { SHARED_LIMITS } from "@/lib/householdShared";
import { readField } from "@/lib/sharedExpenseDraft";
import { checkGoalDraft, emptyGoalDraft, goalPercent, goalToDraft, goalTone, upsertGoal, type GoalDraft, type GoalErrorCode } from "@/lib/sharedGoalDraft";
import { ConfirmActionModal, FIELD_CLASS } from "./PaymentsDashboard";
import { Value, fmt } from "./HouseholdParts";
import { Field, whoText, type TFn } from "./SharedEditorParts";
import { NoticeBox, noticeFor, type EditorShared, type Notice } from "./SharedExpensesEditor";
import type { SaveOutcome } from "./useHouseholdOverview";

// Tools > Planner > Household > Shared: the SHARED GOALS editor (Phase 2, Step 4C). Goals are savings, kept apart from
// shared expenses and joint debts: a planned contribution is a monthly saving, never a bill or a debt payment, and the
// household plan keeps it out of spending. Required monthly amount, on-track / short / past-due status, months left and the
// calendar-month rule all come from the calculation module (goalProgress); this file collects input and shows results.
// "Already part of {name}'s monthly savings" is the existing countedInSavings flag: the user's explicit statement that
// stops the same money being added to household savings twice. A personal planner's savings are never changed. Saving,
// revision checks, conflicts and the unreadable-data gate are those of the other editors (one data layer).

const ERROR_KEY: Record<GoalErrorCode, TranslationKey> = {
  nameRequired: "se.eName",
  nameTooLong: "se.eNameLong",
  targetInvalid: "sg.eTarget",
  targetZero: "sg.eTargetZero",
  dateInvalid: "sg.eDate",
  savedInvalid: "sg.eSaved",
  meInvalid: "se.eContrib",
  partnerInvalid: "se.eContrib",
};
const STATUS_KEY: Record<GoalResult["status"], TranslationKey> = {
  noTarget: "sg.statusNoTarget",
  noDate: "sg.statusNoDate",
  achieved: "sg.statusAchieved",
  pastDue: "sg.statusPastDue",
  noContributions: "sg.statusNoContributions",
  onTrack: "sg.statusOnTrack",
  short: "sg.statusShort",
};

export function statusLabel(r: GoalResult, t: TFn): string {
  return r.status === "short" ? t("sg.statusShort", { amount: fmt(r.shortByMonthlyCents ?? 0) }) : t(STATUS_KEY[r.status]);
}
export function hintFor(r: GoalResult, t: TFn): string | null {
  return r.status === "noTarget" ? t("sg.hintNoTarget") : r.status === "noDate" ? t("sg.hintNoDate") : r.status === "pastDue" ? t("sg.hintPastDue") : null;
}

export default function SharedGoalsEditor(p: EditorShared) {
  const { t } = useLanguage();
  const { ctl, state, included, plan, me, partner, bills, accounts, subscriptions, todayISO, canEdit, ack, onSaved, locked, onFormChange } = p;
  const [draft, setDraftState] = useState<GoalDraft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmRemove, setConfirmRemove] = useState<SharedGoal | null>(null);

  const setDraft = (d: GoalDraft | null) => {
    setDraftState(d);
    onFormChange(d !== null);
  };
  const shared = state.shared;
  const goals = shared.goals;
  const hasPartner = !!partner;
  const partnerName = partner?.name ?? "";
  const busy = ctl.savingShared;
  const off = !canEdit || busy || locked;

  const checked = useMemo(() => (draft ? checkGoalDraft(draft, { hasPartner }) : null), [draft, hasPartner]);
  // The live preview of the open form: the real calculation module run with the draft in place. Nothing is saved.
  const preview = useMemo<GoalResult | null>(() => {
    if (!checked?.goal) return null;
    const pl = buildHouseholdPlan({
      me: { profile: me },
      partner: partner ? { profile: partner.profile, name: partner.name, included } : null,
      shared: { ...shared, goals: upsertGoal(goals, checked.goal) },
      composition: state.composition,
      records: { bills, accounts, subscriptions },
      todayISO,
    });
    return pl.goals.find((g) => g.id === checked.goal!.id) ?? null;
  }, [checked, shared, goals, me, partner, included, state.composition, bills, accounts, subscriptions, todayISO]);

  function report(out: SaveOutcome): boolean {
    setNotice(noticeFor(out));
    if (out.ok) onSaved();
    return out.ok;
  }
  async function saveDraft() {
    setShowErrors(true);
    if (!draft || !checked?.goal) return;
    if (report(await ctl.saveShared({ shared: { ...shared, goals: upsertGoal(goals, checked.goal) }, composition: state.composition }, { acknowledge: ack }))) {
      setDraft(null);
      setShowErrors(false);
    }
  }
  async function remove(g: SharedGoal): Promise<string | null> {
    report(await ctl.saveShared({ shared: { ...shared, goals: goals.filter((x) => x.id !== g.id) }, composition: state.composition }, { acknowledge: ack }));
    setConfirmRemove(null);
    return null;
  }

  const atLimit = goals.length >= SHARED_LIMITS.goals;
  const resultOf = (id: string): GoalResult | undefined => plan.goals.find((g) => g.id === id);
  const openNew = () => {
    setDraft(emptyGoalDraft());
    setShowErrors(false);
    setNotice(null);
  };
  const plannedTotal = plan.goals.reduce((s, g) => s + g.plannedMonthlyCents, 0);

  return (
    <div className="sg-root" data-testid="sg-root">
      <section className="plan-glass" aria-label={t("sg.title")}>
        <h4 className="plan-card-title">{t("sg.title")}</h4>
        <p className="plan-row-note">{t("sg.intro")}</p>
      </section>

      <NoticeBox notice={notice} idp="sg" />

      {goals.length === 0 && !draft && (
        <section className="plan-glass plan-empty-card" data-testid="sg-empty">
          <h4>{t("sg.empty")}</h4>
          <p>{t("sg.emptyHelp")}</p>
          <div className="se-actions">
            <button type="button" className="plan-btn plan-gold" onClick={openNew} disabled={off} data-testid="sg-add">
              <Plus size={16} aria-hidden="true" /> {t("sg.add")}
            </button>
          </div>
        </section>
      )}

      {goals.length > 0 && (
        <section aria-label={t("sg.title")} data-testid="sg-list">
          <p className="plan-row-note" data-testid="sg-count">
            {t("sg.count", { count: goals.length })}
          </p>
          <section className="plan-glass" data-testid="sg-totals" aria-label={t("sg.totalsTitle")}>
            <dl className="plan-rows">
              <div className="plan-row">
                <dt>{t("sg.totalsPlanned")}</dt>
                <dd>
                  <Value f={{ kind: "amount", cents: plannedTotal, estimate: false }} testId="sg-total-planned" />
                </dd>
              </div>
              <div className="plan-row" data-tone="none">
                <dt>{t("sg.totalsCounted")}</dt>
                <dd>
                  <Value f={{ kind: "amount", cents: plan.savings.goalContributionsCents, estimate: false }} testId="sg-total-counted" />
                </dd>
              </div>
            </dl>
            <p className="plan-row-note">{t("sg.totalsNote")}</p>
          </section>
          {goals.map((g) => {
            const r = resultOf(g.id);
            const pct = goalPercent(g);
            const hint = r ? hintFor(r, t) : null;
            return (
              <article key={g.id} className="plan-glass se-card" data-testid={`sg-card-${g.id}`}>
                <div className="se-card-head">
                  <div className="se-card-title">
                    <strong data-testid={`sg-name-${g.id}`}>{g.name}</strong>
                    {g.targetDate && <span className="plan-row-note">{t("sg.targetLine", { date: g.targetDate })}</span>}
                  </div>
                  <Value f={g.targetAmount === null ? { kind: "unknown" } : { kind: "amount", cents: toCents(g.targetAmount), estimate: false }} testId={`sg-target-${g.id}`} />
                </div>
                {r && (
                  <div>
                    <span className="plan-chip" data-status={goalTone(r.status)} data-testid={`sg-chip-${g.id}`}>
                      {statusLabel(r, t)}
                    </span>
                  </div>
                )}
                {pct !== null && (
                  <div className="sg-progress" role="img" aria-label={`${pct}%`} data-testid={`sg-bar-${g.id}`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
                <ul className="hh-list se-who" data-testid={`sg-lines-${g.id}`}>
                  {g.savedAmount !== null && g.targetAmount !== null && pct !== null ? (
                    <li data-testid={`sg-progress-${g.id}`}>{t("sg.progress", { saved: fmt(toCents(g.savedAmount)), target: fmt(toCents(g.targetAmount)), percent: pct })}</li>
                  ) : g.savedAmount !== null ? (
                    <li data-testid={`sg-progress-${g.id}`}>{t("sg.savedOnly", { saved: fmt(toCents(g.savedAmount)) })}</li>
                  ) : (
                    <li data-testid={`sg-saved-unknown-${g.id}`}>{t("sg.savedUnknown")}</li>
                  )}
                  {r && r.requiredMonthlyCents !== null && <li data-testid={`sg-required-${g.id}`}>{t("sg.required", { amount: fmt(r.requiredMonthlyCents) })}</li>}
                  {r && r.timing && (
                    <li data-testid={`sg-timing-${g.id}`}>
                      {t("sg.timing", { from: r.timing.fromMonth, to: r.timing.toMonth, count: r.timing.monthsLeft })}
                      {r.timing.laterDayThisMonthCountsAsOne ? ` ${t("sg.timingLater")}` : ""}
                    </li>
                  )}
                  <li data-testid={`sg-planned-${g.id}`}>
                    {g.contributions.me === null && g.contributions.partner === null ? t("sg.plannedNone") : t("sg.planned", { amount: fmt(r?.plannedMonthlyCents ?? 0) })}
                  </li>
                  <li data-person="me">{whoText(t("plan.personMe"), g.contributions.me, t)}</li>
                  {hasPartner && <li data-person="partner">{whoText(partnerName, g.contributions.partner, t)}</li>}
                  {g.countedInSavings.me && <li data-testid={`sg-counted-me-${g.id}`}>{t("sg.countedMe")}</li>}
                  {hasPartner && g.countedInSavings.partner && <li data-testid={`sg-counted-partner-${g.id}`}>{t("sg.counted", { name: partnerName })}</li>}
                </ul>
                {hint && (
                  <p className="plan-warn" data-testid={`sg-hint-${g.id}`}>
                    {hint}
                  </p>
                )}
                <div className="se-actions">
                  <button type="button" className="plan-btn" onClick={() => { setDraft(goalToDraft(g)); setShowErrors(false); setNotice(null); }} disabled={off} data-testid={`sg-edit-${g.id}`} aria-label={`${t("se.edit")} ${g.name}`}>
                    <Pencil size={15} aria-hidden="true" /> {t("se.edit")}
                  </button>
                  <button type="button" className="plan-btn" onClick={() => setConfirmRemove(g)} disabled={off} data-testid={`sg-remove-${g.id}`} aria-label={`${t("se.remove")} ${g.name}`}>
                    <Trash2 size={15} aria-hidden="true" /> {t("se.remove")}
                  </button>
                </div>
              </article>
            );
          })}
          {!draft && (
            <div className="se-actions">
              <button type="button" className="plan-btn plan-gold" onClick={openNew} disabled={off || atLimit} data-testid="sg-add">
                <Plus size={16} aria-hidden="true" /> {t("sg.add")}
              </button>
              {atLimit && (
                <p className="plan-row-note" data-testid="sg-limit">
                  {t("sg.addLimit", { max: SHARED_LIMITS.goals })}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {draft && (
        <GoalForm
          draft={draft}
          setDraft={setDraft}
          checked={checked!}
          showErrors={showErrors}
          hasPartner={hasPartner}
          partnerName={partnerName}
          partnerExcluded={hasPartner && !included}
          meSavings={me.savingsMonthly}
          partnerSavings={partner ? partner.profile.savingsMonthly : null}
          preview={preview}
          busy={busy}
          canEdit={canEdit}
          onSave={saveDraft}
          onCancel={() => {
            setDraft(null);
            setShowErrors(false);
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmActionModal title={t("sg.removeTitle", { label: confirmRemove.name })} body={t("sg.removeBody")} confirmLabel={t("se.removeConfirm")} busyLabel={t("se.removeBusy")} onCancel={() => setConfirmRemove(null)} onConfirm={() => remove(confirmRemove)} />
      )}
    </div>
  );
}

function GoalForm({
  draft, setDraft, checked, showErrors, hasPartner, partnerName, partnerExcluded, meSavings, partnerSavings, preview, busy, canEdit, onSave, onCancel,
}: {
  draft: GoalDraft;
  setDraft: (d: GoalDraft) => void;
  checked: ReturnType<typeof checkGoalDraft>;
  showErrors: boolean;
  hasPartner: boolean;
  partnerName: string;
  partnerExcluded: boolean;
  meSavings: number | null;
  partnerSavings: number | null;
  preview: GoalResult | null;
  busy: boolean;
  canEdit: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const set = (patch: Partial<GoalDraft>) => setDraft({ ...draft, ...patch });
  const errs = showErrors ? checked.errors : [];
  const err = (codes: GoalErrorCode[]) => errs.find((e) => codes.includes(e.code));
  const errText = (e: { code: GoalErrorCode } | undefined) => (e ? t(ERROR_KEY[e.code], { max: SHARED_LIMITS.label }) : null);
  const meField = readField(draft.me);
  const partnerField = readField(draft.partner);
  const mePositive = meField.state === "value" && meField.value > 0;
  const partnerPositive = hasPartner && partnerField.state === "value" && partnerField.value > 0;
  const disabled = !canEdit || busy;
  const hint = preview ? hintFor(preview, t) : null;

  const personBox = (who: "me" | "partner") => {
    const isMe = who === "me";
    const name = isMe ? t("plan.personMe") : partnerName;
    const value = isMe ? draft.me : draft.partner;
    const positive = isMe ? mePositive : partnerPositive;
    const counted = isMe ? draft.meCounted : draft.partnerCounted;
    const savings = isMe ? meSavings : partnerSavings;
    const error = errText(err([isMe ? "meInvalid" : "partnerInvalid"]));
    return (
      <div key={who} className="sg-person">
        <Field label={isMe ? name : partnerExcluded ? t("se.fPartnerExcluded", { name }) : name} error={error}>
          <input type="text" inputMode="decimal" autoComplete="off" placeholder="—" value={value} onChange={(e) => set(isMe ? { me: e.target.value } : { partner: e.target.value })} className={`${FIELD_CLASS} plan-amount`} data-testid={`sg-f-${who}`} aria-invalid={!!error} />
        </Field>
        {positive && (
          <>
            {savings !== null && savings > 0 && !counted && (
              <p className="plan-row-note" data-testid={`sg-savings-hint-${who}`}>
                {isMe ? t("sg.savingsHintMe", { amount: fmt(toCents(savings)) }) : t("sg.savingsHint", { name, amount: fmt(toCents(savings)) })}
              </p>
            )}
            <label className="plan-check">
              <input type="checkbox" checked={counted} onChange={(e) => set(isMe ? { meCounted: e.target.checked } : { partnerCounted: e.target.checked })} data-testid={`sg-f-${who}-counted`} />
              <span>{isMe ? t("sg.countedMe") : t("sg.counted", { name })}</span>
            </label>
            {counted && <p className="plan-row-note">{isMe ? t("sg.countedHelpMe") : t("sg.countedHelp", { name })}</p>}
          </>
        )}
      </div>
    );
  };

  return (
    <section className="plan-glass se-form" data-testid="sg-form" aria-label={draft.id ? t("sg.formEdit") : t("sg.formAdd")}>
      <h4 className="plan-card-title">{draft.id ? t("sg.formEdit") : t("sg.formAdd")}</h4>

      <Field label={t("se.fName")} error={errText(err(["nameRequired", "nameTooLong"]))}>
        <input type="text" autoComplete="off" maxLength={SHARED_LIMITS.label + 20} placeholder={t("sg.fNamePh")} value={draft.name} onChange={(e) => set({ name: e.target.value })} className={FIELD_CLASS} data-testid="sg-f-name" aria-invalid={!!err(["nameRequired", "nameTooLong"])} />
      </Field>
      <Field label={t("sg.fTarget")} error={errText(err(["targetInvalid", "targetZero"]))} help={t("sg.fTargetHelp")}>
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.target} onChange={(e) => set({ target: e.target.value })} className={`${FIELD_CLASS} plan-amount`} data-testid="sg-f-target" aria-invalid={!!err(["targetInvalid", "targetZero"])} />
      </Field>
      <Field label={t("sg.fDate")} error={errText(err(["dateInvalid"]))} help={t("sg.fDateHelp")}>
        <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} className={FIELD_CLASS} data-testid="sg-f-date" aria-invalid={!!err(["dateInvalid"])} />
      </Field>
      <Field label={t("sg.fSaved")} error={errText(err(["savedInvalid"]))} help={t("sg.fSavedHelp")}>
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.saved} onChange={(e) => set({ saved: e.target.value })} className={`${FIELD_CLASS} plan-amount`} data-testid="sg-f-saved" aria-invalid={!!err(["savedInvalid"])} />
      </Field>

      <fieldset className="se-who-box">
        <legend className="plan-card-title">{t("sg.fPlanned")}</legend>
        <p className="plan-row-note">{t("sg.fPlannedHelp")}</p>
        <div className="se-grid2">
          {personBox("me")}
          {hasPartner && personBox("partner")}
        </div>
        {partnerExcluded && (
          <p className="plan-row-note" data-testid="sg-excluded-note">
            {t("sg.excludedNote", { name: partnerName })}
          </p>
        )}
      </fieldset>

      {preview && (
        <div className="plan-note" role="status" data-testid="sg-preview">
          <strong>{t("sg.preview")}:</strong>{" "}
          <span className="plan-chip" data-status={goalTone(preview.status)} data-testid="sg-preview-status">
            {statusLabel(preview, t)}
          </span>
          {preview.requiredMonthlyCents !== null && <div data-testid="sg-preview-required">{t("sg.required", { amount: fmt(preview.requiredMonthlyCents) })}</div>}
          {preview.timing && (
            <div data-testid="sg-preview-timing">
              {t("sg.timing", { from: preview.timing.fromMonth, to: preview.timing.toMonth, count: preview.timing.monthsLeft })}
              {preview.timing.laterDayThisMonthCountsAsOne ? ` ${t("sg.timingLater")}` : ""}
            </div>
          )}
          {draft.saved.trim() === "" && <div data-testid="sg-preview-saved-unknown">{t("sg.savedUnknown")}</div>}
          {hint && <div data-testid="sg-preview-hint">{hint}</div>}
        </div>
      )}

      <div className="se-actions">
        <button type="button" className="plan-btn plan-gold" onClick={onSave} disabled={disabled} data-testid="sg-save">
          {busy ? t("se.saving") : t("se.save")}
        </button>
        <button type="button" className="plan-btn" onClick={onCancel} disabled={busy} data-testid="sg-cancel">
          {t("pay.cancel")}
        </button>
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { toCents, type Bill } from "@/lib/bills";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type FinancialProfile } from "@/lib/financialPlanner";
import type { PaymentAccount } from "@/lib/supabase/db";
import type { Subscription } from "@/lib/subscriptions";
import { buildHouseholdPlan, type HouseholdPlan, type SharedExpense, type SharedItemResult } from "@/lib/householdPlan";
import { buildOverview, type OverviewModel } from "@/lib/householdOverview";
import { SHARED_LIMITS } from "@/lib/householdShared";
import {
  applyShortcut,
  checkDraft,
  emptyDraft,
  expenseToDraft,
  linkCandidates,
  linkKey,
  liveAllocation,
  toggleLink,
  upsertExpense,
  withSuggestion,
  type DraftErrorCode,
  type ExpenseDraft,
  type LinkCandidate,
  type LinkGroup,
} from "@/lib/sharedExpenseDraft";
import type { ReadyState } from "@/lib/supabase/householdShared";
import type { PartnerRecord } from "@/lib/supabase/household";
import { ConfirmActionModal, FIELD_CLASS } from "./PaymentsDashboard";
import { Value, dupText, fmt } from "./HouseholdParts";
import { Field, LinksBox, StatusChip, Suggestions, WhoBox, whoText, type LinkChoiceGroup } from "./SharedEditorParts";
import type { OverviewController, SaveOutcome } from "./useHouseholdOverview";

// Tools > Planner > Household > Shared: the shared EXPENSES editor (Phase 2, Step 4A). It edits only the shared-expense
// list and the "there are none" answer; joint debts, goals and household composition are carried through unchanged.
// Everything is saved through the one data layer (validated, revision-checked, blocked over unreadable data unless
// acknowledged). Amounts, remainders, duplicates and suggestions come from the calculation module; this file collects
// input and shows results. The integrity warning / acknowledgement live in SharedTab, shared with the joint-debt editor.

export type EditorShared = {
  ctl: OverviewController;
  state: ReadyState;
  included: boolean;
  plan: HouseholdPlan;
  model: OverviewModel;
  me: FinancialProfile;
  partner: PartnerRecord | null;
  bills: readonly Bill[];
  accounts: readonly PaymentAccount[];
  subscriptions: readonly Subscription[];
  todayISO: string;
  /** false while stored data is unreadable and the user hasn't acknowledged it */
  canEdit: boolean;
  ack: boolean;
  /** called after a save succeeds (clears the acknowledgement) */
  onSaved: () => void;
  /** the other editor has a form open: only one form at a time */
  locked: boolean;
  onFormChange: (open: boolean) => void;
};

export const CATEGORY_KEY: Record<ExpenseCategory, TranslationKey> = {
  housing: "plan.expHousing",
  utilities: "plan.expUtilities",
  groceries: "plan.expGroceries",
  transportation: "plan.expTransportation",
  insurance: "plan.expInsurance",
  healthcare: "plan.expHealthcare",
  childcare: "plan.expChildcare",
  other: "plan.expOther",
};
const ERROR_KEY: Record<DraftErrorCode, TranslationKey> = {
  labelRequired: "se.eName",
  labelTooLong: "se.eNameLong",
  amountRequired: "se.eAmount",
  amountInvalid: "se.eAmountInvalid",
  meInvalid: "se.eContrib",
  partnerInvalid: "se.eContrib",
  overAssigned: "se.eOver",
  tooManyLinks: "se.eLinks",
};
const GROUP_KEY: Record<LinkGroup, TranslationKey> = {
  personal: "se.linkGroupPersonal",
  bill: "se.linkGroupBill",
  subscription: "se.linkGroupSubscription",
  account: "se.linkGroupAccount",
};

export type Notice = { kind: "conflict" | "error" | "validation" | "integrity" | "unavailable" | "saved"; message?: string } | null;

/** The text of a save notice (shared by the expense and joint-debt editors). */
export function NoticeBox({ notice, idp }: { notice: Notice; idp: string }) {
  const { t } = useLanguage();
  if (!notice) return null;
  return (
    <div role={notice.kind === "saved" ? "status" : "alert"} className={notice.kind === "saved" ? "plan-note" : "pay-error"} data-testid={`${idp}-message`} data-kind={notice.kind}>
      {notice.kind === "saved" && t("se.saved")}
      {notice.kind === "conflict" && t("se.conflict")}
      {notice.kind === "validation" && t("se.validationFailed")}
      {notice.kind === "integrity" && t("se.integrityBlocked")}
      {notice.kind === "unavailable" && t("se.unavailable")}
      {notice.kind === "error" && (notice.message && notice.message !== "busy" ? notice.message : t("se.saveFailed"))}
    </div>
  );
}

export function noticeFor(out: SaveOutcome): Notice {
  return out.ok ? { kind: "saved" } : { kind: out.kind, message: out.kind === "error" ? out.message : undefined };
}

export default function SharedExpensesEditor(p: EditorShared) {
  const { t } = useLanguage();
  const { ctl, state, included, plan, model, me, partner, bills, accounts, subscriptions, todayISO, canEdit, ack, onSaved, locked, onFormChange } = p;
  const [draft, setDraftState] = useState<ExpenseDraft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmRemove, setConfirmRemove] = useState<SharedExpense | null>(null);
  const [confirmNone, setConfirmNone] = useState(false);

  const setDraft = (d: ExpenseDraft | null) => {
    setDraftState(d);
    onFormChange(d !== null);
  };
  const shared = state.shared;
  const expenses = shared.expenses;
  const hasPartner = !!partner;
  const partnerName = partner?.name ?? "";
  const busy = ctl.savingShared;
  const off = !canEdit || busy || locked;
  const candidates = useMemo(() => linkCandidates({ me, partner: partner ? partner.profile : null, bills, accounts, subscriptions }), [me, partner, bills, accounts, subscriptions]);

  // The live preview of the open form: the real calculation module run with the draft in place. Nothing is saved.
  const checked = useMemo(() => (draft ? checkDraft(draft, { hasPartner }) : null), [draft, hasPartner]);
  const preview = useMemo(() => {
    if (!checked?.expense) return null;
    const next = { ...shared, expenses: upsertExpense(expenses, checked.expense), noSharedExpenses: false };
    const pl = buildHouseholdPlan({
      me: { profile: me },
      partner: partner ? { profile: partner.profile, name: partner.name, included } : null,
      shared: next,
      composition: state.composition,
      records: { bills, accounts, subscriptions },
      todayISO,
    });
    const m = buildOverview({ plan: pl, shared: next, integrity: state.integrity, droppedItems: state.droppedItems, meName: t("plan.personMe"), partnerName: partner ? partner.name : null, subscriptions });
    return { item: pl.sharedItems.find((i) => i.id === checked.expense!.id) ?? null, duplicates: m.duplicates.filter((d) => d.itemId === checked.expense!.id) };
  }, [checked, shared, expenses, me, partner, included, state.composition, state.integrity, state.droppedItems, bills, accounts, subscriptions, todayISO, t]);

  function report(out: SaveOutcome): boolean {
    setNotice(noticeFor(out));
    if (out.ok) onSaved();
    return out.ok;
  }

  async function saveDraft() {
    setShowErrors(true);
    if (!draft || !checked?.expense) return;
    const next = { ...shared, expenses: upsertExpense(expenses, checked.expense), noSharedExpenses: false };
    if (report(await ctl.saveShared({ shared: next, composition: state.composition }, { acknowledge: ack }))) {
      setDraft(null);
      setShowErrors(false);
    }
  }

  async function remove(e: SharedExpense): Promise<string | null> {
    report(await ctl.saveShared({ shared: { ...shared, expenses: expenses.filter((x) => x.id !== e.id) }, composition: state.composition }, { acknowledge: ack }));
    setConfirmRemove(null);
    return null;
  }

  async function confirmNoExpenses(): Promise<string | null> {
    report(await ctl.saveShared({ shared: { ...shared, expenses: [], noSharedExpenses: true }, composition: state.composition }, { acknowledge: ack }));
    setConfirmNone(false);
    return null;
  }

  const atLimit = expenses.length >= SHARED_LIMITS.expenses;
  const itemOf = (id: string): SharedItemResult | undefined => plan.sharedItems.find((i) => i.id === id);
  const openNew = () => {
    setDraft(emptyDraft());
    setShowErrors(false);
    setNotice(null);
  };

  return (
    <div className="se-root" data-testid="se-root">
      <section className="plan-glass" aria-label={t("se.title")}>
        <h4 className="plan-card-title">{t("se.title")}</h4>
        <p className="plan-row-note">{t("se.intro")}</p>
      </section>

      <NoticeBox notice={notice} idp="se" />

      {/* ── list / empty states ── */}
      {expenses.length === 0 && !draft && (
        <section className="plan-glass plan-empty-card" data-testid="se-empty" data-answered={shared.noSharedExpenses}>
          {shared.noSharedExpenses ? (
            <p data-testid="se-none-confirmed">{t("se.noneConfirmed")}</p>
          ) : (
            <>
              <h4>{t("se.empty")}</h4>
              <p>{t("se.emptyHelp")}</p>
            </>
          )}
          <div className="se-actions">
            <button type="button" className="plan-btn plan-gold" onClick={openNew} disabled={off} data-testid="se-add">
              <Plus size={16} aria-hidden="true" /> {t("se.add")}
            </button>
            {!shared.noSharedExpenses && (
              <button type="button" className="plan-btn" onClick={() => setConfirmNone(true)} disabled={off} data-testid="se-none">
                {t("se.none")}
              </button>
            )}
          </div>
        </section>
      )}

      {expenses.length > 0 && (
        <section aria-label={t("se.title")} data-testid="se-list">
          <p className="plan-row-note" data-testid="se-count">
            {t("se.count", { count: expenses.length })}
          </p>
          {expenses.map((e) => {
            const item = itemOf(e.id);
            const dups = model.duplicates.filter((d) => d.itemId === e.id);
            return (
              <article key={e.id} className="plan-glass se-card" data-testid={`se-card-${e.id}`}>
                <div className="se-card-head">
                  <div className="se-card-title">
                    <strong data-testid={`se-name-${e.id}`}>{e.label}</strong>
                    <span className="plan-row-note">
                      {t(CATEGORY_KEY[e.category])}
                      {e.basis === "estimate" ? ` · ${t("hh.noteEstimate")}` : ""}
                    </span>
                  </div>
                  <Value f={{ kind: "amount", cents: toCents(e.amount), estimate: e.basis === "estimate" }} testId={`se-amount-${e.id}`} />
                </div>
                {item && <StatusChip item={item} id={e.id} idp="se" />}
                {item && item.excludedReason !== null && (
                  <p className="plan-row-note" data-testid={`se-counted-${e.id}`}>
                    {t("se.countedElsewhere")}
                  </p>
                )}
                <ul className="hh-list se-who" data-testid={`se-who-${e.id}`}>
                  <li data-person="me">{whoText(t("plan.personMe"), e.contributions.me, t)}</li>
                  {hasPartner && <li data-person="partner">{whoText(partnerName, e.contributions.partner, t)}</li>}
                  {item && item.counted && item.allocation.unassignedCents > 0 && <li data-testid={`se-remaining-${e.id}`}>{t("se.sumRemaining", { amount: fmt(item.allocation.unassignedCents) })}</li>}
                </ul>
                {item?.informational && (
                  <p className="plan-row-note" data-testid={`se-info-${e.id}`}>
                    {t("se.infoLine", { meName: t("plan.personMe"), meAmount: fmt(item.informational.meCents), partnerName, partnerAmount: fmt(item.informational.partnerCents) })}
                  </p>
                )}
                {dups.length > 0 && (
                  <ul className="hh-list" data-testid={`se-dups-${e.id}`}>
                    {dups.map((d, i) => (
                      <li key={d.code + i} data-severity="warning">
                        {dupText(d, t)}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="se-actions">
                  <button type="button" className="plan-btn" onClick={() => { setDraft(expenseToDraft(e)); setShowErrors(false); setNotice(null); }} disabled={off} data-testid={`se-edit-${e.id}`} aria-label={`${t("se.edit")} ${e.label}`}>
                    <Pencil size={15} aria-hidden="true" /> {t("se.edit")}
                  </button>
                  <button type="button" className="plan-btn" onClick={() => setConfirmRemove(e)} disabled={off} data-testid={`se-remove-${e.id}`} aria-label={`${t("se.remove")} ${e.label}`}>
                    <Trash2 size={15} aria-hidden="true" /> {t("se.remove")}
                  </button>
                </div>
              </article>
            );
          })}
          {!draft && (
            <div className="se-actions">
              <button type="button" className="plan-btn plan-gold" onClick={openNew} disabled={off || atLimit} data-testid="se-add">
                <Plus size={16} aria-hidden="true" /> {t("se.add")}
              </button>
              {atLimit && (
                <p className="plan-row-note" data-testid="se-limit">
                  {t("se.addLimit", { max: SHARED_LIMITS.expenses })}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── add / edit form ── */}
      {draft && (
        <ExpenseForm
          draft={draft}
          setDraft={setDraft}
          checked={checked!}
          showErrors={showErrors}
          hasPartner={hasPartner}
          partnerName={partnerName}
          partnerExcluded={hasPartner && !included}
          candidates={candidates}
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
        <ConfirmActionModal title={t("se.removeTitle", { label: confirmRemove.label })} body={t("se.removeBody")} confirmLabel={t("se.removeConfirm")} busyLabel={t("se.removeBusy")} onCancel={() => setConfirmRemove(null)} onConfirm={() => remove(confirmRemove)} />
      )}
      {confirmNone && (
        <ConfirmActionModal title={t("se.noneConfirmTitle")} body={t("se.noneConfirmBody")} confirmLabel={t("se.noneConfirmYes")} busyLabel={t("se.noneConfirmBusy")} onCancel={() => setConfirmNone(false)} onConfirm={confirmNoExpenses} />
      )}
    </div>
  );
}

function ExpenseForm({
  draft, setDraft, checked, showErrors, hasPartner, partnerName, partnerExcluded, candidates, preview, busy, canEdit, onSave, onCancel,
}: {
  draft: ExpenseDraft;
  setDraft: (d: ExpenseDraft) => void;
  checked: ReturnType<typeof checkDraft>;
  showErrors: boolean;
  hasPartner: boolean;
  partnerName: string;
  partnerExcluded: boolean;
  candidates: LinkCandidate[];
  preview: { item: SharedItemResult | null; duplicates: OverviewModel["duplicates"] } | null;
  busy: boolean;
  canEdit: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const set = (patch: Partial<ExpenseDraft>) => setDraft({ ...draft, ...patch });
  const live = liveAllocation(draft, hasPartner);
  const errs = checked.errors.filter((e) => showErrors || e.code === "overAssigned");
  const err = (codes: DraftErrorCode[]) => errs.find((e) => codes.includes(e.code));
  const errText = (e: { code: DraftErrorCode } | undefined) => (e ? t(ERROR_KEY[e.code], { max: e.code === "labelTooLong" ? SHARED_LIMITS.label : SHARED_LIMITS.linksPerItem }) : null);
  const selected = new Set(draft.links.map(linkKey));
  const item = preview?.item ?? null;
  const partnerLabel = partnerExcluded ? t("se.fPartnerExcluded", { name: partnerName }) : partnerName;
  const labelOf = (c: LinkCandidate) => (c.group === "personal" ? t("se.linkPersonal", { who: c.person === "me" ? t("plan.personMe") : partnerName, category: t(CATEGORY_KEY[c.category as ExpenseCategory]) }) : c.name);
  const groups: LinkChoiceGroup[] = (["personal", "bill", "subscription", "account"] as LinkGroup[])
    .map((g) => ({ group: g, title: t(GROUP_KEY[g]), items: candidates.filter((c) => c.group === g).map((c) => ({ key: c.key, label: labelOf(c), amountCents: c.amountCents, checked: selected.has(c.key), toggle: () => setDraft({ ...draft, links: toggleLink(draft.links, c.link) }) })) }))
    .filter((g) => g.items.length > 0);
  const disabled = !canEdit || busy;

  return (
    <section className="plan-glass se-form" data-testid="se-form" aria-label={draft.id ? t("se.formEdit") : t("se.formAdd")}>
      <h4 className="plan-card-title">{draft.id ? t("se.formEdit") : t("se.formAdd")}</h4>

      <Field label={t("se.fName")} error={errText(err(["labelRequired", "labelTooLong"]))}>
        <input type="text" autoComplete="off" maxLength={SHARED_LIMITS.label + 20} placeholder={t("se.fNamePh")} value={draft.label} onChange={(e) => set({ label: e.target.value })} className={FIELD_CLASS} data-testid="se-f-name" aria-invalid={!!err(["labelRequired", "labelTooLong"])} />
      </Field>
      <Field label={t("se.fCategory")}>
        <select value={draft.category} onChange={(e) => set({ category: e.target.value as ExpenseCategory })} className={`${FIELD_CLASS} pay-select`} data-testid="se-f-category">
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(CATEGORY_KEY[c])}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("se.fAmount")} error={errText(err(["amountRequired", "amountInvalid"]))} help={t("se.fAmountHelp")}>
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} className={`${FIELD_CLASS} plan-amount`} data-testid="se-f-amount" aria-invalid={!!err(["amountRequired", "amountInvalid"])} />
      </Field>
      <label className="plan-check">
        <input type="checkbox" checked={draft.basis === "estimate"} onChange={(e) => set({ basis: e.target.checked ? "estimate" : "actual" })} data-testid="se-f-estimate" />
        <span>{t("se.fEstimate")}</span>
      </label>

      <WhoBox
        idp="se"
        legend={t("se.fWho")}
        hasPartner={hasPartner}
        partnerName={partnerName}
        partnerLabel={partnerLabel}
        me={draft.me}
        partner={draft.partner}
        onMe={(v) => set({ me: v })}
        onPartner={(v) => set({ partner: v })}
        shortcutsEnabled={live !== null}
        onShortcut={(who) => setDraft(applyShortcut(draft, who, hasPartner))}
        meError={errText(err(["meInvalid"]))}
        partnerError={errText(err(["partnerInvalid"]))}
        overAssigned={!!err(["overAssigned"])}
        live={live}
      />

      {item && <Suggestions idp="se" suggestions={item.suggestions} partnerName={partnerName} onUse={(person, cents) => setDraft(withSuggestion(draft, person, cents))} />}

      <LinksBox idp="se" title={t("se.linkTitle")} help={t("se.linkHelp")} groups={groups} count={draft.links.length} error={errText(err(["tooManyLinks"]))} />

      {preview && preview.duplicates.length > 0 && (
        <ul className="hh-list" data-testid="se-form-dups">
          {preview.duplicates.map((d, i) => (
            <li key={d.code + i} data-severity="warning">
              {dupText(d, t)}
            </li>
          ))}
        </ul>
      )}
      {item && item.excludedReason !== null && (
        <div role="note" className="plan-note" data-testid="se-form-counted">
          {t("se.countedElsewhere")}
          {item.informational && <div data-testid="se-form-info">{t("se.infoLine", { meName: t("plan.personMe"), meAmount: fmt(item.informational.meCents), partnerName, partnerAmount: fmt(item.informational.partnerCents) })}</div>}
        </div>
      )}

      <div className="se-actions">
        <button type="button" className="plan-btn plan-gold" onClick={onSave} disabled={disabled} data-testid="se-save">
          {busy ? t("se.saving") : t("se.save")}
        </button>
        <button type="button" className="plan-btn" onClick={onCancel} disabled={busy} data-testid="se-cancel">
          {t("pay.cancel")}
        </button>
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n/en";
import { toCents } from "@/lib/bills";
import { buildHouseholdPlan, type SharedDebt, type SharedItemResult } from "@/lib/householdPlan";
import { buildOverview, type Figure, type OverviewModel } from "@/lib/householdOverview";
import { SHARED_LIMITS } from "@/lib/householdShared";
import { readField } from "@/lib/sharedExpenseDraft";
import {
  applyDebtShortcut,
  checkDebtDraft,
  debtLinkCandidates,
  debtLinkKey,
  debtToDraft,
  emptyDebtDraft,
  liveDebtAllocation,
  toggleDebtLink,
  upsertDebt,
  withDebtSuggestion,
  type DebtDraft,
  type DebtErrorCode,
  type DebtLinkCandidate,
} from "@/lib/sharedDebtDraft";
import { ConfirmActionModal, FIELD_CLASS } from "./PaymentsDashboard";
import { Value, dupText, fmt } from "./HouseholdParts";
import { Field, LinksBox, StatusChip, Suggestions, WhoBox, whoText, type LinkChoiceGroup } from "./SharedEditorParts";
import { NoticeBox, noticeFor, type EditorShared, type Notice } from "./SharedExpensesEditor";
import type { SaveOutcome } from "./useHouseholdOverview";

// Tools > Planner > Household > Shared: the JOINT DEBTS editor (Phase 2, Step 4B). It edits only the joint-debt list and
// the "there are none" answer; shared expenses, goals and household composition are carried through unchanged. Each debt
// has two separate amounts: the monthly PAYMENT (the only thing that enters monthly cash flow, and the only thing the
// "who covers it" shares apply to) and the outstanding BALANCE (shown apart and never added to monthly figures). Saving,
// revision checks, conflicts and the unreadable-data gate are exactly those of the expense editor (one data layer).

const ERROR_KEY: Record<DebtErrorCode, TranslationKey> = {
  nameRequired: "se.eName",
  nameTooLong: "se.eNameLong",
  balanceInvalid: "jd.eBalance",
  paymentInvalid: "jd.ePayment",
  meInvalid: "se.eContrib",
  partnerInvalid: "se.eContrib",
  overAssigned: "se.eOver",
  tooManyLinks: "se.eLinks",
};

/** What a $0 monthly payment means. "Paid off" is only ever said for a balance of exactly 0 that the user entered. */
function zeroPaymentText(balance: number | null, t: (k: TranslationKey, p?: Record<string, string | number>) => string): string {
  if (balance === 0) return t("jd.paidOff");
  return balance !== null && balance > 0 ? t("jd.zeroPayBalanceOwed") : t("jd.zeroPayBalanceUnknown");
}

export default function SharedDebtsEditor(p: EditorShared) {
  const { t } = useLanguage();
  const { ctl, state, included, plan, model, me, partner, accounts, bills, subscriptions, todayISO, canEdit, ack, onSaved, locked, onFormChange } = p;
  const [draft, setDraftState] = useState<DebtDraft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmRemove, setConfirmRemove] = useState<SharedDebt | null>(null);
  const [confirmNone, setConfirmNone] = useState(false);

  const setDraft = (d: DebtDraft | null) => {
    setDraftState(d);
    onFormChange(d !== null);
  };
  const shared = state.shared;
  const debts = shared.debts;
  const hasPartner = !!partner;
  const partnerName = partner?.name ?? "";
  const busy = ctl.savingShared;
  const off = !canEdit || busy || locked;
  const candidates = useMemo(() => debtLinkCandidates({ me, partner: partner ? partner.profile : null, accounts }), [me, partner, accounts]);

  const checked = useMemo(() => (draft ? checkDebtDraft(draft, { hasPartner }) : null), [draft, hasPartner]);
  const preview = useMemo(() => {
    if (!checked?.debt) return null;
    const next = { ...shared, debts: upsertDebt(debts, checked.debt), noSharedDebts: false };
    const pl = buildHouseholdPlan({
      me: { profile: me },
      partner: partner ? { profile: partner.profile, name: partner.name, included } : null,
      shared: next,
      composition: state.composition,
      records: { bills, accounts, subscriptions },
      todayISO,
    });
    const m = buildOverview({ plan: pl, shared: next, integrity: state.integrity, droppedItems: state.droppedItems, meName: t("plan.personMe"), partnerName: partner ? partner.name : null, subscriptions });
    return { item: pl.sharedItems.find((i) => i.id === checked.debt!.id) ?? null, duplicates: m.duplicates.filter((d) => d.itemId === checked.debt!.id) };
  }, [checked, shared, debts, me, partner, included, state.composition, state.integrity, state.droppedItems, bills, accounts, subscriptions, todayISO, t]);

  function report(out: SaveOutcome): boolean {
    setNotice(noticeFor(out));
    if (out.ok) onSaved();
    return out.ok;
  }

  async function saveDraft() {
    setShowErrors(true);
    if (!draft || !checked?.debt) return;
    const next = { ...shared, debts: upsertDebt(debts, checked.debt), noSharedDebts: false };
    if (report(await ctl.saveShared({ shared: next, composition: state.composition }, { acknowledge: ack }))) {
      setDraft(null);
      setShowErrors(false);
    }
  }
  async function remove(d: SharedDebt): Promise<string | null> {
    report(await ctl.saveShared({ shared: { ...shared, debts: debts.filter((x) => x.id !== d.id) }, composition: state.composition }, { acknowledge: ack }));
    setConfirmRemove(null);
    return null;
  }
  async function confirmNoDebts(): Promise<string | null> {
    report(await ctl.saveShared({ shared: { ...shared, debts: [], noSharedDebts: true }, composition: state.composition }, { acknowledge: ack }));
    setConfirmNone(false);
    return null;
  }

  const atLimit = debts.length >= SHARED_LIMITS.debts;
  const itemOf = (id: string): SharedItemResult | undefined => plan.sharedItems.find((i) => i.id === id);
  const openNew = () => {
    setDraft(emptyDebtDraft());
    setShowErrors(false);
    setNotice(null);
  };

  // Monthly payments and outstanding balances are shown side by side but never combined.
  const missingPayments = debts.some((d) => d.monthlyPayment === null);
  const paymentsFig: Figure = missingPayments ? (plan.spending.components.jointDebtPaymentsCents > 0 ? { kind: "atLeast", cents: plan.spending.components.jointDebtPaymentsCents, estimate: false } : { kind: "unknown" }) : { kind: "amount", cents: plan.spending.components.jointDebtPaymentsCents, estimate: false };
  const bal = plan.debtBalances;
  const balancesFig: Figure = bal.missingJointBalances > 0 ? (bal.jointCents > 0 ? { kind: "atLeast", cents: bal.jointCents, estimate: false } : { kind: "unknown" }) : { kind: "amount", cents: bal.jointCents, estimate: false };

  return (
    <div className="jd-root" data-testid="jd-root">
      <section className="plan-glass" aria-label={t("jd.title")}>
        <h4 className="plan-card-title">{t("jd.title")}</h4>
        <p className="plan-row-note">{t("jd.intro")}</p>
      </section>

      <NoticeBox notice={notice} idp="jd" />

      {debts.length === 0 && !draft && (
        <section className="plan-glass plan-empty-card" data-testid="jd-empty" data-answered={shared.noSharedDebts}>
          {shared.noSharedDebts ? (
            <p data-testid="jd-none-confirmed">{t("jd.noneConfirmed")}</p>
          ) : (
            <>
              <h4>{t("jd.empty")}</h4>
              <p>{t("jd.emptyHelp")}</p>
            </>
          )}
          <div className="se-actions">
            <button type="button" className="plan-btn plan-gold" onClick={openNew} disabled={off} data-testid="jd-add">
              <Plus size={16} aria-hidden="true" /> {t("jd.add")}
            </button>
            {!shared.noSharedDebts && (
              <button type="button" className="plan-btn" onClick={() => setConfirmNone(true)} disabled={off} data-testid="jd-none">
                {t("jd.none")}
              </button>
            )}
          </div>
        </section>
      )}

      {debts.length > 0 && (
        <section aria-label={t("jd.title")} data-testid="jd-list">
          <p className="plan-row-note" data-testid="jd-count">
            {t("jd.count", { count: debts.length })}
          </p>
          <section className="plan-glass" data-testid="jd-totals" aria-label={t("jd.totalsTitle")}>
            <dl className="plan-rows">
              <div className="plan-row">
                <dt>{t("jd.totalsPayments")}</dt>
                <dd>
                  <Value f={paymentsFig} testId="jd-total-payments" />
                </dd>
              </div>
              <div className="plan-row" data-tone="none">
                <dt>{t("jd.totalsBalances")}</dt>
                <dd>
                  <Value f={balancesFig} testId="jd-total-balances" />
                </dd>
              </div>
            </dl>
            <p className="plan-row-note">{t("jd.totalsNote")}</p>
          </section>
          {debts.map((d) => {
            const item = itemOf(d.id);
            const dups = model.duplicates.filter((x) => x.itemId === d.id);
            return (
              <article key={d.id} className="plan-glass se-card" data-testid={`jd-card-${d.id}`}>
                <div className="se-card-head">
                  <div className="se-card-title">
                    <strong data-testid={`jd-name-${d.id}`}>{d.name}</strong>
                    <span className="plan-row-note" data-testid={`jd-balance-${d.id}`}>
                      {d.balance === null ? t("jd.balanceUnknown") : t("jd.balanceLabel", { amount: fmt(toCents(d.balance)) })}
                      {d.basis === "estimate" ? ` · ${t("hh.noteEstimate")}` : ""}
                    </span>
                  </div>
                  <div className="jd-pay">
                    <span className="plan-row-note">{t("jd.paymentShort")}</span>
                    <Value f={d.monthlyPayment === null ? { kind: "unknown" } : { kind: "amount", cents: toCents(d.monthlyPayment), estimate: d.basis === "estimate" }} testId={`jd-payment-${d.id}`} />
                  </div>
                </div>
                {d.monthlyPayment === 0 ? (
                  // A $0 payment says nothing is due THIS MONTH. Only a balance of exactly 0 means paid off.
                  <div>
                    <span className="plan-chip" data-status={d.balance === 0 ? "complete" : "todo"} data-testid={`jd-chip-${d.id}`}>
                      {d.balance === 0 ? t("jd.chipPaidOff") : t("jd.chipNoPayment")}
                    </span>
                  </div>
                ) : (
                  item && d.monthlyPayment !== null && <StatusChip item={item} id={d.id} idp="jd" />
                )}
                {d.monthlyPayment === 0 && (
                  <p className="plan-row-note" data-testid={`jd-zero-${d.id}`}>
                    {zeroPaymentText(d.balance, t)}
                  </p>
                )}
                {item && item.excludedReason !== null && (
                  <p className="plan-row-note" data-testid={`jd-counted-${d.id}`}>
                    {t("jd.countedElsewhere")}
                  </p>
                )}
                <ul className="hh-list se-who" data-testid={`jd-who-${d.id}`}>
                  <li data-person="me">{whoText(t("plan.personMe"), d.contributions.me, t)}</li>
                  {hasPartner && <li data-person="partner">{whoText(partnerName, d.contributions.partner, t)}</li>}
                  {item && item.counted && item.allocation.unassignedCents > 0 && <li data-testid={`jd-remaining-${d.id}`}>{t("se.sumRemaining", { amount: fmt(item.allocation.unassignedCents) })}</li>}
                  {d.monthlyPayment === null && <li data-testid={`jd-unknown-${d.id}`}>{t("jd.noteUnknownPayment")}</li>}
                </ul>
                {item?.informational && (
                  <p className="plan-row-note" data-testid={`jd-info-${d.id}`}>
                    {t("se.infoLine", { meName: t("plan.personMe"), meAmount: fmt(item.informational.meCents), partnerName, partnerAmount: fmt(item.informational.partnerCents) })}
                  </p>
                )}
                {dups.length > 0 && (
                  <ul className="hh-list" data-testid={`jd-dups-${d.id}`}>
                    {dups.map((x, i) => (
                      <li key={x.code + i} data-severity="warning">
                        {dupText(x, t)}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="se-actions">
                  <button type="button" className="plan-btn" onClick={() => { setDraft(debtToDraft(d)); setShowErrors(false); setNotice(null); }} disabled={off} data-testid={`jd-edit-${d.id}`} aria-label={`${t("se.edit")} ${d.name}`}>
                    <Pencil size={15} aria-hidden="true" /> {t("se.edit")}
                  </button>
                  <button type="button" className="plan-btn" onClick={() => setConfirmRemove(d)} disabled={off} data-testid={`jd-remove-${d.id}`} aria-label={`${t("se.remove")} ${d.name}`}>
                    <Trash2 size={15} aria-hidden="true" /> {t("se.remove")}
                  </button>
                </div>
              </article>
            );
          })}
          {!draft && (
            <div className="se-actions">
              <button type="button" className="plan-btn plan-gold" onClick={openNew} disabled={off || atLimit} data-testid="jd-add">
                <Plus size={16} aria-hidden="true" /> {t("jd.add")}
              </button>
              {atLimit && (
                <p className="plan-row-note" data-testid="jd-limit">
                  {t("jd.addLimit", { max: SHARED_LIMITS.debts })}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {draft && (
        <DebtForm
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
        <ConfirmActionModal title={t("se.removeTitle", { label: confirmRemove.name })} body={t("jd.removeBody")} confirmLabel={t("se.removeConfirm")} busyLabel={t("se.removeBusy")} onCancel={() => setConfirmRemove(null)} onConfirm={() => remove(confirmRemove)} />
      )}
      {confirmNone && (
        <ConfirmActionModal title={t("jd.noneConfirmTitle")} body={t("jd.noneConfirmBody")} confirmLabel={t("se.noneConfirmYes")} busyLabel={t("se.noneConfirmBusy")} onCancel={() => setConfirmNone(false)} onConfirm={confirmNoDebts} />
      )}
    </div>
  );
}

function DebtForm({
  draft, setDraft, checked, showErrors, hasPartner, partnerName, partnerExcluded, candidates, preview, busy, canEdit, onSave, onCancel,
}: {
  draft: DebtDraft;
  setDraft: (d: DebtDraft) => void;
  checked: ReturnType<typeof checkDebtDraft>;
  showErrors: boolean;
  hasPartner: boolean;
  partnerName: string;
  partnerExcluded: boolean;
  candidates: DebtLinkCandidate[];
  preview: { item: SharedItemResult | null; duplicates: OverviewModel["duplicates"] } | null;
  busy: boolean;
  canEdit: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const set = (patch: Partial<DebtDraft>) => setDraft({ ...draft, ...patch });
  const live = liveDebtAllocation(draft, hasPartner);
  const errs = checked.errors.filter((e) => showErrors || e.code === "overAssigned");
  const err = (codes: DebtErrorCode[]) => errs.find((e) => codes.includes(e.code));
  const errText = (e: { code: DebtErrorCode } | undefined) => (e ? t(ERROR_KEY[e.code], { max: e.code === "nameTooLong" ? SHARED_LIMITS.label : SHARED_LIMITS.linksPerItem }) : null);
  const selected = new Set(draft.links.map(debtLinkKey));
  const item = preview?.item ?? null;
  const partnerLabel = partnerExcluded ? t("se.fPartnerExcluded", { name: partnerName }) : partnerName;
  const labelOf = (c: DebtLinkCandidate) => (c.group === "personalDebt" ? t("jd.linkPersonalDebt", { who: c.person === "me" ? t("plan.personMe") : partnerName, name: c.name }) : c.name);
  const groups: LinkChoiceGroup[] = (["account", "personalDebt"] as const)
    .map((g) => ({
      group: g,
      title: t(g === "account" ? "se.linkGroupAccount" : "jd.linkGroupPersonalDebt"),
      items: candidates.filter((c) => c.group === g).map((c) => ({ key: c.key, label: labelOf(c), amountCents: c.amountCents, checked: selected.has(c.key), toggle: () => setDraft({ ...draft, links: toggleDebtLink(draft.links, c.link) }) })),
    }))
    .filter((g) => g.items.length > 0);
  const paymentBlank = draft.payment.trim() === "";
  const payField = readField(draft.payment);
  const balField = readField(draft.balance);
  const zeroHint = payField.state === "value" && payField.value === 0 ? zeroPaymentText(balField.state === "value" ? balField.value : null, t) : null;
  const stated = draft.me.trim() !== "" || (hasPartner && draft.partner.trim() !== "");
  const disabled = !canEdit || busy;

  return (
    <section className="plan-glass se-form" data-testid="jd-form" aria-label={draft.id ? t("jd.formEdit") : t("jd.formAdd")}>
      <h4 className="plan-card-title">{draft.id ? t("jd.formEdit") : t("jd.formAdd")}</h4>

      <Field label={t("se.fName")} error={errText(err(["nameRequired", "nameTooLong"]))}>
        <input type="text" autoComplete="off" maxLength={SHARED_LIMITS.label + 20} placeholder={t("jd.fNamePh")} value={draft.name} onChange={(e) => set({ name: e.target.value })} className={FIELD_CLASS} data-testid="jd-f-name" aria-invalid={!!err(["nameRequired", "nameTooLong"])} />
      </Field>
      <Field label={t("jd.fBalance")} error={errText(err(["balanceInvalid"]))} help={t("jd.fBalanceHelp")}>
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.balance} onChange={(e) => set({ balance: e.target.value })} className={`${FIELD_CLASS} plan-amount`} data-testid="jd-f-balance" aria-invalid={!!err(["balanceInvalid"])} />
      </Field>
      <Field label={t("jd.fPayment")} error={errText(err(["paymentInvalid"]))} help={t("jd.fPaymentHelp")}>
        <input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.payment} onChange={(e) => set({ payment: e.target.value })} className={`${FIELD_CLASS} plan-amount`} data-testid="jd-f-payment" aria-invalid={!!err(["paymentInvalid"])} />
      </Field>
      {zeroHint && (
        <p className="plan-row-note" data-testid="jd-zero-hint">
          {zeroHint}
        </p>
      )}
      <label className="plan-check">
        <input type="checkbox" checked={draft.basis === "estimate"} onChange={(e) => set({ basis: e.target.checked ? "estimate" : "actual" })} data-testid="jd-f-estimate" />
        <span>{t("jd.fEstimate")}</span>
      </label>

      <WhoBox
        idp="jd"
        legend={t("jd.fWho")}
        hasPartner={hasPartner}
        partnerName={partnerName}
        partnerLabel={partnerLabel}
        me={draft.me}
        partner={draft.partner}
        onMe={(v) => set({ me: v })}
        onPartner={(v) => set({ partner: v })}
        shortcutsEnabled={live !== null}
        onShortcut={(who) => setDraft(applyDebtShortcut(draft, who, hasPartner))}
        meError={errText(err(["meInvalid"]))}
        partnerError={errText(err(["partnerInvalid"]))}
        overAssigned={!!err(["overAssigned"])}
        live={live}
        note={paymentBlank && stated ? t("jd.noteUnknownPayment") : null}
      />

      {item && <Suggestions idp="jd" suggestions={item.suggestions} partnerName={partnerName} onUse={(person, cents) => setDraft(withDebtSuggestion(draft, person, cents))} />}

      <LinksBox idp="jd" title={t("jd.linkTitle")} help={t("jd.linkHelp")} groups={groups} count={draft.links.length} error={errText(err(["tooManyLinks"]))} />

      {preview && preview.duplicates.length > 0 && (
        <ul className="hh-list" data-testid="jd-form-dups">
          {preview.duplicates.map((d, i) => (
            <li key={d.code + i} data-severity="warning">
              {dupText(d, t)}
            </li>
          ))}
        </ul>
      )}
      {item && item.excludedReason !== null && (
        <div role="note" className="plan-note" data-testid="jd-form-counted">
          {t("jd.countedElsewhere")}
          {item.informational && <div data-testid="jd-form-info">{t("se.infoLine", { meName: t("plan.personMe"), meAmount: fmt(item.informational.meCents), partnerName, partnerAmount: fmt(item.informational.partnerCents) })}</div>}
        </div>
      )}

      <div className="se-actions">
        <button type="button" className="plan-btn plan-gold" onClick={onSave} disabled={disabled} data-testid="jd-save">
          {busy ? t("se.saving") : t("se.save")}
        </button>
        <button type="button" className="plan-btn" onClick={onCancel} disabled={busy} data-testid="jd-cancel">
          {t("pay.cancel")}
        </button>
      </div>
    </section>
  );
}

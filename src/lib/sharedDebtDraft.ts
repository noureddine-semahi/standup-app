import { toCents } from "@/lib/bills";
import type { Basis, FinancialProfile } from "@/lib/financialPlanner";
import { allocate, contributionError, type Allocation, type Contributions, type PersonalDebtLink, type RecordLink, type SharedDebt } from "@/lib/householdPlan";
import { SHARED_LIMITS, newSharedId } from "@/lib/householdShared";
import { readField, shortcutValues, type FieldValue } from "@/lib/sharedExpenseDraft";
import type { PaymentAccount } from "@/lib/supabase/db";

// Pure helpers for the joint-debt form (Phase 2, Step 4B). Same rules as the expense form:
//   * a blank box is UNKNOWN (null); a typed 0 is a real 0 (for the balance, the payment and each person's share)
//   * the outstanding BALANCE is kept apart from the monthly payment: contributions are shares of the monthly payment only
//   * nothing is linked automatically; a link exists only because the user ticked it
// How much is assigned and what remains comes from allocate() in householdPlan, the one calculation module.

export type DebtLink = Extract<RecordLink, { kind: "account" }> | PersonalDebtLink;

export type DebtDraft = {
  id: string | null;
  name: string;
  balance: string;
  payment: string;
  basis: Basis;
  me: string;
  partner: string;
  links: DebtLink[];
};

export const emptyDebtDraft = (): DebtDraft => ({ id: null, name: "", balance: "", payment: "", basis: "actual", me: "", partner: "", links: [] });

const text = (n: number | null): string => (n === null ? "" : String(n));

export function debtToDraft(d: SharedDebt): DebtDraft {
  return { id: d.id, name: d.name, balance: text(d.balance), payment: text(d.monthlyPayment), basis: d.basis, me: text(d.contributions.me), partner: text(d.contributions.partner), links: d.links.map((l) => ({ ...l })) };
}

export type DebtErrorCode = "nameRequired" | "nameTooLong" | "balanceInvalid" | "paymentInvalid" | "meInvalid" | "partnerInvalid" | "overAssigned" | "tooManyLinks";
export type DebtDraftResult = { errors: { code: DebtErrorCode }[]; debt: SharedDebt | null };

const valueOrNull = (f: FieldValue): number | null => (f.state === "value" ? f.value : null);

/** Validates the form and builds the debt. A blank balance or payment is unknown (null); a typed 0 is a real 0. */
export function checkDebtDraft(d: DebtDraft, opts: { hasPartner: boolean }): DebtDraftResult {
  const errors: { code: DebtErrorCode }[] = [];
  const name = d.name.trim();
  if (name === "") errors.push({ code: "nameRequired" });
  else if (name.length > SHARED_LIMITS.label) errors.push({ code: "nameTooLong" });
  const balance = readField(d.balance);
  const payment = readField(d.payment);
  const me = readField(d.me);
  const partner = opts.hasPartner ? readField(d.partner) : ({ state: "empty" } as FieldValue);
  if (balance.state === "invalid") errors.push({ code: "balanceInvalid" });
  if (payment.state === "invalid") errors.push({ code: "paymentInvalid" });
  if (me.state === "invalid") errors.push({ code: "meInvalid" });
  if (partner.state === "invalid") errors.push({ code: "partnerInvalid" });
  if (d.links.length > SHARED_LIMITS.linksPerItem) errors.push({ code: "tooManyLinks" });
  const contributions: Contributions = { me: valueOrNull(me), partner: valueOrNull(partner) };
  // Shares can only be compared with a known payment; with an unknown payment they are kept as stated.
  if (payment.state === "value" && me.state !== "invalid" && partner.state !== "invalid" && contributionError(payment.value, contributions) === "overAssigned") errors.push({ code: "overAssigned" });
  if (errors.length > 0) return { errors, debt: null };
  return { errors, debt: { id: d.id ?? newSharedId(), name, balance: valueOrNull(balance), monthlyPayment: valueOrNull(payment), basis: d.basis, contributions, links: d.links.map((l) => ({ ...l })) } };
}

/** Live assigned / not-yet-assigned for the monthly payment. null while the payment is blank or unusable. */
export function liveDebtAllocation(d: DebtDraft, hasPartner: boolean): (Allocation & { totalCents: number }) | null {
  const payment = readField(d.payment);
  const me = readField(d.me);
  const partner = hasPartner ? readField(d.partner) : ({ state: "empty" } as FieldValue);
  if (payment.state !== "value" || me.state === "invalid" || partner.state === "invalid") return null;
  const totalCents = toCents(payment.value);
  return { ...allocate(totalCents, { me: valueOrNull(me), partner: valueOrNull(partner) }), totalCents };
}

/** The shortcuts act on the MONTHLY PAYMENT (never on the balance). */
export function applyDebtShortcut(d: DebtDraft, who: "me" | "partner" | "clear", hasPartner: boolean): DebtDraft {
  const v = shortcutValues(d.payment, who, hasPartner);
  return v === null ? d : { ...d, me: v.me, partner: v.partner };
}

/** Fills one person's EMPTY box with a suggested amount; never overwrites what the user typed (an explicit 0 included). */
export function withDebtSuggestion(d: DebtDraft, person: "me" | "partner", cents: number): DebtDraft {
  if ((person === "me" ? d.me : d.partner).trim() !== "") return d;
  const v = String(cents / 100);
  return person === "me" ? { ...d, me: v } : { ...d, partner: v };
}

// ── what a joint debt can be linked to ──────────────────────────────────

export type DebtLinkCandidate = {
  key: string;
  link: DebtLink;
  group: "account" | "personalDebt";
  name: string;
  person?: "me" | "partner";
  /** The record's monthly payment (an account's minimum payment, or the planner debt's payment). */
  amountCents: number | null;
  balanceCents: number | null;
};

export const debtLinkKey = (l: DebtLink): string => (l.kind === "personalDebt" ? `personalDebt|${l.person}|${l.debtId}` : `account|${l.id}`);

/**
 * Everything the user may explicitly link a joint debt to: the user's own Payments accounts and the debts in the Me and
 * Partner planners. Listing a candidate links nothing, and the originals are never modified.
 */
export function debtLinkCandidates(i: { me: FinancialProfile; partner: FinancialProfile | null; accounts: readonly PaymentAccount[] }): DebtLinkCandidate[] {
  const out: DebtLinkCandidate[] = [];
  for (const a of i.accounts) {
    const link: DebtLink = { kind: "account", id: a.id };
    out.push({ key: debtLinkKey(link), link, group: "account", name: a.name, amountCents: toCents(a.minimumPayment), balanceCents: toCents(a.balance) });
  }
  const people: ["me" | "partner", FinancialProfile | null][] = [["me", i.me], ["partner", i.partner]];
  for (const [person, profile] of people) {
    if (!profile) continue;
    for (const d of profile.debts) {
      const link: DebtLink = { kind: "personalDebt", person, debtId: d.id };
      out.push({ key: debtLinkKey(link), link, group: "personalDebt", name: d.name, person, amountCents: d.monthlyPayment === null ? null : toCents(d.monthlyPayment), balanceCents: d.balance === null ? null : toCents(d.balance) });
    }
  }
  return out;
}

export function toggleDebtLink(links: readonly DebtLink[], link: DebtLink): DebtLink[] {
  const k = debtLinkKey(link);
  return links.some((l) => debtLinkKey(l) === k) ? links.filter((l) => debtLinkKey(l) !== k) : [...links, { ...link }];
}

/** Replaces the debt with the same id, or appends a new one. Never touches the others. */
export function upsertDebt(list: readonly SharedDebt[], d: SharedDebt): SharedDebt[] {
  return list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d];
}

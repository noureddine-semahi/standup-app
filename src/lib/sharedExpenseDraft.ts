import { parseMoney, toCents, type Bill } from "@/lib/bills";
import { EXPENSE_CATEGORIES, type Basis, type ExpenseCategory, type FinancialProfile } from "@/lib/financialPlanner";
import { allocate, contributionError, type Allocation, type Contributions, type PersonalExpenseLink, type RecordLink, type SharedExpense } from "@/lib/householdPlan";
import { SHARED_LIMITS, newSharedId } from "@/lib/householdShared";
import { monthlyCents, type Subscription } from "@/lib/subscriptions";
import type { PaymentAccount } from "@/lib/supabase/db";

// Pure helpers for the shared-expense form (Phase 2, Step 4A): text <-> values, the "who covers it" shortcuts, and
// the places an expense can be explicitly linked to. No I/O, and no accounting of its own: how much is assigned and
// what remains comes from allocate() in householdPlan, the one calculation module.
//
// Two rules the whole form rests on:
//   * an EMPTY contribution box means "not stated" (null); a typed 0 means "this person covers nothing" (a real 0)
//   * nothing is ever linked automatically: a link exists only because the user ticked it

export type ExpenseLink = RecordLink | PersonalExpenseLink;

export type ExpenseDraft = {
  /** null while adding; the stored id while editing (ids are stable, so links and references keep working). */
  id: string | null;
  label: string;
  category: ExpenseCategory;
  amount: string;
  basis: Basis;
  me: string;
  partner: string;
  links: ExpenseLink[];
};

export const emptyDraft = (): ExpenseDraft => ({ id: null, label: "", category: "housing", amount: "", basis: "actual", me: "", partner: "", links: [] });

const text = (n: number | null): string => (n === null ? "" : String(n));

export function expenseToDraft(e: SharedExpense): ExpenseDraft {
  return { id: e.id, label: e.label, category: e.category, amount: text(e.amount), basis: e.basis, me: text(e.contributions.me), partner: text(e.contributions.partner), links: e.links.map((l) => ({ ...l })) };
}

export type FieldValue = { state: "empty" } | { state: "value"; value: number } | { state: "invalid" };

/** Empty stays empty (not stated). A typed 0 is a real 0. */
export function readField(raw: string): FieldValue {
  if (raw.trim() === "") return { state: "empty" };
  const p = parseMoney(raw);
  return p.ok ? { state: "value", value: p.value } : { state: "invalid" };
}

export type DraftErrorCode = "labelRequired" | "labelTooLong" | "amountRequired" | "amountInvalid" | "meInvalid" | "partnerInvalid" | "overAssigned" | "tooManyLinks";
export type DraftError = { code: DraftErrorCode };

export type DraftResult = { errors: DraftError[]; expense: SharedExpense | null };

/** Validates the form values and, when they are fine, builds the expense. The save is validated again by the data layer. */
export function checkDraft(d: ExpenseDraft, opts: { hasPartner: boolean }): DraftResult {
  const errors: DraftError[] = [];
  const label = d.label.trim();
  if (label === "") errors.push({ code: "labelRequired" });
  else if (label.length > SHARED_LIMITS.label) errors.push({ code: "labelTooLong" });
  const amount = readField(d.amount);
  // A blank amount is unknown and is refused; an explicitly typed 0 is a real amount and is allowed.
  if (amount.state === "empty") errors.push({ code: "amountRequired" });
  else if (amount.state === "invalid") errors.push({ code: "amountInvalid" });
  const me = readField(d.me);
  const partner = opts.hasPartner ? readField(d.partner) : ({ state: "empty" } as FieldValue);
  if (me.state === "invalid") errors.push({ code: "meInvalid" });
  if (partner.state === "invalid") errors.push({ code: "partnerInvalid" });
  if (d.links.length > SHARED_LIMITS.linksPerItem) errors.push({ code: "tooManyLinks" });
  const contributions: Contributions = { me: me.state === "value" ? me.value : null, partner: partner.state === "value" ? partner.value : null };
  if (amount.state === "value" && me.state !== "invalid" && partner.state !== "invalid" && contributionError(amount.value, contributions) === "overAssigned") errors.push({ code: "overAssigned" });
  if (errors.length > 0 || amount.state !== "value") return { errors, expense: null };
  return { errors, expense: { id: d.id ?? newSharedId(), category: d.category, label, amount: amount.value, basis: d.basis, contributions, links: d.links.map((l) => ({ ...l })) } };
}

/** Live "assigned / not yet assigned" for the form, straight from allocate(). null while the amount isn't usable yet. */
export function liveAllocation(d: ExpenseDraft, hasPartner: boolean): (Allocation & { totalCents: number }) | null {
  const amount = readField(d.amount);
  const me = readField(d.me);
  const partner = hasPartner ? readField(d.partner) : ({ state: "empty" } as FieldValue);
  if (amount.state !== "value" || me.state === "invalid" || partner.state === "invalid") return null;
  const c: Contributions = { me: me.state === "value" ? me.value : null, partner: partner.state === "value" ? partner.value : null };
  const totalCents = toCents(amount.value);
  return { ...allocate(totalCents, c), totalCents };
}

/**
 * "Me covers all" / "<partner> covers all" fill in the whole amount for that person and an explicit 0 for the other (a
 * stated "covers nothing"); "clear" returns both to not stated. Unusable amounts change nothing.
 */
export function applyShortcut(d: ExpenseDraft, who: "me" | "partner" | "clear", hasPartner: boolean): ExpenseDraft {
  const v = shortcutValues(d.amount, who, hasPartner);
  return v === null ? d : { ...d, me: v.me, partner: v.partner };
}

/**
 * The values the three shortcuts put in the boxes, for any amount text (an expense's amount, a debt's monthly payment).
 * null when the amount isn't usable yet. A typed 0 is a usable amount.
 */
export function shortcutValues(amountText: string, who: "me" | "partner" | "clear", hasPartner: boolean): { me: string; partner: string } | null {
  if (who === "clear") return { me: "", partner: "" };
  const amount = readField(amountText);
  if (amount.state !== "value") return null;
  const full = String(amount.value);
  return who === "me" ? { me: full, partner: hasPartner ? "0" : "" } : { me: "0", partner: full };
}

/** Puts a suggested dollar amount into one person's box (only when that box is empty: it never overwrites). */
export function withSuggestion(d: ExpenseDraft, person: "me" | "partner", cents: number): ExpenseDraft {
  if ((person === "me" ? d.me : d.partner).trim() !== "") return d;
  const v = String(cents / 100);
  return person === "me" ? { ...d, me: v } : { ...d, partner: v };
}

// ── what an expense can be linked to ────────────────────────────────────

export type LinkGroup = "personal" | "bill" | "subscription" | "account";
export type LinkCandidate = {
  key: string;
  link: ExpenseLink;
  group: LinkGroup;
  /** The record's own name (planner entries use the category and person instead). */
  name: string;
  person?: "me" | "partner";
  category?: ExpenseCategory;
  amountCents: number | null;
};

export const linkKey = (l: ExpenseLink): string => (l.kind === "personalExpense" ? `personalExpense|${l.person}|${l.category}` : `${l.kind}|${l.id}`);

/** Generic key for any shared-item link (expense or joint-debt kinds). */
export const anyLinkKey = (l: { kind: string; id?: string; person?: string; category?: string; debtId?: string }): string =>
  l.kind === "personalExpense" ? `personalExpense|${l.person}|${l.category}` : l.kind === "personalDebt" ? `personalDebt|${l.person}|${l.debtId}` : `${l.kind}|${l.id}`;

/**
 * Everything the user may explicitly link a shared expense to: personal planner rows (Me, and the partner if there is
 * one) and the user's own active Finances records. Listing a candidate links nothing.
 */
export function linkCandidates(i: {
  me: FinancialProfile;
  partner: FinancialProfile | null;
  bills: readonly Bill[];
  accounts: readonly PaymentAccount[];
  subscriptions: readonly Subscription[];
}): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  const people: ["me" | "partner", FinancialProfile | null][] = [["me", i.me], ["partner", i.partner]];
  for (const [person, profile] of people) {
    if (!profile) continue;
    for (const category of EXPENSE_CATEGORIES) {
      const row = profile.expenses[category];
      if (!row || !(row.amount > 0)) continue;
      const link: PersonalExpenseLink = { kind: "personalExpense", person, category };
      out.push({ key: linkKey(link), link, group: "personal", name: "", person, category, amountCents: toCents(row.amount) });
    }
  }
  for (const b of i.bills) {
    if (b.archivedAt) continue;
    const link: RecordLink = { kind: "bill", id: b.id };
    out.push({ key: linkKey(link), link, group: "bill", name: b.name, amountCents: b.expectedAmount === null ? null : toCents(b.expectedAmount) });
  }
  for (const s of i.subscriptions) {
    // The household is USD only: a subscription in another currency is never counted, so it isn't offered either.
    if (s.status === "canceled" || s.currency !== "USD") continue;
    const link: RecordLink = { kind: "subscription", id: s.id };
    out.push({ key: linkKey(link), link, group: "subscription", name: s.name, amountCents: monthlyCents(s) });
  }
  for (const a of i.accounts) {
    const link: RecordLink = { kind: "account", id: a.id };
    out.push({ key: linkKey(link), link, group: "account", name: a.name, amountCents: toCents(a.minimumPayment) });
  }
  return out;
}

/** Adds the link if absent, removes it if present. */
export function toggleLink(links: readonly ExpenseLink[], link: ExpenseLink): ExpenseLink[] {
  const k = linkKey(link);
  return links.some((l) => linkKey(l) === k) ? links.filter((l) => linkKey(l) !== k) : [...links, { ...link }];
}

/** Replaces the expense with the same id, or appends a new one. Never touches the other entries. */
export function upsertExpense(list: readonly SharedExpense[], e: SharedExpense): SharedExpense[] {
  return list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e];
}

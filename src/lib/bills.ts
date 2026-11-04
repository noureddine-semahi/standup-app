// Pure logic for the Finances > Bills tracker: recurrence, occurrence status,
// bounded windows, summaries, suggestions and input validation. No I/O.
// The recurrence rules here are mirrored by public.bill_is_occurrence() in
// supabase/migrations/20261104000100_finance_bills.sql -- change both together.

export type BillRecurrence = "once" | "weekly" | "biweekly" | "monthly" | "quarterly" | "annually";
export type BillAmountType = "fixed" | "variable";

export const BILL_RECURRENCES: readonly BillRecurrence[] = ["once", "weekly", "biweekly", "monthly", "quarterly", "annually"];

/**
 * Bounded calculation window (documented, never "forever"):
 *  - an unpaid occurrence is only counted/flagged OVERDUE for this many days
 *    after its due date (older unpaid cycles stay visible in History but no
 *    longer inflate the overdue count);
 *  - upcoming occurrences are generated this many days ahead.
 * A one-time bill is always considered regardless of the window.
 */
export const OVERDUE_LOOKBACK_DAYS = 45;
export const UPCOMING_HORIZON_DAYS = 60;

export type Bill = {
  id: string;
  name: string;
  amountType: BillAmountType;
  /** Fixed: the amount due each cycle. Variable: an optional estimate. */
  expectedAmount: number | null;
  recurrence: BillRecurrence;
  firstDueDate: string;
  remindDaysBefore: number;
  category: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type BillPaymentRecord = {
  id: string;
  amount: number;
  paidAt: string;
  note: string | null;
  reversedAt: string | null;
};

/** A stored billing cycle (row exists once a payment or actual amount was recorded). */
export type BillOccurrenceRecord = {
  id: string;
  billId: string;
  dueDate: string;
  /** Fixed: snapshot of the expected amount at creation. Variable: the actual amount, or null until entered. */
  amountDue: number | null;
  payments: BillPaymentRecord[];
};

// ── Date helpers (pure string/UTC arithmetic: no timezone can shift a day) ──

function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dayNumber = (iso: string): number => {
  const { y, m, d } = parseISO(iso);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const fromDayNumber = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);

export function addDaysISO(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

export const daysBetween = (fromISO: string, toISO: string): number => dayNumber(toISO) - dayNumber(fromISO);

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isValidISODate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function monthBounds(todayISO: string): { start: string; end: string } {
  const { y, m } = parseISO(todayISO);
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
}

const MONTH_STEP: Partial<Record<BillRecurrence, number>> = { monthly: 1, quarterly: 3, annually: 12 };

/**
 * The k-th occurrence of a month-based bill: `step*k` months after the first
 * due date, on the FIRST due date's day-of-month clamped to that month's last
 * day. The anchor day is never lost, so Jan 31 -> Feb 28/29 -> Mar 31 (not
 * Mar 28), and a Feb 29 annual bill falls on Feb 28 in non-leap years.
 */
function monthlyOccurrence(first: string, step: number, k: number): string {
  const { y, m, d } = parseISO(first);
  const total = (m - 1) + step * k;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/** All occurrence dates of a bill within [fromISO, toISO], ascending. */
export function occurrenceDates(
  bill: Pick<Bill, "firstDueDate" | "recurrence">,
  fromISO: string,
  toISO: string
): string[] {
  const { firstDueDate: first, recurrence } = bill;
  if (toISO < fromISO) return [];
  if (recurrence === "once") return first >= fromISO && first <= toISO ? [first] : [];

  const out: string[] = [];
  if (recurrence === "weekly" || recurrence === "biweekly") {
    const step = recurrence === "weekly" ? 7 : 14;
    const firstN = dayNumber(first);
    const startK = Math.max(0, Math.ceil((dayNumber(fromISO) - firstN) / step));
    for (let k = startK; k < startK + 1000; k++) {
      const date = fromDayNumber(firstN + k * step);
      if (date > toISO) break;
      out.push(date);
    }
    return out;
  }

  const step = MONTH_STEP[recurrence]!;
  const a = parseISO(first);
  const b = parseISO(fromISO);
  const monthsToFrom = (b.y - a.y) * 12 + (b.m - a.m);
  const startK = Math.max(0, Math.floor(monthsToFrom / step) - 1);
  for (let k = startK; k < startK + 1000; k++) {
    const date = monthlyOccurrence(first, step, k);
    if (date > toISO) break;
    if (date >= fromISO) out.push(date);
  }
  return out;
}

export function isOccurrenceDate(bill: Pick<Bill, "firstDueDate" | "recurrence">, iso: string): boolean {
  return occurrenceDates(bill, iso, iso).length === 1;
}

/** First occurrence on/after a date, or null (a one-time bill already past). */
export function nextOccurrenceOnOrAfter(bill: Pick<Bill, "firstDueDate" | "recurrence">, fromISO: string): string | null {
  const start = fromISO < bill.firstDueDate ? bill.firstDueDate : fromISO;
  return occurrenceDates(bill, start, addDaysISO(start, 400))[0] ?? null;
}

// ── Money ────────────────────────────────────────────────────────────────

export const MAX_BILL_AMOUNT = 9_999_999_999.99;
export const toCents = (n: number): number => Math.round(n * 100);

export type MoneyError = "invalid" | "precision" | "negative" | "range";

/** Strict, non-negative, at most 2 decimals. Never rounds silently. */
export function parseMoney(raw: string): { ok: true; value: number } | { ok: false; error: MoneyError } {
  const s = raw.trim();
  if (s.startsWith("-")) return { ok: false, error: "negative" };
  if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: "precision" };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: "invalid" };
  const value = Number(s);
  if (!Number.isFinite(value) || value > MAX_BILL_AMOUNT) return { ok: false, error: "range" };
  return { ok: true, value };
}

// ── Occurrence status (always derived, never stored) ─────────────────────

export type OccurrenceStatus = "unpaid" | "partial" | "paid";
export type DueTier = "overdue" | "paid" | "soon" | "later";

/** Sum of non-reversed payments, in cents (exact). */
export function paidCents(payments: readonly BillPaymentRecord[]): number {
  return payments.reduce((sum, p) => (p.reversedAt ? sum : sum + toCents(p.amount)), 0);
}

/**
 * Status from payments vs. the amount due:
 *  - amount known: paid once payments reach it, partial when some but not all,
 *    unpaid when none.
 *  - amount unknown (variable bill, no actual entered): never "paid" -- an
 *    estimate being reached proves nothing -- so any payment reads "partial".
 */
export function computeStatus(amountDue: number | null, paid: number): OccurrenceStatus {
  if (amountDue === null) return paid > 0 ? "partial" : "unpaid";
  // Nothing owed (an amount due of 0) counts as paid.
  if (paid >= toCents(amountDue)) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}

export type OccurrenceView = {
  billId: string;
  /** Stored occurrence id, or null while the cycle has no row yet. */
  occurrenceId: string | null;
  dueDate: string;
  /** The amount actually due this cycle, or null when not known. */
  amountDue: number | null;
  /** The bill's estimate (variable bills only), kept separate from amountDue. */
  estimate: number | null;
  paid: number;
  outstanding: number | null;
  status: OccurrenceStatus;
  overdue: boolean;
  daysUntil: number;
  tier: DueTier;
  payments: BillPaymentRecord[];
};

export function resolveOccurrence(
  bill: Bill,
  dueDate: string,
  record: BillOccurrenceRecord | undefined,
  todayISO: string
): OccurrenceView {
  // A stored cycle keeps its own snapshot; an uncreated fixed cycle uses the
  // bill's current amount; an uncreated variable cycle has no amount yet.
  const amountDue = record ? record.amountDue : bill.amountType === "fixed" ? bill.expectedAmount : null;
  const payments = record?.payments ?? [];
  const paid = paidCents(payments);
  const status = computeStatus(amountDue, paid);
  const daysUntil = daysBetween(todayISO, dueDate);
  const overdue = status !== "paid" && daysUntil < 0;
  const tier: DueTier = status === "paid" ? "paid" : overdue ? "overdue" : daysUntil <= bill.remindDaysBefore ? "soon" : "later";
  return {
    billId: bill.id,
    occurrenceId: record?.id ?? null,
    dueDate,
    amountDue,
    estimate: bill.amountType === "variable" ? bill.expectedAmount : null,
    paid: paid / 100,
    outstanding: amountDue === null ? null : Math.max(0, toCents(amountDue) - paid) / 100,
    status,
    overdue,
    daysUntil,
    tier,
    payments,
  };
}

/** billId -> dueDate -> stored cycle */
export type OccurrenceMap = Record<string, Record<string, BillOccurrenceRecord>>;

/** The dates the tracker considers for one bill: the bounded window, or the single date of a one-time bill. */
export function windowDates(bill: Bill, todayISO: string): string[] {
  if (bill.recurrence === "once") return [bill.firstDueDate];
  return occurrenceDates(bill, addDaysISO(todayISO, -OVERDUE_LOOKBACK_DAYS), addDaysISO(todayISO, UPCOMING_HORIZON_DAYS));
}

export function billOccurrenceViews(bill: Bill, map: OccurrenceMap, todayISO: string): OccurrenceView[] {
  return windowDates(bill, todayISO).map((d) => resolveOccurrence(bill, d, map[bill.id]?.[d], todayISO));
}

/**
 * The occurrence a card should show: the earliest UNPAID one (which may be
 * overdue); when everything in the window is paid, the next one to come (or the
 * latest paid one for a one-time bill).
 */
export function currentOccurrence(bill: Bill, map: OccurrenceMap, todayISO: string): OccurrenceView | null {
  const views = billOccurrenceViews(bill, map, todayISO);
  const unpaid = views.find((v) => v.status !== "paid");
  if (unpaid) return unpaid;
  const future = views.find((v) => v.daysUntil >= 0);
  if (future) return future;
  if (views.length > 0) return views[views.length - 1];
  const next = nextOccurrenceOnOrAfter(bill, todayISO);
  return next ? resolveOccurrence(bill, next, map[bill.id]?.[next], todayISO) : null;
}

// ── Summaries ────────────────────────────────────────────────────────────

/**
 * The amount a cycle is planned/measured against:
 *   1. the ACTUAL amount due when it is known (fixed bills always have one);
 *   2. otherwise the bill's ESTIMATE (variable bills only);
 *   3. otherwise unknown (null) -- never silently 0.
 * `estimated` marks case 2 so every total built from it can say so. This is
 * for totals/planning only: an estimate is never treated as a confirmed amount
 * (a variable cycle's *status* still ignores it -- see computeStatus).
 */
export function selectedAmount(v: Pick<OccurrenceView, "amountDue" | "estimate">): { amount: number | null; estimated: boolean } {
  if (v.amountDue !== null) return { amount: v.amountDue, estimated: false };
  if (v.estimate !== null) return { amount: v.estimate, estimated: true };
  return { amount: null, estimated: false };
}

export type BillsSummary = {
  /** Expected this month: actual amounts where available, otherwise estimates (cycles with neither are excluded and counted in unknownThisMonth). */
  expectedThisMonth: number;
  /** True when expectedThisMonth / remainingThisMonth include at least one estimate. */
  includesEstimates: boolean;
  /** How many of this month's cycles are using an estimate instead of an actual amount. */
  estimatedThisMonth: number;
  /** This month's cycles with NO amount at all (no actual, no estimate) -- never counted as $0. */
  unknownThisMonth: number;
  /** This month's cycles that have an amount to measure against (actual or estimate). */
  knownThisMonth: number;
  /** Non-reversed payments recorded against this month's cycles. */
  paidThisMonth: number;
  /**
   * Still to pay this month: the sum, per cycle, of max(0, selected amount - non-reversed payments)
   * over cycles that have an amount. An overpayment contributes 0 (never negative, and never
   * reduces another cycle's remaining).
   */
  remainingThisMonth: number;
  /** Unpaid occurrences due from today through each bill's own reminder window. */
  upcoming: number;
  /** Unpaid occurrences whose due date has passed (within the lookback window). */
  overdue: number;
};

export function summarizeBills(bills: readonly Bill[], map: OccurrenceMap, todayISO: string): BillsSummary {
  const { start, end } = monthBounds(todayISO);
  let expected = 0;
  let paidTotal = 0;
  let remaining = 0;
  let unknown = 0;
  let known = 0;
  let estimated = 0;
  let upcoming = 0;
  let overdue = 0;

  for (const bill of bills) {
    if (bill.archivedAt) continue;
    // This calendar month.
    const monthDates = bill.recurrence === "once"
      ? (bill.firstDueDate >= start && bill.firstDueDate <= end ? [bill.firstDueDate] : [])
      : occurrenceDates(bill, start, end);
    for (const d of monthDates) {
      const v = resolveOccurrence(bill, d, map[bill.id]?.[d], todayISO);
      const paidC = toCents(v.paid);
      paidTotal += paidC;
      const sel = selectedAmount(v);
      if (sel.amount === null) {
        unknown += 1;
        continue;
      }
      known += 1;
      if (sel.estimated) estimated += 1;
      const selC = toCents(sel.amount);
      expected += selC;
      remaining += Math.max(0, selC - paidC);
    }
    // Reminder window / overdue (bounded).
    for (const v of billOccurrenceViews(bill, map, todayISO)) {
      if (v.status === "paid") continue;
      if (v.overdue) overdue += 1;
      else if (v.daysUntil <= bill.remindDaysBefore) upcoming += 1;
    }
  }
  return {
    expectedThisMonth: expected / 100,
    includesEstimates: estimated > 0,
    estimatedThisMonth: estimated,
    unknownThisMonth: unknown,
    knownThisMonth: known,
    paidThisMonth: paidTotal / 100,
    remainingThisMonth: remaining / 100,
    upcoming,
    overdue,
  };
}

// ── Presentation helpers (labels only -- no financial calculation) ────────

export type StatusLabel = "paid" | "overdue" | "pending" | "partial" | "due";

/**
 * What a card/cycle should SAY. Whenever the actual amount due is unknown the
 * bill is "pending" (never "partially paid" or "paid" -- an estimate decides
 * nothing); once it is known the label follows the real status. Overdue still
 * wins so a late bill is never hidden behind a "pending" tag.
 */
export function statusLabel(v: Pick<OccurrenceView, "amountDue" | "status" | "overdue">): StatusLabel {
  if (v.amountDue === null) return v.overdue ? "overdue" : "pending";
  if (v.status === "paid") return "paid";
  if (v.overdue) return "overdue";
  return v.status === "partial" ? "partial" : "due";
}

export type DueSummaryDisplay = {
  /** This month has bills but not one amount (actual or estimate): show "Amount pending", not $0.00. */
  allPending: boolean;
  /** The totals include at least one estimate: label them "Includes estimates". */
  includesEstimates: boolean;
  /** Some cycles have no amount at all and are left out of the totals. */
  knownOnly: boolean;
  /** Bills with no amount at all. */
  awaiting: number;
};

export function describeDueSummary(
  s: Pick<BillsSummary, "knownThisMonth" | "unknownThisMonth" | "includesEstimates">
): DueSummaryDisplay {
  return {
    allPending: s.unknownThisMonth > 0 && s.knownThisMonth === 0,
    includesEstimates: s.includesEstimates,
    // "Known amounts only" is only the right caveat when no estimate is mixed in.
    knownOnly: s.unknownThisMonth > 0 && s.knownThisMonth > 0 && !s.includesEstimates,
    awaiting: s.unknownThisMonth,
  };
}

// ── Plan Tomorrow suggestions (tap-to-add; never automatic) ──────────────

export type BillSuggestion = {
  bill: Bill;
  dueDate: string;
  amountDue: number | null;
};

export const billSuggestionKey = (billId: string, dueDate: string) => `${billId}|${dueDate}`;

/**
 * Unpaid occurrences whose reminder window covers `planDateISO`
 * (due - remindDaysBefore <= plan date <= due), minus any occurrence that
 * already has a goal linked to it (`linked` holds billSuggestionKey values).
 * A paid occurrence is never suggested.
 */
export function suggestBillGoals(
  bills: readonly Bill[],
  map: OccurrenceMap,
  planDateISO: string,
  linked: ReadonlySet<string>
): BillSuggestion[] {
  const out: BillSuggestion[] = [];
  for (const bill of bills) {
    if (bill.archivedAt) continue;
    const dates = bill.recurrence === "once"
      ? [bill.firstDueDate]
      : occurrenceDates(bill, planDateISO, addDaysISO(planDateISO, bill.remindDaysBefore));
    for (const d of dates) {
      const daysAhead = daysBetween(planDateISO, d);
      if (daysAhead < 0 || daysAhead > bill.remindDaysBefore) continue;
      const v = resolveOccurrence(bill, d, map[bill.id]?.[d], planDateISO);
      if (v.status === "paid") continue;
      if (linked.has(billSuggestionKey(bill.id, d))) continue;
      out.push({ bill, dueDate: d, amountDue: v.amountDue });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.bill.name.localeCompare(b.bill.name));
}

// ── Form validation ──────────────────────────────────────────────────────

/**
 * Predefined categories. The stored value is always this canonical English
 * label (or the user's own text for "Other"), so what's saved never depends on
 * the UI language; the label shown is translated by the component.
 */
export const BILL_CATEGORIES = [
  "Utilities",
  "Internet",
  "Mobile / Phone",
  "Rent / Mortgage",
  "Insurance",
  "Auto / Transportation",
  "Groceries",
  "Healthcare",
  "Education / Childcare",
  "Home Maintenance",
  "Taxes / Government",
  "Memberships",
  "Entertainment",
  "Other",
] as const;
export type BillCategory = (typeof BILL_CATEGORIES)[number];
export const OTHER_CATEGORY: BillCategory = "Other";
export const MAX_CATEGORY_LENGTH = 60;

export function isPredefinedCategory(value: string | null | undefined): value is BillCategory {
  return !!value && (BILL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Stored category -> the two form fields. A saved value that isn't on the list
 * (anything typed before the dropdown existed, or a custom "Other") is restored
 * as "Other" + that text, so it is shown and kept exactly as saved -- never
 * dropped or reclassified.
 */
export function categoryToFormFields(stored: string | null | undefined): { choice: string; custom: string } {
  const value = (stored ?? "").trim();
  if (!value) return { choice: "", custom: "" };
  if (isPredefinedCategory(value)) return { choice: value, custom: "" };
  return { choice: OTHER_CATEGORY, custom: value };
}

/** Form fields -> the value to store: none, a predefined label, or the custom text ("Other" if left blank). */
export function resolveCategory(choice: string, custom: string): string | null {
  if (!choice) return null;
  if (choice !== OTHER_CATEGORY) return isPredefinedCategory(choice) ? choice : null;
  return custom.trim() || OTHER_CATEGORY;
}

export type BillFormValues = {
  name: string;
  amountType: BillAmountType;
  amount: string;
  firstDueDate: string;
  recurrence: BillRecurrence;
  remindDaysBefore: string;
  /** "" (none), a predefined label, or "Other". */
  categoryChoice: string;
  /** Only used when categoryChoice is "Other". */
  categoryCustom: string;
  notes: string;
};

export type BillFormPayload = {
  name: string;
  amountType: BillAmountType;
  expectedAmount: number | null;
  firstDueDate: string;
  recurrence: BillRecurrence;
  remindDaysBefore: number;
  category: string | null;
  notes: string | null;
};

export type BillFormField = "name" | "amount" | "firstDueDate" | "remindDaysBefore" | "category" | "notes";
export type BillFormError = { field: BillFormField; code: "required" | "invalid" | "precision" | "negative" | "range" | "tooLong" };

export function emptyBillForm(todayISO: string): BillFormValues {
  return { name: "", amountType: "fixed", amount: "", firstDueDate: todayISO, recurrence: "monthly", remindDaysBefore: "3", categoryChoice: "", categoryCustom: "", notes: "" };
}

export function billToFormValues(b: Bill): BillFormValues {
  return {
    name: b.name,
    amountType: b.amountType,
    amount: b.expectedAmount === null ? "" : String(b.expectedAmount),
    firstDueDate: b.firstDueDate,
    recurrence: b.recurrence,
    remindDaysBefore: String(b.remindDaysBefore),
    categoryChoice: categoryToFormFields(b.category).choice,
    categoryCustom: categoryToFormFields(b.category).custom,
    notes: b.notes ?? "",
  };
}

export function parseBillForm(v: BillFormValues): { ok: true; payload: BillFormPayload } | { ok: false; errors: BillFormError[] } {
  const errors: BillFormError[] = [];
  const name = v.name.trim();
  if (!name) errors.push({ field: "name", code: "required" });
  else if (name.length > 120) errors.push({ field: "name", code: "tooLong" });

  let expectedAmount: number | null = null;
  if (v.amount.trim() === "") {
    if (v.amountType === "fixed") errors.push({ field: "amount", code: "required" });
  } else {
    const m = parseMoney(v.amount);
    if (m.ok) expectedAmount = m.value;
    else errors.push({ field: "amount", code: m.error });
  }

  if (!isValidISODate(v.firstDueDate.trim())) errors.push({ field: "firstDueDate", code: v.firstDueDate.trim() ? "invalid" : "required" });

  const rd = v.remindDaysBefore.trim();
  const remind = rd === "" ? 0 : Number(rd);
  if (!/^\d*$/.test(rd) || !Number.isInteger(remind) || remind < 0 || remind > 60) errors.push({ field: "remindDaysBefore", code: "invalid" });

  if (v.categoryChoice === OTHER_CATEGORY && v.categoryCustom.trim().length > MAX_CATEGORY_LENGTH) errors.push({ field: "category", code: "tooLong" });
  const category = resolveCategory(v.categoryChoice, v.categoryCustom) ?? "";
  const notes = v.notes.trim();
  if (notes.length > 1000) errors.push({ field: "notes", code: "tooLong" });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      name,
      amountType: v.amountType,
      expectedAmount,
      firstDueDate: v.firstDueDate.trim(),
      recurrence: v.recurrence,
      remindDaysBefore: remind,
      category: category || null,
      notes: notes || null,
    },
  };
}

export type BillPaymentEntryValues = { amount: string; date: string; note: string; amountDue: string };
export type BillPaymentEntryPayload = { amount: number; paidAt: string; note: string | null; amountDue: number | null };
export type BillPaymentEntryError = "amount" | "amountPrecision" | "amountDue" | "date" | "dateFuture" | "note";

/** Record-payment validation: positive amount, optional actual amount due, real non-future date. */
export function parseBillPaymentEntry(
  v: BillPaymentEntryValues,
  todayISO: string
): { ok: true; payload: BillPaymentEntryPayload } | { ok: false; error: BillPaymentEntryError } {
  const amt = parseMoney(v.amount);
  if (!amt.ok) return { ok: false, error: amt.error === "precision" ? "amountPrecision" : "amount" };
  if (!(amt.value > 0)) return { ok: false, error: "amount" };

  let amountDue: number | null = null;
  if (v.amountDue.trim() !== "") {
    const due = parseMoney(v.amountDue);
    if (!due.ok) return { ok: false, error: "amountDue" };
    amountDue = due.value;
  }

  const date = v.date.trim();
  if (!isValidISODate(date)) return { ok: false, error: "date" };
  if (date > todayISO) return { ok: false, error: "dateFuture" };

  const note = v.note.trim();
  if (note.length > 500) return { ok: false, error: "note" };

  const { y, m, d } = parseISO(date);
  return { ok: true, payload: { amount: amt.value, paidAt: new Date(y, m - 1, d, 12, 0, 0).toISOString(), note: note || null, amountDue } };
}

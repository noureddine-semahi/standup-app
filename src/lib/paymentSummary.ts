import { computeNextDueDate, toISODate, type AccountEntry, type PaymentAccount, type PaymentTransaction } from "@/lib/supabase/db";
import type { BillsSummary } from "@/lib/bills";
import type { SubscriptionsSummary } from "@/lib/subscriptions";

// Presentation helpers for the Payments dashboard. Nothing here changes how
// reminders are scheduled: due dates still come from computeNextDueDate, and
// the "due today" / "due soon" tiers are exactly the ones the old card chip
// used (days until the next due date vs. the account's own remindDaysBefore).

/** A stored amount, or 0 when it is missing / NaN / infinite. */
function safeAmount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

export type PaymentSummary = {
  totalBalance: number;
  monthlyMinimums: number;
  count: number;
};

/** Totals across the accounts currently listed (deleted accounts are removed from the list, so they never count). */
export function summarizePayments(accounts: readonly Pick<PaymentAccount, "balance" | "minimumPayment">[]): PaymentSummary {
  let totalBalance = 0;
  let monthlyMinimums = 0;
  for (const a of accounts) {
    totalBalance += safeAmount(a.balance);
    monthlyMinimums += safeAmount(a.minimumPayment);
  }
  // Cents-level rounding so 0.1 + 0.2 style drift never reaches the screen.
  return {
    totalBalance: Math.round(totalBalance * 100) / 100,
    monthlyMinimums: Math.round(monthlyMinimums * 100) / 100,
    count: accounts.length,
  };
}

export type DueTier = "today" | "soon" | "later";

export type PaymentDueInfo = {
  dueDate: string;
  daysUntilDue: number;
  tier: DueTier;
};

/** Next due date plus the urgency tier, using the unchanged reminder rules. */
export function getPaymentDueInfo(
  account: Pick<PaymentAccount, "dueDay" | "remindDaysBefore">,
  todayISO: string
): PaymentDueInfo {
  const dueDate = computeNextDueDate(account.dueDay, todayISO);
  const daysUntilDue = Math.round(
    (new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${todayISO}T00:00:00`).getTime()) / 86400000
  );
  const tier: DueTier = daysUntilDue === 0 ? "today" : daysUntilDue <= account.remindDaysBefore ? "soon" : "later";
  return { dueDate, daysUntilDue, tier };
}

export type BalanceMode = "auto" | "manual";

export type PaymentFormValues = {
  name: string;
  balance: string;
  minimumPayment: string;
  dueDay: string;
  remindDaysBefore: string;
  balanceMode: BalanceMode;
};

export type PaymentFormPayload = {
  name: string;
  balance: number;
  minimumPayment: number;
  dueDay: number;
  remindDaysBefore: number;
  balanceMode: BalanceMode;
};

/** New accounts start in manual mode: nothing touches the balance unless the user opts in. */
export const EMPTY_PAYMENT_FORM: PaymentFormValues = {
  name: "",
  balance: "",
  minimumPayment: "",
  dueDay: "",
  remindDaysBefore: "3",
  balanceMode: "manual",
};

export function paymentToFormValues(a: PaymentAccount): PaymentFormValues {
  return {
    name: a.name,
    balance: String(a.balance),
    minimumPayment: String(a.minimumPayment),
    dueDay: String(a.dueDay),
    remindDaysBefore: String(a.remindDaysBefore),
    balanceMode: a.balanceMode,
  };
}

/**
 * Same rules the inline form used: a name and a due day of 1-31 are required;
 * balance / minimum / reminder days fall back to 0 when blank. Values that are
 * typed but not a finite number are rejected (the old per-field editor ignored
 * those, the add form coerced them to 0 -- rejecting is the safe superset).
 */
export function parsePaymentForm(v: PaymentFormValues): PaymentFormPayload | null {
  const name = v.name.trim();
  const dueDay = Number(v.dueDay);
  if (!name || !dueDay || dueDay < 1 || dueDay > 31) return null;
  const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
  const balance = num(v.balance);
  const minimumPayment = num(v.minimumPayment);
  const remindDaysBefore = num(v.remindDaysBefore);
  if (![balance, minimumPayment, remindDaysBefore].every(Number.isFinite)) return null;
  return { name, balance, minimumPayment, dueDay, remindDaysBefore, balanceMode: v.balanceMode === "auto" ? "auto" : "manual" };
}

/** Only the fields that actually differ, so an untouched edit never writes. */
export function diffPaymentPayload(a: PaymentAccount, p: PaymentFormPayload): Partial<PaymentFormPayload> {
  const patch: Partial<PaymentFormPayload> = {};
  if (p.name !== a.name) patch.name = p.name;
  if (p.balance !== a.balance) patch.balance = p.balance;
  if (p.minimumPayment !== a.minimumPayment) patch.minimumPayment = p.minimumPayment;
  if (p.dueDay !== a.dueDay) patch.dueDay = p.dueDay;
  if (p.remindDaysBefore !== a.remindDaysBefore) patch.remindDaysBefore = p.remindDaysBefore;
  if (p.balanceMode !== a.balanceMode) patch.balanceMode = p.balanceMode;
  return patch;
}

/** A balance edit expressed as an adjustment entry: the amount is a positive magnitude, the direction says which way the balance (the amount OWED) moves. */
export type BalanceAdjustmentPlan = { direction: "increase" | "decrease"; amount: number };

export type BalanceAdjustmentResult =
  | { ok: true; plan: BalanceAdjustmentPlan | null } // plan null = the balance is unchanged: no entry, no write
  | { ok: false; error: "precision" | "range" };

const MAX_LEDGER_AMOUNT_CENTS = 9_999_999_999; // 99,999,999.99, the ledger's limit

/**
 * Turns "set the balance to X" into the adjustment that does it, from the balance the caller actually read.
 * requested above current = increase; below = decrease; equal = no adjustment at all. Cents-exact: a requested balance with
 * more than two decimals is refused (never silently rounded), as is one whose adjustment or balance exceeds the ledger limit.
 */
export function planBalanceAdjustment(current: number, requested: number): BalanceAdjustmentResult {
  if (!Number.isFinite(current) || !Number.isFinite(requested)) return { ok: false, error: "range" };
  const requestedCents = toCents(requested);
  if (Math.abs(requested * 100 - requestedCents) > 1e-6) return { ok: false, error: "precision" };
  const diff = requestedCents - toCents(current);
  if (diff === 0) return { ok: true, plan: null };
  if (Math.abs(requestedCents) > MAX_LEDGER_AMOUNT_CENTS || Math.abs(diff) > MAX_LEDGER_AMOUNT_CENTS) return { ok: false, error: "range" };
  return { ok: true, plan: { direction: diff > 0 ? "increase" : "decrease", amount: fromCents(Math.abs(diff)) } };
}

/**
 * One History row: either a payment (payment_transactions) or an entry (payment_account_entries). They are kept as separate TYPES with separate keys, never merged
 * by id, because they reverse through different functions (reverse_payment vs reverse_account_entry).
 */
export type HistoryItem =
  | { type: "payment"; key: string; day: string; ts: number; txn: PaymentTransaction }
  | { type: "entry"; key: string; day: string; ts: number; entry: AccountEntry };

/** Payments and entries on one list, newest first: by the day the user dated them, then by when they were recorded. */
export function buildHistoryItems(txns: readonly PaymentTransaction[], entries: readonly AccountEntry[]): HistoryItem[] {
  const items: HistoryItem[] = [
    ...txns.map((txn): HistoryItem => ({ type: "payment", key: `payment:${txn.id}`, day: toISODate(new Date(txn.paidAt)), ts: new Date(txn.paidAt).getTime(), txn })),
    ...entries.map((entry): HistoryItem => ({ type: "entry", key: `entry:${entry.id}`, day: entry.entryDate, ts: new Date(entry.createdAt).getTime(), entry })),
  ];
  return items.sort((a, b) => (a.day === b.day ? b.ts - a.ts : a.day < b.day ? 1 : -1));
}

// ── Money helpers ────────────────────────────────────────────────────────
// Amounts are handled in integer cents whenever they're combined, so
// repeated adds/subtracts can't accumulate floating-point error.

export const toCents = (n: number): number => Math.round(n * 100);
export const fromCents = (c: number): number => c / 100;

/** The balance a payment would leave behind (cents-exact). Negative = credit, as in the ledger. */
export function previewBalanceAfter(balance: number, amount: number): number {
  return fromCents(toCents(balance) - toCents(amount));
}

export type PaymentEntryValues = {
  amount: string;
  date: string; // YYYY-MM-DD
  note: string;
  applyBalance: boolean;
};

export type PaymentEntryPayload = {
  amount: number;
  paidAt: string; // ISO timestamp (local noon of the chosen day, so no timezone can flip the date)
  note: string | null;
  applyBalance: boolean;
};

export type PaymentEntryError = "amount" | "amountPrecision" | "date" | "dateFuture" | "note";

export const MAX_PAYMENT_AMOUNT = 99_999_999.99;
export const MAX_PAYMENT_NOTE = 500;

/**
 * Strict validation for Record Payment. The amount must be a plain positive
 * number with at most 2 decimals -- nothing is silently rounded -- and the
 * date a real calendar day that isn't in the future.
 */
export function parsePaymentEntry(
  v: PaymentEntryValues,
  todayISO: string
): { ok: true; payload: PaymentEntryPayload } | { ok: false; error: PaymentEntryError } {
  const raw = v.amount.trim();
  if (!/^\d+(\.\d*)?$/.test(raw)) return { ok: false, error: "amount" };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { ok: false, error: "amountPrecision" };
  const amount = Number(raw);
  if (!(amount > 0) || amount > MAX_PAYMENT_AMOUNT) return { ok: false, error: "amount" };

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.date.trim());
  if (!m) return { ok: false, error: "date" };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d, 12, 0, 0);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return { ok: false, error: "date" };
  if (v.date.trim() > todayISO) return { ok: false, error: "dateFuture" };

  const note = v.note.trim();
  if (note.length > MAX_PAYMENT_NOTE) return { ok: false, error: "note" };

  return { ok: true, payload: { amount, paidAt: probe.toISOString(), note: note || null, applyBalance: v.applyBalance } };
}

export type LedgerEntryKind = "interest" | "fee";
export type LedgerEntryValues = {
  amount: string;
  entryDate: string; // YYYY-MM-DD
  statementDate: string; // YYYY-MM-DD (interest only)
  /** An interest charge's optional note, or a fee's required description. */
  text: string;
};
export type LedgerEntryPayload = { amount: number; entryDate: string; statementDate: string | null; reason: string | null; note: string | null };
export type LedgerEntryError = "amount" | "amountPrecision" | "entryDate" | "entryDateFuture" | "statementDate" | "description" | "descriptionLength" | "note";
export const MAX_LEDGER_TEXT = 500;

function isRealDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d, 12, 0, 0);
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d;
}

/**
 * Strict validation for Record Interest / Record Fee (the same rules the database enforces, checked first so the user sees a clear message). The amount is a plain positive
 * number with at most two decimals, never rounded; dates are real calendar days that aren't in the future; interest needs a statement date; a fee needs a description.
 */
export function parseLedgerEntry(
  kind: LedgerEntryKind,
  v: LedgerEntryValues,
  todayISO: string
): { ok: true; payload: LedgerEntryPayload } | { ok: false; error: LedgerEntryError } {
  const raw = v.amount.trim();
  if (!/^\d+(\.\d*)?$/.test(raw)) return { ok: false, error: "amount" };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { ok: false, error: "amountPrecision" };
  const amount = Number(raw);
  if (!(amount > 0) || amount > MAX_PAYMENT_AMOUNT) return { ok: false, error: "amount" };

  const entryDate = v.entryDate.trim();
  if (!isRealDay(entryDate)) return { ok: false, error: "entryDate" };
  if (entryDate > todayISO) return { ok: false, error: "entryDateFuture" };

  const text = v.text.trim();
  if (kind === "interest") {
    const statementDate = v.statementDate.trim();
    if (!isRealDay(statementDate) || statementDate > todayISO) return { ok: false, error: "statementDate" };
    if (text.length > MAX_LEDGER_TEXT) return { ok: false, error: "note" };
    return { ok: true, payload: { amount, entryDate, statementDate, reason: null, note: text || null } };
  }
  if (text === "") return { ok: false, error: "description" };
  if (text.length > MAX_LEDGER_TEXT) return { ok: false, error: "descriptionLength" };
  return { ok: true, payload: { amount, entryDate, statementDate: null, reason: text, note: null } };
}

/** The balance (the amount OWED) after a charge is added: interest and fees raise it. Cents-exact. */
export function previewBalanceAfterCharge(balance: number, amount: number): number {
  return fromCents(toCents(balance) + toCents(amount));
}

export type FinancesOverview = {
  /** Sum of tracked account balances (credit-card style outstanding balances). */
  totalBalances: number;
  /**
   * Still to pay this month: account minimum payments PLUS this month's bills'
   * remaining amounts (actual where known, otherwise estimated -- see
   * monthlyDueIncludesEstimates). Bills are separate records from
   * accounts (nothing is linked), so nothing is counted twice, and balances
   * are never part of this figure.
   */
  monthlyDue: number;
  /** This month's bill cycles with no amount at all (no actual, no estimate) -- left out, never counted as $0. */
  monthlyDueUnknown: number;
  /** Monthly due contains at least one bill ESTIMATE (a variable bill with no actual amount yet). */
  monthlyDueIncludesEstimates: boolean;
  /** Nothing to show yet (no minimums, no bill with an actual or estimated amount) but bills have no amount: "Amount pending", not $0.00. */
  monthlyDuePending: boolean;
  /** Monthly-equivalent total of ACTIVE paying subscriptions in USD (trials, paused and canceled ones are excluded). */
  subscriptionsMonthly: number;
  /** Active subscriptions with no price yet (left out, never counted as $0). */
  subscriptionsAwaitingPrice: number;
  /** Active subscriptions in another currency (left out; they can't be added to USD). */
  subscriptionsOtherCurrency: number;
  /** Obligations due today or inside their own reminder window. */
  upcomingCount: number;
};

/**
 * The hub's four headline figures. They are deliberately separate concepts
 * and are never added together: balances are what is owed, monthly due is
 * what must be paid this cycle (a payment toward a balance, so the two
 * overlap by design), subscriptions are a recurring cost and upcoming is a
 * count.
 */
export function summarizeFinances(
  accounts: readonly PaymentAccount[],
  todayISO: string,
  bills?: Pick<BillsSummary, "remainingThisMonth" | "unknownThisMonth" | "knownThisMonth" | "includesEstimates" | "upcoming"> | null,
  subscriptions?: Pick<SubscriptionsSummary, "monthlyCost" | "upcomingUnlinked" | "awaitingPrice" | "otherCurrency"> | null
): FinancesOverview {
  const s = summarizePayments(accounts);
  const accountsUpcoming = accounts.filter((a) => getPaymentDueInfo(a, todayISO).tier !== "later").length;
  const minimumsCents = toCents(s.monthlyMinimums);
  const monthlyDueCents = minimumsCents + toCents(bills?.remainingThisMonth ?? 0);
  return {
    totalBalances: s.totalBalance,
    monthlyDue: fromCents(monthlyDueCents),
    monthlyDueUnknown: bills?.unknownThisMonth ?? 0,
    monthlyDueIncludesEstimates: bills?.includesEstimates ?? false,
    monthlyDuePending: (bills?.unknownThisMonth ?? 0) > 0 && (bills?.knownThisMonth ?? 0) === 0 && minimumsCents === 0,
    // Subscriptions are a recurring COST, a separate concept from this month's obligations above, so
    // their monthly total is shown on its own tile and never added into monthlyDue (no double counting).
    subscriptionsMonthly: subscriptions?.monthlyCost ?? 0,
    subscriptionsAwaitingPrice: subscriptions?.awaitingPrice ?? 0,
    subscriptionsOtherCurrency: subscriptions?.otherCurrency ?? 0,
    // Upcoming counts a subscription renewal / trial end only when it is NOT linked to a bill: a linked
    // subscription's charge is already counted through its bill.
    upcomingCount: accountsUpcoming + (bills?.upcoming ?? 0) + (subscriptions?.upcomingUnlinked ?? 0),
  };
}

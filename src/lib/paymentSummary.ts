import { computeNextDueDate, type PaymentAccount } from "@/lib/supabase/db";

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

export type FinancesOverview = {
  /** Sum of tracked account balances (credit-card style outstanding balances). */
  totalBalances: number;
  /** Known monthly obligations. Phase 1: account minimum payments only; bills join in a later phase. */
  monthlyDue: number;
  /** Monthly equivalent of active subscriptions (none tracked yet). */
  subscriptionsMonthly: number;
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
export function summarizeFinances(accounts: readonly PaymentAccount[], todayISO: string): FinancesOverview {
  const s = summarizePayments(accounts);
  const upcomingCount = accounts.filter((a) => getPaymentDueInfo(a, todayISO).tier !== "later").length;
  return { totalBalances: s.totalBalance, monthlyDue: s.monthlyMinimums, subscriptionsMonthly: 0, upcomingCount };
}

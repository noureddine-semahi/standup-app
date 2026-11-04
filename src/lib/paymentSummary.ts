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

export type PaymentFormValues = {
  name: string;
  balance: string;
  minimumPayment: string;
  dueDay: string;
  remindDaysBefore: string;
};

export type PaymentFormPayload = {
  name: string;
  balance: number;
  minimumPayment: number;
  dueDay: number;
  remindDaysBefore: number;
};

export const EMPTY_PAYMENT_FORM: PaymentFormValues = {
  name: "",
  balance: "",
  minimumPayment: "",
  dueDay: "",
  remindDaysBefore: "3",
};

export function paymentToFormValues(a: PaymentAccount): PaymentFormValues {
  return {
    name: a.name,
    balance: String(a.balance),
    minimumPayment: String(a.minimumPayment),
    dueDay: String(a.dueDay),
    remindDaysBefore: String(a.remindDaysBefore),
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
  return { name, balance, minimumPayment, dueDay, remindDaysBefore };
}

/** Only the fields that actually differ, so an untouched edit never writes. */
export function diffPaymentPayload(a: PaymentAccount, p: PaymentFormPayload): Partial<PaymentFormPayload> {
  const patch: Partial<PaymentFormPayload> = {};
  if (p.name !== a.name) patch.name = p.name;
  if (p.balance !== a.balance) patch.balance = p.balance;
  if (p.minimumPayment !== a.minimumPayment) patch.minimumPayment = p.minimumPayment;
  if (p.dueDay !== a.dueDay) patch.dueDay = p.dueDay;
  if (p.remindDaysBefore !== a.remindDaysBefore) patch.remindDaysBefore = p.remindDaysBefore;
  return patch;
}

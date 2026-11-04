import { supabase } from "@/lib/supabase/client";
import { formatDateDisplay, getCurrentUserId, getOrCreatePlan, type Goal } from "@/lib/supabase/db";
import {
  OVERDUE_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
  addDaysISO,
  billSuggestionKey,
  monthBounds,
  suggestBillGoals,
  type Bill,
  type BillFormPayload,
  type BillOccurrenceRecord,
  type BillPaymentRecord,
  type BillSuggestion,
  type OccurrenceMap,
} from "@/lib/bills";

// Data access for Finances > Bills. Reads use plain selects (RLS scopes them to
// the signed-in user); every write to occurrences/payments goes through a
// SECURITY DEFINER function (record_bill_payment, set_bill_occurrence_amount,
// reverse_bill_payment) so a payment and its occurrence commit atomically.
// Requires supabase/migrations/20261104000100_finance_bills.sql.

/** True when the error means the Bills tables/functions don't exist yet (migration not applied). */
export function isBillsUnavailableError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  const msg = String(err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" || // undefined_table
    err.code === "42883" || // undefined_function
    err.code === "PGRST205" || // table not in schema cache
    err.code === "PGRST202" || // function not in schema cache
    msg.includes("could not find the table") ||
    msg.includes("could not find the function") ||
    (msg.includes("relation") && msg.includes("does not exist"))
  );
}

type BillRow = {
  id: string;
  name: string;
  amount_type: string;
  expected_amount: string | number | null;
  recurrence: Bill["recurrence"];
  first_due_date: string;
  remind_days_before: number;
  category: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
};
type OccurrenceRow = { id: string; bill_id: string; due_date: string; amount_due: string | number | null };
type PaymentRow = { id: string; occurrence_id: string; amount: string | number; paid_at: string; note: string | null; reversed_at: string | null };
type RpcPaymentRow = { r_payment_id: string; r_occurrence_id: string; r_duplicate: boolean };

function rowToBill(r: BillRow): Bill {
  return {
    id: r.id,
    name: r.name,
    amountType: r.amount_type === "variable" ? "variable" : "fixed",
    expectedAmount: r.expected_amount === null || r.expected_amount === undefined ? null : Number(r.expected_amount),
    recurrence: r.recurrence,
    firstDueDate: r.first_due_date,
    remindDaysBefore: r.remind_days_before,
    category: r.category ?? null,
    notes: r.notes ?? null,
    archivedAt: r.archived_at ?? null,
    createdAt: r.created_at,
  };
}

function rowToPayment(r: PaymentRow): BillPaymentRecord {
  return { id: r.id, amount: Number(r.amount), paidAt: r.paid_at, note: r.note ?? null, reversedAt: r.reversed_at ?? null };
}

/** Active (not removed) bills, in creation order. */
export async function getBills(): Promise<Bill[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("bills")
    .select("*")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as BillRow[]).map(rowToBill);
}

export async function createBill(p: BillFormPayload): Promise<Bill> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("bills")
    .insert({
      user_id: userId,
      name: p.name,
      amount_type: p.amountType,
      expected_amount: p.expectedAmount,
      recurrence: p.recurrence,
      first_due_date: p.firstDueDate,
      remind_days_before: p.remindDaysBefore,
      category: p.category,
      notes: p.notes,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToBill(data as BillRow);
}

export async function updateBill(id: string, p: Partial<BillFormPayload>): Promise<Bill> {
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) patch.name = p.name;
  if (p.amountType !== undefined) patch.amount_type = p.amountType;
  if (p.expectedAmount !== undefined) patch.expected_amount = p.expectedAmount;
  if (p.recurrence !== undefined) patch.recurrence = p.recurrence;
  if (p.firstDueDate !== undefined) patch.first_due_date = p.firstDueDate;
  if (p.remindDaysBefore !== undefined) patch.remind_days_before = p.remindDaysBefore;
  if (p.category !== undefined) patch.category = p.category;
  if (p.notes !== undefined) patch.notes = p.notes;
  const { data, error } = await supabase.from("bills").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return rowToBill(data as BillRow);
}

/** "Remove" archives the bill; its occurrences and payments are kept. */
export async function archiveBill(id: string): Promise<void> {
  const { error } = await supabase.from("bills").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

async function fetchOccurrences(billIds: string[], fromISO: string | null, toISO: string | null): Promise<BillOccurrenceRecord[]> {
  if (billIds.length === 0) return [];
  let q = supabase.from("bill_occurrences").select("*").in("bill_id", billIds);
  if (fromISO) q = q.gte("due_date", fromISO);
  if (toISO) q = q.lte("due_date", toISO);
  const { data: occRows, error } = await q.order("due_date", { ascending: true });
  if (error) throw error;
  const occs = (occRows ?? []) as OccurrenceRow[];
  if (occs.length === 0) return [];
  const { data: payRows, error: payErr } = await supabase
    .from("bill_payments")
    .select("*")
    .in("occurrence_id", occs.map((o) => o.id))
    .order("paid_at", { ascending: false });
  if (payErr) throw payErr;
  const byOcc = new Map<string, BillPaymentRecord[]>();
  for (const p of (payRows ?? []) as PaymentRow[]) {
    const list = byOcc.get(p.occurrence_id) ?? [];
    list.push(rowToPayment(p));
    byOcc.set(p.occurrence_id, list);
  }
  return occs.map((o) => ({
    id: o.id,
    billId: o.bill_id,
    dueDate: o.due_date,
    amountDue: o.amount_due === null ? null : Number(o.amount_due),
    payments: byOcc.get(o.id) ?? [],
  }));
}

export function toOccurrenceMap(records: readonly BillOccurrenceRecord[]): OccurrenceMap {
  const map: OccurrenceMap = {};
  for (const r of records) (map[r.billId] ??= {})[r.dueDate] = r;
  return map;
}

/** Stored cycles for the bounded window the tracker works in (covers this month, the overdue lookback and the upcoming horizon). */
export async function getBillOccurrenceWindow(bills: readonly Bill[], todayISO: string): Promise<OccurrenceMap> {
  const { start, end } = monthBounds(todayISO);
  const from = [start, addDaysISO(todayISO, -OVERDUE_LOOKBACK_DAYS)].sort()[0];
  const to = [end, addDaysISO(todayISO, UPCOMING_HORIZON_DAYS)].sort().reverse()[0];
  const records = await fetchOccurrences(bills.map((b) => b.id), from, to);
  // One-time bills sit outside the window by design; load theirs explicitly.
  const onceIds = bills.filter((b) => b.recurrence === "once").map((b) => b.id);
  const onceRecords = await fetchOccurrences(onceIds, null, null);
  return toOccurrenceMap([...records, ...onceRecords.filter((o) => !records.some((r) => r.id === o.id))]);
}

/** Every stored cycle of one bill, newest first (the History view). */
export async function getBillHistory(billId: string): Promise<BillOccurrenceRecord[]> {
  const records = await fetchOccurrences([billId], null, null);
  return records.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
}

export type RecordBillPaymentParams = {
  billId: string;
  dueDate: string;
  amount: number;
  paidAt: string;
  note: string | null;
  /** Actual amount due for this cycle (variable bills); null leaves it as is. */
  amountDue: number | null;
  clientKey: string;
};

/** Atomically records one payment (idempotent per clientKey). Never touches any account balance. */
export async function recordBillPayment(p: RecordBillPaymentParams): Promise<{ paymentId: string; occurrenceId: string; wasDuplicate: boolean }> {
  const { data, error } = await supabase.rpc("record_bill_payment", {
    p_bill_id: p.billId,
    p_due_date: p.dueDate,
    p_amount: p.amount,
    p_paid_at: p.paidAt,
    p_note: p.note,
    p_amount_due: p.amountDue,
    p_client_key: p.clientKey,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as RpcPaymentRow;
  return { paymentId: row.r_payment_id, occurrenceId: row.r_occurrence_id, wasDuplicate: !!row.r_duplicate };
}

export async function setBillOccurrenceAmount(billId: string, dueDate: string, amount: number): Promise<string> {
  const { data, error } = await supabase.rpc("set_bill_occurrence_amount", { p_bill_id: billId, p_due_date: dueDate, p_amount: amount });
  if (error) throw error;
  return data as string;
}

/** Reverses a bill payment (row kept; outstanding/status are derived, so they recalculate). */
export async function reverseBillPayment(paymentId: string): Promise<void> {
  const { error } = await supabase.rpc("reverse_bill_payment", { p_payment_id: paymentId });
  if (error) throw error;
}

// ── Plan Tomorrow: tap-to-add suggestions ────────────────────────────────

/**
 * Bill occurrences whose reminder window covers planDateISO and that are still
 * unpaid and not already linked to a goal. Suggestions only -- nothing is
 * created until the user taps one (addGoalFromBill).
 */
export async function getSuggestedBillReminders(planDateISO: string): Promise<BillSuggestion[]> {
  const bills = await getBills();
  if (bills.length === 0) return [];
  const map = await getBillOccurrenceWindow(bills, planDateISO);

  const { data: linkedRows, error } = await supabase
    .from("goals")
    .select("source_bill_id, source_bill_due_date")
    .in("source_bill_id", bills.map((b) => b.id));
  if (error) throw error;
  const linked = new Set<string>(
    ((linkedRows ?? []) as { source_bill_id: string; source_bill_due_date: string | null }[])
      .filter((g) => g.source_bill_due_date)
      .map((g) => billSuggestionKey(g.source_bill_id, g.source_bill_due_date as string))
  );
  return suggestBillGoals(bills, map, planDateISO, linked);
}

/** The goal title a bill suggestion becomes (also used as the suggestion chip's label). */
export function billGoalTitle(s: BillSuggestion): string {
  const amount = s.amountDue === null ? "" : ` — $${s.amountDue.toFixed(2)}`;
  return `Pay ${s.bill.name}${amount} — due ${formatDateDisplay(s.dueDate)}`;
}

/**
 * Tap-to-add: creates an ordinary, not-yet-saved goal for one bill cycle
 * (same shape as addGoalFromTemplate). It is linked to its bill + due date only
 * so the cycle isn't suggested twice. Completing the goal does NOT mark the
 * bill paid -- the user records the payment explicitly in Finances > Bills.
 */
export async function addGoalFromBill(s: BillSuggestion, planDateISO: string): Promise<Goal> {
  const plan = await getOrCreatePlan(planDateISO);
  const { data: existing, error: existingErr } = await supabase
    .from("goals")
    .select("sort_order")
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (existingErr) throw existingErr;
  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const userId = await getCurrentUserId();
  const { data: created, error } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      title: billGoalTitle(s),
      status: "not_started",
      sort_order: nextSortOrder,
      priority: 2,
      source_bill_id: s.bill.id,
      source_bill_due_date: s.dueDate,
    })
    .select()
    .single();
  if (error) throw error;
  return created as Goal;
}


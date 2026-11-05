import { EXPENSE_CATEGORIES, type Basis, type ExpenseCategory } from "@/lib/financialPlanner";
import {
  COMPOSITION_LIMITS,
  compositionErrors,
  contributionError,
  emptyComposition,
  emptyShared,
  type Composition,
  type Contributions,
  type PersonalDebtLink,
  type PersonalExpenseLink,
  type RecordLink,
  type SharedDebt,
  type SharedExpense,
  type SharedGoal,
  type SharedHousehold,
} from "@/lib/householdPlan";

// Pure pieces of the household's shared data (Phase 2, Step 2): limits, validation, and the translation between the
// app's types and the database columns. No I/O. Unknown is null and an explicit zero stays 0, in both directions.
// Amounts are USD.

export const SHARED_LIMITS = {
  expenses: 30,
  debts: 10,
  goals: 10,
  linksPerItem: 6,
  label: 60,
  idLength: 64,
  maxAmount: 9_999_999.99,
} as const;

export type SharedColumns = {
  shared_expenses: unknown[];
  no_shared_expenses: boolean;
  shared_debts: unknown[];
  no_shared_debts: boolean;
  shared_goals: unknown[];
  adults: number | null;
  children: number | null;
  other_members: number | null;
};

/** What a household row holds for shared data. `revision` is database-managed (see the migration). */
export type SharedRow = Partial<SharedColumns> & { revision?: number | null };

export type SharedValidationCode =
  | "duplicateId"
  | "badId"
  | "tooMany"
  | "labelRequired"
  | "labelTooLong"
  | "badAmount"
  | "badCategory"
  | "badBasis"
  | "invalidContribution"
  | "overAssigned"
  | "badLink"
  | "duplicateLink"
  | "tooManyLinks"
  | "badDate"
  | "compositionInteger"
  | "compositionRange";

export type SharedValidationError = { code: SharedValidationCode; list: "expenses" | "debts" | "goals" | "composition"; ref?: string; field?: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const money = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= SHARED_LIMITS.maxAmount;
const wholeCents = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const goodId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= SHARED_LIMITS.idLength;
const isBasis = (v: unknown): v is Basis => v === "actual" || v === "estimate";
const isCategory = (v: unknown): v is ExpenseCategory => (EXPENSE_CATEGORIES as readonly string[]).includes(v as string);
const isISODate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));

/** A new stable id for a shared item. */
export function newSharedId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : "x" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── validation (used before saving) ──────────────────────────────────────

function linkError(l: unknown, kinds: readonly string[]): boolean {
  if (!isObj(l) || typeof l.kind !== "string" || !kinds.includes(l.kind)) return true;
  if (l.kind === "bill" || l.kind === "subscription" || l.kind === "account") return !goodId(l.id);
  if (l.kind === "personalExpense") return !(l.person === "me" || l.person === "partner") || !isCategory(l.category);
  if (l.kind === "personalDebt") return !(l.person === "me" || l.person === "partner") || !goodId(l.debtId);
  return true;
}
const linkKey = (l: { kind: string } & Record<string, unknown>) => [l.kind, l.id ?? "", l.person ?? "", l.category ?? "", l.debtId ?? ""].join("|");

function contributionProblems(list: "expenses" | "debts" | "goals", ref: string, total: number | null, c: Contributions, out: SharedValidationError[], allowOver = false): void {
  for (const k of ["me", "partner"] as const) {
    const v = c[k];
    if (v !== null && (typeof v !== "number" || !money(v) || !wholeCents(v))) out.push({ code: "invalidContribution", list, ref, field: k });
  }
  if (out.some((e) => e.ref === ref && e.code === "invalidContribution")) return;
  if (!allowOver && total !== null && contributionError(total, c) === "overAssigned") out.push({ code: "overAssigned", list, ref });
}

/**
 * Everything that must hold before shared data is written. An empty result means it is safe to save. Over-assigned
 * contributions are rejected here (the calculation module also flags them) so they never reach the database.
 */
export function validateShared(s: SharedHousehold, composition: Composition = emptyComposition()): SharedValidationError[] {
  const out: SharedValidationError[] = [];
  const lists = [
    ["expenses", s.expenses, SHARED_LIMITS.expenses],
    ["debts", s.debts, SHARED_LIMITS.debts],
    ["goals", s.goals, SHARED_LIMITS.goals],
  ] as const;
  const seen = new Set<string>();
  for (const [list, items, max] of lists) {
    if (items.length > max) out.push({ code: "tooMany", list });
    // Ids are unique across the whole household so any reference to an item is unambiguous.
    for (const it of items) {
      if (!goodId(it.id)) out.push({ code: "badId", list, ref: String(it.id) });
      else if (seen.has(it.id)) out.push({ code: "duplicateId", list, ref: it.id });
      else seen.add(it.id);
    }
  }
  const label = (list: "expenses" | "debts" | "goals", ref: string, text: unknown) => {
    if (typeof text !== "string" || text.trim().length === 0) out.push({ code: "labelRequired", list, ref });
    else if (text.trim().length > SHARED_LIMITS.label) out.push({ code: "labelTooLong", list, ref });
  };
  const links = (list: "expenses" | "debts", ref: string, ls: readonly unknown[], kinds: readonly string[]) => {
    if (ls.length > SHARED_LIMITS.linksPerItem) out.push({ code: "tooManyLinks", list, ref });
    const keys = new Set<string>();
    for (const l of ls) {
      if (linkError(l, kinds)) out.push({ code: "badLink", list, ref });
      else {
        const k = linkKey(l as { kind: string } & Record<string, unknown>);
        if (keys.has(k)) out.push({ code: "duplicateLink", list, ref });
        keys.add(k);
      }
    }
  };

  for (const e of s.expenses) {
    label("expenses", e.id, e.label);
    if (!isCategory(e.category)) out.push({ code: "badCategory", list: "expenses", ref: e.id });
    if (!isBasis(e.basis)) out.push({ code: "badBasis", list: "expenses", ref: e.id });
    if (!money(e.amount) || !wholeCents(e.amount)) out.push({ code: "badAmount", list: "expenses", ref: e.id, field: "amount" });
    contributionProblems("expenses", e.id, money(e.amount) ? e.amount : null, e.contributions, out);
    links("expenses", e.id, e.links, ["bill", "subscription", "account", "personalExpense"]);
  }
  for (const d of s.debts) {
    label("debts", d.id, d.name);
    if (!isBasis(d.basis)) out.push({ code: "badBasis", list: "debts", ref: d.id });
    for (const f of ["balance", "monthlyPayment"] as const) {
      const v = d[f];
      if (v !== null && (!money(v) || !wholeCents(v))) out.push({ code: "badAmount", list: "debts", ref: d.id, field: f });
    }
    contributionProblems("debts", d.id, d.monthlyPayment !== null && money(d.monthlyPayment) ? d.monthlyPayment : null, d.contributions, out);
    links("debts", d.id, d.links, ["account", "personalDebt"]);
  }
  for (const g of s.goals) {
    label("goals", g.id, g.name);
    for (const f of ["targetAmount", "savedAmount"] as const) {
      const v = g[f];
      if (v !== null && (!money(v) || !wholeCents(v))) out.push({ code: "badAmount", list: "goals", ref: g.id, field: f });
    }
    if (g.targetDate !== null && !isISODate(g.targetDate)) out.push({ code: "badDate", list: "goals", ref: g.id });
    // A goal's contribution is a monthly plan, not a share of a fixed total, so it has no over-assigned check.
    contributionProblems("goals", g.id, null, g.contributions, out, true);
    if (!isObj(g.countedInSavings) || typeof g.countedInSavings.me !== "boolean" || typeof g.countedInSavings.partner !== "boolean") out.push({ code: "badLink", list: "goals", ref: g.id, field: "countedInSavings" });
  }
  for (const [k, e] of Object.entries(compositionErrors(composition))) out.push({ code: e === "integer" ? "compositionInteger" : "compositionRange", list: "composition", field: k });
  return out;
}

// ── to database columns ──────────────────────────────────────────────────

const c2 = (c: Contributions) => ({ me: c.me, partner: c.partner });

/** The columns to write. Null stays null and 0 stays 0; nothing is defaulted or rounded here. */
export function sharedToColumns(s: SharedHousehold, composition: Composition): SharedColumns {
  return {
    shared_expenses: s.expenses.map((e) => ({ id: e.id, category: e.category, label: e.label.trim(), amount: e.amount, basis: e.basis, contributions: c2(e.contributions), links: e.links.map((l) => ({ ...l })) })),
    no_shared_expenses: !!s.noSharedExpenses,
    shared_debts: s.debts.map((d) => ({ id: d.id, name: d.name.trim(), balance: d.balance, monthlyPayment: d.monthlyPayment, basis: d.basis, contributions: c2(d.contributions), links: d.links.map((l) => ({ ...l })) })),
    no_shared_debts: !!s.noSharedDebts,
    shared_goals: s.goals.map((g) => ({ id: g.id, name: g.name.trim(), targetAmount: g.targetAmount, targetDate: g.targetDate, savedAmount: g.savedAmount, contributions: c2(g.contributions), countedInSavings: { me: g.countedInSavings.me, partner: g.countedInSavings.partner } })),
    adults: composition.adults,
    children: composition.children,
    other_members: composition.otherMembers,
  };
}

// ── from database columns (tolerant: a malformed row never crashes the planner) ──

/** A number that is present and valid, else null. A genuine 0 is kept; a missing value is never turned into 0. */
const optMoney = (v: unknown): number | null => (money(v) ? v : null);
const optCount = (v: unknown, key: keyof Composition): number | null => {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  const [lo, hi] = COMPOSITION_LIMITS[key];
  return v >= lo && v <= hi ? v : null;
};
const readContrib = (v: unknown): Contributions => (isObj(v) ? { me: optMoney(v.me), partner: optMoney(v.partner) } : { me: null, partner: null });

function readLinks(raw: unknown, kinds: readonly string[]): unknown[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set<string>();
  const out: unknown[] = [];
  for (const l of raw.slice(0, SHARED_LIMITS.linksPerItem)) {
    if (linkError(l, kinds)) continue;
    const o = l as { kind: string } & Record<string, unknown>;
    const k = linkKey(o);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(o.kind === "personalExpense" ? { kind: o.kind, person: o.person, category: o.category } : o.kind === "personalDebt" ? { kind: o.kind, person: o.person, debtId: o.debtId } : { kind: o.kind, id: o.id });
  }
  return out;
}

/**
 * Something about the STORED data that tolerant reading had to work around. Reading still returns a usable household
 * for display, but saving that sanitized copy would permanently change or delete what is stored, so saving is blocked
 * until the user acknowledges it (see saveHouseholdShared).
 */
export type IntegrityIssueCode =
  | "malformedItem" // not an object, or missing a valid id / label / amount: left out of the display copy
  | "duplicateId" // a repeated id (within a list or across lists): the later one is left out of the display copy
  | "overLimit" // more items than the list allows: the extra ones are left out of the display copy
  | "fieldRepaired" // the item is shown, but a stored field was invalid (or not canonical) and read as unknown/default
  | "listNotArray" // a list column holds something other than an array
  | "flagRepaired" // a yes/no answer holds something other than a boolean
  | "compositionRepaired"; // a household-size value was out of range or not a whole number
export type IntegrityIssue = { code: IntegrityIssueCode; list: "expenses" | "debts" | "goals" | "composition"; ref?: string; index?: number; field?: string };
export type SharedIntegrity = {
  /** True when the display copy equals what is stored (nothing was dropped, repaired or defaulted). */
  ok: boolean;
  issues: IntegrityIssue[];
  /** Identifies exactly this stored content. Acknowledging a problem is tied to it, so a later change needs a new look. */
  fingerprint: string;
};

export type SharedReadResult = {
  shared: SharedHousehold;
  composition: Composition;
  /** Stored items that could not be shown (malformed, repeated id, over the limit). Never silently invented. */
  droppedItems: number;
  integrity: SharedIntegrity;
};

const RAW_KEYS = ["shared_expenses", "no_shared_expenses", "shared_debts", "no_shared_debts", "shared_goals", "adults", "children", "other_members"] as const;

function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (isObj(v)) {
    return (
      "{" +
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(v[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v === undefined ? null : v);
}
/** Deep equality that ignores key order, and treats an absent key like an undefined one. */
const canonEqual = (a: unknown, b: unknown) => stable(a) === stable(b);

/** A short, stable identifier of the stored shared columns (FNV-1a over their canonical JSON). */
export function fingerprintOf(r: SharedRow | null | undefined): string {
  const row = (r ?? {}) as Record<string, unknown>;
  const text = stable(Object.fromEntries(RAW_KEYS.map((k) => [k, row[k] ?? null])));
  let h = 0x811c9dc5;
  for (let n = 0; n < text.length; n++) {
    h ^= text.charCodeAt(n);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + ":" + text.length;
}

type ListName = "expenses" | "debts" | "goals";

export function rowToShared(r: SharedRow | null | undefined): SharedReadResult {
  const row = r ?? {};
  const issues: IntegrityIssue[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  const kept: Record<ListName, number[]> = { expenses: [], debts: [], goals: [] }; // raw index of each kept item
  const take = <T>(list: ListName, raw: unknown, max: number, build: (o: Record<string, unknown>) => T | null, idOf: (t: T) => string): T[] => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      issues.push({ code: "listNotArray", list });
      return [];
    }
    const out: T[] = [];
    raw.forEach((o, index) => {
      const ref = isObj(o) && typeof o.id === "string" ? o.id : undefined;
      if (out.length >= max) {
        dropped++;
        issues.push({ code: "overLimit", list, index, ref });
        return;
      }
      const item = isObj(o) ? build(o) : null;
      if (!item) {
        dropped++;
        issues.push({ code: "malformedItem", list, index, ref });
        return;
      }
      if (seen.has(idOf(item))) {
        dropped++;
        issues.push({ code: "duplicateId", list, index, ref: idOf(item) });
        return;
      }
      seen.add(idOf(item));
      kept[list].push(index);
      out.push(item);
    });
    return out;
  };
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const expenses = take<SharedExpense>(
    "expenses",
    row.shared_expenses,
    SHARED_LIMITS.expenses,
    (o) => {
      // An expense without a valid amount has no meaning (blank is not $0), so it is reported, never zeroed.
      if (!goodId(o.id) || !isCategory(o.category) || !money(o.amount) || text(o.label) === "") return null;
      return { id: o.id, category: o.category, label: text(o.label).slice(0, SHARED_LIMITS.label), amount: o.amount, basis: isBasis(o.basis) ? o.basis : "estimate", contributions: readContrib(o.contributions), links: readLinks(o.links, ["bill", "subscription", "account", "personalExpense"]) as (RecordLink | PersonalExpenseLink)[] };
    },
    (t) => t.id
  );
  const debts = take<SharedDebt>(
    "debts",
    row.shared_debts,
    SHARED_LIMITS.debts,
    (o) => {
      if (!goodId(o.id) || text(o.name) === "") return null;
      return { id: o.id, name: text(o.name).slice(0, SHARED_LIMITS.label), balance: optMoney(o.balance), monthlyPayment: optMoney(o.monthlyPayment), basis: isBasis(o.basis) ? o.basis : "estimate", contributions: readContrib(o.contributions), links: readLinks(o.links, ["account", "personalDebt"]) as (Extract<RecordLink, { kind: "account" }> | PersonalDebtLink)[] };
    },
    (t) => t.id
  );
  const goals = take<SharedGoal>(
    "goals",
    row.shared_goals,
    SHARED_LIMITS.goals,
    (o) => {
      if (!goodId(o.id) || text(o.name) === "") return null;
      const cs = isObj(o.countedInSavings) ? o.countedInSavings : {};
      return { id: o.id, name: text(o.name).slice(0, SHARED_LIMITS.label), targetAmount: optMoney(o.targetAmount), targetDate: isISODate(o.targetDate) ? o.targetDate : null, savedAmount: optMoney(o.savedAmount), contributions: readContrib(o.contributions), countedInSavings: { me: cs.me === true, partner: cs.partner === true } };
    },
    (t) => t.id
  );
  const composition: Composition = { adults: optCount(row.adults, "adults"), children: optCount(row.children, "children"), otherMembers: optCount(row.other_members, "otherMembers") };
  const shared: SharedHousehold = { ...emptyShared(), expenses, noSharedExpenses: row.no_shared_expenses === true, debts, noSharedDebts: row.no_shared_debts === true, goals };

  // Anything that would change if the display copy were saved back is reported, so it can never be lost unnoticed.
  const cols = sharedToColumns(shared, composition);
  const rawLists = { expenses: row.shared_expenses, debts: row.shared_debts, goals: row.shared_goals } as Record<ListName, unknown>;
  const outLists = { expenses: cols.shared_expenses, debts: cols.shared_debts, goals: cols.shared_goals } as Record<ListName, unknown[]>;
  for (const list of ["expenses", "debts", "goals"] as const) {
    const rawList = rawLists[list];
    if (!Array.isArray(rawList)) continue;
    kept[list].forEach((rawIndex, k) => {
      if (!canonEqual(rawList[rawIndex], outLists[list][k])) issues.push({ code: "fieldRepaired", list, index: rawIndex, ref: (outLists[list][k] as { id: string }).id });
    });
  }
  for (const [key, list] of [["no_shared_expenses", "expenses"], ["no_shared_debts", "debts"]] as const) {
    const v = row[key];
    if (v !== undefined && v !== null && typeof v !== "boolean") issues.push({ code: "flagRepaired", list, field: key });
  }
  for (const [key, field] of [["adults", "adults"], ["children", "children"], ["other_members", "otherMembers"]] as const) {
    const v = row[key];
    if (v !== undefined && v !== null && v !== composition[field]) issues.push({ code: "compositionRepaired", list: "composition", field });
  }
  return { shared, composition, droppedItems: dropped, integrity: { ok: issues.length === 0, issues, fingerprint: fingerprintOf(row) } };
}

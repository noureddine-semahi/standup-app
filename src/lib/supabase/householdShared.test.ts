import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory stand-in for the two household tables that behaves like the real database for what matters here:
// owner-only visibility (RLS), the unique owner, the migration's revision trigger, and "column does not exist" when
// the migration has not been applied. It records every call so tests can prove what was (not) touched.
type Row = Record<string, unknown>;
type Call = { table: string; op: string; args: unknown[] };
const db = vi.hoisted(() => ({
  user: "u1",
  tables: { households: [] as Row[], household_members: [] as Row[], financial_profiles: [] as Row[], bills: [] as Row[] },
  calls: [] as { table: string; op: string; args: unknown[] }[],
  migrated: true,
  nextId: 1,
  affected: -1,
  writes: 0,
}));

const NEW_COLS = ["shared_expenses", "no_shared_expenses", "shared_debts", "no_shared_debts", "shared_goals", "adults", "children", "other_members", "revision"];
const TRIGGER_COLS = NEW_COLS.filter((c) => c !== "revision");
const missingColumn = () => ({ code: "42703", message: 'column households.shared_expenses does not exist' });

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: keyof typeof db.tables) => {
      const filters: [string, unknown][] = [];
      let op = "select";
      let payload: Row = {};
      let opts: Record<string, unknown> = {};
      let cols = "*";
      const rec = (o: string, ...a: unknown[]) => db.calls.push({ table, op: o, args: a });
      const visible = () => db.tables[table].filter((r) => r.owner_id === db.user && filters.every(([k, v]) => r[k] === v)); // RLS
      const touchesNew = () => table === "households" && (NEW_COLS.some((c) => cols.includes(c)) || NEW_COLS.some((c) => c in payload));
      const pick = (r: Row) => (cols === "*" ? { ...r } : Object.fromEntries(cols.split(",").map((c) => [c.trim(), r[c.trim()]])));
      const exec = (): { data: Row[] | null; error: unknown } => {
        if (touchesNew() && !db.migrated) return { data: null, error: missingColumn() };
        if (op === "select") return { data: visible().map(pick), error: null };
        if (op === "upsert") {
          const dup = db.tables[table].find((r) => r.owner_id === payload.owner_id);
          if (payload.owner_id !== db.user) return { data: null, error: { code: "42501", message: "row-level security" } };
          if (dup) return { data: opts.ignoreDuplicates ? [] : [pick(dup)], error: null };
          const row: Row = { id: "h" + db.nextId++, revision: 0, shared_expenses: [], no_shared_expenses: false, shared_debts: [], no_shared_debts: false, shared_goals: [], adults: null, children: null, other_members: null, ...payload };
          db.tables[table].push(row);
          return { data: [pick(row)], error: null };
        }
        if (op === "update") {
          const rows = visible();
          db.affected = rows.length;
          db.writes++;
          for (const r of rows) {
            const before = { ...r };
            const patch = { ...payload };
            delete patch.revision; // a client cannot set it
            Object.assign(r, patch);
            if (table === "households") {
              const changed = TRIGGER_COLS.some((c) => JSON.stringify(r[c]) !== JSON.stringify(before[c]));
              r.revision = (before.revision as number) + (changed ? 1 : 0);
            }
          }
          return { data: rows.map(pick), error: null };
        }
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: (c?: string) => (rec("select", c), (cols = c ?? "*"), chain),
        eq: (k: string, v: unknown) => (rec("eq", k, v), filters.push([k, v]), chain),
        upsert: (p: Row, o?: Record<string, unknown>) => (rec("upsert", p, o), (op = "upsert"), (payload = p), (opts = o ?? {}), chain),
        update: (p: Row) => (rec("update", p), (op = "update"), (payload = p), chain),
        maybeSingle: async () => {
          const r = exec();
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        then: (resolve: (v: unknown) => void) => resolve(exec()),
      };
      return chain;
    },
  },
}));

vi.mock("@/lib/supabase/db", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/db")>()), getCurrentUserId: async () => db.user }));

import { emptyComposition, emptyShared, type SharedExpense } from "@/lib/householdPlan";
import { HouseholdConflictError, HouseholdIntegrityError, HouseholdValidationError, getHouseholdShared, getPartnerIncluded, isHouseholdSharedUnavailableError, saveHouseholdShared, setPartnerIncluded, type ReadyState } from "./householdShared";

const NONE = { me: null, partner: null };
const expense = (over: Partial<SharedExpense> = {}): SharedExpense => ({ id: "e1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const tables = () => [...new Set(db.calls.map((c: Call) => c.table))].sort();
const ready = (s: Awaited<ReturnType<typeof getHouseholdShared>>): ReadyState => {
  if (s.status !== "ready") throw new Error("expected ready");
  return s;
};

beforeEach(() => {
  db.user = "u1";
  db.tables = { households: [], household_members: [], financial_profiles: [{ owner_id: "u1", take_home: 5000 }], bills: [{ owner_id: "u1", name: "Rent" }] };
  db.calls = [];
  db.migrated = true;
  db.nextId = 1;
  db.affected = -1;
  db.writes = 0;
});

describe("persistence", () => {
  it("no household yet: loads as an empty, ready state at revision 0 (nothing invented, nothing written)", async () => {
    const s = ready(await getHouseholdShared());
    expect(s).toMatchObject({ householdId: null, revision: 0, shared: emptyShared(), composition: emptyComposition(), droppedItems: 0 });
    expect(db.calls.some((c) => ["upsert", "update", "insert", "delete"].includes(c.op))).toBe(false);
  });

  it("saves, then loads exactly what was saved, and the revision moves", async () => {
    const shared = { ...emptyShared(), expenses: [expense({ contributions: { me: 0, partner: 900 } })], noSharedDebts: true };
    const saved = await saveHouseholdShared({ expectedRevision: 0, shared, composition: { adults: 2, children: null, otherMembers: 0 } });
    expect(saved.revision).toBe(1);
    const loaded = ready(await getHouseholdShared());
    expect(loaded.shared).toEqual(shared);
    expect(loaded.composition).toEqual({ adults: 2, children: null, otherMembers: 0 });
    expect(loaded.revision).toBe(1);
  });

  it("creating the household uses an upsert that ignores an existing one, so it never bumps the revision", async () => {
    await saveHouseholdShared({ expectedRevision: 0, shared: emptyShared(), composition: emptyComposition() });
    const up = db.calls.find((c) => c.op === "upsert")!;
    expect(up.args).toEqual([{ owner_id: "u1" }, { onConflict: "owner_id", ignoreDuplicates: true }]);
    const again = await saveHouseholdShared({ expectedRevision: 0, shared: emptyShared(), composition: emptyComposition() });
    expect(again.revision).toBe(0); // nothing changed, nothing bumped
  });

  it("the update is scoped to the household, the owner and the expected revision", async () => {
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), noSharedExpenses: true }, composition: emptyComposition() });
    const eqs = db.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toEqual(expect.arrayContaining([["owner_id", "u1"], ["revision", 0]]));
    const upd = db.calls.find((c) => c.op === "update")!.args[0] as Row;
    expect(upd).not.toHaveProperty("revision"); // only the database moves it
    expect(upd).not.toHaveProperty("owner_id");
  });

  it("an explicit zero and an unknown are stored differently and come back differently", async () => {
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), expenses: [expense({ contributions: { me: 0, partner: null } })] }, composition: { adults: null, children: 0, otherMembers: null } });
    const stored = db.tables.households[0];
    expect((stored.shared_expenses as Row[])[0].contributions).toEqual({ me: 0, partner: null });
    expect([stored.adults, stored.children]).toEqual([null, 0]);
  });
});

describe("validation happens before anything is sent", () => {
  it("invalid contributions, duplicate ids and bad composition are refused with no database call", async () => {
    const bad = [
      { ...emptyShared(), expenses: [expense({ contributions: { me: 1500, partner: 1500 } })] },
      { ...emptyShared(), expenses: [expense(), expense()] },
    ];
    for (const shared of bad) await expect(saveHouseholdShared({ expectedRevision: 0, shared, composition: emptyComposition() })).rejects.toBeInstanceOf(HouseholdValidationError);
    await expect(saveHouseholdShared({ expectedRevision: 0, shared: emptyShared(), composition: { adults: 50, children: null, otherMembers: null } })).rejects.toBeInstanceOf(HouseholdValidationError);
    expect(db.calls).toEqual([]);
  });
  it("the error lists what is wrong", async () => {
    const err = await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), expenses: [expense({ contributions: { me: -1, partner: null } })] }, composition: emptyComposition() }).catch((e) => e);
    expect((err as HouseholdValidationError).errors.map((e) => e.code)).toContain("invalidContribution");
  });
  it("reading a malformed stored row repairs it for display instead of throwing", async () => {
    db.tables.households.push({ id: "h9", owner_id: "u1", revision: 4, shared_expenses: [{ id: "a", category: "housing", label: "Rent", amount: 10 }, { id: "a", category: "other", label: "Dup", amount: 5 }, "junk"], shared_debts: "not-an-array", shared_goals: [], no_shared_expenses: false, no_shared_debts: false, adults: 99, children: null, other_members: null });
    const s = ready(await getHouseholdShared());
    expect(s.shared.expenses.map((e) => e.id)).toEqual(["a"]);
    expect(s.droppedItems).toBe(2);
    expect(s.shared.debts).toEqual([]);
    expect(s.composition.adults).toBeNull();
    expect(s.revision).toBe(4);
  });
});

describe("concurrent updates", () => {
  it("a stale save is refused with the latest data instead of overwriting it", async () => {
    const tabA = ready(await getHouseholdShared());
    const tabB = ready(await getHouseholdShared());
    await saveHouseholdShared({ expectedRevision: tabA.revision, shared: { ...emptyShared(), expenses: [expense({ label: "From A" })] }, composition: emptyComposition() });
    const err = await saveHouseholdShared({ expectedRevision: tabB.revision, shared: { ...emptyShared(), expenses: [expense({ label: "From B" })] }, composition: emptyComposition() }).catch((e) => e);
    expect(err).toBeInstanceOf(HouseholdConflictError);
    const latest = (err as HouseholdConflictError).latest as ReadyState;
    expect(latest.shared.expenses[0].label).toBe("From A");
    expect(latest.revision).toBe(1);
    expect(ready(await getHouseholdShared()).shared.expenses[0].label).toBe("From A"); // A's data is intact
  });

  it("after a conflict, saving again with the latest revision succeeds", async () => {
    const stale = ready(await getHouseholdShared());
    await saveHouseholdShared({ expectedRevision: stale.revision, shared: { ...emptyShared(), noSharedDebts: true }, composition: emptyComposition() });
    const err = (await saveHouseholdShared({ expectedRevision: stale.revision, shared: { ...emptyShared(), noSharedExpenses: true }, composition: emptyComposition() }).catch((e) => e)) as HouseholdConflictError;
    const retry = await saveHouseholdShared({ expectedRevision: (err.latest as ReadyState).revision, shared: { ...emptyShared(), noSharedExpenses: true }, composition: emptyComposition() });
    expect(retry.revision).toBe(2);
    expect(retry.shared.noSharedExpenses).toBe(true);
  });

  it("a client cannot forge the revision", async () => {
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), noSharedDebts: true }, composition: emptyComposition() });
    expect(db.tables.households[0].revision).toBe(1);
  });

  it("two first-time saves: the second is a conflict, not a duplicate household", async () => {
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), noSharedDebts: true }, composition: emptyComposition() });
    await expect(saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), noSharedExpenses: true }, composition: emptyComposition() })).rejects.toBeInstanceOf(HouseholdConflictError);
    expect(db.tables.households).toHaveLength(1);
  });
});

describe("missing schema fallback", () => {
  it("recognises a missing column or table, and nothing else", () => {
    for (const e of [{ code: "42703" }, { code: "PGRST204" }, { code: "PGRST205" }, { code: "42P01" }, { message: "Could not find the 'shared_goals' column of 'households' in the schema cache" }]) expect(isHouseholdSharedUnavailableError(e), JSON.stringify(e)).toBe(true);
    for (const e of [null, { code: "23505" }, { code: "42501", message: "row-level security" }, { message: "network" }]) expect(isHouseholdSharedUnavailableError(e)).toBe(false);
  });
  it("loading before the migration is applied reports 'unavailable' and does not throw", async () => {
    db.migrated = false;
    expect(await getHouseholdShared()).toEqual({ status: "unavailable" });
  });
  it("saving before the migration is applied rejects with an error the UI can classify, and writes nothing", async () => {
    db.migrated = false;
    const err = await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), noSharedDebts: true }, composition: emptyComposition() }).catch((e) => e);
    expect(isHouseholdSharedUnavailableError(err)).toBe(true);
    expect(db.tables.households.every((h) => h.shared_expenses === undefined || (h.shared_expenses as unknown[]).length === 0)).toBe(true);
  });
  it("Me and Partner keep working without the migration: their data access never selects the new columns", async () => {
    db.migrated = false;
    db.tables.household_members.push({ id: "m1", owner_id: "u1", role: "partner", include_in_household: true });
    expect(await getPartnerIncluded()).toBe(true);
    expect(await setPartnerIncluded("m1", false)).toBe(false);
    const { getPartner } = await import("./household");
    await expect(getPartner()).resolves.toBeTruthy();
    expect(db.calls.filter((c) => c.table === "household_members").every((c) => !NEW_COLS.some((n) => JSON.stringify(c.args).includes(n)))).toBe(true);
  });
});

describe("include_in_household", () => {
  beforeEach(() => db.tables.household_members.push({ id: "m1", owner_id: "u1", role: "partner", include_in_household: true, take_home: 3000 }));

  it("reads the partner's setting; no partner reads as null", async () => {
    expect(await getPartnerIncluded()).toBe(true);
    db.tables.household_members.length = 0;
    expect(await getPartnerIncluded()).toBeNull();
  });
  it("changes only that flag on that member, scoped to the owner", async () => {
    expect(await setPartnerIncluded("m1", false)).toBe(false);
    expect(db.calls.find((c) => c.op === "update")!.args[0]).toEqual({ include_in_household: false });
    expect(db.calls.filter((c) => c.op === "eq").map((c) => c.args)).toEqual(expect.arrayContaining([["id", "m1"], ["owner_id", "u1"]]));
    expect(db.tables.household_members[0]).toMatchObject({ include_in_household: false, take_home: 3000 });
    expect(await getPartnerIncluded()).toBe(false);
    expect(await setPartnerIncluded("m1", true)).toBe(true);
  });
  it("an unknown member is an error, not a silent success", async () => {
    await expect(setPartnerIncluded("nope", false)).rejects.toThrow();
  });
  it("toggling inclusion leaves the shared data untouched", async () => {
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), expenses: [expense()] }, composition: emptyComposition() });
    const before = JSON.stringify(db.tables.households);
    await setPartnerIncluded("m1", false);
    expect(JSON.stringify(db.tables.households)).toBe(before);
  });
});

describe("personal records and cross-account isolation", () => {
  it("household operations touch only households and household_members, never personal records", async () => {
    db.tables.household_members.push({ id: "m1", owner_id: "u1", role: "partner", include_in_household: true });
    await getHouseholdShared();
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), expenses: [expense()] }, composition: emptyComposition() });
    await setPartnerIncluded("m1", false);
    await getPartnerIncluded();
    expect(tables().every((t) => t === "households" || t === "household_members")).toBe(true);
    expect(db.calls.filter((c) => c.table === "households").every((c) => c.op !== "delete")).toBe(true);
    expect(db.tables.financial_profiles).toEqual([{ owner_id: "u1", take_home: 5000 }]);
    expect(db.tables.bills).toEqual([{ owner_id: "u1", name: "Rent" }]);
  });

  it("every read and write is filtered on the signed-in user", async () => {
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), noSharedDebts: true }, composition: emptyComposition() });
    await getHouseholdShared();
    const ownerFilters = db.calls.filter((c) => c.op === "eq" && c.args[0] === "owner_id");
    const queries = db.calls.filter((c) => ["select", "update"].includes(c.op) && c.table === "households").length;
    expect(ownerFilters.length).toBeGreaterThanOrEqual(queries - 1); // the select that follows an update is part of the same query
    expect(ownerFilters.every((c) => c.args[1] === "u1")).toBe(true);
  });

  it("another account sees none of this household's data and cannot overwrite it", async () => {
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), expenses: [expense({ label: "Private rent" })] }, composition: { adults: 2, children: 3, otherMembers: null } });
    db.user = "u2";
    const theirs = ready(await getHouseholdShared());
    expect(theirs.householdId).toBeNull();
    expect(theirs.shared).toEqual(emptyShared());
    expect(theirs.composition).toEqual(emptyComposition());
    // u2 saves their own household; u1's row is unaffected and u2 gets a separate row
    await saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), noSharedExpenses: true }, composition: emptyComposition() });
    expect(db.tables.households).toHaveLength(2);
    db.user = "u1";
    const mine = ready(await getHouseholdShared());
    expect(mine.shared.expenses[0].label).toBe("Private rent");
    expect(mine.shared.noSharedExpenses).toBe(false);
  });

  it("another account cannot change this account's partner flag", async () => {
    db.tables.household_members.push({ id: "m1", owner_id: "u1", role: "partner", include_in_household: true });
    db.user = "u2";
    await expect(setPartnerIncluded("m1", false)).rejects.toThrow();
    expect(db.tables.household_members[0].include_in_household).toBe(true);
    expect(await getPartnerIncluded()).toBeNull();
  });
});

const GOOD = { id: "a", category: "housing", label: "Rent", amount: 10, basis: "actual", contributions: { me: null, partner: null }, links: [] };
const withStored = (over: Row) =>
  db.tables.households.push({ id: "h9", owner_id: "u1", revision: 4, shared_expenses: [], no_shared_expenses: false, shared_debts: [], no_shared_debts: false, shared_goals: [], adults: null, children: null, other_members: null, ...over });
const snapshot = () => JSON.stringify(db.tables.households);

describe("stored-data integrity safeguards", () => {
  it("a clean household reports integrity ok", async () => {
    withStored({ shared_expenses: [{ ...GOOD, basis: "actual", contributions: { me: null, partner: null }, links: [] }] });
    expect(ready(await getHouseholdShared()).integrity).toMatchObject({ ok: true, issues: [] });
  });

  it("malformed and duplicate-id stored entries are displayed tolerantly AND reported", async () => {
    withStored({ shared_expenses: [GOOD, { ...GOOD, category: "other", label: "Dup" }, "junk", { id: "z", category: "housing", label: "No amount" }] });
    const s = ready(await getHouseholdShared());
    expect(s.shared.expenses.map((e) => e.id)).toEqual(["a"]);
    expect(s.integrity.ok).toBe(false);
    expect(s.integrity.issues.map((i) => i.code).sort()).toEqual(["duplicateId", "malformedItem", "malformedItem"]);
    expect(s.integrity.fingerprint).toMatch(/^[0-9a-f]{8}:\d+$/);
  });

  it("saving over malformed stored data is refused, writes nothing, and keeps every stored entry", async () => {
    withStored({ shared_expenses: [GOOD, "junk"] });
    const before = snapshot();
    const s = ready(await getHouseholdShared());
    const err = await saveHouseholdShared({ expectedRevision: s.revision, shared: s.shared, composition: s.composition }).catch((e) => e);
    expect(err).toBeInstanceOf(HouseholdIntegrityError);
    expect(snapshot()).toBe(before);
    expect(db.writes).toBe(0);
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("saving over duplicate-id stored data is refused the same way", async () => {
    withStored({ shared_expenses: [GOOD, { ...GOOD, label: "Second one", amount: 99 }] });
    const before = snapshot();
    const s = ready(await getHouseholdShared());
    await expect(saveHouseholdShared({ expectedRevision: s.revision, shared: s.shared, composition: s.composition })).rejects.toBeInstanceOf(HouseholdIntegrityError);
    expect(snapshot()).toBe(before); // the second entry is still stored
  });

  it("repairs that would silently change a stored field are blocked too (not only dropped items)", async () => {
    withStored({ shared_expenses: [{ ...GOOD, contributions: { me: -4, partner: 5 } }], adults: 99 });
    const s = ready(await getHouseholdShared());
    expect(s.integrity.issues.map((i) => i.code).sort()).toEqual(["compositionRepaired", "fieldRepaired"]);
    await expect(saveHouseholdShared({ expectedRevision: s.revision, shared: s.shared, composition: s.composition })).rejects.toBeInstanceOf(HouseholdIntegrityError);
  });

  it("a list that is not an array is reported and blocks saving", async () => {
    withStored({ shared_debts: { oops: true } });
    const s = ready(await getHouseholdShared());
    expect(s.integrity.issues).toEqual([{ code: "listNotArray", list: "debts" }]);
    await expect(saveHouseholdShared({ expectedRevision: s.revision, shared: s.shared, composition: s.composition })).rejects.toBeInstanceOf(HouseholdIntegrityError);
  });

  it("the error is recoverable: it carries the issues, the exact stored content and the display copy", async () => {
    withStored({ shared_expenses: [GOOD, "junk"] });
    const s = ready(await getHouseholdShared());
    const err = (await saveHouseholdShared({ expectedRevision: s.revision, shared: s.shared, composition: s.composition }).catch((e) => e)) as HouseholdIntegrityError;
    expect(err.issues.map((i) => i.code)).toEqual(["malformedItem"]);
    expect(err.stored.shared_expenses).toEqual([GOOD, "junk"]); // nothing lost: the user can copy or export it
    expect(err.stored).not.toHaveProperty("revision");
    expect(err.latest.shared.expenses).toHaveLength(1);
    expect(err.fingerprint).toBe(s.integrity.fingerprint);
  });

  it("an explicit acknowledgement of exactly what was shown allows the save, and the other lists are untouched", async () => {
    withStored({ shared_expenses: [GOOD, "junk"], shared_debts: [{ id: "d", name: "Loan", balance: 5, monthlyPayment: null, basis: "actual", contributions: { me: null, partner: null }, links: [] }] });
    const s = ready(await getHouseholdShared());
    const out = await saveHouseholdShared({ expectedRevision: s.revision, shared: s.shared, composition: s.composition, acknowledgeIntegrity: s.integrity.fingerprint });
    expect(out.integrity.ok).toBe(true);
    expect(out.revision).toBe(5);
    expect((db.tables.households[0].shared_debts as Row[])[0].id).toBe("d");
  });

  it("an acknowledgement for different content is refused (the data changed since it was seen)", async () => {
    withStored({ shared_expenses: [GOOD, "junk"] });
    const s = ready(await getHouseholdShared());
    const before = snapshot();
    await expect(saveHouseholdShared({ expectedRevision: s.revision, shared: s.shared, composition: s.composition, acknowledgeIntegrity: "00000000:0" })).rejects.toBeInstanceOf(HouseholdIntegrityError);
    expect(snapshot()).toBe(before);
  });

  it("clean stored data needs no acknowledgement, and a pointless one is harmless", async () => {
    withStored({});
    const s = ready(await getHouseholdShared());
    await expect(saveHouseholdShared({ expectedRevision: s.revision, shared: { ...emptyShared(), noSharedDebts: true }, composition: emptyComposition(), acknowledgeIntegrity: "whatever" })).resolves.toMatchObject({ revision: 5 });
  });

  it("with no household yet nothing needs acknowledging", async () => {
    await expect(saveHouseholdShared({ expectedRevision: 0, shared: { ...emptyShared(), noSharedDebts: true }, composition: emptyComposition() })).resolves.toMatchObject({ revision: 1 });
  });
});

describe("revision concurrency safeguards", () => {
  const goal1 = { id: "g1", name: "Trip", targetAmount: null, targetDate: null, savedAmount: null, contributions: { ...NONE }, countedInSavings: { me: false, partner: false } };
  const debt1 = { id: "d1", name: "Loan", balance: 1, monthlyPayment: null, basis: "actual" as const, contributions: { ...NONE }, links: [] };
  const save = (rev: number, over: Partial<ReturnType<typeof emptyShared>> = {}, c = emptyComposition()) => saveHouseholdShared({ expectedRevision: rev, shared: { ...emptyShared(), ...over }, composition: c });

  it("the revision rises by exactly one for each meaningful change, in every shared column", async () => {
    const steps: [Partial<ReturnType<typeof emptyShared>>, ReturnType<typeof emptyComposition>][] = [
      [{ noSharedExpenses: true }, emptyComposition()],
      [{ noSharedExpenses: true, noSharedDebts: true }, emptyComposition()],
      [{ noSharedExpenses: true, noSharedDebts: true, expenses: [expense()] }, emptyComposition()],
      [{ noSharedExpenses: true, noSharedDebts: true, expenses: [expense()], debts: [debt1] }, emptyComposition()],
      [{ noSharedExpenses: true, noSharedDebts: true, expenses: [expense()], debts: [debt1], goals: [goal1] }, emptyComposition()],
      [{ noSharedExpenses: true, noSharedDebts: true, expenses: [expense()], debts: [debt1], goals: [goal1] }, { adults: 2, children: null, otherMembers: null }],
      [{ noSharedExpenses: true, noSharedDebts: true, expenses: [expense()], debts: [debt1], goals: [goal1] }, { adults: 2, children: 0, otherMembers: null }], // null -> 0 is a real change
      [{ noSharedExpenses: true, noSharedDebts: true, expenses: [expense()], debts: [debt1], goals: [goal1] }, { adults: 2, children: 0, otherMembers: 1 }],
    ];
    let rev = 0;
    for (const [over, c] of steps) {
      const out = await save(rev, over, c);
      expect(out.revision, JSON.stringify([over, c])).toBe(rev + 1);
      rev = out.revision;
    }
  });

  it("saving identical content does NOT change the revision", async () => {
    const first = await save(0, { expenses: [expense()] });
    const same = await save(first.revision, { expenses: [expense()] });
    expect(same.revision).toBe(first.revision);
    const padded = await save(first.revision, { expenses: [expense({ label: "  Rent  " })] }); // trims to the stored value
    expect(padded.revision).toBe(first.revision);
  });

  it("re-creating or touching the household without shared changes does not change the revision", async () => {
    const first = await save(0, { noSharedDebts: true });
    const { supabase } = await import("@/lib/supabase/client");
    await supabase.from("households").upsert({ owner_id: "u1" }, { onConflict: "owner_id", ignoreDuplicates: true });
    expect(ready(await getHouseholdShared()).revision).toBe(first.revision);
  });

  it("the client never sends a revision value; the update filters on it instead", async () => {
    await save(0, { noSharedDebts: true });
    const upd = db.calls.find((c) => c.op === "update")!.args[0] as Row;
    expect(Object.keys(upd).sort()).toEqual(["adults", "children", "no_shared_debts", "no_shared_expenses", "other_members", "shared_debts", "shared_expenses", "shared_goals"]);
    expect(db.calls.filter((c) => c.op === "eq" && c.args[0] === "revision").map((c) => c.args[1])).toEqual([0]);
  });

  it("the database ignores a revision written by a client (a forged value does not stick)", async () => {
    const out = await save(0, { noSharedDebts: true });
    const { supabase } = await import("@/lib/supabase/client");
    await supabase.from("households").update({ revision: 999, no_shared_expenses: true }).eq("owner_id", "u1");
    expect(db.tables.households[0].revision).toBe(out.revision + 1); // moved by the trigger for the real change only
    await supabase.from("households").update({ revision: 5000 }).eq("owner_id", "u1");
    expect(db.tables.households[0].revision).toBe(out.revision + 1); // no change => no move, and 5000 is ignored
  });

  it("a stale update is refused up front: nothing is sent and the stored row is byte-for-byte unchanged", async () => {
    const a = await save(0, { expenses: [expense({ label: "A" })] });
    const before = snapshot();
    const writes = db.writes;
    const err = await save(0, { expenses: [expense({ label: "Stale" })] }).catch((e) => e);
    expect(err).toBeInstanceOf(HouseholdConflictError);
    expect(snapshot()).toBe(before);
    expect(db.writes).toBe(writes);
    expect(a.revision).toBe(1);
  });

  it("when another tab commits between this tab's read and write, the revision filter matches ZERO rows", async () => {
    const a = await save(0, { expenses: [expense({ label: "A" })] });
    const { supabase } = await import("@/lib/supabase/client");
    const real = supabase.from.bind(supabase);
    let bumped = false;
    const spy = vi.spyOn(supabase, "from").mockImplementation(((t: string) => {
      const q = real(t as never) as unknown as Record<string, (...x: unknown[]) => unknown>;
      if (t === "households") {
        const origUpdate = q.update;
        q.update = (...args: unknown[]) => {
          if (!bumped) {
            bumped = true;
            const r = db.tables.households[0]; // the other tab's committed save, landing just before this update
            r.no_shared_debts = true;
            r.revision = (r.revision as number) + 1;
          }
          return origUpdate(...args);
        };
      }
      return q as never;
    }) as never);
    db.affected = -1;
    const err = await save(a.revision, { expenses: [expense({ label: "Mine" })] }).catch((e) => e);
    spy.mockRestore();
    expect(err).toBeInstanceOf(HouseholdConflictError);
    expect(db.affected).toBe(0);
    expect(db.tables.households[0].no_shared_debts).toBe(true); // the other tab's change survived
    expect((db.tables.households[0].shared_expenses as Row[])[0].label).toBe("A"); // and mine did not overwrite it
    expect(((err as HouseholdConflictError).latest as ReadyState).revision).toBe(a.revision + 1);
  });

  it("a conflict returns the latest stored version (not the caller's), without overwriting it", async () => {
    await save(0, { expenses: [expense({ label: "Winner" })] }, { adults: 3, children: null, otherMembers: null });
    const before = snapshot();
    const err = (await save(0, { expenses: [expense({ label: "Loser" })] }).catch((e) => e)) as HouseholdConflictError;
    const latest = err.latest as ReadyState;
    expect(latest.shared.expenses[0].label).toBe("Winner");
    expect(latest.composition.adults).toBe(3);
    expect(latest.revision).toBe(1);
    expect(snapshot()).toBe(before);
  });

  it("a stale save is reported as a conflict before integrity, so stale data is never mistaken for a repair", async () => {
    withStored({ shared_expenses: [GOOD, "junk"] });
    const err = await save(0, {}).catch((e) => e); // stored revision is 4, the caller read 0
    expect(err).toBeInstanceOf(HouseholdConflictError);
  });
});

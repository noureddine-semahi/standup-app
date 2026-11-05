import { describe, it, expect } from "vitest";
import { emptyComposition, emptyShared, type SharedDebt, type SharedExpense, type SharedGoal, type SharedHousehold } from "./householdPlan";
import { SHARED_LIMITS, fingerprintOf, newSharedId, rowToShared, sharedToColumns, validateShared } from "./householdShared";

const NONE = { me: null, partner: null };
const expense = (over: Partial<SharedExpense> = {}): SharedExpense => ({ id: "e1", category: "housing", label: "Rent", amount: 1800, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const debt = (over: Partial<SharedDebt> = {}): SharedDebt => ({ id: "d1", name: "Mortgage", balance: 250000, monthlyPayment: 1400, basis: "actual", contributions: { ...NONE }, links: [], ...over });
const goal = (over: Partial<SharedGoal> = {}): SharedGoal => ({ id: "g1", name: "House", targetAmount: 12000, targetDate: "2027-11-04", savedAmount: 0, contributions: { ...NONE }, countedInSavings: { me: false, partner: false }, ...over });
const shared = (over: Partial<SharedHousehold> = {}): SharedHousehold => ({ ...emptyShared(), ...over });
const codes = (s: SharedHousehold, c = emptyComposition()) => validateShared(s, c).map((e) => e.code);
const roundTrip = (s: SharedHousehold, c = emptyComposition()) => rowToShared(sharedToColumns(s, c));

describe("serialization round trip", () => {
  it("everything survives save -> load unchanged", () => {
    const s = shared({
      expenses: [expense({ contributions: { me: 800, partner: 1000 }, links: [{ kind: "bill", id: "b1" }, { kind: "personalExpense", person: "me", category: "housing" }] })],
      noSharedExpenses: false,
      debts: [debt({ contributions: { me: 700, partner: null }, links: [{ kind: "account", id: "a1" }, { kind: "personalDebt", person: "partner", debtId: "x" }] })],
      noSharedDebts: false,
      goals: [goal({ contributions: { me: 100, partner: 150 }, savedAmount: 500, countedInSavings: { me: true, partner: false } })],
    });
    const c = { adults: 2, children: 1, otherMembers: 0 };
    const back = roundTrip(s, c);
    expect(back.shared).toEqual(s);
    expect(back.composition).toEqual(c);
    expect(back.droppedItems).toBe(0);
  });

  it("the stored columns have the shape the migration expects and survive JSON", () => {
    const cols = sharedToColumns(shared({ expenses: [expense()], noSharedDebts: true }), { adults: 2, children: null, otherMembers: null });
    expect(Object.keys(cols).sort()).toEqual(["adults", "children", "no_shared_debts", "no_shared_expenses", "other_members", "shared_debts", "shared_expenses", "shared_goals"]);
    expect(rowToShared(JSON.parse(JSON.stringify(cols))).shared.expenses).toEqual([expense()]);
    expect(cols.no_shared_debts).toBe(true);
    expect(cols.children).toBeNull();
  });

  it("an empty household round-trips to empty, with 'none' answers kept distinct from empty lists", () => {
    expect(roundTrip(emptyShared()).shared).toEqual(emptyShared());
    expect(roundTrip(shared({ noSharedExpenses: true, noSharedDebts: true })).shared).toMatchObject({ noSharedExpenses: true, noSharedDebts: true, expenses: [] });
    expect(roundTrip(emptyShared()).shared.noSharedExpenses).toBe(false);
  });

  it("is a pure function: inputs are not modified", () => {
    const s = shared({ expenses: [expense({ label: "  Rent  " })] });
    const before = JSON.stringify(s);
    sharedToColumns(s, emptyComposition());
    expect(JSON.stringify(s)).toBe(before);
    expect(sharedToColumns(s, emptyComposition()).shared_expenses[0]).toMatchObject({ label: "Rent" }); // trimmed on the way out only
  });
});

describe("missing versus explicit zero", () => {
  it("null stays null and 0 stays 0 for contributions, amounts, goals and composition", () => {
    const s = shared({
      expenses: [expense({ contributions: { me: 0, partner: null } })],
      debts: [debt({ balance: null, monthlyPayment: 0, contributions: { me: null, partner: 0 } })],
      goals: [goal({ targetAmount: null, targetDate: null, savedAmount: 0, contributions: { me: 0, partner: null } })],
    });
    const back = roundTrip(s, { adults: null, children: 0, otherMembers: null });
    expect(back.shared.expenses[0].contributions).toEqual({ me: 0, partner: null });
    expect(back.shared.debts[0]).toMatchObject({ balance: null, monthlyPayment: 0, contributions: { me: null, partner: 0 } });
    expect(back.shared.goals[0]).toMatchObject({ targetAmount: null, targetDate: null, savedAmount: 0, contributions: { me: 0, partner: null } });
    expect(back.composition).toEqual({ adults: null, children: 0, otherMembers: null });
  });

  it("a missing key in a stored row reads as unknown (null), never as 0", () => {
    const back = rowToShared({
      shared_debts: [{ id: "d", name: "Loan" }],
      shared_goals: [{ id: "g", name: "Trip", contributions: {} }],
      shared_expenses: [{ id: "e", category: "housing", label: "Rent", amount: 100 }],
    });
    expect(back.shared.debts[0]).toMatchObject({ balance: null, monthlyPayment: null, contributions: { me: null, partner: null } });
    expect(back.shared.goals[0]).toMatchObject({ targetAmount: null, savedAmount: null, contributions: { me: null, partner: null } });
    expect(back.shared.expenses[0].contributions).toEqual({ me: null, partner: null });
  });

  it("an expense whose amount is missing is dropped and counted, not turned into $0", () => {
    const back = rowToShared({ shared_expenses: [{ id: "e", category: "housing", label: "Rent" }, { id: "e2", category: "housing", label: "Power", amount: 0 }] });
    expect(back.shared.expenses.map((e) => e.id)).toEqual(["e2"]);
    expect(back.shared.expenses[0].amount).toBe(0);
    expect(back.droppedItems).toBe(1);
  });

  it("a missing row / missing columns (migration not applied) read as an empty household", () => {
    for (const row of [null, undefined, {}]) {
      const back = rowToShared(row);
      expect(back.shared).toEqual(emptyShared());
      expect(back.composition).toEqual(emptyComposition());
      expect(back.droppedItems).toBe(0);
    }
  });
});

describe("invalid contributions", () => {
  it("rejects negative, non-finite, non-number and sub-cent contributions", () => {
    for (const bad of [-1, NaN, Infinity, 10.005, "5" as unknown as number]) {
      expect(codes(shared({ expenses: [expense({ contributions: { me: bad, partner: null } })] })), String(bad)).toContain("invalidContribution");
    }
  });
  it("rejects contributions that add up to more than the cost, but accepts exactly the cost", () => {
    expect(codes(shared({ expenses: [expense({ contributions: { me: 1000, partner: 800.01 } })] }))).toContain("overAssigned");
    expect(codes(shared({ expenses: [expense({ contributions: { me: 1000, partner: 800 } })] }))).toEqual([]);
    expect(codes(shared({ debts: [debt({ contributions: { me: 1000, partner: 500 } })] }))).toContain("overAssigned");
  });
  it("a debt with an unknown payment cannot be over-assigned, and a goal's monthly plan has no cap", () => {
    expect(codes(shared({ debts: [debt({ monthlyPayment: null, contributions: { me: 5000, partner: null } })] }))).toEqual([]);
    expect(codes(shared({ goals: [goal({ contributions: { me: 9000, partner: 9000 } })] }))).toEqual([]);
    expect(codes(shared({ goals: [goal({ contributions: { me: -5, partner: null } })] }))).toContain("invalidContribution");
  });
  it("reading drops an invalid stored contribution to unknown rather than trusting or zeroing it", () => {
    const back = rowToShared({ shared_expenses: [{ id: "e", category: "housing", label: "Rent", amount: 100, contributions: { me: -4, partner: "x" } }] });
    expect(back.shared.expenses[0].contributions).toEqual({ me: null, partner: null });
  });
});

describe("duplicate ids and limits", () => {
  it("rejects a repeated id within a list and across lists", () => {
    expect(codes(shared({ expenses: [expense(), expense({ label: "Other" })] }))).toContain("duplicateId");
    expect(codes(shared({ expenses: [expense({ id: "same" })], goals: [goal({ id: "same" })] }))).toContain("duplicateId");
  });
  it("rejects blank or over-long ids", () => {
    expect(codes(shared({ expenses: [expense({ id: "" })] }))).toContain("badId");
    expect(codes(shared({ expenses: [expense({ id: "x".repeat(SHARED_LIMITS.idLength + 1) })] }))).toContain("badId");
  });
  it("reading keeps the first of a repeated id and reports the rest as dropped", () => {
    const back = rowToShared({ shared_expenses: [{ id: "e", category: "housing", label: "First", amount: 1 }, { id: "e", category: "other", label: "Second", amount: 2 }] });
    expect(back.shared.expenses.map((e) => e.label)).toEqual(["First"]);
    expect(back.droppedItems).toBe(1);
  });
  it("enforces list sizes on save and on read", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => expense({ id: "e" + i }));
    expect(codes(shared({ expenses: many(SHARED_LIMITS.expenses) }))).toEqual([]);
    expect(codes(shared({ expenses: many(SHARED_LIMITS.expenses + 1) }))).toContain("tooMany");
    const back = rowToShared({ shared_expenses: many(SHARED_LIMITS.expenses + 3) });
    expect(back.shared.expenses).toHaveLength(SHARED_LIMITS.expenses);
    expect(back.droppedItems).toBe(3);
  });
  it("newSharedId makes distinct, valid ids", () => {
    const ids = new Set(Array.from({ length: 50 }, newSharedId));
    expect(ids.size).toBe(50);
    expect([...ids].every((i) => i.length >= 1 && i.length <= SHARED_LIMITS.idLength)).toBe(true);
  });
});

describe("other validation", () => {
  it("accepts a complete valid household", () => {
    expect(codes(shared({ expenses: [expense()], debts: [debt()], goals: [goal()] }), { adults: 2, children: 1, otherMembers: 0 })).toEqual([]);
  });
  it("requires labels, bounded", () => {
    expect(codes(shared({ expenses: [expense({ label: "   " })] }))).toContain("labelRequired");
    expect(codes(shared({ debts: [debt({ name: "x".repeat(SHARED_LIMITS.label + 1) })] }))).toContain("labelTooLong");
  });
  it("rejects bad amounts, categories, bases and dates", () => {
    expect(codes(shared({ expenses: [expense({ amount: -1 })] }))).toContain("badAmount");
    expect(codes(shared({ expenses: [expense({ amount: NaN })] }))).toContain("badAmount");
    expect(codes(shared({ expenses: [expense({ amount: 10.001 })] }))).toContain("badAmount");
    expect(codes(shared({ expenses: [expense({ category: "yacht" as never })] }))).toContain("badCategory");
    expect(codes(shared({ expenses: [expense({ basis: "guess" as never })] }))).toContain("badBasis");
    expect(codes(shared({ goals: [goal({ targetDate: "11/04/2027" })] }))).toContain("badDate");
    expect(codes(shared({ goals: [goal({ targetDate: "2027-13-45" })] }))).toContain("badDate");
    expect(codes(shared({ debts: [debt({ balance: SHARED_LIMITS.maxAmount + 1 })] }))).toContain("badAmount");
  });
  it("rejects malformed, wrong-kind and repeated links", () => {
    expect(codes(shared({ expenses: [expense({ links: [{ kind: "bill", id: "" }] })] }))).toContain("badLink");
    expect(codes(shared({ expenses: [expense({ links: [{ kind: "personalDebt", person: "me", debtId: "d" } as never] })] }))).toContain("badLink");
    expect(codes(shared({ debts: [debt({ links: [{ kind: "bill", id: "b" } as never] })] }))).toContain("badLink");
    expect(codes(shared({ expenses: [expense({ links: [{ kind: "bill", id: "b" }, { kind: "bill", id: "b" }] })] }))).toContain("duplicateLink");
    const many = Array.from({ length: SHARED_LIMITS.linksPerItem + 1 }, (_, i) => ({ kind: "bill" as const, id: "b" + i }));
    expect(codes(shared({ expenses: [expense({ links: many })] }))).toContain("tooManyLinks");
  });
  it("household composition: whole numbers within range; unanswered is allowed", () => {
    expect(validateShared(emptyShared(), { adults: 0, children: null, otherMembers: null }).map((e) => e.code)).toEqual(["compositionRange"]);
    expect(validateShared(emptyShared(), { adults: 1.5, children: null, otherMembers: null }).map((e) => e.code)).toEqual(["compositionInteger"]);
    expect(validateShared(emptyShared(), { adults: null, children: 99, otherMembers: -1 }).map((e) => e.field).sort()).toEqual(["children", "otherMembers"]);
    expect(validateShared(emptyShared(), emptyComposition())).toEqual([]);
  });
  it("reading discards an out-of-range stored composition value to unknown", () => {
    expect(rowToShared({ adults: 99, children: -2, other_members: 1.5 }).composition).toEqual(emptyComposition());
    expect(rowToShared({ adults: 2, children: 0, other_members: 3 }).composition).toEqual({ adults: 2, children: 0, otherMembers: 3 });
  });
});

describe("integrity reporting (tolerant display, explicit warning)", () => {
  const good = { id: "a", category: "housing", label: "Rent", amount: 10, basis: "actual", contributions: { me: null, partner: null }, links: [] };

  it("canonical stored data is ok, whatever its key order", () => {
    const reversed = Object.fromEntries(Object.entries(good).reverse());
    expect(rowToShared({ shared_expenses: [reversed], adults: 2 }).integrity.ok).toBe(true);
    expect(rowToShared(null).integrity).toMatchObject({ ok: true, issues: [] });
    expect(rowToShared({}).integrity.ok).toBe(true);
  });

  it("each kind of problem gets its own issue code with the item's position and id", () => {
    const r = rowToShared({
      shared_expenses: [good, { ...good }, 5, { ...good, id: "b", contributions: { me: -1, partner: null } }],
      shared_debts: "x" as unknown as unknown[],
      no_shared_debts: "yes" as unknown as boolean,
      adults: 99,
    });
    expect(r.integrity.ok).toBe(false);
    expect(r.integrity.issues).toEqual(
      expect.arrayContaining([
        { code: "duplicateId", list: "expenses", index: 1, ref: "a" },
        { code: "malformedItem", list: "expenses", index: 2, ref: undefined },
        { code: "fieldRepaired", list: "expenses", index: 3, ref: "b" },
        { code: "listNotArray", list: "debts" },
        { code: "flagRepaired", list: "debts", field: "no_shared_debts" },
        { code: "compositionRepaired", list: "composition", field: "adults" },
      ])
    );
    expect(r.droppedItems).toBe(2);
  });

  it("over-limit extras are reported, not silently cut", () => {
    const many = Array.from({ length: SHARED_LIMITS.goals + 2 }, (_, i) => ({ id: "g" + i, name: "G", targetAmount: null, targetDate: null, savedAmount: null, contributions: { me: null, partner: null }, countedInSavings: { me: false, partner: false } }));
    const r = rowToShared({ shared_goals: many });
    expect(r.integrity.issues.filter((i) => i.code === "overLimit")).toHaveLength(2);
    expect(r.shared.goals).toHaveLength(SHARED_LIMITS.goals);
  });

  it("an untrimmed stored label is a repair (saving would rewrite it)", () => {
    expect(rowToShared({ shared_expenses: [{ ...good, label: "  Rent " }] }).integrity.issues.map((i) => i.code)).toEqual(["fieldRepaired"]);
  });

  it("the fingerprint identifies the stored content: stable for equal data, different when anything changes", () => {
    const a = rowToShared({ shared_expenses: [good, 5] }).integrity.fingerprint;
    const sameReordered = rowToShared({ shared_expenses: [Object.fromEntries(Object.entries(good).reverse()), 5] }).integrity.fingerprint;
    const changed = rowToShared({ shared_expenses: [good, 6] }).integrity.fingerprint;
    expect(sameReordered).toBe(a);
    expect(changed).not.toBe(a);
    expect(fingerprintOf(null)).toBe(fingerprintOf({}));
  });

  it("reading never modifies its input", () => {
    const input = { shared_expenses: [good, 5, { ...good }] };
    const before = JSON.stringify(input);
    rowToShared(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

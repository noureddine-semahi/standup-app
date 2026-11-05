import { describe, it, expect } from "vitest";
import type { Bill } from "./bills";
import { EXPENSE_CATEGORIES, emptyProfile, type FinancialProfile } from "./financialPlanner";
import type { SharedExpense } from "./householdPlan";
import type { Subscription } from "./subscriptions";
import type { PaymentAccount } from "./supabase/db";
import { SHARED_LIMITS } from "./householdShared";
import { applyShortcut, checkDraft, emptyDraft, expenseToDraft, linkCandidates, liveAllocation, readField, toggleLink, upsertExpense, withSuggestion, type ExpenseDraft } from "./sharedExpenseDraft";

const draft = (over: Partial<ExpenseDraft> = {}): ExpenseDraft => ({ ...emptyDraft(), label: "Rent", amount: "1800", ...over });
const codes = (d: ExpenseDraft, hasPartner = true) => checkDraft(d, { hasPartner }).errors.map((e) => e.code);

describe("empty is not stated; a typed 0 is a real 0", () => {
  it("readField distinguishes empty, zero, a value and garbage", () => {
    expect(readField("")).toEqual({ state: "empty" });
    expect(readField("   ")).toEqual({ state: "empty" });
    expect(readField("0")).toEqual({ state: "value", value: 0 });
    expect(readField("0.00")).toEqual({ state: "value", value: 0 });
    expect(readField("12.5")).toEqual({ state: "value", value: 12.5 });
    for (const bad of ["abc", "-1", "1.234", "1,5", "$5"]) expect(readField(bad).state, bad).toBe("invalid");
  });
  it("an empty box becomes null and a typed 0 becomes 0 in the expense", () => {
    const e = checkDraft(draft({ me: "", partner: "0" }), { hasPartner: true }).expense!;
    expect(e.contributions).toEqual({ me: null, partner: 0 });
    const f = checkDraft(draft({ me: "0", partner: "" }), { hasPartner: true }).expense!;
    expect(f.contributions).toEqual({ me: 0, partner: null });
  });
  it("without a partner the partner box is ignored (never a contribution for someone who isn't there)", () => {
    expect(checkDraft(draft({ me: "100", partner: "50" }), { hasPartner: false }).expense!.contributions).toEqual({ me: 100, partner: null });
  });
  it("editing round-trips: null -> empty box, 0 -> '0'", () => {
    const e: SharedExpense = { id: "e1", category: "utilities", label: "Power", amount: 120.5, basis: "estimate", contributions: { me: 0, partner: null }, links: [{ kind: "bill", id: "b1" }] };
    const d = expenseToDraft(e);
    expect(d).toMatchObject({ id: "e1", amount: "120.5", me: "0", partner: "", basis: "estimate" });
    expect(checkDraft(d, { hasPartner: true }).expense).toEqual(e);
  });
});

describe("validation", () => {
  it("requires a name and an amount; a blank amount is unknown and refused, an explicit 0 is allowed", () => {
    expect(codes(draft({ label: "  " }))).toContain("labelRequired");
    expect(codes(draft({ label: "x".repeat(SHARED_LIMITS.label + 1) }))).toContain("labelTooLong");
    expect(codes(draft({ amount: "" }))).toContain("amountRequired");
    expect(codes(draft({ amount: "abc" }))).toContain("amountInvalid");
    expect(codes(draft({ amount: "0" }))).toEqual([]);
    expect(checkDraft(draft({ amount: "0" }), { hasPartner: true }).expense!.amount).toBe(0);
    expect(checkDraft(draft({ amount: "0.00" }), { hasPartner: true }).expense!.amount).toBe(0);
    expect(codes(draft())).toEqual([]);
  });
  it("rejects invalid contributions and over-assigned totals (exactly the cost is fine)", () => {
    expect(codes(draft({ me: "x" }))).toContain("meInvalid");
    expect(codes(draft({ partner: "-5" }))).toContain("partnerInvalid");
    expect(codes(draft({ me: "1000", partner: "800.01" }))).toContain("overAssigned");
    expect(codes(draft({ me: "1000", partner: "800" }))).toEqual([]);
  });
  it("a new expense gets a fresh stable id; an edited one keeps its id", () => {
    const a = checkDraft(draft(), { hasPartner: true }).expense!.id;
    const b = checkDraft(draft(), { hasPartner: true }).expense!.id;
    expect(a).not.toBe(b);
    expect(checkDraft(draft({ id: "keep" }), { hasPartner: true }).expense!.id).toBe("keep");
  });
  it("limits the number of links", () => {
    const many = Array.from({ length: SHARED_LIMITS.linksPerItem + 1 }, (_, i) => ({ kind: "bill" as const, id: "b" + i }));
    expect(codes(draft({ links: many }))).toContain("tooManyLinks");
  });
});

describe("live assignment comes from the calculation module", () => {
  it("no one stated: the whole amount is not yet assigned (never split)", () => {
    expect(liveAllocation(draft(), true)).toMatchObject({ status: "unassigned", meCents: 0, partnerCents: 0, unassignedCents: 180000, totalCents: 180000 });
  });
  it("partly stated: the remainder is explicit", () => {
    expect(liveAllocation(draft({ me: "900" }), true)).toMatchObject({ status: "partial", meCents: 90000, unassignedCents: 90000 });
  });
  it("explicit zero for one person with the other unstated is still 'partial' with everything left unassigned", () => {
    expect(liveAllocation(draft({ partner: "0" }), true)).toMatchObject({ partnerCents: 0, unassignedCents: 180000 });
  });
  it("fully stated is assigned; over-assigned or unusable amounts give no live figure", () => {
    expect(liveAllocation(draft({ me: "800", partner: "1000" }), true)).toMatchObject({ status: "assigned", unassignedCents: 0 });
    expect(liveAllocation(draft({ me: "1800", partner: "1" }), true)).toMatchObject({ status: "invalid" });
    expect(liveAllocation(draft({ amount: "" }), true)).toBeNull();
    expect(liveAllocation(draft({ me: "x" }), true)).toBeNull();
  });
});

describe("shortcuts", () => {
  it("Me covers all: Me gets the whole amount, the partner an explicit 0", () => {
    expect(applyShortcut(draft(), "me", true)).toMatchObject({ me: "1800", partner: "0" });
    expect(applyShortcut(draft(), "me", false)).toMatchObject({ me: "1800", partner: "" });
  });
  it("Partner covers all: the partner gets the whole amount, Me an explicit 0", () => {
    expect(applyShortcut(draft(), "partner", true)).toMatchObject({ me: "0", partner: "1800" });
  });
  it("Clear returns both to not stated", () => {
    expect(applyShortcut(draft({ me: "5", partner: "0" }), "clear", true)).toMatchObject({ me: "", partner: "" });
  });
  it("needs a usable amount first and then changes nothing", () => {
    const d = draft({ amount: "", me: "5" });
    expect(applyShortcut(d, "me", true)).toBe(d);
    // a typed 0 is a usable amount: the shortcuts work and assign 0
    expect(applyShortcut(draft({ amount: "0" }), "partner", true)).toMatchObject({ me: "0", partner: "0" });
  });
  it("a suggestion only fills an EMPTY box; it never overwrites what the user typed", () => {
    expect(withSuggestion(draft(), "me", 10000).me).toBe("100");
    const typed = draft({ me: "25" });
    expect(withSuggestion(typed, "me", 10000)).toBe(typed);
    expect(withSuggestion(draft({ me: "0" }), "me", 10000).me).toBe("0"); // an explicit 0 is an answer too
  });
});

describe("link candidates: listed, never applied", () => {
  const profile = (over: Partial<FinancialProfile> = {}): FinancialProfile => ({ ...emptyProfile(), expenses: { housing: { amount: 800, basis: "actual" }, groceries: { amount: 0, basis: "actual" } }, ...over });
  const bill = (over: Partial<Bill> = {}): Bill => ({ id: "b1", name: "Rent", amountType: "fixed", expectedAmount: 1800, recurrence: "monthly", firstDueDate: "2026-01-01", remindDaysBefore: 3, category: "Rent / Mortgage", notes: null, archivedAt: null, createdAt: "x", ...over });
  const sub = (over: Partial<Subscription> = {}): Subscription => ({ id: "s1", name: "Netflix", provider: null, category: null, planName: null, amount: 15, currency: "USD", frequency: "monthly", customInterval: null, customUnit: null, nextBillingDate: "2026-11-20", startDate: null, status: "active", trialEndsOn: null, remindDaysBefore: 3, notes: null, billId: null, canceledAt: null, cancelUrl: null, createdAt: "x", updatedAt: "x", ...over });
  const account = (): PaymentAccount => ({ id: "a1", name: "Visa", balance: 900, minimumPayment: 35, dueDay: 15, remindDaysBefore: 3, lastReminderDueDate: null, createdAt: "x", balanceMode: "auto" });

  it("lists personal rows with an amount (not blanks or zeros), active bills, non-canceled subscriptions and accounts", () => {
    const list = linkCandidates({ me: profile(), partner: profile({ expenses: { other: { amount: 50, basis: "actual" } } }), bills: [bill(), bill({ id: "b2", archivedAt: "2026-01-01" })], accounts: [account()], subscriptions: [sub(), sub({ id: "s2", status: "canceled" })] });
    expect(list.map((c) => c.key)).toEqual(["personalExpense|me|housing", "personalExpense|partner|other", "bill|b1", "subscription|s1", "account|a1"]);
    expect(list.find((c) => c.key === "bill|b1")!.amountCents).toBe(180000);
    expect(list.find((c) => c.key === "subscription|s1")!.amountCents).toBe(1500);
    expect(list.find((c) => c.key === "account|a1")!.amountCents).toBe(3500);
  });
  it("a subscription in another currency is not offered (the household is USD only)", () => {
    const list = linkCandidates({ me: profile(), partner: null, bills: [], accounts: [], subscriptions: [sub({ id: "eur", currency: "EUR" })] });
    expect(list.some((c) => c.key === "subscription|eur")).toBe(false);
  });
  it("matching names create no link: the draft's links only change through toggleLink", () => {
    const d = draft({ label: "Rent" });
    const cands = linkCandidates({ me: profile(), partner: null, bills: [bill({ name: "Rent" })], accounts: [], subscriptions: [] });
    expect(cands.some((c) => c.name === "Rent")).toBe(true);
    expect(d.links).toEqual([]);
    expect(checkDraft(d, { hasPartner: false }).expense!.links).toEqual([]);
  });
  it("toggleLink adds then removes, and never mutates its input", () => {
    const base = Object.freeze([]) as unknown as ExpenseDraft["links"];
    const on = toggleLink(base, { kind: "bill", id: "b1" });
    expect(on).toEqual([{ kind: "bill", id: "b1" }]);
    expect(toggleLink(on, { kind: "bill", id: "b1" })).toEqual([]);
  });
  it("every personal category can appear once per person", () => {
    const rows = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, { amount: 10, basis: "actual" as const }]));
    const list = linkCandidates({ me: profile({ expenses: rows }), partner: profile({ expenses: rows }), bills: [], accounts: [], subscriptions: [] });
    expect(list).toHaveLength(16);
    expect(new Set(list.map((c) => c.key)).size).toBe(16);
  });
});

describe("upsertExpense", () => {
  const e = (id: string, label = id): SharedExpense => ({ id, category: "housing", label, amount: 1, basis: "actual", contributions: { me: null, partner: null }, links: [] });
  it("replaces the same id in place and appends a new one, leaving the others untouched", () => {
    const list = [e("a"), e("b"), e("c")];
    expect(upsertExpense(list, e("b", "B2")).map((x) => x.label)).toEqual(["a", "B2", "c"]);
    expect(upsertExpense(list, e("d")).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(list.map((x) => x.label)).toEqual(["a", "b", "c"]);
  });
  it("two expenses in the same category are separate entries", () => {
    expect(upsertExpense([e("a")], e("z")).filter((x) => x.category === "housing")).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import { emptyProfile, type DebtEntry, type FinancialProfile } from "./financialPlanner";
import type { SharedDebt } from "./householdPlan";
import { SHARED_LIMITS } from "./householdShared";
import type { PaymentAccount } from "./supabase/db";
import { applyDebtShortcut, checkDebtDraft, debtLinkCandidates, debtToDraft, emptyDebtDraft, liveDebtAllocation, toggleDebtLink, upsertDebt, withDebtSuggestion, type DebtDraft } from "./sharedDebtDraft";

const draft = (over: Partial<DebtDraft> = {}): DebtDraft => ({ ...emptyDebtDraft(), name: "Mortgage", balance: "250000", payment: "1400", ...over });
const codes = (d: DebtDraft, hasPartner = true) => checkDebtDraft(d, { hasPartner }).errors.map((e) => e.code);
const built = (d: DebtDraft, hasPartner = true) => checkDebtDraft(d, { hasPartner }).debt!;

describe("blank is unknown; a typed 0 is a real 0", () => {
  it("a blank balance and a blank payment are null (unknown), not 0", () => {
    const d = built(draft({ balance: "", payment: "" }));
    expect(d.balance).toBeNull();
    expect(d.monthlyPayment).toBeNull();
  });
  it("a typed 0 balance (paid off) and a typed 0 payment (nothing due) are kept as 0", () => {
    const d = built(draft({ balance: "0", payment: "0.00" }));
    expect(d.balance).toBe(0);
    expect(d.monthlyPayment).toBe(0);
  });
  it("contributions: empty -> null, 0 -> 0", () => {
    expect(built(draft({ me: "", partner: "0" })).contributions).toEqual({ me: null, partner: 0 });
    expect(built(draft({ me: "0", partner: "" })).contributions).toEqual({ me: 0, partner: null });
  });
  it("no partner: the partner box is ignored", () => {
    expect(built(draft({ me: "100", partner: "50" }), false).contributions).toEqual({ me: 100, partner: null });
  });
  it("editing round-trips every field, nulls included", () => {
    const d: SharedDebt = { id: "d1", name: "Car loan", balance: null, monthlyPayment: 245.5, basis: "estimate", contributions: { me: 0, partner: null }, links: [{ kind: "account", id: "a1" }, { kind: "personalDebt", person: "partner", debtId: "x" }] };
    const form = debtToDraft(d);
    expect(form).toMatchObject({ id: "d1", balance: "", payment: "245.5", me: "0", partner: "", basis: "estimate" });
    expect(checkDebtDraft(form, { hasPartner: true }).debt).toEqual(d);
  });
});

describe("validation", () => {
  it("requires only a name; amounts may be unknown", () => {
    expect(codes(draft({ name: " " }))).toContain("nameRequired");
    expect(codes(draft({ name: "x".repeat(SHARED_LIMITS.label + 1) }))).toContain("nameTooLong");
    expect(codes(draft({ balance: "", payment: "" }))).toEqual([]);
  });
  it("rejects malformed balance, payment and contributions", () => {
    expect(codes(draft({ balance: "abc" }))).toContain("balanceInvalid");
    expect(codes(draft({ balance: "1.234" }))).toContain("balanceInvalid");
    expect(codes(draft({ payment: "-5" }))).toContain("paymentInvalid");
    expect(codes(draft({ me: "x" }))).toContain("meInvalid");
    expect(codes(draft({ partner: "1,5" }))).toContain("partnerInvalid");
  });
  it("shares are checked against the monthly PAYMENT, never the balance", () => {
    expect(codes(draft({ me: "1000", partner: "500" }))).toContain("overAssigned"); // 1,500 > 1,400 payment (balance is 250,000)
    expect(codes(draft({ me: "1000", partner: "400" }))).toEqual([]);
  });
  it("with an unknown payment, shares are kept as stated (nothing to compare with)", () => {
    expect(codes(draft({ payment: "", me: "5000", partner: "5000" }))).toEqual([]);
    expect(built(draft({ payment: "", me: "5000" })).contributions.me).toBe(5000);
  });
  it("new debts get fresh ids; edited ones keep theirs; links are limited", () => {
    expect(built(draft()).id).not.toBe(built(draft()).id);
    expect(built(draft({ id: "keep" })).id).toBe("keep");
    const many = Array.from({ length: SHARED_LIMITS.linksPerItem + 1 }, (_, i) => ({ kind: "account" as const, id: "a" + i }));
    expect(codes(draft({ links: many }))).toContain("tooManyLinks");
  });
});

describe("live assignment is of the monthly payment", () => {
  it("none stated: the whole payment is not yet assigned (not split)", () => {
    expect(liveDebtAllocation(draft(), true)).toMatchObject({ status: "unassigned", unassignedCents: 140000, totalCents: 140000 });
  });
  it("partly stated: an explicit remainder", () => {
    expect(liveDebtAllocation(draft({ me: "700" }), true)).toMatchObject({ status: "partial", meCents: 70000, unassignedCents: 70000 });
  });
  it("fully stated is assigned; a blank or invalid payment gives no live figure", () => {
    expect(liveDebtAllocation(draft({ me: "700", partner: "700" }), true)).toMatchObject({ status: "assigned", unassignedCents: 0 });
    expect(liveDebtAllocation(draft({ payment: "" }), true)).toBeNull();
    expect(liveDebtAllocation(draft({ payment: "x" }), true)).toBeNull();
  });
  it("a $0 payment is a real payment: nothing to assign", () => {
    expect(liveDebtAllocation(draft({ payment: "0" }), true)).toMatchObject({ status: "assigned", totalCents: 0 });
  });
});

describe("shortcuts use the payment, never the balance", () => {
  it("Me covers all / Partner covers all / Clear", () => {
    expect(applyDebtShortcut(draft(), "me", true)).toMatchObject({ me: "1400", partner: "0", balance: "250000" });
    expect(applyDebtShortcut(draft(), "partner", true)).toMatchObject({ me: "0", partner: "1400", balance: "250000" });
    expect(applyDebtShortcut(draft({ me: "5", partner: "0" }), "clear", true)).toMatchObject({ me: "", partner: "" });
    expect(applyDebtShortcut(draft(), "me", false)).toMatchObject({ me: "1400", partner: "" });
  });
  it("needs a usable payment first (a blank payment changes nothing, even with a balance entered)", () => {
    const d = draft({ payment: "" });
    expect(applyDebtShortcut(d, "me", true)).toBe(d);
  });
  it("a suggestion only fills an empty box", () => {
    expect(withDebtSuggestion(draft(), "me", 30000).me).toBe("300");
    const typed = draft({ me: "10" });
    expect(withDebtSuggestion(typed, "me", 30000)).toBe(typed);
    expect(withDebtSuggestion(draft({ partner: "0" }), "partner", 30000).partner).toBe("0");
  });
});

describe("link candidates: listed, never applied", () => {
  const debt = (over: Partial<DebtEntry> = {}): DebtEntry => ({ id: "pd1", name: "Car loan", balance: 9000, monthlyPayment: 300, basis: "actual", accountId: null, ...over });
  const profile = (debts: DebtEntry[]): FinancialProfile => ({ ...emptyProfile(), debts });
  const account = (): PaymentAccount => ({ id: "a1", name: "Visa", balance: 900, minimumPayment: 35, dueDay: 15, remindDaysBefore: 3, lastReminderDueDate: null, createdAt: "x", balanceMode: "auto" });
  it("lists the user's Payments accounts and each person's planner debts", () => {
    const list = debtLinkCandidates({ me: profile([debt()]), partner: profile([debt({ id: "pd2", name: "Student loan", monthlyPayment: null, balance: null })]), accounts: [account()] });
    expect(list.map((c) => c.key)).toEqual(["account|a1", "personalDebt|me|pd1", "personalDebt|partner|pd2"]);
    expect(list[0]).toMatchObject({ amountCents: 3500, balanceCents: 90000 });
    expect(list[2]).toMatchObject({ amountCents: null, balanceCents: null });
  });
  it("a matching name creates no link; only toggleDebtLink does, and it is reversible and non-mutating", () => {
    const d = draft({ name: "Car loan" });
    const cands = debtLinkCandidates({ me: profile([debt()]), partner: null, accounts: [] });
    expect(cands.some((c) => c.name === "Car loan")).toBe(true);
    expect(checkDebtDraft(d, { hasPartner: false }).debt!.links).toEqual([]);
    const base = Object.freeze([]) as unknown as DebtDraft["links"];
    const on = toggleDebtLink(base, { kind: "personalDebt", person: "me", debtId: "pd1" });
    expect(on).toEqual([{ kind: "personalDebt", person: "me", debtId: "pd1" }]);
    expect(toggleDebtLink(on, { kind: "personalDebt", person: "me", debtId: "pd1" })).toEqual([]);
  });
  it("the originals are not modified by listing", () => {
    const me = profile([debt()]);
    const acc = account();
    const before = JSON.stringify([me, acc]);
    debtLinkCandidates({ me, partner: null, accounts: [acc] });
    expect(JSON.stringify([me, acc])).toBe(before);
  });
});

describe("upsertDebt", () => {
  const d = (id: string, name = id): SharedDebt => ({ id, name, balance: null, monthlyPayment: null, basis: "actual", contributions: { me: null, partner: null }, links: [] });
  it("replaces in place or appends, leaving the others untouched", () => {
    const list = [d("a"), d("b")];
    expect(upsertDebt(list, d("b", "B2")).map((x) => x.name)).toEqual(["a", "B2"]);
    expect(upsertDebt(list, d("c")).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(list.map((x) => x.name)).toEqual(["a", "b"]);
  });
});

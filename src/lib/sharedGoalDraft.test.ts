import { describe, it, expect } from "vitest";
import { goalProgress, type SharedGoal } from "./householdPlan";
import { SHARED_LIMITS } from "./householdShared";
import { checkGoalDraft, emptyGoalDraft, goalPercent, goalToDraft, goalTone, upsertGoal, type GoalDraft } from "./sharedGoalDraft";

const draft = (over: Partial<GoalDraft> = {}): GoalDraft => ({ ...emptyGoalDraft(), name: "Vacation", ...over });
const codes = (d: GoalDraft, hasPartner = true) => checkGoalDraft(d, { hasPartner }).errors.map((e) => e.code);
const built = (d: GoalDraft, hasPartner = true) => checkGoalDraft(d, { hasPartner }).goal!;

describe("unanswered is null; a typed 0 is a real 0", () => {
  it("only a name is required: target, date, saved and contributions may all be unanswered", () => {
    const g = built(draft());
    expect(g).toMatchObject({ name: "Vacation", targetAmount: null, targetDate: null, savedAmount: null, contributions: { me: null, partner: null }, countedInSavings: { me: false, partner: false } });
  });
  it("amount saved: blank -> null, 0 -> 0", () => {
    expect(built(draft({ saved: "" })).savedAmount).toBeNull();
    expect(built(draft({ saved: "0" })).savedAmount).toBe(0);
    expect(built(draft({ saved: "0.00" })).savedAmount).toBe(0);
  });
  it("contributions: blank -> null (not stated), 0 -> 0 (plans nothing)", () => {
    expect(built(draft({ me: "", partner: "0" })).contributions).toEqual({ me: null, partner: 0 });
    expect(built(draft({ me: "0", partner: "" })).contributions).toEqual({ me: 0, partner: null });
  });
  it("without a partner the partner box is ignored", () => {
    expect(built(draft({ me: "100", partner: "50", partnerCounted: true }), false)).toMatchObject({ contributions: { me: 100, partner: null }, countedInSavings: { partner: false } });
  });
  it("a target of 0 is refused (there is no such goal); blank means no target yet", () => {
    expect(codes(draft({ target: "0" }))).toContain("targetZero");
    expect(built(draft({ target: "" })).targetAmount).toBeNull();
    expect(built(draft({ target: "12000" })).targetAmount).toBe(12000);
  });
  it("editing round-trips every field, nulls and zeros included", () => {
    const g: SharedGoal = { id: "g1", name: "House", targetAmount: 12000, targetDate: "2027-11-04", savedAmount: 0, contributions: { me: 0, partner: null }, countedInSavings: { me: false, partner: false } };
    const form = goalToDraft(g);
    expect(form).toMatchObject({ id: "g1", target: "12000", date: "2027-11-04", saved: "0", me: "0", partner: "" });
    expect(checkGoalDraft(form, { hasPartner: true }).goal).toEqual(g);
  });
});

describe("validation", () => {
  it("name length and money formats", () => {
    expect(codes(draft({ name: " " }))).toContain("nameRequired");
    expect(codes(draft({ name: "x".repeat(SHARED_LIMITS.label + 1) }))).toContain("nameTooLong");
    expect(codes(draft({ target: "abc" }))).toContain("targetInvalid");
    expect(codes(draft({ target: "1.234" }))).toContain("targetInvalid");
    expect(codes(draft({ saved: "-5" }))).toContain("savedInvalid");
    expect(codes(draft({ me: "x" }))).toContain("meInvalid");
    expect(codes(draft({ partner: "1,5" }))).toContain("partnerInvalid");
  });
  it("dates must be real calendar dates (or empty)", () => {
    expect(codes(draft({ date: "2027-02-30" }))).toContain("dateInvalid");
    expect(codes(draft({ date: "11/04/2027" }))).toContain("dateInvalid");
    expect(codes(draft({ date: "2027-13-01" }))).toContain("dateInvalid");
    expect(codes(draft({ date: "" }))).toEqual([]);
    expect(built(draft({ date: "2027-11-04" })).targetDate).toBe("2027-11-04");
    expect(built(draft({ date: "2024-02-29" })).targetDate).toBe("2024-02-29"); // a real leap day
  });
  it("a past date is allowed (the plan reports it as past due)", () => {
    expect(codes(draft({ date: "2020-01-01" }))).toEqual([]);
  });
  it("planned contributions are not capped by the target (they are a monthly plan, not a share of a total)", () => {
    expect(codes(draft({ target: "100", me: "5000", partner: "5000" }))).toEqual([]);
  });
  it("new goals get fresh ids; edited ones keep theirs", () => {
    expect(built(draft()).id).not.toBe(built(draft()).id);
    expect(built(draft({ id: "keep" })).id).toBe("keep");
  });
});

describe("'already part of their monthly savings' (countedInSavings)", () => {
  it("is kept only for a person who actually plans to contribute more than $0", () => {
    expect(built(draft({ me: "500", meCounted: true })).countedInSavings.me).toBe(true);
    expect(built(draft({ me: "", meCounted: true })).countedInSavings.me).toBe(false);
    expect(built(draft({ me: "0", meCounted: true })).countedInSavings.me).toBe(false);
    expect(built(draft({ partner: "300", partnerCounted: true })).countedInSavings.partner).toBe(true);
  });
  it("is never inferred: ticking nothing leaves both false", () => {
    expect(built(draft({ me: "500", partner: "300" })).countedInSavings).toEqual({ me: false, partner: false });
  });
});

describe("progress and tone (display only; the status itself comes from goalProgress)", () => {
  it("goalPercent needs both amounts and a positive target, and is capped at 100", () => {
    expect(goalPercent({ targetAmount: 12000, savedAmount: 3000 })).toBe(25);
    expect(goalPercent({ targetAmount: 12000, savedAmount: 0 })).toBe(0);
    expect(goalPercent({ targetAmount: 12000, savedAmount: 99999 })).toBe(100);
    expect(goalPercent({ targetAmount: 3, savedAmount: 1 })).toBe(33);
    expect(goalPercent({ targetAmount: null, savedAmount: 5 })).toBeNull();
    expect(goalPercent({ targetAmount: 100, savedAmount: null })).toBeNull();
    expect(goalPercent({ targetAmount: 0, savedAmount: 0 })).toBeNull();
  });
  it("goalTone groups every status", () => {
    expect(["achieved", "onTrack"].map((s) => goalTone(s as never))).toEqual(["complete", "complete"]);
    expect(["noTarget", "noDate"].map((s) => goalTone(s as never))).toEqual(["todo", "todo"]);
    expect(["pastDue", "noContributions", "short"].map((s) => goalTone(s as never))).toEqual(["partial", "partial", "partial"]);
  });
  it("a built goal feeds the existing goal calculation: calendar months, required per month, status", () => {
    const g = built(draft({ target: "12000", saved: "2000", date: "2027-11-04", me: "500", partner: "300" }));
    expect(goalProgress(g, "2026-11-04", 80000)).toMatchObject({ status: "short", monthsLeft: 12, requiredMonthlyCents: 83334, shortByMonthlyCents: 3334 });
    expect(goalProgress(built(draft({ target: "12000", saved: "2000", date: "2027-11-04", me: "900" })), "2026-11-04", 90000).status).toBe("onTrack");
    expect(goalProgress(built(draft({ target: "100", date: "2026-11-28" })), "2026-11-04", 0)).toMatchObject({ status: "noContributions", monthsLeft: 1 });
    expect(goalProgress(built(draft({ target: "100", date: "2026-10-01" })), "2026-11-04", 0).status).toBe("pastDue");
    expect(goalProgress(built(draft({ target: "100", saved: "100" })), "2026-11-04", 0).status).toBe("achieved");
    expect(goalProgress(built(draft()), "2026-11-04", 0).status).toBe("noTarget");
    expect(goalProgress(built(draft({ target: "100" })), "2026-11-04", 0).status).toBe("noDate");
  });
});

describe("upsertGoal", () => {
  const g = (id: string, name = id): SharedGoal => ({ id, name, targetAmount: null, targetDate: null, savedAmount: null, contributions: { me: null, partner: null }, countedInSavings: { me: false, partner: false } });
  it("replaces in place or appends, leaving the others untouched; several goals are separate entries", () => {
    const list = [g("a"), g("b")];
    expect(upsertGoal(list, g("b", "B2")).map((x) => x.name)).toEqual(["a", "B2"]);
    expect(upsertGoal(list, g("c")).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(list.map((x) => x.name)).toEqual(["a", "b"]);
  });
});

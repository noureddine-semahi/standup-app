import { describe, it, expect } from "vitest";
import { DEFAULT_PARTNER_NAME, MAX_PARTNER_NAME, parsePartnerName } from "./household";
import { emptyProfile, profileCompletion, stepStatus } from "./financialPlanner";

describe("parsePartnerName", () => {
  it("trims, and a blank name means the default", () => {
    expect(parsePartnerName("  Alex ")).toEqual({ ok: true, name: "Alex" });
    expect(parsePartnerName("")).toEqual({ ok: true, name: DEFAULT_PARTNER_NAME });
    expect(parsePartnerName("   ")).toEqual({ ok: true, name: "Partner" });
  });
  it("rejects names longer than the database allows", () => {
    expect(parsePartnerName("x".repeat(MAX_PARTNER_NAME)).ok).toBe(true);
    expect(parsePartnerName("x".repeat(MAX_PARTNER_NAME + 1))).toEqual({ ok: false, error: "tooLong" });
  });
});

describe("a partner's step progress", () => {
  it("is tracked on their own profile, independent of anyone else's", () => {
    const partner = { ...emptyProfile(), payFrequency: "monthly" as const, takeHome: 2000 };
    const me = emptyProfile();
    expect(stepStatus(partner, 1, "partner")).toBe("complete");
    expect(stepStatus(me, 1)).toBe("todo");
    expect(profileCompletion(partner, "partner").completeCount).toBe(1);
    expect(profileCompletion(me).completeCount).toBe(0);
  });
  it("'Location' is complete for a partner once a country or region is given (they have no household-size answer)", () => {
    expect(stepStatus(emptyProfile(), 2, "partner")).toBe("todo");
    expect(stepStatus({ ...emptyProfile(), region: "TX" }, 2, "partner")).toBe("complete");
    expect(stepStatus({ ...emptyProfile(), country: "US" }, 2, "partner")).toBe("complete");
    expect(stepStatus({ ...emptyProfile(), skippedSteps: [2] }, 2, "partner")).toBe("skipped");
  });
  it("personal behavior is unchanged: Location still needs the household size", () => {
    expect(stepStatus({ ...emptyProfile(), region: "TX" }, 2)).toBe("partial");
    expect(stepStatus({ ...emptyProfile(), region: "TX" }, 2, "me")).toBe("partial");
    expect(stepStatus({ ...emptyProfile(), adults: 2 }, 2)).toBe("complete");
  });
});

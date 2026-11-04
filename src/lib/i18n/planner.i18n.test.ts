import { describe, it, expect } from "vitest";
import { en } from "./en";
import { es } from "./es";

const E = en as Record<string, string>;
const S = es as Record<string, string>;
const keys = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("plan.") || k === "backlog.tabPlanner" || k === "tools.descPlanner");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Planner strings (English / Spanish)", () => {
  it("every Planner key exists in both languages and none is empty", () => {
    const ek = keys(E).sort();
    expect(ek.length).toBeGreaterThan(130);
    expect(keys(S).sort()).toEqual(ek);
    for (const k of ek) {
      expect(E[k].trim().length, "en " + k).toBeGreaterThan(0);
      expect(S[k].trim().length, "es " + k).toBeGreaterThan(0);
    }
  });

  it("placeholders match between languages so no value is dropped", () => {
    for (const k of keys(E)) expect(placeholders(S[k]), k).toEqual(placeholders(E[k]));
  });

  it("the Spanish is actually translated where it should differ", () => {
    for (const k of ["plan.title", "plan.setup", "plan.tileIncome", "plan.statusComplete", "plan.s3Help", "plan.errMoney", "plan.sourcesTitle", "backlog.tabPlanner"]) {
      expect(S[k], k).not.toBe(E[k]);
    }
  });

  it("covers every step, status, error and missing-data message the screen can show", () => {
    const required = [
      ...[1, 2, 3, 4, 5].map((n) => `plan.stepName${n}`),
      "plan.statusComplete", "plan.statusPartial", "plan.statusSkipped", "plan.statusTodo",
      "plan.errMoney", "plan.errNegative", "plan.errRange", "plan.errRequired", "plan.errTooLong", "plan.errFrequency", "plan.errLow", "plan.errInteger", "plan.errNumRange", "plan.errDate", "plan.errTooMany",
      "plan.missingIncome", "plan.missingExpenses", "plan.missingObligations", "plan.missingSubscriptions", "plan.missingBillAmounts", "plan.missingSubscriptionPrices", "plan.missingDebtPayments",
      "plan.incompleteBanner", "plan.unavailable", "plan.freqIrregular", "plan.basisEstimate", "plan.basisActual",
    ];
    for (const k of required) {
      expect(E[k], "en " + k).toBeTruthy();
      expect(S[k], "es " + k).toBeTruthy();
    }
  });

  it("the income step labels exist in both languages ('Income type' replaces 'This figure is' on that step)", () => {
    expect(E["plan.incomeType"]).toBe("Income type");
    expect(S["plan.incomeType"]).toBe("Tipo de ingreso");
    for (const k of ["plan.incomeActual", "plan.incomeEstimate", "plan.takeHomeGeneric", "plan.amountHint", "plan.errChooseFrequency", "plan.errEnterAmount"]) {
      expect(E[k], "en " + k).toBeTruthy();
      expect(S[k], "es " + k).toBeTruthy();
    }
  });

  it("the step 3 / step 4 refinement strings exist in both languages", () => {
    expect(E["plan.totalPartial"]).toBe("Partial total");
    expect(S["plan.totalPartial"]).toBe("Total parcial");
    for (const k of ["plan.totalUnavailable", "plan.debtsEmpty", "plan.savingsHeading", "plan.savingsHint"]) {
      expect(E[k], "en " + k).toBeTruthy();
      expect(S[k], "es " + k).toBeTruthy();
      expect(S[k]).not.toBe(E[k]);
    }
  });

  it("the household / partner strings exist in both languages and are translated", () => {
    expect([E["plan.personMe"], E["plan.personPartner"], E["plan.personHousehold"]]).toEqual(["Me", "Partner", "Household"]);
    expect([S["plan.personMe"], S["plan.personPartner"], S["plan.personHousehold"]]).toEqual(["Yo", "Pareja", "Hogar"]);
    for (const k of ["plan.peopleLabel", "plan.partnerEmptyTitle", "plan.partnerEmptyBody", "plan.partnerAdd", "plan.partnerRemoveTitle", "plan.partnerRemoveBody", "plan.partnerUnavailable", "plan.partnerRecordsNote", "plan.householdTitle", "plan.householdSoon"]) {
      expect(E[k], "en " + k).toBeTruthy();
      expect(S[k], "es " + k).toBeTruthy();
      expect(S[k], k).not.toBe(E[k]);
    }
    expect(E["plan.householdSoon"]).toMatch(/nothing is combined/);
    expect(S["plan.householdSoon"]).toMatch(/no se combina nada/);
    expect(E["plan.partnerRemoveBody"]).toMatch(/not affected/);
  });

  it("a partner's step 2 is named 'Location' while Me keeps 'Location & household' (both languages)", () => {
    expect(E["plan.stepName2"]).toBe("Location & household");
    expect(E["plan.stepName2Partner"]).toBe("Location");
    expect(S["plan.stepName2"]).toBe("Ubicación y hogar");
    expect(S["plan.stepName2Partner"]).toBe("Ubicación");
  });

  it("says plainly that records are read-only, blanks are unknown, and balances are separate (both languages)", () => {
    expect(E["plan.sourcesHelp"]).toMatch(/never changes your Bills, Payments or Subscriptions/);
    expect(S["plan.sourcesHelp"]).toMatch(/nunca cambia/);
    expect(E["plan.s3Help"]).toMatch(/blank means unknown, not \$0/);
    expect(S["plan.s3Help"]).toMatch(/en blanco significa desconocido, no \$0/);
    expect(E["plan.s4Help"]).toMatch(/separate/);
    expect(S["plan.s4Help"]).toMatch(/separados/);
  });
});

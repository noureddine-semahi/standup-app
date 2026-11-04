import { describe, it, expect } from "vitest";
import { en } from "./en";
import { es } from "./es";

const keys = (dict: Record<string, string>) => Object.keys(dict).filter((k) => k.startsWith("subs.") || k.startsWith("unsub.") || k === "pay.sectionTitle");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("subscription strings (English / Spanish)", () => {
  it("every Subscriptions key exists in both languages", () => {
    const enKeys = keys(en as Record<string, string>).sort();
    const esKeys = keys(es as Record<string, string>).sort();
    expect(enKeys.length).toBeGreaterThan(100);
    expect(esKeys).toEqual(enKeys);
  });

  it("no string is empty, and Spanish isn't just a copy of English where it should differ", () => {
    for (const k of keys(en as Record<string, string>)) {
      expect((en as Record<string, string>)[k].trim().length, "en " + k).toBeGreaterThan(0);
      expect((es as Record<string, string>)[k].trim().length, "es " + k).toBeGreaterThan(0);
    }
    for (const k of ["subs.title", "subs.subtitle", "subs.add", "subs.monthlyCost", "subs.statusActive", "subs.cancelBody", "subs.empty"]) {
      expect((es as Record<string, string>)[k]).not.toBe((en as Record<string, string>)[k]);
    }
  });

  it("placeholders ({date}, {amount}, {name}, ...) match between languages, so no value is dropped", () => {
    for (const k of keys(en as Record<string, string>)) {
      expect(placeholders((es as Record<string, string>)[k]), k).toEqual(placeholders((en as Record<string, string>)[k]));
    }
  });

  it("covers statuses, frequencies, summary labels, forms, validation, confirmations, reminders and empty states", () => {
    const required = [
      "subs.statusActive", "subs.statusTrial", "subs.statusPaused", "subs.statusCanceled",
      "subs.freqWeekly", "subs.freqMonthly", "subs.freqQuarterly", "subs.freqYearly", "subs.freqCustom",
      "subs.monthlyCost", "subs.yearlyEstimate", "subs.activeCount", "subs.upcomingRenewals",
      "subs.fieldName", "subs.fieldAmount", "subs.fieldNextBilling", "subs.fieldTrialEnds", "subs.fieldRemind",
      "subs.errFirstCharge", "subs.errStartAfter", "subs.errInterval",
      "subs.cancelBody", "subs.deleteBody", "subs.reverseBody",
      "subs.renewsInDays", "subs.trialEndsInDays", "subs.projectedNote",
      "subs.empty", "subs.unavailable",
    ];
    for (const k of required) {
      expect((en as Record<string, string>)[k], "en " + k).toBeTruthy();
      expect((es as Record<string, string>)[k], "es " + k).toBeTruthy();
    }
  });

  it("Unsubscribe Me never claims a cancellation is provider-confirmed unless it is, in both languages", () => {
    for (const dict of [en, es] as Record<string, string>[]) {
      expect(dict["unsub.badgeReported"]).toMatch(/{date}/);
      expect(dict["unsub.badgeConfirmed"]).not.toBe(dict["unsub.badgeReported"]);
    }
    expect((en as Record<string, string>)["unsub.badgeReported"]).toMatch(/Not confirmed by the provider/);
    expect((es as Record<string, string>)["unsub.badgeReported"]).toMatch(/No confirmada por el proveedor/);
    expect((en as Record<string, string>)["unsub.savingsNote"]).toMatch(/not money already saved/);
    expect((es as Record<string, string>)["unsub.savingsNote"]).toMatch(/No es dinero ya ahorrado/);
  });

  it("the cancel confirmation makes clear it only updates StandUp's tracking, in both languages", () => {
    expect((en as Record<string, string>)["subs.cancelBody"]).toMatch(/does not cancel the subscription with the provider/);
    expect((es as Record<string, string>)["subs.cancelBody"]).toMatch(/No cancela la suscripción con el proveedor/);
  });
});

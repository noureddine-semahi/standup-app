import { describe, it, expect } from "vitest";
import { checkoutErrorMessageKey } from "./checkoutMessages";
import { en } from "./i18n/en";
import { es } from "./i18n/es";

describe("checkout refusal messages", () => {
  it("maps each endpoint error to its message", () => {
    expect(checkoutErrorMessageKey("already_subscribed")).toBe("checkout.alreadySubscribed");
    expect(checkoutErrorMessageKey("checkout_in_progress")).toBe("checkout.inProgress");
    expect(checkoutErrorMessageKey("checkout_disabled")).toBe("checkout.unavailable");
    expect(checkoutErrorMessageKey("billing_unavailable")).toBe("checkout.unavailable");
    for (const code of ["checkout_failed", "invalid_request", "forbidden_origin", "unauthenticated", "weird", "", null, undefined]) expect(checkoutErrorMessageKey(code)).toBe("checkout.failed");
  });
  it("every message exists in English and Spanish, and the duplicate-subscription ones say what to do and where to look", () => {
    for (const key of ["checkout.alreadySubscribed", "checkout.inProgress", "checkout.unavailable", "checkout.failed"] as const) {
      expect(en[key].length).toBeGreaterThan(10);
      expect(es[key].length).toBeGreaterThan(10);
      expect(es[key]).not.toBe(en[key]);
    }
    expect(en["checkout.alreadySubscribed"]).toContain("Settings");
    expect(es["checkout.alreadySubscribed"]).toContain("Ajustes");
    expect(en["checkout.inProgress"]).toContain("try again");
  });
  it("shows no Stripe wording or identifiers", () => {
    for (const key of ["checkout.alreadySubscribed", "checkout.inProgress", "checkout.unavailable", "checkout.failed"] as const) {
      expect(en[key] + es[key]).not.toMatch(/stripe|cus_|sub_|cs_|session/i);
    }
  });
});

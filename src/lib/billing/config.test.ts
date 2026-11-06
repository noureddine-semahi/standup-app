import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { BillingConfigError, STRIPE_ENV, isBillingConfigured, priceIdFor, readBillingConfig } from "./config";
import { BILLING_PLANS, PLAN_TERMS, isBillingPlan } from "./plans";
import { createStripeClient, getStripe, resetStripeClientForTests } from "./stripe";

const good = {
  STRIPE_SECRET_KEY: "sk_test_abc123DEF456",
  STRIPE_PRICE_MONTHLY: "price_monthly123",
  STRIPE_PRICE_ANNUAL: "price_annual456",
};

const problemsOf = (env: Record<string, string | undefined>) => {
  try {
    readBillingConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(BillingConfigError);
    return (e as BillingConfigError).problems;
  }
  throw new Error("expected a BillingConfigError");
};

describe("plans", () => {
  it("are monthly $5.99 and annual $49.99, from the same prices the Settings screen shows", () => {
    expect(BILLING_PLANS).toEqual(["monthly", "annual"]);
    expect(PLAN_TERMS.monthly).toEqual({ interval: "month", amountCents: 599 });
    expect(PLAN_TERMS.annual).toEqual({ interval: "year", amountCents: 4999 });
    expect(isBillingPlan("annual")).toBe(true);
    expect(isBillingPlan("lifetime")).toBe(false);
  });
});

describe("readBillingConfig", () => {
  it("accepts a test-mode setup and returns it typed, in test mode, with the Price ID for each plan", () => {
    const c = readBillingConfig(good);
    expect(c.mode).toBe("test");
    expect(c.secretKey).toBe(good.STRIPE_SECRET_KEY);
    expect(priceIdFor("monthly", c)).toBe("price_monthly123");
    expect(priceIdFor("annual", c)).toBe("price_annual456");
    expect(c.webhookSecret).toBeNull();
  });
  it("accepts restricted test keys and an optional webhook secret, and trims whitespace", () => {
    const c = readBillingConfig({ ...good, STRIPE_SECRET_KEY: "  rk_test_xyz789 ", STRIPE_WEBHOOK_SECRET: " whsec_abc123 " });
    expect(c.secretKey).toBe("rk_test_xyz789");
    expect(c.webhookSecret).toBe("whsec_abc123");
  });
  it("lists every missing variable by name", () => {
    expect(problemsOf({})).toEqual([`${STRIPE_ENV.secretKey} is missing`, `${STRIPE_ENV.prices.monthly} is missing`, `${STRIPE_ENV.prices.annual} is missing`]);
    expect(problemsOf({ ...good, STRIPE_PRICE_ANNUAL: "  " })).toEqual([`${STRIPE_ENV.prices.annual} is missing`]);
  });
  it("refuses a live key (test mode only for now), whatever else is right", () => {
    for (const k of ["sk_live_REALSECRET123", "rk_live_REALSECRET123"]) {
      expect(problemsOf({ ...good, STRIPE_SECRET_KEY: k })[0]).toContain("live key");
    }
  });
  it("refuses things that aren't Stripe secret keys, Price IDs or webhook secrets", () => {
    expect(problemsOf({ ...good, STRIPE_SECRET_KEY: "pk_test_publishable" })[0]).toContain("test-mode secret key");
    expect(problemsOf({ ...good, STRIPE_PRICE_MONTHLY: "prod_123" })[0]).toContain("Price ID");
    expect(problemsOf({ ...good, STRIPE_WEBHOOK_SECRET: "nope" })[0]).toContain("whsec_");
  });
  it("refuses the same Price for both plans", () => {
    expect(problemsOf({ ...good, STRIPE_PRICE_ANNUAL: good.STRIPE_PRICE_MONTHLY })[0]).toContain("must be different");
  });
  it("never puts a secret value in an error message", () => {
    const secrets = ["sk_live_REALSECRET123", "pk_test_publishable", "price_dup999", "nope-whsec-VALUE"];
    for (const env of [
      { ...good, STRIPE_SECRET_KEY: secrets[0] },
      { ...good, STRIPE_SECRET_KEY: secrets[1] },
      { ...good, STRIPE_PRICE_MONTHLY: secrets[2], STRIPE_PRICE_ANNUAL: secrets[2] },
      { ...good, STRIPE_WEBHOOK_SECRET: secrets[3] },
    ]) {
      try {
        readBillingConfig(env);
      } catch (e) {
        for (const s of secrets) expect((e as Error).message).not.toContain(s);
      }
    }
  });
  it("isBillingConfigured is a plain yes/no that never throws", () => {
    expect(isBillingConfigured(good)).toBe(true);
    expect(isBillingConfigured({})).toBe(false);
    expect(isBillingConfigured({ ...good, STRIPE_SECRET_KEY: "sk_live_x" })).toBe(false);
  });
});

describe("Stripe client", () => {
  beforeEach(() => resetStripeClientForTests());
  afterEach(() => {
    vi.unstubAllEnvs();
    resetStripeClientForTests();
  });

  it("is built from the validated config without contacting Stripe", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const s = createStripeClient(readBillingConfig(good));
    expect(typeof s.checkout.sessions.create).toBe("function");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("getStripe refuses to start without configuration, naming the variables", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "");
    vi.stubEnv("STRIPE_PRICE_ANNUAL", "");
    expect(() => getStripe()).toThrow(BillingConfigError);
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY is missing/);
  });
  it("getStripe reuses one client", () => {
    for (const [k, v] of Object.entries(good)) vi.stubEnv(k, v);
    expect(getStripe()).toBe(getStripe());
  });
});

import { readWebhookConfig } from "./config";

describe("readWebhookConfig", () => {
  const ok = { STRIPE_SECRET_KEY: "sk_test_abc123DEF456", STRIPE_WEBHOOK_SECRET: "whsec_abc123def" };
  const problems = (env: Record<string, string | undefined>) => {
    try {
      readWebhookConfig(env);
    } catch (e) {
      return (e as BillingConfigError).problems;
    }
    throw new Error("expected a BillingConfigError");
  };
  it("needs only the test secret key and the signing secret: no Price IDs", () => {
    expect(readWebhookConfig(ok)).toEqual({ secretKey: "sk_test_abc123DEF456", webhookSecret: "whsec_abc123def" });
  });
  it("a missing or malformed webhook secret fails, naming the variable and never the value", () => {
    expect(problems({ STRIPE_SECRET_KEY: ok.STRIPE_SECRET_KEY })).toEqual(["STRIPE_WEBHOOK_SECRET is missing"]);
    expect(problems({ ...ok, STRIPE_WEBHOOK_SECRET: "not-a-whsec-VALUE" })[0]).toContain("whsec_");
    try {
      readWebhookConfig({ ...ok, STRIPE_WEBHOOK_SECRET: "not-a-whsec-VALUE" });
    } catch (e) {
      expect((e as Error).message).not.toContain("not-a-whsec-VALUE");
    }
  });
  it("refuses a live key or a missing key", () => {
    expect(problems({ ...ok, STRIPE_SECRET_KEY: "sk_live_REAL" })[0]).toContain("live key");
    expect(problems({ STRIPE_WEBHOOK_SECRET: ok.STRIPE_WEBHOOK_SECRET })).toEqual(["STRIPE_SECRET_KEY is missing"]);
  });
});

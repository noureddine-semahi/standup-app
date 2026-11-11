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
    expect(readWebhookConfig(ok)).toEqual({ mode: "test", secretKey: "sk_test_abc123DEF456", webhookSecret: "whsec_abc123def" });
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

describe("live mode is an explicit opt-in (STRIPE_MODE=live) and is kept strictly apart from test mode", () => {
  const prices = { STRIPE_PRICE_MONTHLY: "price_monthly123", STRIPE_PRICE_ANNUAL: "price_annual456" };
  const live = { STRIPE_MODE: "live", STRIPE_SECRET_KEY: "rk_live_RestrictedKey789", ...prices };
  const whsec = { STRIPE_WEBHOOK_SECRET: "whsec_abc123def" };
  const problems = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(BillingConfigError);
      return (e as BillingConfigError).problems;
    }
    throw new Error("expected a BillingConfigError");
  };

  it("sandbox behaviour is unchanged: no STRIPE_MODE (or STRIPE_MODE=test) means test mode with a test key", () => {
    expect(readBillingConfig(good).mode).toBe("test");
    expect(readBillingConfig({ ...good, STRIPE_MODE: "test" }).mode).toBe("test");
    expect(readBillingConfig({ ...good, STRIPE_SECRET_KEY: "rk_test_abc123DEF456" }).mode).toBe("test");
    expect(readBillingConfig({ ...good, STRIPE_MODE: " test " }).mode).toBe("test");
  });
  it("accepts a RESTRICTED live key only when STRIPE_MODE is exactly live", () => {
    expect(readBillingConfig(live)).toEqual({ mode: "live", secretKey: "rk_live_RestrictedKey789", prices: { monthly: "price_monthly123", annual: "price_annual456" }, webhookSecret: null });
    expect(readBillingConfig({ ...live, STRIPE_MODE: " live " }).mode).toBe("live");
    expect(isBillingConfigured(live)).toBe(true);
  });
  it("a live key without the explicit opt-in is refused (absent or test STRIPE_MODE): live billing can't switch on by accident", () => {
    for (const mode of [undefined, "test"]) {
      const p = problems(() => readBillingConfig({ ...live, STRIPE_MODE: mode }));
      expect(p).toHaveLength(1);
      expect(p[0]).toContain("is a live key");
      expect(p[0]).toContain("STRIPE_MODE");
    }
    expect(isBillingConfigured({ ...live, STRIPE_MODE: undefined })).toBe(false);
  });
  it("live mode refuses a full live secret key, a test key, a publishable key and a missing key", () => {
    expect(problems(() => readBillingConfig({ ...live, STRIPE_SECRET_KEY: "sk_live_FullSecret123" }))[0]).toContain("restricted key (rk_live_");
    expect(problems(() => readBillingConfig({ ...live, STRIPE_SECRET_KEY: "sk_test_abc123DEF456" }))[0]).toContain("test key");
    expect(problems(() => readBillingConfig({ ...live, STRIPE_SECRET_KEY: "rk_test_abc123DEF456" }))[0]).toContain("must match");
    expect(problems(() => readBillingConfig({ ...live, STRIPE_SECRET_KEY: "pk_live_Publishable1" }))[0]).toContain("restricted live key");
    expect(problems(() => readBillingConfig({ ...live, STRIPE_SECRET_KEY: "rk_live_" }))[0]).toContain("restricted live key");
    expect(problems(() => readBillingConfig({ ...live, STRIPE_SECRET_KEY: undefined }))).toEqual(["STRIPE_SECRET_KEY is missing"]);
  });
  it("any STRIPE_MODE other than test or live is a problem, never silently treated as live", () => {
    for (const v of ["LIVE", "production", "1", "true", "live-mode"]) {
      expect(problems(() => readBillingConfig({ ...live, STRIPE_MODE: v })).some((x) => x.includes('STRIPE_MODE must be "test" or "live"'))).toBe(true);
    }
    expect(problems(() => readBillingConfig({ ...good, STRIPE_MODE: "production" }))).toEqual(['STRIPE_MODE must be "test" or "live"']);
  });
  it("live mode still needs both distinct Price IDs, and fails closed on anything missing", () => {
    expect(problems(() => readBillingConfig({ ...live, STRIPE_PRICE_ANNUAL: undefined }))).toEqual(["STRIPE_PRICE_ANNUAL is missing"]);
    expect(problems(() => readBillingConfig({ ...live, STRIPE_PRICE_ANNUAL: live.STRIPE_PRICE_MONTHLY }))[0]).toContain("must be different Prices");
    expect(problems(() => readBillingConfig({ STRIPE_MODE: "live" }))).toEqual(["STRIPE_SECRET_KEY is missing", "STRIPE_PRICE_MONTHLY is missing", "STRIPE_PRICE_ANNUAL is missing"]);
  });
  it("errors name variables only: no key, mode value or webhook secret ever appears in a message", () => {
    const secrets = ["sk_live_FullSecret123", "rk_live_RestrictedKey789", "sk_test_abc123DEF456", "whsec_LEAKCHECK123", "price_monthly123"];
    const envs: Record<string, string | undefined>[] = [{ ...live, STRIPE_SECRET_KEY: secrets[0] }, { ...live, STRIPE_SECRET_KEY: secrets[2] }, { ...good, STRIPE_SECRET_KEY: secrets[1] }, { ...live, STRIPE_WEBHOOK_SECRET: "not-whsec-LEAKCHECK123" }];
    for (const env of envs) {
      try {
        readBillingConfig(env);
        readWebhookConfig({ ...env, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET ?? "bad" });
      } catch (e) {
        for (const s of secrets) expect((e as Error).message).not.toContain(s);
      }
    }
  });
  it("the webhook configuration follows the same rules and reports the mode it validated", () => {
    expect(readWebhookConfig({ ...live, ...whsec })).toEqual({ mode: "live", secretKey: "rk_live_RestrictedKey789", webhookSecret: "whsec_abc123def" });
    expect(readWebhookConfig({ STRIPE_SECRET_KEY: "sk_test_abc123DEF456", ...whsec }).mode).toBe("test");
    expect(problems(() => readWebhookConfig({ ...live, STRIPE_MODE: undefined, ...whsec }))[0]).toContain("is a live key");
    expect(problems(() => readWebhookConfig({ ...live, STRIPE_SECRET_KEY: "sk_test_abc123DEF456", ...whsec }))[0]).toContain("must match");
    expect(problems(() => readWebhookConfig({ ...live, STRIPE_SECRET_KEY: "sk_live_FullSecret123", ...whsec }))[0]).toContain("restricted key");
    expect(problems(() => readWebhookConfig({ ...live }))).toEqual(["STRIPE_WEBHOOK_SECRET is missing"]);
  });
  it("the shared Stripe client is built only from a validated configuration, in either mode", () => {
    resetStripeClientForTests();
    for (const [k, v] of Object.entries(live)) vi.stubEnv(k, v);
    expect(getStripe()).toBeTruthy();
    resetStripeClientForTests();
    vi.stubEnv("STRIPE_MODE", "");
    expect(() => getStripe()).toThrow(BillingConfigError); // live key, no opt-in: refused
    vi.unstubAllEnvs();
    resetStripeClientForTests();
  });
});

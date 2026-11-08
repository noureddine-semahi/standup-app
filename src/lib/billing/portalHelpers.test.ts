import { describe, it, expect } from "vitest";
import { PRODUCTION_ORIGIN, portalReturnUrl, resolveTrustedOrigin } from "./origins";
import { PORTAL_SUBSCRIPTION_STATUSES, LIVE_SUBSCRIPTION_STATUSES, blocksNewCheckout, portalEligible } from "./subscriptionStates";

describe("portalEligible: which subscriptions have something to manage", () => {
  it("running, retried, uncollected and paused subscriptions can be managed", () => {
    for (const s of ["active", "trialing", "past_due", "unpaid", "paused"]) expect(portalEligible(s), s).toBe(true);
    expect([...PORTAL_SUBSCRIPTION_STATUSES]).toEqual(["active", "trialing", "past_due", "unpaid", "paused"]);
  });
  it("over, never started, missing or unrecognised subscriptions cannot (an allow-list: a new Stripe status stays closed)", () => {
    for (const s of ["canceled", "incomplete_expired", "incomplete", "something_new", "ACTIVE", "", null, undefined]) expect(portalEligible(s), String(s)).toBe(false);
  });
  it("is always a subset of the states that block a second Checkout, so nobody can both subscribe again and manage the old one", () => {
    for (const s of PORTAL_SUBSCRIPTION_STATUSES) {
      expect(blocksNewCheckout(s)).toBe(true);
      expect((LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(s)).toBe(true);
    }
  });
});

describe("portalReturnUrl", () => {
  it("is the trusted origin plus the fixed Settings path and marker", () => {
    expect(portalReturnUrl(PRODUCTION_ORIGIN)).toBe(`${PRODUCTION_ORIGIN}/standup/settings?portal=return`);
  });
  it("is only ever built from an origin that resolveTrustedOrigin accepted, so an external redirect cannot be produced", () => {
    const env = { NODE_ENV: "production" };
    for (const bad of ["https://evil.example", `${PRODUCTION_ORIGIN}.evil.example`, "javascript:alert(1)", "//evil.example"]) expect(resolveTrustedOrigin(bad, env)).toBeNull();
    expect(portalReturnUrl(resolveTrustedOrigin(PRODUCTION_ORIGIN, env)!)).toMatch(/^https:\/\/standup-app-two\.vercel\.app\/standup\/settings\?portal=return$/);
  });
});

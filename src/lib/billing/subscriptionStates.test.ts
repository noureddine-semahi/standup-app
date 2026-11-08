import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { ENDED_SUBSCRIPTION_STATUSES, LIVE_SUBSCRIPTION_STATUSES, blocksNewCheckout } from "./subscriptionStates";
import { BILLING_STATUS_POLICY } from "@/lib/billingEntitlement";

describe("which subscription states block a second subscription", () => {
  it("every live or still-recoverable state blocks: active, trialing, past_due, unpaid, incomplete, paused", () => {
    for (const s of ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]) expect(blocksNewCheckout(s)).toBe(true);
  });
  it("only a subscription that is over for good allows a new one: canceled and incomplete_expired", () => {
    for (const s of ["canceled", "incomplete_expired"]) expect(blocksNewCheckout(s)).toBe(false);
  });
  it("no record at all allows checkout; an empty or unknown status fails closed and blocks", () => {
    expect(blocksNewCheckout(null)).toBe(false);
    expect(blocksNewCheckout(undefined)).toBe(false);
    for (const s of ["", "something_new", "ACTIVE", "Canceled"]) expect(blocksNewCheckout(s)).toBe(s === "" ? false : true);
  });
  it("covers every Stripe status the billing policy knows about, with nothing left unclassified", () => {
    expect([...LIVE_SUBSCRIPTION_STATUSES, ...ENDED_SUBSCRIPTION_STATUSES].sort()).toEqual(Object.keys(BILLING_STATUS_POLICY).sort());
  });
  it("is deliberately STRICTER than Premium access: paused, unpaid and incomplete give no Premium but still block a second subscription", () => {
    for (const s of ["unpaid", "incomplete", "paused"]) {
      expect(BILLING_STATUS_POLICY[s as keyof typeof BILLING_STATUS_POLICY]).toBe("none");
      expect(blocksNewCheckout(s)).toBe(true);
    }
  });
  it("matches the database rule: begin_checkout_attempt lets only canceled / incomplete_expired through, and reads only subscription billing records", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const sql = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("_checkout_attempts.sql"))!), "utf8");
    expect(sql).toContain("v_status not in ('canceled', 'incomplete_expired')");
    expect(sql).toContain("from public.account_billing b where b.user_id = p_user_id");
    expect(sql).not.toMatch(/account_entitlements|account_trial_history/); // grants and trials are never consulted
    for (const s of ENDED_SUBSCRIPTION_STATUSES) expect(sql).toContain(`'${s}'`);
  });
});

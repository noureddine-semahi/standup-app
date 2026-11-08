import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { BILLING_PAST_DUE_GRACE_DAYS } from "./billingEntitlement";

// The status function runs in SQL, so this pins its scope, privacy and read-only nature by inspection (a live check runs separately).
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_billing_status.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("billing status migration", () => {
  it("sorts after the billing entitlement migration whose functions it reads", () => {
    expect(file > readdirSync(dir).find((f) => f.endsWith("_billing_entitlements.sql"))!).toBe(true);
  });

  it("is read-only: one function, no table, no write, no policy or flag change", () => {
    expect(code.match(/create or replace function/gi)).toHaveLength(1);
    expect(code).not.toMatch(/create table|alter table|drop\s|delete\s+from|truncate|create policy|create trigger/i);
    expect(code).not.toMatch(/\b(insert into|update)\s+public\./i);
    expect(code).not.toMatch(/feature_flags|admin_audit_log|account_trial_history|stripe_webhook_events/);
  });

  it("is scoped to the caller: no parameters, answers only for auth.uid(), signed-out gets a Free answer", () => {
    expect(code).toContain("create or replace function public.get_my_billing_status()");
    expect(code).toContain("v_uid uuid := auth.uid()");
    expect(code).toContain("where user_id = v_uid");
    expect(code).not.toMatch(/\bp_user_id\b|\bp_[a-z_]+\b/);
    expect(code).toContain("if v_uid is null then");
  });

  it("returns no identifier: no Stripe customer, subscription, price or event ID and no account ID", () => {
    const returns = code.slice(code.indexOf("returns table ("), code.indexOf(")", code.indexOf("r_trial_ends_at timestamptz")) + 1);
    expect(returns).not.toMatch(/customer|subscription_id|price|event|user_id|stripe/i);
    expect(code).not.toMatch(/stripe_customer_id|stripe_subscription_id|stripe_price_id|last_event_id/);
  });

  it("is security definer with a pinned search_path, executable by signed-in users only", () => {
    expect(code).toContain("security definer set search_path = public");
    expect(code).toContain("revoke all on function public.get_my_billing_status() from public, anon;");
    expect(code).toContain("grant execute on function public.get_my_billing_status() to authenticated;");
    expect(code).not.toMatch(/grant execute[^;]*\bto\s+(anon|public)\b/);
  });

  it("reuses the existing tier and billing rules rather than redefining them", () => {
    expect(code).toContain("v_access := public.account_effective_tier(v_uid)");
    expect(code).toContain("v_grants := public.billing_grants_premium(v_uid)");
    expect(code).not.toMatch(/'(active|trialing|unpaid|canceled|incomplete|paused)'/); // no status policy of its own
  });

  it("explains the source of Premium in the existing precedence order: Free, then admin grant, then subscription, then trial", () => {
    const c = code.slice(code.indexOf("v_source := case"));
    const iNone = c.indexOf("when v_access = 'free' then 'none'");
    const iManual = c.indexOf("when v_has_ent and v_ent.tier = 'premium' then 'manual'");
    const iSub = c.indexOf("when v_grants then 'subscription'");
    const iTrial = c.indexOf("else 'trial'");
    expect(iNone).toBeGreaterThan(-1);
    expect(iManual).toBeGreaterThan(iNone);
    expect(iSub).toBeGreaterThan(iManual);
    expect(iTrial).toBeGreaterThan(iSub);
  });

  it("reports whether the subscription itself grants Premium, separately from the member's access", () => {
    expect(code).toContain("r_subscription_grants_premium boolean");
    expect(code).toContain("r_access text");
    expect(code).toContain("r_access_source text");
  });

  it("the grace end uses the same 7 days as the billing policy, and only for past_due", () => {
    expect(code).toContain(`v_b.subscription_status = 'past_due' and v_b.current_period_end is not null then v_b.current_period_end + interval '${BILLING_PAST_DUE_GRACE_DAYS} days'`);
    const policy = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("_billing_entitlements.sql"))!), "utf8");
    expect(policy).toContain(`p_now <= b.current_period_end + interval '${BILLING_PAST_DUE_GRACE_DAYS} days'`);
  });

  it("a trial end is shown only while the trial is still running", () => {
    expect(code).toContain("v_ent.tier = 'premium_trial' and v_ent.trial_ends_at > now()");
  });
});

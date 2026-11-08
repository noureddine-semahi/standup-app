import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { BILLING_ACTIVE_SLACK_DAYS, BILLING_PAST_DUE_GRACE_DAYS, BILLING_STATUS_POLICY } from "./billingEntitlement";

// The tier computation lives in SQL, which can't run without a live database, so this pins its policy, precedence and safety by inspection
// (and pins it to the readable policy in billingEntitlement.ts). A live matrix against the real database is run separately.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_billing_entitlements.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const fn = (name: string) => {
  const start = code.indexOf(`create or replace function public.${name}(`);
  const end = code.indexOf("$$;", code.indexOf("as $$", start));
  return code.slice(start, end);
};

describe("billing entitlements migration", () => {
  it("sorts after the billing sync, feature flags and admin entitlement migrations it replaces functions from", () => {
    for (const earlier of ["_billing_sync.sql", "_feature_flags.sql", "_admin_entitlements.sql", "_goals_free_limit.sql"]) expect(file > readdirSync(dir).find((f) => f.endsWith(earlier))!).toBe(true);
  });

  it("creates no table and changes no row: it only replaces functions", () => {
    expect(code).not.toMatch(/create table|alter table|drop\s|delete\s+from|truncate/i);
    expect(code).not.toMatch(/create policy|create trigger|drop trigger/i);
  });

  describe("billing status policy (matches billingEntitlement.ts)", () => {
    const f = fn("billing_grants_premium");
    it("active and trialing: Premium within the paid period plus the slack", () => {
      expect(f).toContain("b.subscription_status in ('active', 'trialing')");
      expect(f).toContain(`p_now <= b.current_period_end + interval '${BILLING_ACTIVE_SLACK_DAYS} days'`);
      expect(f).toContain("b.current_period_end is null or");
    });
    it("past_due: Premium only during the grace period after the paid period, and never without a period end", () => {
      expect(f).toContain("b.subscription_status = 'past_due'");
      expect(f).toContain(`b.current_period_end is not null and p_now <= b.current_period_end + interval '${BILLING_PAST_DUE_GRACE_DAYS} days'`);
    });
    it("every other status, including unknown ones, is NOT Premium (fail closed)", () => {
      expect(f).toContain("else false");
      expect(f).toContain("), false)");
      const named = [...f.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      const premiumish = Object.entries(BILLING_STATUS_POLICY).filter(([, v]) => v !== "none").map(([k]) => k).sort();
      expect([...new Set(named.filter((n) => n in BILLING_STATUS_POLICY))].sort()).toEqual(premiumish);
      for (const never of ["unpaid", "canceled", "incomplete", "incomplete_expired", "paused"]) expect(f).not.toContain(`'${never}'`);
    });
    it("reads only the billing record of the account asked about", () => {
      expect(f).toContain("from public.account_billing b");
      expect(f).toContain("where b.user_id = p_user_id");
    });
  });

  describe("precedence in account_effective_tier: manual grant, then billing, then active trial, then Free", () => {
    const f = fn("account_effective_tier");
    it("is ordered exactly so", () => {
      const iManual = f.indexOf("when e.tier = 'premium' then 'premium'");
      const iBilling = f.indexOf("when public.billing_grants_premium(p_user_id, p_now) then 'premium'");
      const iTrial = f.indexOf("when e.tier = 'premium_trial' and e.trial_ends_at is not null and p_now < e.trial_ends_at then 'premium_trial'");
      const iFree = f.indexOf("else 'free'");
      expect(iManual).toBeGreaterThan(-1);
      expect(iBilling).toBeGreaterThan(iManual);
      expect(iTrial).toBeGreaterThan(iBilling);
      expect(iFree).toBeGreaterThan(iTrial);
    });
    it("an account with no entitlement row is still evaluated (left join), so billing alone can grant", () => {
      expect(f).toContain("left join public.account_entitlements e on e.user_id = p_user_id");
    });
  });

  it("billing-derived Premium is computed, never stored: no write to entitlements or trial history outside the two pre-existing writers", () => {
    const writers = ["start_my_premium_trial", "admin_set_entitlement"];
    let rest = code;
    for (const w of writers) rest = rest.replace(fn(w), "");
    expect(rest).not.toMatch(/insert into public\.(account_entitlements|account_trial_history|account_billing)/);
    expect(rest).not.toMatch(/\bupdate\s+public\./);
    expect(rest).not.toMatch(/delete\s+from/i);
  });

  it("the two writers are otherwise unchanged: same checks, same writes, same audit, and no write to billing", () => {
    const trial = fn("start_my_premium_trial");
    for (const s of ["TRIAL_ACTIVATION_DISABLED", "TRIAL_ALREADY_USED", "ALREADY_PREMIUM", "NOT_SIGNED_IN", "interval '336 hours'", "insert into public.account_trial_history", "premium_trial:' || v_uid::text"]) expect(trial).toContain(s);
    expect(trial).toContain("if v_stored = 'premium' or public.billing_grants_premium(v_uid) then");
    const admin = fn("admin_set_entitlement");
    for (const s of ["sys admin access required", "invalid tier", "user not found", "if v_old_stored <> p_tier then", "'set_entitlement'", "on conflict (user_id) do update set tier = excluded.tier;"]) expect(admin).toContain(s);
    expect(admin).not.toMatch(/trial_started_at\s*=|trial_ends_at\s*=/);
    expect(admin).not.toMatch(/(insert into|update|delete from)\s+public\.(account_billing|account_trial_history)/); // it only READS trial history
    expect(admin).not.toMatch(/account_billing/);
    expect(fn("admin_get_entitlement")).toContain("if not public.is_admin() then");
  });

  it("the Free creation limits are unchanged and now lifted by Premium from ANY source; existing data is never touched", () => {
    for (const [name, limit, codeName] of [["enforce_note_limit", ">= 10", "NOTE_LIMIT_REACHED"], ["enforce_routine_limit", ">= 3", "ROUTINE_LIMIT_REACHED"], ["enforce_goal_limit", ">= 3", "GOAL_LIMIT_REACHED"]] as const) {
      const f = fn(name);
      expect(f).toContain("if public.account_effective_tier(new.user_id) <> 'free' then");
      expect(f).toContain(`v_count ${limit}`);
      expect(f).toContain(`raise exception '${codeName}'`);
      expect(f).toContain("pg_advisory_xact_lock");
      expect(f).not.toMatch(/delete\s|update\s+public|set active|set status/i);
      // the tier check comes before the lock and the count, and a caller can't escape the check by naming another user
      expect(f.indexOf("account_effective_tier")).toBeLessThan(f.indexOf("pg_advisory_xact_lock"));
      expect(f.indexOf("new.user_id is distinct from auth.uid()")).toBeLessThan(f.indexOf("account_effective_tier"));
    }
  });

  it("get_my_account_entitlement keeps its shape and scope (own account only) and reports the combined tier", () => {
    const f = fn("get_my_account_entitlement");
    expect(f).toContain("returns table (r_tier text, r_stored_tier text, r_trial_started_at timestamptz, r_trial_ends_at timestamptz)");
    expect(f).toContain("v_uid uuid := auth.uid()");
    expect(f).toContain("v_tier := public.account_effective_tier(v_uid)");
    expect(f).toContain("select 'free'::text, 'free'::text, null::timestamptz, null::timestamptz");
    expect(f).not.toMatch(/p_user_id|p_/);
  });

  it("permissions: the internal tier functions are service-role only; users reach only their own tier through the existing RPCs", () => {
    for (const sig of ["billing_grants_premium(uuid, timestamptz)", "account_effective_tier(uuid, timestamptz)"]) {
      expect(code).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function public.${sig} to service_role;`);
    }
    expect(code).not.toMatch(/grant execute on function public\.(billing_grants_premium|account_effective_tier)[^;]*to (anon|authenticated|public)/);
    expect(code).toContain("grant execute on function public.get_my_account_entitlement() to authenticated;");
    expect(code).toContain("grant execute on function public.start_my_premium_trial() to authenticated;");
    expect(code).toContain("grant execute on function public.admin_set_entitlement(uuid, text) to authenticated;");
    for (const name of ["billing_grants_premium", "account_effective_tier", "get_my_account_entitlement", "enforce_note_limit", "enforce_routine_limit", "enforce_goal_limit", "start_my_premium_trial", "admin_get_entitlement", "admin_set_entitlement"]) {
      expect(fn(name)).toContain("security definer set search_path = public");
    }
  });
});

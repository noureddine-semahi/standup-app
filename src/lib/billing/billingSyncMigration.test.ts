import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The ownership and ordering rules live in SQL, which can't run without a live database, so this pins their shape and security by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_billing_sync.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const fnStart = code.indexOf("create or replace function public.sync_stripe_subscription(");
const fn = code.slice(fnStart, code.indexOf("$$;", code.indexOf("as $$", fnStart)));

describe("billing sync migration", () => {
  it("sorts after the billing table and the webhook ledger it builds on", () => {
    for (const earlier of ["_account_billing.sql", "_stripe_webhook_events.sql"]) expect(file > readdirSync(dir).find((f) => f.endsWith(earlier))!).toBe(true);
  });

  it("is additive: new nullable columns and one function; no drops, deletes or new tables", () => {
    expect(code).not.toMatch(/drop\s|delete\s+from|truncate|create table/i);
    for (const c of ["current_period_start timestamptz", "canceled_at timestamptz", "ended_at timestamptz", "subscription_synced_at timestamptz", "last_event_id text"]) {
      expect(code).toContain(`add column if not exists ${c}`);
    }
    expect(code.match(/create or replace function/gi)).toHaveLength(1);
  });

  it("is server-only: executable by the service role alone", () => {
    const sig = "public.sync_stripe_subscription(text, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, timestamptz)";
    expect(code).toContain(`revoke all on function ${sig} from public, anon, authenticated;`);
    expect(code).toContain(`grant execute on function ${sig} to service_role;`);
    expect(code).not.toMatch(/grant execute[^;]*\bto\s+(anon|authenticated|public)\b/);
    expect(fn).toContain("security definer set search_path = public");
  });

  it("validates its inputs: plan, Stripe ID prefixes, a fetch time, and the event ID format", () => {
    expect(fn).toContain("p_plan not in ('monthly', 'annual')");
    for (const p of ["cus\\_%", "sub\\_%", "price\\_%", "evt\\_%"]) expect(fn).toContain(`like '${p}'`);
    expect(fn).toContain("p_fetched_at is null");
    expect(fn).toContain("return 'invalid'");
  });

  it("ownership: an existing record wins, a hint must be a real account, and any contradiction changes nothing", () => {
    expect(fn).toContain("where stripe_subscription_id = p_subscription_id");
    expect(fn).toContain("where stripe_customer_id = p_customer_id");
    expect(fn).toContain("v_owner := coalesce(v_by_sub, v_by_cust)");
    expect(fn).toContain("if p_user_hint is not null and p_user_hint <> v_owner then");
    expect(fn).toContain("select 1 from auth.users where id = p_user_hint");
    expect(fn.match(/return 'ownership_conflict'/g)!.length).toBeGreaterThanOrEqual(3);
    expect(fn).toContain("return 'unmapped'");
    // no path writes before every ownership check has passed
    expect(fn.indexOf("insert into public.account_billing")).toBeGreaterThan(fn.lastIndexOf("return 'ownership_conflict'"));
    expect(fn.indexOf("insert into public.account_billing")).toBeGreaterThan(fn.lastIndexOf("return 'subscription_conflict'"));
    expect(fn.indexOf("insert into public.account_billing")).toBeGreaterThan(fn.indexOf("return 'stale'"));
  });

  it("an account already tied to a different Stripe customer, or holding a live different subscription, is not overwritten", () => {
    expect(fn).toContain("v_row.stripe_customer_id <> p_customer_id");
    expect(fn).toContain("v_row.stripe_subscription_id <> p_subscription_id");
    expect(fn).toContain("not in ('canceled', 'incomplete_expired')");
    expect(fn).toContain("return 'subscription_conflict'");
  });

  it("ordering: an older snapshot never overwrites a newer one", () => {
    expect(fn).toContain("v_row.subscription_synced_at > p_fetched_at");
    expect(fn).toContain("return 'stale'");
    expect(fn).toContain("subscription_synced_at = excluded.subscription_synced_at");
  });

  it("concurrent writers are serialized per Stripe customer and per account", () => {
    expect(fn).toContain("pg_advisory_xact_lock(hashtextextended('billing_sync_customer:' || p_customer_id, 0))");
    expect(fn).toContain("pg_advisory_xact_lock(hashtextextended('billing_sync_account:' || v_owner::text, 0))");
    expect(fn).toContain("for update");
  });

  it("records the billing facts: subscription, customer, price, plan, status, period and timestamps", () => {
    for (const c of ["stripe_customer_id = excluded", "stripe_subscription_id = excluded", "stripe_price_id = excluded", "plan = excluded", "subscription_status = excluded", "current_period_start = excluded", "current_period_end = excluded", "cancel_at_period_end = excluded", "canceled_at = excluded", "ended_at = excluded"]) {
      expect(fn).toContain(c);
    }
  });

  it("changes billing records ONLY: it can never touch entitlements, trials, trial history, admin grants, the webhook ledger or user content", () => {
    const writes = [...code.matchAll(/(?:insert into|(?<!do )(?<!before )update)\s+(?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect([...new Set(writes)]).toEqual(["account_billing"]);
    expect(code).not.toMatch(/account_entitlements|account_trial_history|stripe_webhook_events|feature_flags|admin_audit_log|notes|outcome_goals|recurring_goal_templates|premium/i);
  });
});

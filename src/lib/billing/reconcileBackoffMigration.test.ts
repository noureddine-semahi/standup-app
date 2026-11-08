import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The backoff memory lives in SQL, which can't run without a live database, so this pins its shape and security by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_reconcile_backoff.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const fnStart = code.indexOf("create or replace function public.record_reconcile_result(");
const fn = code.slice(fnStart, code.indexOf("$$;", code.indexOf("as $$", fnStart)));

describe("reconcile backoff migration", () => {
  it("sorts after the checkout-attempts migration (the latest billing one) and exists", () => {
    expect(file).toBeTruthy();
    expect(file > readdirSync(dir).find((f) => f.endsWith("_checkout_attempts.sql"))!).toBe(true);
  });

  it("is additive and idempotent: four columns on account_billing and one function; no drops, deletes, new tables or rewrites of the sync function", () => {
    expect(code).not.toMatch(/drop\s|delete\s+from|truncate|create table|sync_stripe_subscription/i);
    for (const c of ["reconcile_failures integer not null default 0", "reconcile_last_outcome text", "reconcile_last_failed_at timestamptz", "reconcile_next_attempt_at timestamptz"]) expect(code).toContain(`add column if not exists ${c}`);
    expect(code.match(/add column/gi)).toHaveLength(4);
    expect(code.match(/create or replace function/gi)).toHaveLength(1);
    expect(code).toContain("if not exists (select 1 from pg_constraint where conname = 'account_billing_reconcile_failures_range')");
  });

  it("bounds the stored values: failure count 0-1000, outcome from a fixed list", () => {
    expect(code).toContain("check (reconcile_failures between 0 and 1000)");
    expect(code).toContain("reconcile_last_outcome in ('missing', 'conflict', 'stripe_error', 'ignored')");
  });

  it("the function can write ONLY the four reconcile columns: every update sets nothing else", () => {
    const sets = [...fn.matchAll(/update public\.account_billing\s+set([\s\S]*?)where/g)].map((m) => m[1]);
    expect(sets).toHaveLength(2);
    for (const set of sets) {
      const cols = [...set.matchAll(/^\s*(\w+)\s*=/gm)].map((m) => m[1]);
      expect(cols.length).toBeGreaterThan(0);
      for (const c of cols) expect(c, c).toMatch(/^reconcile_(failures|last_outcome|last_failed_at|next_attempt_at)$/);
    }
    // it never names a billing, entitlement, trial or grant field, and never inserts or deletes
    expect(fn).not.toMatch(/subscription_status|current_period|cancel_at_period_end|stripe_price_id|plan\s*=|ended_at|canceled_at|subscription_synced_at|last_event_id|account_entitlements|trial|admin_/i);
    expect(fn).not.toMatch(/\binsert\b|\bdelete\b/i);
  });

  it("matches the record by Stripe subscription ID only (the one unique key), and never by anything a client sends", () => {
    expect(fn.match(/where stripe_subscription_id = p_subscription_id/g)).toHaveLength(2);
    expect(fn).not.toMatch(/user_id/);
  });

  it("validates its inputs: a sub_ ID and a fixed outcome list", () => {
    expect(fn).toContain("p_subscription_id not like 'sub\\_%'");
    expect(fn).toContain("p_outcome not in ('ok', 'missing', 'conflict', 'stripe_error', 'ignored')");
    expect(fn).toContain("return 'invalid'");
  });

  it("bounds the retry time in the database: never in the past, never beyond 7 days, 1 hour if omitted", () => {
    expect(fn).toContain("greatest(now(), least(coalesce(p_next_attempt_at, now() + interval '1 hour'), now() + interval '7 days'))");
    expect(fn).toContain("least(reconcile_failures + 1, 1000)");
  });

  it("a success clears the memory completely", () => {
    expect(fn).toMatch(/reconcile_failures = 0,\s*reconcile_last_outcome = null,\s*reconcile_last_failed_at = null,\s*reconcile_next_attempt_at = null/);
  });

  it("is server-only: executable by the service role alone, running with the owner's rights and a fixed search path", () => {
    const sig = "public.record_reconcile_result(text, text, timestamptz)";
    expect(code).toContain(`revoke all on function ${sig} from public, anon, authenticated;`);
    expect(code).toContain(`grant execute on function ${sig} to service_role;`);
    expect(code).not.toMatch(/grant execute[^;]*\bto\s+(anon|authenticated|public)\b/);
    expect(fn).toContain("security definer set search_path = public");
    expect(code).not.toMatch(/grant\s+(select|insert|update|all)[^;]*account_billing[^;]*\bto\s+(anon|authenticated)/i);
  });

  it("the sync function the webhooks and reconciliation use is untouched by this file, so it never names the new columns and a backoff update can't be overwritten by it", () => {
    const syncSql = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("_billing_sync.sql"))!), "utf8");
    expect(syncSql).not.toMatch(/reconcile_/);
  });

  it("the member-facing status function does not expose the new columns", () => {
    const statusSql = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("_billing_status.sql"))!), "utf8");
    expect(statusSql).not.toMatch(/reconcile_/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Definer functions can't be run without a live database, so this pins the migration's shape and security by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_feature_flags.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const trialFn = code.slice(code.indexOf("create or replace function public.start_my_premium_trial"));
const origTrialSql = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("_premium_trial.sql"))!), "utf8");

describe("feature flags migration", () => {
  it("sorts after the trial migration it replaces a function from", () => {
    expect(file > readdirSync(dir).find((f) => f.endsWith("_premium_trial.sql"))!).toBe(true);
    expect(file > readdirSync(dir).find((f) => f.endsWith("_account_billing.sql"))!).toBe(true);
  });

  it("creates the three flags, every one defaulting to and seeded as false, never overwriting an existing value", () => {
    expect(code).toContain("enabled boolean not null default false");
    for (const k of ["premium_promotion_enabled", "premium_trial_activation_enabled", "billing_checkout_enabled"]) {
      expect(code).toContain(`('${k}', false)`);
      expect(code).toContain(`'${k}'`);
    }
    expect(code).toContain("on conflict (key) do nothing");
    expect(code).not.toMatch(/\(\s*'[a-z_]+'\s*,\s*true\s*\)/);
  });

  it("only those three keys can exist", () => {
    expect(code).toContain("check (key in ('premium_promotion_enabled', 'premium_trial_activation_enabled', 'billing_checkout_enabled'))");
  });

  it("browsers can't touch the table: RLS on, no policies, privileges revoked; they can only call get_feature_flags", () => {
    expect(code).toContain("alter table public.feature_flags enable row level security");
    expect(code).not.toMatch(/create policy/i);
    expect(code).toContain("revoke all on public.feature_flags from anon, authenticated;");
    expect(code).toContain("grant execute on function public.get_feature_flags() to authenticated;");
    expect(code).not.toMatch(/grant execute[^;]*feature_enabled/);
    expect(code).toContain("revoke all on function public.feature_enabled(text) from public, anon, authenticated;");
    expect(code).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });

  it("a missing flag reads as false, and the helpers are security definer with a pinned search_path", () => {
    expect(code).toContain("coalesce((select enabled from public.feature_flags where key = p_key), false)");
    expect(code.match(/security definer set search_path = public/g)!.length).toBe(3);
    expect(code).toContain("where auth.uid() is not null");
  });

  it("trial activation is blocked in the database when the flag is off, right after the sign-in check and before anything is written", () => {
    expect(trialFn).toContain("if not public.feature_enabled('premium_trial_activation_enabled') then");
    expect(trialFn).toContain("raise exception 'TRIAL_ACTIVATION_DISABLED'");
    const at = (s: string) => trialFn.indexOf(s);
    expect(at("NOT_SIGNED_IN")).toBeLessThan(at("TRIAL_ACTIVATION_DISABLED"));
    expect(at("TRIAL_ACTIVATION_DISABLED")).toBeLessThan(at("pg_advisory_xact_lock"));
    expect(at("TRIAL_ACTIVATION_DISABLED")).toBeLessThan(at("insert into public.account_trial_history"));
  });

  it("the trial function is otherwise unchanged: same checks, same 14-day window, same writes, same grants", () => {
    for (const s of [
      "raise exception 'TRIAL_ALREADY_USED'",
      "raise exception 'ALREADY_PREMIUM'",
      "v_ends := v_now + interval '336 hours';",
      "insert into public.account_trial_history (user_id, started_at, ends_at) values (v_uid, v_now, v_ends);",
      "set tier = 'premium_trial', trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at;",
      "pg_advisory_xact_lock(hashtextextended('premium_trial:' || v_uid::text, 0))",
      "revoke all on function public.start_my_premium_trial() from public, anon;",
      "grant execute on function public.start_my_premium_trial() to authenticated;",
    ]) {
      expect(trialFn).toContain(s);
      expect(origTrialSql).toContain(s);
    }
  });

  it("changes no existing data: no deletes, drops of data, or writes to entitlements, history, billing or user content", () => {
    expect(code).not.toMatch(/delete\s+from|truncate|drop\s+(table|column|policy)/i);
    const writes = [...code.matchAll(/(?:insert into|(?<!do |before )update)\s+(?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect([...new Set(writes)].sort()).toEqual(["account_entitlements", "account_trial_history", "feature_flags"]);
    // account_entitlements / account_trial_history are written only inside start_my_premium_trial, exactly as before
    const outside = code.slice(0, code.indexOf("create or replace function public.start_my_premium_trial"));
    expect(outside).not.toMatch(/account_entitlements|account_trial_history|account_billing/);
  });
});

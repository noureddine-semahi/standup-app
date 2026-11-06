import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { TRIAL_DAYS } from "@/lib/entitlements";

// The function can't run without a live database, so this pins its shape by inspection: one trial ever, exactly 14 days, started only
// through the one function, no direct writes, serialized attempts, and nothing destructive.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_premium_trial.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const fnAt = code.indexOf("function public.start_my_premium_trial");
const fn = code.slice(fnAt, code.indexOf("$$;", code.indexOf("$$;", fnAt) + 3));

describe("premium trial migration", () => {
  it("exists and sorts after the entitlement migration it depends on", () => {
    expect(file > readdirSync(dir).find((f) => f.endsWith("_account_entitlements.sql"))!).toBe(true);
  });

  it("keeps a permanent one-row-per-user history: user_id is the primary key, so a second trial row is impossible", () => {
    expect(code).toMatch(/create table if not exists public\.account_trial_history[\s\S]*?user_id uuid primary key references auth\.users\(id\) on delete cascade/);
    expect(code).toContain("started_at timestamptz not null");
    expect(code).toContain("ends_at timestamptz not null");
    expect(code).toContain("ends_at > started_at");
  });

  it("users can only READ their own history: RLS on, one select policy, no write policy, write privileges revoked", () => {
    expect(code).toContain("alter table public.account_trial_history enable row level security");
    expect(code).toContain("on public.account_trial_history for select using (auth.uid() = user_id)");
    expect(code.match(/create policy/g)).toHaveLength(1);
    expect(code).not.toMatch(/for (insert|update|delete|all)/i);
    expect(code).toMatch(/revoke insert, update, delete, truncate on public\.account_trial_history from anon, authenticated/);
  });

  it("a trial lasts exactly the app's TRIAL_DAYS, counted in hours so a daylight-saving change can't shift it", () => {
    expect(fn).toContain(`v_ends := v_now + interval '${TRIAL_DAYS * 24} hours'`);
    expect(TRIAL_DAYS).toBe(14);
    expect(fn).not.toMatch(/interval '\d+ days?'/);
  });

  it("the function is security definer, scoped to auth.uid(), pinned search_path, signed-in users only", () => {
    expect(fn).toContain("security definer set search_path = public");
    expect(fn).toContain("auth.uid()");
    expect(fn).toContain("raise exception 'NOT_SIGNED_IN'");
    expect(code).toContain("revoke all on function public.start_my_premium_trial() from public, anon");
    expect(code).toContain("grant execute on function public.start_my_premium_trial() to authenticated");
    // it takes no arguments, so a caller cannot choose another user, a length or a tier
    expect(code).toContain("function public.start_my_premium_trial()\nreturns table");
  });

  it("refuses a second trial (after expiry or downgrade too) and a trial on an already-Premium account", () => {
    expect(fn).toMatch(/if exists \(select 1 from public\.account_trial_history where user_id = v_uid\) then\s+raise exception 'TRIAL_ALREADY_USED'/);
    expect(fn).toMatch(/if v_stored = 'premium' then\s+raise exception 'ALREADY_PREMIUM'/);
    // the history check does not look at the current tier or the dates, so an expired or downgraded account is still refused
    const check = fn.slice(fn.indexOf("if exists"), fn.indexOf("raise exception 'TRIAL_ALREADY_USED'"));
    expect(check).not.toMatch(/tier|trial_ends_at|now\(\)/);
  });

  it("serializes concurrent attempts with a transaction-scoped advisory lock taken BEFORE the history check", () => {
    expect(fn).toMatch(/pg_advisory_xact_lock\(hashtextextended\('premium_trial:' \|\| v_uid::text, 0\)\)/);
    expect(fn.indexOf("pg_advisory_xact_lock")).toBeLessThan(fn.indexOf("account_trial_history where"));
  });

  it("records the history, then grants premium_trial with the same two dates, in the same transaction", () => {
    expect(fn).toContain("insert into public.account_trial_history (user_id, started_at, ends_at) values (v_uid, v_now, v_ends)");
    expect(fn).toMatch(/insert into public\.account_entitlements \(user_id, tier, trial_started_at, trial_ends_at\)\s+values \(v_uid, 'premium_trial', v_now, v_ends\)/);
    expect(fn).toMatch(/on conflict \(user_id\) do update\s+set tier = 'premium_trial'/);
    expect(fn.indexOf("insert into public.account_trial_history")).toBeLessThan(fn.indexOf("insert into public.account_entitlements"));
  });

  it("returns the effective tier computed by the shared rule (an active trial is premium_trial)", () => {
    expect(fn).toContain("public.effective_account_tier('premium_trial', v_ends, v_now)");
  });

  it("backfills history for anyone who already has trial dates, without overwriting a row", () => {
    expect(code).toMatch(/insert into public\.account_trial_history \(user_id, started_at, ends_at\)\s+select user_id, trial_started_at, trial_ends_at\s+from public\.account_entitlements\s+where trial_started_at is not null and trial_ends_at is not null\s+on conflict \(user_id\) do nothing/);
  });

  it("never touches Goals, Routines, Notes or anything destructive; additive only", () => {
    expect(code).not.toMatch(/outcome_goals|recurring_goal_templates|public\.notes|public\.goals|daily_plans/);
    expect(code).not.toMatch(/delete from|drop table|drop column|truncate table|alter table public\.(?!account_trial_history)/i);
  });
});

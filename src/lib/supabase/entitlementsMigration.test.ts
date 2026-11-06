import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// RLS and definer functions can't be exercised without a live database, so this pins the migration's shape by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_account_entitlements.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("account entitlements migration", () => {
  it("exists and sorts after every earlier migration", () => {
    expect(file).toBeTruthy();
    expect(readdirSync(dir).filter((f) => f !== file && f.endsWith(".sql")).every((f) => f < file)).toBe(true);
  });

  it("one owner-keyed table, defaulting to free, with only the three tiers", () => {
    expect(code).toMatch(/create table if not exists public\.account_entitlements[\s\S]*?user_id uuid primary key references auth\.users\(id\) on delete cascade/);
    expect(code).toContain("tier text not null default 'free' check (tier in ('free', 'premium_trial', 'premium'))");
    expect(code).toContain("trial_started_at timestamptz");
    expect(code).toContain("trial_ends_at timestamptz");
  });

  it("trial dates are consistent: a trial tier needs both dates and the end is after the start", () => {
    expect(code).toContain("trial_ends_at > trial_started_at");
    expect(code).toMatch(/tier <> 'premium_trial' or \(trial_started_at is not null and trial_ends_at is not null\)/);
  });

  it("users can only READ their own row: RLS on, a single select policy, no write policy, write privileges revoked", () => {
    expect(code).toContain("alter table public.account_entitlements enable row level security");
    expect(code).toContain("on public.account_entitlements for select using (auth.uid() = user_id)");
    expect(code.match(/create policy/g)).toHaveLength(1);
    expect(code).not.toMatch(/for (insert|update|delete|all)/i);
    expect(code).not.toMatch(/using \(true\)|with check \(true\)/i);
    expect(code).toMatch(/revoke insert, update, delete, truncate on public\.account_entitlements from anon, authenticated/);
  });

  it("the effective tier is decided in the database: an expired trial is free", () => {
    const at = code.indexOf("function public.effective_account_tier");
    const fn = code.slice(at, code.indexOf("$$", code.indexOf("$$", at) + 2) + 2); // from the opening $$ to the closing $$
    expect(fn).toContain("when p_tier = 'premium' then 'premium'");
    expect(fn).toMatch(/p_tier = 'premium_trial' and p_trial_ends_at is not null and p_now < p_trial_ends_at then 'premium_trial'/);
    expect(fn).toContain("else 'free'");
  });

  it("the read function is security definer, scoped to auth.uid(), pinned search_path, signed-in users only", () => {
    const start = code.indexOf("function public.get_my_account_entitlement");
    const def = code.slice(start, code.indexOf("$$;", code.indexOf("$$;", start) + 3));
    expect(def).toContain("security definer set search_path = public");
    expect(def).toContain("auth.uid()");
    expect(def).toContain("where user_id = v_uid");
    expect(code).toContain("revoke all on function public.get_my_account_entitlement() from public, anon");
    expect(code).toContain("grant execute on function public.get_my_account_entitlement() to authenticated");
  });

  it("existing users get an explicit free row without overwriting anything; new users need none", () => {
    expect(code).toMatch(/insert into public\.account_entitlements \(user_id\)\s+select id from auth\.users\s+on conflict \(user_id\) do nothing/);
  });

  it("is additive only and touches no existing table", () => {
    expect(code).not.toMatch(/drop table|drop column|truncate table|delete from|alter table public\.(?!account_entitlements)/i);
    expect(code).not.toMatch(/profiles/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { FREE_LIMITS } from "@/lib/entitlements";

// The trigger can't run without a live database, so this pins its shape by inspection: what fires it, which actions it checks, what it
// counts, who is exempt, how it serializes concurrent requests, and that it never deletes, completes or archives anything.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_goals_free_limit.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("goals free-limit migration", () => {
  it("exists and sorts after the entitlement migration it depends on", () => {
    expect(file > readdirSync(dir).find((f) => f.endsWith("_account_entitlements.sql"))!).toBe(true);
  });

  it("fires BEFORE INSERT or UPDATE OF status on outcome_goals only (structured Goals, not the daily goals table)", () => {
    expect(code).toMatch(/create trigger trg_enforce_goal_limit\s+before insert or update of status on public\.outcome_goals\s+for each row execute function public\.enforce_goal_limit\(\)/);
    expect(code.match(/create trigger/g)).toHaveLength(1);
    expect(code).not.toMatch(/on public\.goals\b/);
    expect(code).not.toMatch(/before delete|after (insert|update|delete)|instead of/i);
  });

  it("the limit equals FREE_LIMITS.structuredGoals and refuses with GOAL_LIMIT_REACHED (53400)", () => {
    expect(code).toContain(`if v_count >= ${FREE_LIMITS.structuredGoals} then`);
    expect(FREE_LIMITS.structuredGoals).toBe(3);
    expect(code).toContain("raise exception 'GOAL_LIMIT_REACHED'");
    expect(code).toContain("errcode = '53400'");
  });

  it("counts only ACTIVE Goals (completed and abandoned do not count), and only the acting user's", () => {
    expect(code).toContain("from public.outcome_goals where user_id = new.user_id and status = 'active'");
    expect(code.match(/from public\.outcome_goals/g)).toHaveLength(1);
  });

  it("checks only actions that ADD an active Goal: a new active row, or a non-active row turned active", () => {
    expect(code).toMatch(/if new\.status is distinct from 'active' then\s+return new;/);
    expect(code).toMatch(/if tg_op = 'UPDATE' and old\.status is not distinct from 'active' then\s+return new;/);
    expect(code.indexOf("old.status is not distinct from 'active'")).toBeLessThan(code.indexOf("account_entitlements"));
    expect(code.indexOf("old.status is not distinct from 'active'")).toBeLessThan(code.indexOf("select count(*)"));
  });

  it("never deletes, completes, archives or edits Goals (a downgrade keeps everything: tasks, lineage, history)", () => {
    expect(code).not.toMatch(/delete from|update public\.|set status|drop table|drop column|truncate|alter table/i);
    expect(code).not.toMatch(/new\.status\s*:=/);
  });

  it("premium and an active premium trial are exempt, using the shared effective-tier rule", () => {
    expect(code).toContain("public.effective_account_tier(coalesce(v_tier, 'free'), v_ends) <> 'free' then");
    expect(code.indexOf("<> 'free' then")).toBeLessThan(code.indexOf("select count(*)"));
  });

  it("serializes concurrent requests per user with a transaction-scoped advisory lock taken BEFORE the count", () => {
    expect(code).toMatch(/pg_advisory_xact_lock\(hashtextextended\('goals_free_limit:' \|\| new\.user_id::text, 0\)\)/);
    expect(code.indexOf("pg_advisory_xact_lock")).toBeLessThan(code.indexOf("select count(*)"));
  });

  it("a row claiming someone else's user_id is passed through for the policies to reject, never counted", () => {
    expect(code).toMatch(/if auth\.uid\(\) is not null and new\.user_id is distinct from auth\.uid\(\) then\s+return new;/);
    expect(code.indexOf("is distinct from auth.uid()")).toBeLessThan(code.indexOf("account_entitlements"));
  });

  it("is security definer with a pinned search_path and creates no policy", () => {
    expect(code).toContain("security definer set search_path = public");
    expect(code).not.toMatch(/create policy|drop policy/i);
  });
});

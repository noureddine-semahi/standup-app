import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Definer functions can't be exercised without a live database, so this pins the migration's security and behavior by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_admin_entitlements.sql"))!;
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
const getFn = fn("admin_get_entitlement");
const setFn = fn("admin_set_entitlement");

describe("admin entitlements migration", () => {
  it("sorts after the entitlement and trial migrations it builds on", () => {
    for (const earlier of ["_account_entitlements.sql", "_premium_trial.sql"]) {
      expect(file > readdirSync(dir).find((f) => f.endsWith(earlier))!).toBe(true);
    }
  });

  it("is additive: no tables, no drops, no deletes, no policy changes", () => {
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/drop\s/i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/create policy|alter table/i);
  });

  it("both functions are security definer with a pinned search_path", () => {
    for (const f of [getFn, setFn]) expect(f).toContain("security definer set search_path = public");
  });

  it("authorization is the first statement: viewing needs an admin, changing needs a Sys Admin", () => {
    const first = (f: string) => f.slice(f.indexOf("begin") + 5).trim();
    expect(first(getFn)).toMatch(/^if not public\.is_admin\(\) then\s+raise exception 'admin access required';/);
    expect(first(setFn)).toMatch(/^if not public\.is_sys_admin\(\) then\s+raise exception 'sys admin access required';/);
  });

  it("a regular user can call neither: execute is revoked from public and anon and granted to authenticated only (the checks refuse the rest)", () => {
    for (const sig of ["admin_get_entitlement(uuid)", "admin_set_entitlement(uuid, text)"]) {
      expect(code).toContain(`revoke all on function public.${sig} from public, anon;`);
      expect(code).toContain(`grant execute on function public.${sig} to authenticated;`);
    }
    expect(code).not.toMatch(/grant execute[^;]*to (anon|public)/);
  });

  it("only free and premium can be set; trials can't be granted by an admin", () => {
    expect(setFn).toContain("p_tier not in ('free', 'premium')");
    expect(setFn).toContain("raise exception 'invalid tier'");
    expect(setFn).not.toContain("premium_trial'");
  });

  it("checks the user exists and takes the same per-user lock as trial activation", () => {
    expect(setFn).toContain("select 1 from auth.users where id = p_user_id");
    expect(setFn).toContain("pg_advisory_xact_lock(hashtextextended('premium_trial:' || p_user_id::text, 0))");
    expect(readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("_premium_trial.sql"))!), "utf8")).toContain("'premium_trial:' || ");
  });

  it("changes only the tier: trial dates are not written and trial history is never written", () => {
    expect(setFn).toContain("on conflict (user_id) do update set tier = excluded.tier;");
    expect(setFn).not.toMatch(/trial_started_at\s*=|trial_ends_at\s*=/);
    expect(setFn).not.toMatch(/(insert into|update|delete from)\s+public\.account_trial_history/);
  });

  it("touches only account_entitlements and admin_audit_log: goals, routines, notes and history are never written", () => {
    const writes = [...code.matchAll(/(?:insert into|(?<!do )update)\s+(?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect([...new Set(writes)].sort()).toEqual(["account_entitlements", "admin_audit_log"]);
  });

  it("a no-op change writes nothing: the write and the audit row are inside the 'tier differs' branch", () => {
    const branch = setFn.indexOf("if v_old_stored <> p_tier then");
    expect(branch).toBeGreaterThan(-1);
    expect(setFn.indexOf("insert into public.account_entitlements")).toBeGreaterThan(branch);
    expect(setFn.indexOf("insert into public.admin_audit_log")).toBeGreaterThan(branch);
    expect(setFn.indexOf("end if;", branch)).toBeGreaterThan(setFn.indexOf("insert into public.admin_audit_log"));
  });

  it("every change is audited: who, whom, previous and new values, and trial dates (created_at is the audit table's own default)", () => {
    expect(setFn).toContain("insert into public.admin_audit_log (admin_id, target_user_id, action, details)");
    expect(setFn).toContain("auth.uid(), p_user_id, 'set_entitlement'");
    for (const k of ["old_stored_tier", "new_stored_tier", "old_effective_tier", "new_effective_tier", "trial_started_at", "trial_ends_at"]) {
      expect(setFn).toContain(`'${k}'`);
    }
  });

  it("reads report stored and effective tier, trial dates and whether a trial was ever used", () => {
    expect(getFn).toContain("public.effective_account_tier(");
    expect(getFn).toContain("account_trial_history");
    expect(getFn).toContain("coalesce(v_row.tier, 'free')");
  });
});

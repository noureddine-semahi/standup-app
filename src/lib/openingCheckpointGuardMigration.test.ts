import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Static shape test for the opening-checkpoint balance-path guard. Behaviour is verified on a disposable PostgreSQL, not here.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const read = (suffix: string) => {
  const f = names.find((n) => n.endsWith(suffix))!;
  const raw = readFileSync(join(dir, f), "utf8");
  const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  return { f, raw, code, flat: raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " "), n: code.replace(/\s+/g, " ").trim() };
};
const guard = read("_opening_checkpoint_balance_path_guard.sql");
const prev = read("_create_opening_checkpoint.sql");
const rec = read("_reconcile_payment_account.sql");
const body = (s: string) => s.slice(s.indexOf("create or replace function public.create_opening_checkpoint("), s.indexOf("$$;", s.indexOf("as $$")) + 3);

const GUARD = "if has_column_privilege('authenticated', 'public.payment_accounts', 'balance', 'UPDATE') then raise exception 'Opening checkpoints are disabled while the balance can still be edited directly'; end if;";
const ANCHOR = "raise exception 'This account already has an opening checkpoint'; end if; ";

describe("create_opening_checkpoint balance-path guard migration", () => {
  it("is forward-only, sorts after the migration it replaces, defines exactly one function, and touches no permission or other object", () => {
    expect(guard.f > prev.f).toBe(true);
    expect(guard.code.match(/create or replace function/g)).toHaveLength(1);
    expect(guard.code).not.toMatch(/\b(grant|revoke|drop|alter|truncate|delete from|create table|create policy|create trigger|create index)\b/i);
    expect(guard.code).not.toMatch(/update public\.payment_transactions|insert into public\.payment_transactions/i);
  });
  it("is IDENTICAL to the previous function apart from the one inserted guard", () => {
    const before = body(prev.n), after = body(guard.n);
    expect(before).toContain(ANCHOR);
    expect(after).toBe(before.replace(ANCHOR, ANCHOR + GUARD + " "));
  });
  it("places the guard after the account lock, the idempotent retry and the duplicate-checkpoint check, and before confirmation and allocation", () => {
    const n = body(guard.n);
    const parts = [
      "for update; if not found then raise exception 'Account not found';",
      "return query select v_existing, v_existing_version, v_balance, true; return;",
      "This account already has an opening checkpoint",
      "Opening checkpoints are disabled while the balance can still be edited directly",
      "if p_confirmed_balance <> v_balance then",
      "set ledger_version = a.ledger_version + 1",
      "insert into public.payment_account_entries",
    ].map((p) => n.indexOf(p));
    expect(parts.every((i) => i > -1)).toBe(true);
    expect([...parts].sort((a, b) => a - b)).toEqual(parts);
    expect(n.match(/Opening checkpoints are disabled/g)).toHaveLength(1);
  });
  it("uses exactly the same privilege test as reconcile_payment_account, so both agree on 'path open'", () => {
    const test = "has_column_privilege('authenticated', 'public.payment_accounts', 'balance', 'UPDATE')";
    expect(guard.n).toContain(test);
    expect(rec.n).toContain(test);
  });
  it("keeps signature, SECURITY DEFINER and search path, and still never writes the balance", () => {
    const head = (s: string) => s.slice(0, s.indexOf("as $$"));
    expect(head(body(guard.n))).toBe(head(body(prev.n)));
    expect(guard.code).not.toMatch(/set balance\s*=/i);
  });
  it("documents the production effect and that retries and refusals consume nothing", () => {
    for (const s of ["no checkpoint can be created", "a legitimate retry of an already-created checkpoint still returns the original", "consumes no version", "Permissions are NOT touched"]) expect(guard.flat).toContain(s);
  });
});

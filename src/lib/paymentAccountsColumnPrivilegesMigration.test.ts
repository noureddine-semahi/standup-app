import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here. This pins the migration's text and checks, from the application source, that every column the client really writes is still
// granted. It does NOT prove the live privileges: that needs the live verification that accompanies the migration.
const root = process.cwd();
const dir = join(root, "supabase", "migrations");
const names = readdirSync(dir);
const file = names.find((n) => n.endsWith("_payment_accounts_column_privileges.sql"))!;
const raw = readFileSync(join(dir, file), "utf8");
const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const statements = code.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const flatRaw = raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " "); // join the comment lines so a phrase may wrap across lines
const dbSource = readFileSync(join(root, "src", "lib", "supabase", "db.ts"), "utf8");

const list = (s: string) => s.slice(s.indexOf("(") + 1, s.indexOf(")")).split(",").map((c) => c.trim()).sort();
const insertCols = list(statements[1]);
const updateCols = list(statements[2]);

describe("payment_accounts column-privilege migration", () => {
  it("exists, is permission-only, and sorts after the ledger-version columns it protects", () => {
    expect(file).toBeTruthy();
    expect(file > names.find((n) => n.endsWith("_ledger_version_columns.sql"))!).toBe(true);
    expect(code).not.toMatch(/\b(create|alter|drop|insert into|update public|delete from|truncate)\b/i);
    expect(code).not.toMatch(/\bpolicy\b|\btrigger\b|\bfunction\b|security definer|current_user|session_user/i);
  });

  it("is exactly three statements: revoke table-level INSERT/UPDATE from anon and authenticated, then column-level grants to authenticated only", () => {
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe("revoke insert, update on public.payment_accounts from anon, authenticated");
    expect(statements[1]).toMatch(/^grant insert \([a-z_, ]+\) on public\.payment_accounts to authenticated$/);
    expect(statements[2]).toMatch(/^grant update \([a-z_, ]+\) on public\.payment_accounts to authenticated$/);
    // the revoke comes first: a column-level revoke would do nothing while a table-level grant exists
    expect(code.indexOf("revoke insert, update")).toBeLessThan(code.indexOf("grant insert ("));
  });

  it("grants exactly the columns the client writes, and never ledger_version", () => {
    expect(insertCols).toEqual(["balance", "balance_mode", "due_day", "minimum_payment", "name", "remind_days_before", "user_id"]);
    expect(updateCols).toEqual(["balance", "balance_mode", "due_day", "last_reminder_due_date", "minimum_payment", "name", "remind_days_before"]);
    for (const cols of [insertCols, updateCols]) {
      expect(cols).not.toContain("ledger_version");
      expect(cols).not.toContain("id");
      expect(cols).not.toContain("created_at");
    }
    expect(updateCols).not.toContain("user_id"); // an existing account's owner never changes
    expect(insertCols).toContain("user_id"); // the owner is set when the account is created (the RLS check needs it)
  });

  it("grants nothing broader: no table-level grant, no SELECT/DELETE/ALL, nothing to anon or PUBLIC", () => {
    expect(code.match(/\bgrant\b/gi)).toHaveLength(2);
    expect(code).not.toMatch(/\bgrant\s+(all|select|delete|truncate|references|trigger)\b/i);
    expect(code).not.toMatch(/\bto\s+(anon|public|service_role)\b/i);
    expect(statements[0]).not.toMatch(/\bselect\b|\bdelete\b/i);
  });

  it("the client code only ever writes granted columns (insert columns, update patch keys, and the reminder update)", () => {
    // createPaymentAccount's insert object
    const create = dbSource.slice(dbSource.indexOf("export async function createPaymentAccount"), dbSource.indexOf("export async function updatePaymentAccount"));
    const insertBlock = create.slice(create.indexOf(".insert({"), create.indexOf("})", create.indexOf(".insert({")));
    const inserted = new Set([...insertBlock.matchAll(/\b([a-z_]+)\s*:/g)].map((m) => m[1]));
    inserted.add("balance_mode"); // the optional spread { balance_mode: "auto" }
    for (const c of inserted) expect(insertCols, `insert column ${c}`).toContain(c);
    expect(inserted.has("ledger_version")).toBe(false);

    // updatePaymentAccount's patch keys
    const update = dbSource.slice(dbSource.indexOf("export async function updatePaymentAccount"), dbSource.indexOf("export async function deletePaymentAccount"));
    const patched = new Set([...update.matchAll(/patch\.([a-z_]+)\s*=/g)].map((m) => m[1]));
    expect(patched.size).toBeGreaterThanOrEqual(6);
    for (const c of patched) expect(updateCols, `update column ${c}`).toContain(c);

    // every other direct update of payment_accounts in the application
    const others = [...dbSource.matchAll(/from\("payment_accounts"\)\s*\.update\(\{\s*([a-z_]+)\s*:/g)].map((m) => m[1]);
    expect(others).toContain("last_reminder_due_date");
    for (const c of others) expect(updateCols, `update column ${c}`).toContain(c);
  });

  it("no application code reads or writes ledger_version yet, so nothing depends on client access to it", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(d, e.name)] : []));
    const hits = walk(join(root, "src")).filter((f) => /ledger_version/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the trusted writers are SECURITY DEFINER functions with a fixed search path, so revoking client privileges cannot stop them", () => {
    const all = names.map((n) => readFileSync(join(dir, n), "utf8")).join("\n");
    for (const fn of ["record_payment", "reverse_payment", "confirm_payment_goal_completion"]) {
      const at = all.lastIndexOf(`create or replace function public.${fn}(`);
      expect(at, fn).toBeGreaterThan(-1);
      const head = all.slice(at, all.indexOf("as $$", at));
      expect(head, fn).toMatch(/security definer/i);
      expect(head, fn).toMatch(/set search_path = public/i);
    }
  });

  it("explains its mechanism and is honest about what only a live database can prove", () => {
    expect(flatRaw).toContain("RLS decides which ROWS a user may touch; it says nothing about COLUMNS");
    expect(flatRaw).toContain("a column-level REVOKE does nothing while a table-level UPDATE/INSERT grant exists");
    expect(flatRaw).toContain("it does not depend on RLS, on a trigger, or on current_user inside a SECURITY DEFINER function");
    expect(flatRaw).toContain("balance is deliberately STILL client-writable here");
    expect(flatRaw).toContain("WHAT STATIC TESTS CANNOT PROVE");
    expect(flatRaw).toContain("Idempotent (REVOKE and GRANT can be repeated)");
  });
});

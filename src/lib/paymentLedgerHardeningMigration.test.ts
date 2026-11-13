import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here, so this pins Hardening A by inspection, and checks that the application really has no direct ledger writes to lose.
const root = process.cwd();
const dir = join(root, "supabase", "migrations");
const file = readdirSync(dir).find((n) => n.endsWith("_payment_ledger_hardening.sql"))!;
const raw = readFileSync(join(dir, file), "utf8");
const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const statements = code.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

describe("payment ledger hardening migration (Hardening A)", () => {
  it("exists, is forward-only, and sorts after the migrations it builds on", () => {
    expect(file).toBeTruthy();
    for (const dep of ["_payment_confirmation_ledger.sql", "_finance_payment_ledger.sql", "_confirm_payment_goal_lock.sql", "_confirm_payment_goal_precision.sql"]) {
      expect(file > readdirSync(dir).find((n) => n.endsWith(dep))!, dep).toBe(true);
    }
    expect(code).not.toMatch(/\bdrop (table|column|function|trigger)\b/i);
  });

  it("is exactly four statements, all on payment_transactions", () => {
    expect(statements).toEqual([
      "alter table public.payment_transactions add column if not exists created_at timestamptz",
      "alter table public.payment_transactions alter column created_at set default clock_timestamp()",
      'drop policy if exists "payment_transactions_insert_own" on public.payment_transactions',
      "revoke insert, update, delete, truncate on public.payment_transactions from anon, authenticated",
    ]);
  });

  it("adds created_at nullable with NO inline default and no backfill, so legacy rows stay NULL", () => {
    const add = statements[0];
    expect(add).not.toMatch(/\bdefault\b|\bnot null\b/i);
    expect(code).not.toMatch(/\bupdate public\.payment_transactions\b|\binsert into\b/i);
    expect(statements[1]).toContain("clock_timestamp()"); // the actual insert moment, not now() (the transaction start)
    expect(code).not.toMatch(/default now\(\)/i);
  });

  it("keeps SELECT, its policy, and every function and function permission untouched", () => {
    expect(code).not.toMatch(/revoke[^;]*\bselect\b/i);
    expect(code).not.toMatch(/select_own/);
    expect(code).not.toMatch(/\b(create or replace function|alter function|grant execute|revoke execute|revoke all on function)\b/i);
    expect(code).not.toMatch(/payment_accounts|confirm_payment_goal_completion|record_payment|reverse_payment/);
  });

  it("revokes only from the two client roles, not from the service role or the table owner", () => {
    expect(statements[3]).toMatch(/from anon, authenticated$/);
    expect(code).not.toMatch(/service_role|postgres|\bpublic\b\s*;/);
  });

  it("documents a rollback that restores the original policy and grants", () => {
    expect(raw).toContain('grant insert, update, delete, truncate on public.payment_transactions to anon, authenticated;');
    expect(raw).toContain('create policy "payment_transactions_insert_own" on public.payment_transactions for insert with check (user_id = auth.uid());');
  });
});

describe("no application code needs direct writes to the ledger", () => {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(d, e.name)] : []));

  it("the only access to payment_transactions in src is a SELECT", () => {
    const hits: string[] = [];
    for (const f of walk(join(root, "src"))) {
      const text = readFileSync(f, "utf8");
      const re = /from\(\s*["']payment_transactions["']\s*\)([\s\S]{0,300})/g;
      for (let m = re.exec(text); m; m = re.exec(text)) hits.push(f.replace(root, "") + " :: " + (/\.(insert|update|upsert|delete)\(/.test(m[1]) ? "WRITE" : "read"));
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((h) => h.endsWith("WRITE"))).toEqual([]);
  });

  it("the payment functions that DO write are SECURITY DEFINER with a fixed search path (so they do not depend on client privileges)", () => {
    const all = readdirSync(dir).map((n) => readFileSync(join(dir, n), "utf8")).join("\n");
    for (const fn of ["record_payment", "reverse_payment", "confirm_payment_goal_completion"]) {
      const last = all.lastIndexOf(`create or replace function public.${fn}(`);
      expect(last, fn).toBeGreaterThan(-1);
      const head = all.slice(last, all.indexOf("as $$", last));
      expect(head, fn).toMatch(/security definer/i);
      expect(head, fn).toMatch(/set search_path = public/i);
    }
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Static shape tests for the Step 4C.4 migrations. Behaviour, rollback and concurrency are verified on a disposable PostgreSQL, not here.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const read = (suffix: string) => {
  const f = names.find((n) => n.endsWith(suffix))!;
  const raw = readFileSync(join(dir, f), "utf8");
  const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  return { f, raw, code, flat: raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " "), n: code.replace(/\s+/g, " ").trim() };
};
const open = read("_create_opening_checkpoint.sql");
const rec = read("_reconcile_payment_account.sql");
const inOrder = (s: string, parts: string[]) => {
  const idx = parts.map((p) => s.indexOf(p));
  expect(idx.every((i) => i > -1), parts.filter((p) => s.indexOf(p) < 0).join(" | ")).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
};

describe("Step 4C.4 migrations: ordering, scope, nothing automatic", () => {
  it("sort after the entry functions and in dependency order", () => {
    expect(open.f > read("_reverse_account_entry.sql").f).toBe(true);
    expect(rec.f > open.f).toBe(true);
  });
  it("define exactly one function each, change no table/policy/trigger, backfill nothing, create no checkpoint by themselves", () => {
    for (const m of [open, rec]) {
      expect(m.code.match(/create or replace function/g)).toHaveLength(1);
      expect(m.code).not.toMatch(/\b(drop|alter|truncate|delete from|create table|create policy|create trigger|create index)\b/i);
      expect(m.code).not.toMatch(/update public\.payment_transactions|insert into public\.payment_transactions/i);
    }
    // the only data write in either file is the checkpoint insert (and the counter increment) inside create_opening_checkpoint
    expect(rec.code).not.toMatch(/\b(insert|delete)\b|update public\./i);
    expect(open.code.match(/insert into public\.payment_account_entries/g)).toHaveLength(1);
    expect(open.code).not.toMatch(/\bselect\b[^;]*\bfrom public\.payment_accounts\b[^;]*;\s*insert[^;]*select/i);
  });
});

describe("create_opening_checkpoint", () => {
  it("has the documented signature, SECURITY DEFINER, fixed search path and authenticated-only grants", () => {
    expect(open.n).toContain("create or replace function public.create_opening_checkpoint( p_account_id uuid, p_confirmed_balance numeric, p_expected_ledger_version bigint, p_statement_date date, p_note text, p_client_key uuid ) returns table (entry_id uuid, checkpoint_version bigint, account_balance numeric, was_duplicate boolean) language plpgsql security definer set search_path = public");
    expect(open.n).toContain("revoke all on function public.create_opening_checkpoint(uuid, numeric, bigint, date, text, uuid) from public, anon;");
    expect(open.n).toContain("grant execute on function public.create_opening_checkpoint(uuid, numeric, bigint, date, text, uuid) to authenticated;");
    expect(open.code.match(/\bgrant\b/gi)).toHaveLength(1);
  });
  it("requires explicit confirmation of BOTH the balance and the ledger version, checked under the account lock before anything is written", () => {
    inOrder(open.n, [
      "Not authenticated", "A confirmed balance is required", "The ledger version being confirmed is required", "An as-of date is required", "at most 2 decimal places",
      "from public.payment_accounts a where a.id = p_account_id and a.user_id = auth.uid() for update;",
      "e.client_key = p_client_key", "This request key was already used for a different checkpoint", "return query select v_existing, v_existing_version, v_balance, true; return;",
      "This account already has an opening checkpoint",
      "if p_confirmed_balance <> v_balance then raise exception 'The confirmed balance does not match the current tracked balance';",
      "if p_expected_ledger_version <> v_counter then raise exception",
      "set ledger_version = a.ledger_version + 1", "insert into public.payment_account_entries", "return query select v_entry, v_version, v_balance, false;",
    ]);
    expect(open.n.match(/ledger_version = a\.ledger_version \+ 1/g)).toHaveLength(1);
  });
  it("writes a checkpoint of the exact valid shape and never changes the balance", () => {
    expect(open.n).toContain("(p_account_id, auth.uid(), 'checkpoint', 0, 0, true, p_confirmed_balance, p_statement_date, p_statement_date, v_note, p_client_key, v_version)");
    expect(open.code).not.toMatch(/set balance\s*=/i);
  });
  it("documents that nothing is automatic and that statement dates never order anything", () => {
    for (const s of ["Nothing creates one automatically", "never used to order or reconcile anything", "never changes the balance and never \"corrects\" it", "A key already used for anything different raises"])
      expect(open.flat.toLowerCase()).toContain(s.toLowerCase());
  });
});

describe("reconcile_payment_account", () => {
  it("has the documented signature and result columns, SECURITY DEFINER, fixed search path and authenticated-only grants", () => {
    expect(rec.n).toContain("create or replace function public.reconcile_payment_account(p_account_id uuid, p_statement_balance numeric default null) returns table ( checkpoint_id uuid, checkpoint_version bigint, checkpoint_balance numeric, current_ledger_version bigint, calculated_balance numeric, tracked_balance numeric, statement_balance numeric, tracked_difference numeric, statement_difference numeric, version_gap boolean, balance_write_path_open boolean, reliable boolean, status text ) language plpgsql security definer set search_path = public");
    expect(rec.n).toContain("revoke all on function public.reconcile_payment_account(uuid, numeric) from public, anon;");
    expect(rec.n).toContain("grant execute on function public.reconcile_payment_account(uuid, numeric) to authenticated;");
  });
  it("is read-only: no DML at all, takes the account lock FOR SHARE first (ownership by auth.uid()), and reads only after it", () => {
    expect(rec.n).not.toMatch(/\b(insert|delete)\b|update public\./i);
    inOrder(rec.n, ["Not authenticated", "from public.payment_accounts a where a.id = p_account_id and a.user_id = auth.uid() for share;", "has_column_privilege('authenticated', 'public.payment_accounts', 'balance', 'UPDATE')", "e.kind = 'checkpoint'", "v_gap :="]);
    expect(rec.n).not.toMatch(/for update/i);
  });
  it("calculates from the checkpoint using ledger VERSIONS only: applied payments, payment reversals, entry deltas and entry reversal deltas", () => {
    for (const part of [
      "v_cp_balance - coalesce((select sum(t.amount) from public.payment_transactions t where t.account_id = p_account_id and t.balance_applied and t.ledger_version > v_cp_version), 0)",
      "+ coalesce((select sum(t.amount) from public.payment_transactions t where t.account_id = p_account_id and t.balance_applied and t.reversed_version > v_cp_version), 0)",
      "+ coalesce((select sum(e.balance_delta) from public.payment_account_entries e where e.account_id = p_account_id and e.ledger_version > v_cp_version), 0)",
      "- coalesce((select sum(e.balance_delta) from public.payment_account_entries e where e.account_id = p_account_id and e.reversed_version > v_cp_version), 0)",
    ]) expect(rec.n).toContain(part);
    // dates play no part in the calculation
    const calc = rec.n.slice(rec.n.indexOf("v_cp_balance - coalesce"), rec.n.indexOf("into v_calc"));
    expect(calc).not.toMatch(/paid_at|created_at|entry_date|statement_date|reversed_at|now\(\)|clock_timestamp/);
  });
  it("checks the version sequence is complete and reports status in priority order, with the honesty flags", () => {
    expect(rec.n).toContain("v_gap := not (v_n = v_counter - v_cp_version and v_n = v_distinct and (v_n = 0 or (v_min = v_cp_version + 1 and v_max = v_counter)));");
    inOrder(rec.n, ["when v_gap then 'ledger_incomplete'", "when v_tracked <> v_calc then 'tracked_mismatch'", "p_statement_balance <> v_calc then 'statement_mismatch'", "else 'reconciled'"]);
    expect(rec.n).toContain("(not v_gap and not v_open)");
    expect(rec.n).toContain("'no_checkpoint'");
  });
  it("documents the unversioned balance-write path and that statement dates do not map to versions", () => {
    for (const s of ["IT WRITES NOTHING", "balance_write_path_open is TRUE while", "invisible to the versions", "A statement's own date does not map to a ledger version"]) expect(rec.flat).toContain(s);
  });
});

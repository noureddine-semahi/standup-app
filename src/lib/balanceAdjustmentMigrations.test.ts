import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Static shape tests for the Step 4C.4B migrations. Behaviour and concurrency are verified on a disposable PostgreSQL, not here.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const read = (suffix: string) => {
  const f = names.find((n) => n.endsWith(suffix))!;
  const raw = readFileSync(join(dir, f), "utf8");
  const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  return { f, raw, code, flat: raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " "), n: code.replace(/\s+/g, " ").trim() };
};
const expected = read("_record_account_entry_expected_version.sql");
const revoke = read("_revoke_payment_account_balance_update.sql");
const prev = read("_record_account_entry.sql");
const body = (s: string) => s.slice(s.indexOf("create or replace function public.record_account_entry("), s.indexOf("$$;", s.indexOf("as $$")) + 3);
const inOrder = (s: string, parts: string[]) => {
  const idx = parts.map((p) => s.indexOf(p));
  expect(idx.every((i) => i > -1), parts.filter((p) => s.indexOf(p) < 0).join(" | ")).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
};

describe("record_account_entry expected-version migration", () => {
  it("sorts after the function it replaces, drops ONLY the old 10-argument signature, and creates exactly one function", () => {
    expect(expected.f > prev.f).toBe(true);
    expect(expected.code.match(/\bdrop function\b/gi)).toHaveLength(1);
    expect(expected.n).toContain("drop function if exists public.record_account_entry(uuid, text, numeric, date, date, text, text, text, boolean, uuid);");
    expect(expected.code.match(/create or replace function/g)).toHaveLength(1);
    expect(expected.code).not.toMatch(/\b(alter|truncate|delete from|create table|create policy|create trigger|create index)\b/i);
  });
  it("only appends an optional last parameter (default NULL) to the signature; the result table and security settings are unchanged", () => {
    const head = (s: string) => s.slice(0, s.indexOf("as $$"));
    expect(head(body(expected.n))).toBe(head(body(prev.n)).replace("p_client_key uuid )", "p_client_key uuid, p_expected_ledger_version bigint default null )"));
  });
  it("is IDENTICAL to the previous function apart from the counter variable, the lock select, and the one expected-version check", () => {
    const CHECK =
      "if p_expected_ledger_version is not null and p_expected_ledger_version <> v_counter then raise exception 'The account changed since it was loaded; review it and try again'; end if; ";
    const ANCHOR = "-- Allocate";
    const strip = (s: string) => s.replace(/\s+/g, " ");
    // compare code only (comments removed): the check sits right before the allocation update
    const after = body(expected.n);
    const before = body(prev.n);
    const expectedAfter = before
      .replace("p_client_key uuid ) returns", "p_client_key uuid, p_expected_ledger_version bigint default null ) returns")
      .replace("v_balance numeric; v_reason text;", "v_balance numeric; v_counter bigint; v_reason text;")
      .replace("select a.balance_mode, a.balance into v_mode, v_balance from", "select a.balance_mode, a.balance, a.ledger_version into v_mode, v_balance, v_counter from")
      .replace("update public.payment_accounts a set ledger_version = a.ledger_version + 1", CHECK + "update public.payment_accounts a set ledger_version = a.ledger_version + 1");
    expect(strip(after)).toBe(strip(expectedAfter));
    expect(ANCHOR.length).toBeGreaterThan(0);
  });
  it("checks the expected version AFTER the idempotent retry return and BEFORE the allocation, so retries survive a moved version and refusals consume nothing", () => {
    inOrder(body(expected.n), [
      "for update;", "return query select v_existing, v_balance, true; return;", "p_expected_ledger_version is not null and p_expected_ledger_version <> v_counter",
      "The account changed since it was loaded", "set ledger_version = a.ledger_version + 1", "insert into public.payment_account_entries", "set balance = a.balance + v_delta",
    ]);
    expect(body(expected.n).match(/ledger_version = a\.ledger_version \+ 1/g)).toHaveLength(1);
  });
  it("re-states the permissions for the new signature: revoke PUBLIC and anon, grant authenticated only", () => {
    const sig = "(uuid, text, numeric, date, date, text, text, text, boolean, uuid, bigint)";
    expect(expected.n).toContain(`revoke all on function public.record_account_entry${sig} from public, anon;`);
    expect(expected.n).toContain(`grant execute on function public.record_account_entry${sig} to authenticated;`);
    expect(expected.code.match(/\bgrant\b/gi)).toHaveLength(1);
  });
  it("is wrapped in ONE explicit transaction: BEGIN before the drop, COMMIT after the grant, nothing outside it but comments", () => {
    const stmts = expected.code.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    expect(stmts[0]).toBe("begin");
    expect(stmts[stmts.length - 1]).toBe("commit");
    expect(expected.code.match(/\bbegin;/gi) ?? []).toHaveLength(1);
    expect(expected.code.match(/\bcommit;/gi) ?? []).toHaveLength(1);
    expect(expected.n.indexOf("begin;")).toBeLessThan(expected.n.indexOf("drop function"));
    expect(expected.n.indexOf("commit;")).toBeGreaterThan(expected.n.indexOf("grant execute"));
  });
  it("documents why the function is replaced and that nothing calls it yet", () => {
    for (const s of ["would silently overwrite the newer change", "DROPPED in the same script", "Nothing in the app calls record_account_entry yet", "Run the whole file in ONE execution"]) expect(expected.flat).toContain(s);
  });
});

describe("balance UPDATE revoke migration", () => {
  it("sorts after the expected-version migration and is exactly one column-level revoke from authenticated", () => {
    expect(revoke.f > expected.f).toBe(true);
    expect(revoke.n).toBe("revoke update (balance) on public.payment_accounts from authenticated;");
  });
  it("touches nothing else: no grants, no drops, no function or table changes", () => {
    expect(revoke.code).not.toMatch(/\b(grant|drop|alter|create|truncate|insert|delete)\b/i);
    expect(revoke.code).not.toMatch(/ledger_version|anon/);
  });
  it("states that it must NOT run before the app release, what keeps working, and the rollback", () => {
    for (const s of ["DO NOT RUN THIS BEFORE THE 4C.4B APP RELEASE IS LIVE AND VERIFIED", "SECURITY DEFINER functions owned by postgres", "balance_write_path_open = false", "ROLLBACK"]) expect(revoke.flat).toContain(s);
  });
  it("the privilege model it relies on is the column-level grant list from 20261205000100 (balance is in it today)", () => {
    const priv = read("_payment_accounts_column_privileges.sql").n;
    expect(priv).toMatch(/grant update \([^)]*\bbalance\b[^)]*\) on public\.payment_accounts to authenticated;/);
  });
});

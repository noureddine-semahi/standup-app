import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Static shape tests for the three Step 4C.3 migrations. Behaviour, rollback and concurrency are verified on a disposable PostgreSQL, not here.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const read = (suffix: string) => {
  const f = names.find((n) => n.endsWith(suffix))!;
  const raw = readFileSync(join(dir, f), "utf8");
  const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  return { f, raw, code, flat: raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " "), n: code.replace(/\s+/g, " ").trim() };
};
const guard = read("_payment_account_entries_version_guard.sql");
const record = read("_record_account_entry.sql");
const reverse = read("_reverse_account_entry.sql");
const base = read("_payment_account_entries.sql");
const versions = read("_ledger_version_columns.sql");
const at = (s: string, x: string) => s.indexOf(x);
const inOrder = (s: string, parts: string[]) => {
  const idx = parts.map((p) => at(s, p));
  expect(idx.every((i) => i > -1), parts.filter((p) => at(s, p) < 0).join(" | ")).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
};

describe("Step 4C.3 migrations: ordering and scope", () => {
  it("sort after the schema, version columns and payment RPC migrations, in dependency order", () => {
    for (const dep of [base, versions, read("_reverse_payment_version_stamp.sql")]) expect(guard.f > dep.f).toBe(true);
    expect(record.f > guard.f).toBe(true);
    expect(reverse.f > record.f).toBe(true);
  });
  it("each file does only its own job: no table/column/policy/index changes, no checkpoint creation, no data statements", () => {
    for (const m of [guard, record, reverse]) {
      expect(m.code).not.toMatch(/\b(drop|alter|truncate|delete from|create table|create policy|create index|update public\.payment_transactions|insert into public\.payment_transactions)\b/i);
      expect(m.code).not.toMatch(/'checkpoint'\s*,?\s*(0|amount)/i);
    }
    expect(guard.code.match(/create or replace function/g)).toHaveLength(1);
    expect(guard.code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(record.code.match(/create or replace function/g)).toHaveLength(1);
    expect(reverse.code.match(/create or replace function/g)).toHaveLength(1);
  });
});

describe("version guard (trigger function)", () => {
  it("keeps every column the old trigger froze and adds ledger_version", () => {
    const oldList = base.n.slice(base.n.indexOf("create or replace function public.payment_account_entries_immutable"));
    for (const c of ["id", "account_id", "user_id", "kind", "amount", "balance_delta", "balance_applied", "balance_after", "entry_date", "statement_date", "reason", "note", "client_key", "created_at", "seq"]) {
      expect(oldList).toContain(`new.${c}`);
      expect(guard.n).toContain(`new.${c}`);
      expect(guard.n).toContain(`old.${c}`);
    }
    expect(guard.n).toContain("new.seq, new.ledger_version)");
    expect(guard.n).toContain("old.seq, old.ledger_version)");
  });
  it("keeps the reversed_at rule and adds the reversed_version and versioned-reversal rules", () => {
    expect(guard.n).toContain("if old.reversed_at is not null and new.reversed_at is distinct from old.reversed_at then raise exception 'This entry has already been reversed';");
    expect(guard.n).toContain("if old.reversed_version is not null and new.reversed_version is distinct from old.reversed_version then raise exception 'This entry has already been reversed';");
    expect(guard.n).toContain("if old.reversed_at is null and new.reversed_at is not null and new.reversed_version is null then raise exception 'A reversal must carry a ledger version';");
  });
  it("is a plain trigger function (not SECURITY DEFINER) and does not recreate the trigger", () => {
    expect(guard.n).toContain("returns trigger language plpgsql as $$");
    expect(guard.code).not.toMatch(/security definer|create trigger|drop trigger/i);
  });
});

describe("record_account_entry", () => {
  const sig = "create or replace function public.record_account_entry( p_account_id uuid, p_kind text, p_amount numeric, p_entry_date date, p_statement_date date, p_reason text, p_note text, p_direction text, p_apply_balance boolean, p_client_key uuid ) returns table (entry_id uuid, new_balance numeric, was_duplicate boolean) language plpgsql security definer set search_path = public";
  it("has the documented signature, SECURITY DEFINER and a fixed search path", () => {
    expect(record.n).toContain(sig);
  });
  it("revokes PUBLIC and anon and grants execute to authenticated only", () => {
    const s = "(uuid, text, numeric, date, date, text, text, text, boolean, uuid)";
    expect(record.n).toContain(`revoke all on function public.record_account_entry${s} from public, anon;`);
    expect(record.n).toContain(`grant execute on function public.record_account_entry${s} to authenticated;`);
    expect(record.code.match(/\bgrant\b/gi)).toHaveLength(1);
  });
  it("validates everything BEFORE the account lock; locks the account, then looks up the key, then allocates once, then inserts, then updates the balance", () => {
    inOrder(record.n, [
      "Not authenticated", "Entry kind must be interest, fee or adjustment", "Entry amount must be greater than zero", "at most 2 decimal places", "Entry date is required",
      "Interest requires a statement date", "An adjustment requires a direction", "An adjustment requires a reason", "A direction applies only to adjustments",
      "from public.payment_accounts a where a.id = p_account_id and a.user_id = auth.uid() for update;", "from public.payment_account_entries e where e.user_id = auth.uid() and e.client_key = p_client_key",
      "raise exception 'This request key was already used for a different entry'", "return query select v_existing, v_balance, true; return;",
      "set ledger_version = a.ledger_version + 1", "insert into public.payment_account_entries", "set balance = a.balance + v_delta", "return query select v_entry, v_balance, false;",
    ]);
    expect(record.n.match(/ledger_version = a\.ledger_version \+ 1/g)).toHaveLength(1);
  });
  it("accepts only interest, fee, adjustment (never checkpoint) and stamps the version on the row", () => {
    expect(record.n).toContain("p_kind not in ('interest', 'fee', 'adjustment')");
    expect(record.n).toContain("client_key, ledger_version) values");
    expect(record.n).toContain("v_note, p_client_key, v_version) returning id into v_entry;");
    expect(record.n).not.toMatch(/balance_after|'checkpoint'/);
  });
  it("derives the signed effect: adjustments always applied, interest/fee only on auto accounts or when ticked, decrease negative", () => {
    expect(record.n).toContain("v_apply := p_kind = 'adjustment' or v_mode = 'auto' or coalesce(p_apply_balance, false);");
    expect(record.n).toContain("v_delta := case when not v_apply then 0 when p_direction = 'decrease' then -p_amount else p_amount end;");
  });
  it("compares account, kind, amount, signed effect, entry date and statement date on a retry", () => {
    for (const c of ["v_existing_account is distinct from p_account_id", "v_existing_kind is distinct from p_kind", "v_existing_amount is distinct from p_amount", "v_existing_delta is distinct from v_delta", "v_existing_entry_date is distinct from p_entry_date", "v_existing_statement_date is distinct from p_statement_date"]) expect(record.n).toContain(c);
  });
  it("only ever scopes by the caller (auth.uid()) and never trusts a user id argument", () => {
    expect(record.n).not.toMatch(/p_user_id/);
    expect(record.n.match(/auth\.uid\(\)/g)!.length).toBeGreaterThanOrEqual(5);
    expect(record.n).toContain("(p_account_id, auth.uid(), p_kind");
  });
  it("documents idempotency, ordering, atomicity and permissions", () => {
    for (const s of ["A retry or a rejected request returns before the version is allocated, so it consumes none", "one function call, i.e. one transaction", "the only way to create a row in payment_account_entries", "a checkpoint is NOT creatable here"]) expect(record.flat.toLowerCase()).toContain(s.toLowerCase());
  });
});

describe("reverse_account_entry", () => {
  it("has the documented signature, SECURITY DEFINER and a fixed search path, and grants authenticated only", () => {
    expect(reverse.n).toContain("create or replace function public.reverse_account_entry(p_entry_id uuid) returns numeric language plpgsql security definer set search_path = public");
    expect(reverse.n).toContain("revoke all on function public.reverse_account_entry(uuid) from public, anon;");
    expect(reverse.n).toContain("grant execute on function public.reverse_account_entry(uuid) to authenticated;");
    expect(reverse.code.match(/\bgrant\b/gi)).toHaveLength(1);
  });
  it("locks account first, then the entry row, revalidates, rejects checkpoints and duplicates BEFORE allocating once, then stamps and restores", () => {
    inOrder(reverse.n, [
      "Not authenticated",
      "from public.payment_account_entries e where e.id = p_entry_id and e.user_id = auth.uid(); if not found", // unlocked hint
      "from public.payment_accounts a where a.id = v_hint_account and a.user_id = auth.uid() for update;",
      "from public.payment_account_entries e where e.id = p_entry_id and e.user_id = auth.uid() for update;",
      "A reconciliation checkpoint cannot be reversed", "This entry has already been reversed",
      "set ledger_version = a.ledger_version + 1",
      "set reversed_at = clock_timestamp(), reversed_version = v_version where id = p_entry_id;",
      "set balance = a.balance - v_delta",
    ]);
    expect(reverse.n.match(/ledger_version = a\.ledger_version \+ 1/g)).toHaveLength(1);
  });
  it("lock order is account then entry (acyclic with the payment functions) and it never deletes", () => {
    const locks: { at: number; r: string }[] = [];
    for (const [re, r] of [[/from public\.payment_accounts a [^;]*for update/g, "account"], [/from public\.payment_account_entries e [^;]*for update/g, "entry"]] as [RegExp, string][])
      for (let m = re.exec(reverse.n); m; m = re.exec(reverse.n)) locks.push({ at: m.index, r });
    expect(locks.sort((a, b) => a.at - b.at).map((l) => l.r)).toEqual(["account", "entry"]);
    expect(reverse.code).not.toMatch(/delete from/i);
  });
  it("documents that nothing is deleted and that rejections consume no version", () => {
    expect(reverse.flat).toContain("never deleted or edited");
    expect(reverse.flat).toContain("none consumes a version");
  });
});

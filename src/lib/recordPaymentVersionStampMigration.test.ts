import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here. Part 1 pins the migration's text (the function is IDENTICAL to the existing one apart from the version allocation and stamp,
// and the lock order is unchanged). Part 2 is a small reference MODEL of the intended semantics: it documents and regression-tests the design intent, it is NOT
// the SQL and proves nothing about PostgreSQL. Concurrency and transactional behaviour need a real PostgreSQL test.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const read = (suffix: string) => {
  const f = names.find((n) => n.endsWith(suffix))!;
  const raw = readFileSync(join(dir, f), "utf8");
  return { f, raw, code: raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n") };
};
const stamp = read("_record_payment_version_stamp.sql");
const ledger = read("_finance_payment_ledger.sql");
const fnBody = (code: string, name: string) => {
  const start = code.lastIndexOf(`create or replace function public.${name}(`);
  const end = code.indexOf("$$;", code.indexOf("as $$", start)) + 3;
  return code.slice(start, end);
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const after = norm(fnBody(stamp.code, "record_payment"));
const before = norm(fnBody(ledger.code, "record_payment"));
const flatRaw = stamp.raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " ");

const OLD_INSERT =
  "v_apply := (v_mode = 'auto') or coalesce(p_apply_balance, false); insert into public.payment_transactions (account_id, user_id, amount, paid_at, note, balance_applied, client_key) values (p_account_id, auth.uid(), p_amount, coalesce(p_paid_at, now()), nullif(btrim(p_note), ''), v_apply, p_client_key) returning id into v_txn;";
const NEW_INSERT =
  "v_apply := (v_mode = 'auto') or coalesce(p_apply_balance, false); update public.payment_accounts a set ledger_version = a.ledger_version + 1 where a.id = p_account_id and a.user_id = auth.uid() returning a.ledger_version into v_version; insert into public.payment_transactions (account_id, user_id, amount, paid_at, note, balance_applied, client_key, ledger_version) values (p_account_id, auth.uid(), p_amount, coalesce(p_paid_at, now()), nullif(btrim(p_note), ''), v_apply, p_client_key, v_version) returning id into v_txn;";

describe("record_payment version-stamp migration", () => {
  it("is forward-only, sorts after the migrations it depends on, replaces only record_payment, and leaves every permission alone", () => {
    expect(stamp.f).toBeTruthy();
    for (const dep of ["_finance_payment_ledger.sql", "_ledger_version_columns.sql", "_payment_accounts_column_privileges.sql", "_revoke_anon_payment_functions.sql"]) expect(stamp.f > read(dep).f, dep).toBe(true);
    expect(stamp.code.match(/create or replace function/g)).toHaveLength(1);
    expect(stamp.code).toContain("create or replace function public.record_payment(");
    expect(stamp.code).not.toMatch(/\b(grant|revoke|drop|alter|truncate|insert into public\.payment_account|delete from)\b/i);
    expect(stamp.code).not.toMatch(/function public\.(reverse_payment|confirm_payment_goal_completion)\(/);
    expect(stamp.code).not.toMatch(/reversed_version|checkpoint/i);
  });

  it("is IDENTICAL to the existing function apart from the version variable, the version update, and the ledger_version column in the insert", () => {
    const expected = before.replace("v_apply boolean; begin", "v_apply boolean; v_version bigint; begin").replace(OLD_INSERT, NEW_INSERT);
    expect(before).toContain(OLD_INSERT);
    expect(after).toBe(expected);
  });

  it("keeps the signature, SECURITY DEFINER, the search path, the returned table and the balance-mode rule exactly", () => {
    const head = (s: string) => s.slice(0, s.indexOf("as $$"));
    expect(head(after)).toBe(head(before));
    expect(after).toContain("returns table (transaction_id uuid, new_balance numeric, was_duplicate boolean)");
    expect(after).toContain("language plpgsql security definer set search_path = public");
    expect(after).toContain("v_apply := (v_mode = 'auto') or coalesce(p_apply_balance, false);");
    expect(after).toContain("if v_apply then update public.payment_accounts a set balance = a.balance - p_amount");
    expect(after).toContain("return query select v_txn, v_balance, false;");
  });

  it("locks the account BEFORE allocating the version, returns idempotent retries BEFORE it, and allocates before the insert", () => {
    const at = (s: string) => after.indexOf(s);
    const order = [
      "Not authenticated",
      "at most 2 decimal places", // validation raises before any row is touched
      "from public.payment_accounts a where a.id = p_account_id and a.user_id = auth.uid() for update;", // the account lock
      "return query select v_existing, v_balance, true; return;", // the idempotent retry
      "set ledger_version = a.ledger_version + 1", // the one allocation
      "insert into public.payment_transactions",
      "set balance = a.balance - p_amount",
    ].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("increments exactly once, by one, only for this account and owner, and stamps that same value on the new row", () => {
    expect(after.match(/ledger_version = a\.ledger_version \+ 1/g)).toHaveLength(1);
    expect(after).toContain("update public.payment_accounts a set ledger_version = a.ledger_version + 1 where a.id = p_account_id and a.user_id = auth.uid() returning a.ledger_version into v_version;");
    expect(after.match(/v_version/g)).toHaveLength(3); // declared, assigned by the update, stamped on the insert
    expect(after).toContain("balance_applied, client_key, ledger_version) values (");
    expect(after).toContain("v_apply, p_client_key, v_version) returning id into v_txn;");
    expect(after).not.toMatch(/reversed_version/);
  });

  it("does not change the lock order: it is still account only, so the three-function wait-for graph stays acyclic", () => {
    const locks = (body: string) => {
      const hits: { at: number; res: string }[] = [];
      for (const [re, res] of [[/from public\.goals [^;]*for update/g, "goal"], [/from public\.payment_accounts [^;]*for update/g, "account"], [/from public\.payment_transactions t [^;]*for update/g, "txn"],
        [/\bupdate public\.goals\b/g, "goal"], [/\bupdate public\.payment_accounts\b/g, "account"], [/\bupdate public\.payment_transactions\b/g, "txn"]] as [RegExp, string][]) {
        for (let m = re.exec(body); m; m = re.exec(body)) hits.push({ at: m.index, res });
      }
      const seen = new Set<string>();
      return hits.sort((a, b) => a.at - b.at).map((h) => h.res).filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
    };
    expect(locks(after)).toEqual(["account"]);
    expect(locks(before)).toEqual(["account"]);
  });

  it("documents the allocation, the retry and rollback rules, that other writers are not stamped yet, and what only PostgreSQL can prove", () => {
    expect(flatRaw).toContain("each one reads the committed counter, adds one, and stamps its own row");
    expect(flatRaw).toContain("A RETRY carrying a client_key that already exists RETURNS BEFORE the version is allocated".replace("A RETRY", "a retry"));
    expect(flatRaw).toContain("a failed or rolled-back payment never consumes a version");
    expect(flatRaw).toContain("confirm_payment_goal_completion() and reverse_payment() are untouched");
    expect(flatRaw).toContain("NO checkpoint may be created");
    expect(flatRaw).toContain("WHAT STATIC TESTS CANNOT PROVE");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Part 2: a reference MODEL of the intended semantics (documentation and regression of the design; NOT the SQL, and no proof about PostgreSQL).
type Account = { id: string; balanceCents: number; mode: "auto" | "manual"; version: number };
type Txn = { id: string; accountId: string; amountCents: number; applied: boolean; key: string | null; version: number };
type Db = { accounts: Map<string, Account>; txns: Txn[] };
const clone = (db: Db): Db => ({ accounts: new Map([...db.accounts].map(([k, v]) => [k, { ...v }])), txns: db.txns.map((t) => ({ ...t })) });

/** One call = one transaction: work on a copy and commit it only if nothing throws. */
function recordPayment(db: Db, a: { accountId: string; amountCents: number; apply?: boolean; key?: string | null; failAfterAllocation?: boolean }) {
  const work = clone(db);
  if (!Number.isInteger(a.amountCents) || a.amountCents <= 0) throw new Error("Payment amount must be greater than zero");
  const acct = work.accounts.get(a.accountId);
  if (!acct) throw new Error("Account not found");
  if (a.key) {
    const dup = work.txns.find((t) => t.key === a.key);
    if (dup) return { result: { txnId: dup.id, balanceCents: acct.balanceCents, duplicate: true }, db };
  }
  const apply = acct.mode === "auto" || !!a.apply;
  acct.version += 1; // the one allocation, under the (modelled) account lock
  if (a.failAfterAllocation) throw new Error("insert failed");
  const txn: Txn = { id: `t${work.txns.length + 1}`, accountId: acct.id, amountCents: a.amountCents, applied: apply, key: a.key ?? null, version: acct.version };
  work.txns.push(txn);
  if (apply) acct.balanceCents -= a.amountCents;
  return { result: { txnId: txn.id, balanceCents: acct.balanceCents, duplicate: false }, db: work };
}
const fresh = (mode: "auto" | "manual"): Db => ({ accounts: new Map([["a1", { id: "a1", balanceCents: 50000, mode, version: 0 }]]), txns: [] });
const attempt = (db: Db, args: Parameters<typeof recordPayment>[1]) => {
  try {
    return { ok: true as const, ...recordPayment(db, args) };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message, db }; // a failed call changes nothing
  }
};

describe("reference model of the intended semantics (not the SQL)", () => {
  it("a new payment increments the version once and stamps that value on its row, in the same step as the balance change", () => {
    const r = recordPayment(fresh("auto"), { accountId: "a1", amountCents: 2500, key: "k1" });
    expect(r.db.accounts.get("a1")!.version).toBe(1);
    expect(r.db.txns).toEqual([expect.objectContaining({ version: 1, applied: true })]);
    expect(r.db.accounts.get("a1")!.balanceCents).toBe(47500);
  });

  it("versions are consecutive and each row is stamped with the account version at that moment (no gaps, no repeats)", () => {
    let db = fresh("auto");
    for (let i = 1; i <= 4; i++) db = recordPayment(db, { accountId: "a1", amountCents: 100, key: `k${i}` }).db;
    expect(db.txns.map((t) => t.version)).toEqual([1, 2, 3, 4]);
    expect(db.accounts.get("a1")!.version).toBe(4);
  });

  it("an idempotent retry returns the original transaction and changes neither the version nor the balance", () => {
    const first = recordPayment(fresh("auto"), { accountId: "a1", amountCents: 2500, key: "k1" });
    const retry = recordPayment(first.db, { accountId: "a1", amountCents: 2500, key: "k1" });
    expect(retry.result).toEqual({ txnId: first.result.txnId, balanceCents: 47500, duplicate: true });
    expect(retry.db.accounts.get("a1")!.version).toBe(1);
    expect(retry.db.txns).toHaveLength(1);
  });

  it("failed calls consume no version: a validation error, an unknown account, and a failure after the allocation all roll back completely", () => {
    const start = recordPayment(fresh("auto"), { accountId: "a1", amountCents: 100, key: "k1" }).db; // version 1
    for (const args of [
      { accountId: "a1", amountCents: 0 },
      { accountId: "a1", amountCents: 12.5 },
      { accountId: "nope", amountCents: 100 },
      { accountId: "a1", amountCents: 100, key: "k2", failAfterAllocation: true },
    ]) {
      const r = attempt(start, args);
      expect(r.ok).toBe(false);
      expect(r.db.accounts.get("a1")!.version).toBe(1);
      expect(r.db.txns).toHaveLength(1);
    }
    // and the next real payment gets version 2, not 3
    expect(recordPayment(start, { accountId: "a1", amountCents: 100, key: "k3" }).db.txns[1].version).toBe(2);
  });

  it("manual accounts still stamp a version but leave the balance alone unless the payment is explicitly applied; auto always applies", () => {
    const manual = recordPayment(fresh("manual"), { accountId: "a1", amountCents: 2500, key: "m1" });
    expect(manual.db.accounts.get("a1")!.version).toBe(1);
    expect(manual.db.accounts.get("a1")!.balanceCents).toBe(50000);
    expect(manual.db.txns[0]).toEqual(expect.objectContaining({ applied: false, version: 1 }));
    const ticked = recordPayment(manual.db, { accountId: "a1", amountCents: 1000, apply: true, key: "m2" });
    expect(ticked.db.accounts.get("a1")!.balanceCents).toBe(49000);
    expect(ticked.db.txns[1]).toEqual(expect.objectContaining({ applied: true, version: 2 }));
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Static shape tests. Concurrency/transaction behaviour is verified on a disposable PostgreSQL, not here.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const read = (suffix: string) => {
  const f = names.find((n) => n.endsWith(suffix))!;
  const raw = readFileSync(join(dir, f), "utf8");
  return { f, raw, code: raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n") };
};
const fnBody = (code: string, name: string) => {
  const start = code.lastIndexOf(`create or replace function public.${name}(`);
  const end = code.indexOf("$$;", code.indexOf("as $$", start)) + 3;
  return code.slice(start, end);
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const mig = read("_reverse_payment_version_stamp.sql");
const prev = read("_reverse_payment_lock_order.sql");
const after = norm(fnBody(mig.code, "reverse_payment"));
const before = norm(fnBody(prev.code, "reverse_payment"));
const flatRaw = mig.raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " ");

const OLD_STAMP = "update public.payment_transactions set reversed_at = clock_timestamp() where id = p_transaction_id;";
const ALLOC = "update public.payment_accounts a set ledger_version = a.ledger_version + 1 where a.id = v_account and a.user_id = auth.uid() returning a.ledger_version into v_version;";
const NEW_STAMP = "update public.payment_transactions set reversed_at = clock_timestamp(), reversed_version = v_version where id = p_transaction_id;";

describe("reverse_payment version-stamp migration", () => {
  it("is forward-only, sorts after the lock-order migration, replaces only this function, touches no permission", () => {
    expect(mig.f > prev.f).toBe(true);
    expect(mig.code.match(/create or replace function/g)).toHaveLength(1);
    expect(mig.code).not.toMatch(/\b(grant|revoke|drop|alter|truncate|delete from)\b/i);
    expect(mig.code).not.toMatch(/function public\.(record_payment|confirm_payment_goal_completion)\(/);
    expect(mig.code).not.toMatch(/checkpoint/i);
  });

  it("is IDENTICAL to the previous function apart from the version variable, the allocation and the reversed_version stamp", () => {
    expect(before).toContain(OLD_STAMP);
    const expected = before.replace("v_balance numeric; begin", "v_balance numeric; v_version bigint; begin").replace(OLD_STAMP, `${ALLOC} ${NEW_STAMP}`);
    expect(after).toBe(expected);
  });

  it("keeps signature, SECURITY DEFINER and search path", () => {
    const head = (s: string) => s.slice(0, s.indexOf("as $$"));
    expect(head(after)).toBe(head(before));
  });

  it("allocates only after both locks and after the not-found / already-reversed checks, exactly once, before the stamp and the balance restore", () => {
    const at = (s: string) => after.indexOf(s);
    const order = [
      "from public.payment_accounts a where a.id = v_hint_account and a.user_id = auth.uid() for update;",
      "from public.payment_transactions t where t.id = p_transaction_id and t.user_id = auth.uid() for update;",
      "This payment has already been reversed",
      "set ledger_version = a.ledger_version + 1",
      "set reversed_at = clock_timestamp(), reversed_version = v_version",
      "set balance = a.balance + v_amount",
    ].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(after.match(/ledger_version = a\.ledger_version \+ 1/g)).toHaveLength(1);
  });

  it("lock order stays account then payment row", () => {
    const locks = (body: string) => {
      const hits: { at: number; res: string }[] = [];
      for (const [re, res] of [[/from public\.payment_accounts a [^;]*for update/g, "account"], [/from public\.payment_transactions t [^;]*for update/g, "txn"]] as [RegExp, string][]) {
        for (let m = re.exec(body); m; m = re.exec(body)) hits.push({ at: m.index, res });
      }
      return hits.sort((a, b) => a.at - b.at).map((h) => h.res);
    };
    expect(locks(after)).toEqual(["account", "txn"]);
    expect(locks(before)).toEqual(["account", "txn"]);
  });

  it("documents allocation, duplicates and legacy rows", () => {
    expect(flatRaw).toContain("a duplicate reversal consumes no version");
    expect(flatRaw).toContain("LEGACY ROWS");
    expect(flatRaw).toContain("Permissions are NOT touched");
  });
});

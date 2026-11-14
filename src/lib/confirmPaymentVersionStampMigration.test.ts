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
const mig = read("_confirm_payment_goal_version_stamp.sql");
const prev = read("_confirm_payment_goal_account_lock.sql");
const after = norm(fnBody(mig.code, "confirm_payment_goal_completion"));
const before = norm(fnBody(prev.code, "confirm_payment_goal_completion"));
const flatRaw = mig.raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " ");

const OLD_INSERT = "insert into public.payment_transactions (account_id, user_id, goal_id, amount, balance_applied) values (v_account_id, auth.uid(), p_goal_id, p_amount, coalesce(v_mode, 'auto') = 'auto');";
const ALLOC = "update public.payment_accounts set ledger_version = ledger_version + 1 where id = v_account_id and user_id = auth.uid() returning ledger_version into v_version; if v_version is null then raise exception 'Account not found'; end if;";
const NEW_INSERT = "insert into public.payment_transactions (account_id, user_id, goal_id, amount, balance_applied, ledger_version) values (v_account_id, auth.uid(), p_goal_id, p_amount, coalesce(v_mode, 'auto') = 'auto', v_version);";

describe("confirm_payment_goal_completion version-stamp migration", () => {
  it("is forward-only, sorts after the lock migration, replaces only this function, touches no permission", () => {
    expect(mig.f > prev.f).toBe(true);
    expect(mig.code.match(/create or replace function/g)).toHaveLength(1);
    expect(mig.code).not.toMatch(/\b(grant|revoke|drop|alter|truncate|delete from)\b/i);
    expect(mig.code).not.toMatch(/function public\.(reverse_payment|record_payment)\(/);
    expect(mig.code).not.toMatch(/reversed_version|checkpoint/i);
  });

  it("is IDENTICAL to the previous function apart from the version variable, the allocation and the stamped insert", () => {
    expect(before).toContain(OLD_INSERT);
    const expected = before.replace("v_new_balance numeric; begin", "v_new_balance numeric; v_version bigint; begin").replace(OLD_INSERT, `${ALLOC} ${NEW_INSERT}`);
    expect(after).toBe(expected);
  });

  it("keeps signature, SECURITY DEFINER and search path", () => {
    const head = (s: string) => s.slice(0, s.indexOf("as $$"));
    expect(head(after)).toBe(head(before));
  });

  it("allocates only after goal lock, account lock, and the already-confirmed check; exactly once; before the insert", () => {
    const at = (s: string) => after.indexOf(s);
    const order = [
      "from public.goals where id = p_goal_id and user_id = auth.uid() for update;",
      "This payment has already been confirmed",
      "from public.payment_accounts where id = v_account_id and user_id = auth.uid() for update;",
      "update public.goals set status = 'completed'",
      "set ledger_version = ledger_version + 1",
      "insert into public.payment_transactions",
      "set balance = balance - p_amount",
    ].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(after.match(/ledger_version = ledger_version \+ 1/g)).toHaveLength(1);
  });

  it("lock order stays goal then account (acyclic with record_payment and reverse_payment)", () => {
    const locks = (body: string) => {
      const hits: { at: number; res: string }[] = [];
      for (const [re, res] of [[/from public\.goals [^;]*for update/g, "goal"], [/from public\.payment_accounts [^;]*for update/g, "account"], [/\bupdate public\.payment_accounts\b/g, "account"]] as [RegExp, string][]) {
        for (let m = re.exec(body); m; m = re.exec(body)) hits.push({ at: m.index, res });
      }
      const seen = new Set<string>();
      return hits.sort((a, b) => a.at - b.at).map((h) => h.res).filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
    };
    expect(locks(after)).toEqual(["goal", "account"]);
    expect(locks(before)).toEqual(["goal", "account"]);
  });

  it("documents allocation, idempotency and unchanged behaviour", () => {
    expect(flatRaw).toContain("consumes none");
    expect(flatRaw).toContain("so a failed confirmation consumes no version");
    expect(flatRaw).toContain("Permissions are NOT touched");
  });
});

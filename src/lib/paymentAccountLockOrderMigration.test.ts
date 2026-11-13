import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here, so this pins the lock-order migration by inspection: the ONLY change to confirm_payment_goal_completion is "for update" on
// the balance_mode SELECT, and the lock order across all three payment functions stays acyclic.
const dir = join(process.cwd(), "supabase", "migrations");
const read = (suffix: string) => {
  const f = readdirSync(dir).find((n) => n.endsWith(suffix))!;
  return { f, code: readFileSync(join(dir, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n") };
};
const fix = read("_confirm_payment_goal_account_lock.sql");
const prec = read("_confirm_payment_goal_precision.sql");
const ledger = read("_finance_payment_ledger.sql");
const fnBody = (code: string, name: string) => {
  const start = code.lastIndexOf(`create or replace function public.${name}(`);
  const end = code.indexOf("$$;", code.indexOf("as $$", start)) + 3;
  return code.slice(start, end);
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const MODE_READ = "select balance_mode into v_mode from public.payment_accounts where id = v_account_id and user_id = auth.uid()";

describe("confirm_payment_goal_completion account-lock migration", () => {
  it("is forward-only, sorts after the migrations it builds on, and replaces only this one function", () => {
    expect(fix.f).toBeTruthy();
    for (const dep of ["_finance_payment_ledger.sql", "_confirm_payment_goal_lock.sql", "_confirm_payment_goal_precision.sql", "_payment_ledger_hardening.sql"]) expect(fix.f > read(dep).f, dep).toBe(true);
    expect(fix.code.match(/create or replace function/g)).toHaveLength(1);
    expect(fix.code).not.toMatch(/\b(drop|alter|truncate|delete from)\b/i);
    expect(fix.code).not.toMatch(/function public\.(record_payment|reverse_payment)\(/);
  });

  it("is IDENTICAL to the FIN-02.1 function apart from FOR UPDATE on the balance_mode read", () => {
    const before = norm(fnBody(prec.code, "confirm_payment_goal_completion"));
    const after = norm(fnBody(fix.code, "confirm_payment_goal_completion"));
    expect(before).toContain(MODE_READ + ";");
    expect(after).toContain(MODE_READ + " for update;");
    expect(after.replace(MODE_READ + " for update;", MODE_READ + ";")).toBe(before);
  });

  it("takes the locks in order goal -> account, both before ANY write, with the validation first", () => {
    const body = norm(fnBody(fix.code, "confirm_payment_goal_completion"));
    const at = (s: string) => body.indexOf(s);
    const order = [
      "Amount must be zero or positive",
      "at most 2 decimal places", // FIN-02.1 validation, still first
      "from public.goals where id = p_goal_id and user_id = auth.uid() for update;", // FIN-01 goal lock, still present
      "This payment has already been confirmed",
      MODE_READ + " for update;", // the new account lock
      "set_config('app.allow_payment_goal_complete'",
      "update public.goals set status = 'completed'",
      "insert into public.payment_transactions",
      "update public.payment_accounts set balance = balance - p_amount",
    ].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps authorization, balance modes, the guard flag and the security settings and grants unchanged", () => {
    const body = norm(fnBody(fix.code, "confirm_payment_goal_completion"));
    expect(body).toContain("language plpgsql security definer set search_path = public");
    expect(body).toContain("coalesce(v_mode, 'auto') = 'auto'");
    expect(body).toContain("perform set_config('app.allow_payment_goal_complete', 'true', true);");
    expect((body.match(/auth\.uid\(\)/g) ?? []).length).toBe((norm(fnBody(prec.code, "confirm_payment_goal_completion")).match(/auth\.uid\(\)/g) ?? []).length);
    const perms = (c: string) => c.match(/(revoke all on function public\.confirm_payment_goal_completion\(uuid, numeric\) from public;|grant execute on function public\.confirm_payment_goal_completion\(uuid, numeric\) to authenticated;)/g);
    expect(perms(fix.code)).toEqual(perms(prec.code));
  });
});

describe("lock acquisition order across the three payment functions has no cycle", () => {
  // The first lock each function takes on each resource, read from the SQL itself: row-level FOR UPDATE selects, and UPDATE statements.
  const locks = (body: string): string[] => {
    const hits: { at: number; res: string }[] = [];
    const patterns: [RegExp, string][] = [
      [/from public\.goals [^;]*for update/g, "goal"],
      [/from public\.payment_accounts [^;]*for update/g, "account"],
      [/from public\.payment_transactions [^;]*for update/g, "txn"],
      [/\bupdate public\.goals\b/g, "goal"],
      [/\bupdate public\.payment_accounts\b/g, "account"],
      [/\bupdate public\.payment_transactions\b/g, "txn"],
    ];
    for (const [re, res] of patterns) for (let m = re.exec(body); m; m = re.exec(body)) hits.push({ at: m.index, res });
    const seen = new Set<string>();
    return hits.sort((a, b) => a.at - b.at).map((h) => h.res).filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
  };
  const fns = {
    confirm: locks(norm(fnBody(fix.code, "confirm_payment_goal_completion"))),
    record: locks(norm(fnBody(ledger.code, "record_payment"))),
    reverse: locks(norm(fnBody(ledger.code, "reverse_payment"))),
  };

  it("reads the expected sequences from the SQL", () => {
    expect(fns).toEqual({ confirm: ["goal", "account"], record: ["account"], reverse: ["txn", "account"] });
  });

  it("no two functions take the same pair of resources in opposite orders (so no deadlock cycle among them)", () => {
    const pairs = new Set<string>();
    for (const seq of Object.values(fns)) for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) pairs.add(`${seq[i]}>${seq[j]}`);
    for (const p of pairs) {
      const [a, b] = p.split(">");
      expect(pairs.has(`${b}>${a}`), p).toBe(false);
    }
  });

  it("the account is locked before the payment is inserted, as record_payment already does", () => {
    const confirm = norm(fnBody(fix.code, "confirm_payment_goal_completion"));
    const record = norm(fnBody(ledger.code, "record_payment"));
    expect(confirm.indexOf("public.payment_accounts where id = v_account_id and user_id = auth.uid() for update")).toBeLessThan(confirm.indexOf("insert into public.payment_transactions"));
    expect(record.indexOf("for update")).toBeLessThan(record.indexOf("insert into public.payment_transactions"));
  });
});

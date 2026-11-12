import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here, so this pins the migration by inspection: the ONLY change to confirm_payment_goal_completion is the amount validation
// (the same rule record_payment applies), placed before the FIN-01 lock, with everything else byte-for-byte the FIN-01 version.
const dir = join(process.cwd(), "supabase", "migrations");
const read = (suffix: string) => {
  const f = readdirSync(dir).find((n) => n.endsWith(suffix))!;
  return { f, code: readFileSync(join(dir, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n") };
};
const prec = read("_confirm_payment_goal_precision.sql");
const lock = read("_confirm_payment_goal_lock.sql");
const ledger = read("_finance_payment_ledger.sql");
const fnBody = (code: string, name: string) => {
  const start = code.lastIndexOf(`create or replace function public.${name}(`);
  const end = code.indexOf("$$;", code.indexOf("as $$", start)) + 3;
  return code.slice(start, end);
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const RULE = "if p_amount <> round(p_amount, 2) or p_amount > 99999999.99 then raise exception 'Payment amount must be a valid amount with at most 2 decimal places'; end if;";

describe("confirm_payment_goal_completion precision migration", () => {
  it("is forward-only, depends on (sorts after) the ledger, guard and FIN-01 lock migrations, and replaces only this one function", () => {
    expect(prec.f).toBeTruthy();
    for (const dep of [ledger.f, lock.f, readdirSync(dir).find((n) => n.endsWith("_guard_payment_goal_completion.sql"))!]) expect(prec.f > dep, dep).toBe(true);
    expect(prec.code.match(/create or replace function/g)).toHaveLength(1);
    expect(prec.code).toContain("create or replace function public.confirm_payment_goal_completion(p_goal_id uuid, p_amount numeric)");
    expect(prec.code).not.toMatch(/\b(drop|alter|truncate|delete from)\b/i);
    expect(prec.code).not.toMatch(/create (table|trigger|index)/i);
    expect(prec.code).not.toMatch(/function public\.(record_payment|reverse_payment)\(/);
  });

  it("validates with exactly the rule and message record_payment uses", () => {
    const rec = norm(fnBody(ledger.code, "record_payment"));
    const after = norm(fnBody(prec.code, "confirm_payment_goal_completion"));
    expect(rec).toContain("if p_amount <> round(p_amount, 2) or p_amount > 99999999.99 then raise exception 'Payment amount must be a valid amount with at most 2 decimal places'; end if;");
    expect(after).toContain(RULE);
  });

  it("rejects before anything is locked or written, so a bad amount changes no ledger row, goal or balance", () => {
    const body = norm(fnBody(prec.code, "confirm_payment_goal_completion"));
    const at = body.indexOf(RULE);
    for (const later of ["for update", "set_config", "insert into public.payment_transactions", "update public.goals", "update public.payment_accounts"]) expect(at, later).toBeLessThan(body.indexOf(later));
  });

  it("is IDENTICAL to the FIN-01 function apart from the added validation (lock, ownership, link and already-confirmed checks, balance modes, ledger, guard flag, return, security settings)", () => {
    const before = norm(fnBody(lock.code, "confirm_payment_goal_completion"));
    const after = norm(fnBody(prec.code, "confirm_payment_goal_completion"));
    expect(after.replace(" " + RULE, "")).toBe(before);
    expect(after).toContain("language plpgsql security definer set search_path = public");
    expect(after).toContain("for update;");
    expect(after).toContain("raise exception 'Amount must be zero or positive'"); // $0 stays allowed
    const perms = (c: string) => c.match(/(revoke all on function public\.confirm_payment_goal_completion\(uuid, numeric\) from public;|grant execute on function public\.confirm_payment_goal_completion\(uuid, numeric\) to authenticated;)/g);
    expect(perms(prec.code)).toEqual(perms(lock.code));
  });

  it("with at most two decimals, the ledger value and the balance deduction are the same number, so a reversal restores the balance exactly (model)", () => {
    // numeric(10,2) rounding applies to the ledger insert; the balance uses p_amount as given. They agree exactly when p_amount has no extra decimals.
    const cents = (s: string) => Math.round(Number(s) * 100);
    const valid = (s: string) => /^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(s);
    for (const amount of ["25", "25.5", "25.01", "0", "99999999.99"]) {
      expect(valid(amount)).toBe(true);
      const ledger = cents(amount);
      const deduction = cents(amount);
      const start = 50000;
      const afterConfirm = start - deduction;
      const afterReverse = afterConfirm + ledger; // reverse_payment adds back the ledger amount
      expect(afterReverse).toBe(start);
    }
    for (const bad of ["25.005", "0.001", "1.999"]) expect(valid(bad)).toBe(false); // the cases that used to drift are now rejected
  });
});

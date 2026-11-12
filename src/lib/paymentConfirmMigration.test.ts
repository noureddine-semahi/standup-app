import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here, so this pins the migration by inspection: the ONLY change to confirm_payment_goal_completion is the row lock, and it
// stays compatible with the guard trigger and the earlier ledger migration.
const dir = join(process.cwd(), "supabase", "migrations");
const read = (suffix: string) => {
  const f = readdirSync(dir).find((n) => n.endsWith(suffix))!;
  return { f, code: readFileSync(join(dir, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n") };
};
const fix = read("_confirm_payment_goal_lock.sql");
const ledger = read("_finance_payment_ledger.sql");
const guard = read("_guard_payment_goal_completion.sql");
const fnBody = (code: string, name: string) => {
  const start = code.lastIndexOf(`create or replace function public.${name}(`);
  const end = code.indexOf("$$;", code.indexOf("as $$", start)) + 3;
  return code.slice(start, end);
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("confirm_payment_goal_completion lock migration", () => {
  it("is forward-only, sorts after every earlier migration, and replaces only this one function", () => {
    expect(fix.f).toBeTruthy();
    expect(readdirSync(dir).filter((n) => n !== fix.f && n.endsWith(".sql")).every((n) => n < fix.f)).toBe(true);
    expect(fix.code.match(/create or replace function/g)).toHaveLength(1);
    expect(fix.code).toContain("create or replace function public.confirm_payment_goal_completion(p_goal_id uuid, p_amount numeric)");
    expect(fix.code).not.toMatch(/\b(drop|alter|truncate|delete from)\b/i);
    expect(fix.code).not.toMatch(/create (table|trigger|index)/i);
  });

  it("locks the goal row with FOR UPDATE, in the same SELECT that reads its status, before anything else happens", () => {
    const body = norm(fnBody(fix.code, "confirm_payment_goal_completion"));
    expect(body).toMatch(/select source_payment_account_id, status = 'completed' into v_account_id, v_already_completed from public\.goals where id = p_goal_id and user_id = auth\.uid\(\) for update;/);
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("if v_already_completed then"));
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("insert into public.payment_transactions"));
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("update public.payment_accounts"));
    expect(body).toContain("raise exception 'This payment has already been confirmed for this Task.'");
  });

  it("is IDENTICAL to the existing function apart from the lock (validation, ownership, balance modes, ledger, guard flag, return, security settings)", () => {
    const before = norm(fnBody(ledger.code, "confirm_payment_goal_completion"));
    const after = norm(fnBody(fix.code, "confirm_payment_goal_completion"));
    expect(after.replace(" for update", "")).toBe(before);
    expect(after).toContain("language plpgsql security definer set search_path = public");
    // permissions unchanged
    const perms = (c: string) => c.match(/(revoke all on function public\.confirm_payment_goal_completion\(uuid, numeric\) from public;|grant execute on function public\.confirm_payment_goal_completion\(uuid, numeric\) to authenticated;)/g);
    expect(perms(fix.code)).toEqual(perms(ledger.code));
  });

  it("keeps the balance-mode behaviour: auto subtracts and records balance_applied; manual leaves the balance alone", () => {
    const body = norm(fnBody(fix.code, "confirm_payment_goal_completion"));
    expect(body).toContain("balance_applied) values (v_account_id, auth.uid(), p_goal_id, p_amount, coalesce(v_mode, 'auto') = 'auto')");
    expect(body).toContain("if coalesce(v_mode, 'auto') = 'auto' then update public.payment_accounts set balance = balance - p_amount");
    expect(body).toMatch(/else select balance into v_new_balance from public\.payment_accounts/);
  });

  it("stays compatible with the guard trigger: it still sets the same transaction-local flag before completing the goal", () => {
    const flag = "app.allow_payment_goal_complete";
    expect(guard.code).toContain(`current_setting('${flag}', true)`);
    const body = norm(fnBody(fix.code, "confirm_payment_goal_completion"));
    expect(body).toContain(`perform set_config('${flag}', 'true', true);`);
    expect(body.indexOf("set_config")).toBeLessThan(body.indexOf("update public.goals set status = 'completed'"));
    // the lock comes first, so a waiting second caller reads 'completed' and raises BEFORE it could ever reach the update (and the trigger)
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("set_config"));
  });
});

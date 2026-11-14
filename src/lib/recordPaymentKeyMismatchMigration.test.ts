import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Static shape tests: the new function is IDENTICAL to the previous one apart from the key-mismatch check. They do not prove PostgreSQL behaviour (see the
// disposable-PostgreSQL verification).
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
const mig = read("_record_payment_key_mismatch.sql");
const prev = read("_record_payment_version_stamp.sql");
const after = norm(fnBody(mig.code, "record_payment"));
const before = norm(fnBody(prev.code, "record_payment"));
const flatRaw = mig.raw.replace(/\r?\n--/g, " ").replace(/\s+/g, " ");

const OLD_LOOKUP = "select t.id into v_existing from public.payment_transactions t where t.user_id = auth.uid() and t.client_key = p_client_key; if found then return query select v_existing, v_balance, true; return; end if;";
const NEW_LOOKUP =
  "select t.id, t.account_id, t.amount into v_existing, v_existing_account, v_existing_amount from public.payment_transactions t where t.user_id = auth.uid() and t.client_key = p_client_key; if found then if v_existing_account is distinct from p_account_id or v_existing_amount is distinct from p_amount then raise exception 'This request key was already used for a different payment'; end if; return query select v_existing, v_balance, true; return; end if;";

describe("record_payment key-mismatch migration", () => {
  it("is forward-only, sorts after the stamp migration, replaces only record_payment, and touches no permission", () => {
    expect(mig.f > prev.f).toBe(true);
    expect(mig.code.match(/create or replace function/g)).toHaveLength(1);
    expect(mig.code).not.toMatch(/\b(grant|revoke|drop|alter|truncate|delete from)\b/i);
    expect(mig.code).not.toMatch(/function public\.(reverse_payment|confirm_payment_goal_completion)\(/);
  });

  it("is IDENTICAL to the previous function apart from the extra variables and the compare-on-duplicate step", () => {
    expect(before).toContain(OLD_LOOKUP);
    const expected = before
      .replace("v_existing uuid; v_txn uuid;", "v_existing uuid; v_existing_account uuid; v_existing_amount numeric; v_txn uuid;")
      .replace(OLD_LOOKUP, NEW_LOOKUP);
    expect(after).toBe(expected);
  });

  it("keeps signature, SECURITY DEFINER, search path and returned table", () => {
    const head = (s: string) => s.slice(0, s.indexOf("as $$"));
    expect(head(after)).toBe(head(before));
  });

  it("rejects before allocating: lock, then mismatch check, then retry return, then the single allocation, then insert", () => {
    const at = (s: string) => after.indexOf(s);
    const order = [
      "for update;",
      "client_key = p_client_key",
      "raise exception 'This request key was already used for a different payment'",
      "return query select v_existing, v_balance, true; return;",
      "set ledger_version = a.ledger_version + 1",
      "insert into public.payment_transactions",
    ].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(after.match(/ledger_version = a\.ledger_version \+ 1/g)).toHaveLength(1);
  });

  it("compares only account and amount (not apply flag, paid_at or note)", () => {
    const cond = after.slice(after.indexOf("if v_existing_account"), after.indexOf(" then raise exception 'This request key"));
    expect(cond).toBe("if v_existing_account is distinct from p_account_id or v_existing_amount is distinct from p_amount");
  });

  it("documents the behaviour and what is unchanged", () => {
    expect(flatRaw).toContain("neither a retry nor a rejected request consumes a ledger version");
    expect(flatRaw).toContain("Permissions are NOT touched");
  });
});

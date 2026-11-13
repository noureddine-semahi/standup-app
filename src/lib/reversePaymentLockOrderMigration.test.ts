import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here, so this pins the reverse_payment lock-order migration by inspection: account lock before the ledger row, the ledger row
// re-read and revalidated under the locks, clock_timestamp() for the stamp, and everything else identical to the existing function.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const read = (suffix: string) => {
  const f = names.find((n) => n.endsWith(suffix))!;
  return { f, code: readFileSync(join(dir, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n") };
};
const fix = read("_reverse_payment_lock_order.sql");
const ledger = read("_finance_payment_ledger.sql");
const confirmFix = read("_confirm_payment_goal_account_lock.sql");
const fnBody = (code: string, name: string) => {
  const start = code.lastIndexOf(`create or replace function public.${name}(`);
  const end = code.indexOf("$$;", code.indexOf("as $$", start)) + 3;
  return code.slice(start, end);
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const after = norm(fnBody(fix.code, "reverse_payment"));
const before = norm(fnBody(ledger.code, "reverse_payment"));

describe("reverse_payment lock-order migration", () => {
  it("is forward-only, sorts after the migrations it builds on, and replaces only this one function", () => {
    expect(fix.f).toBeTruthy();
    for (const dep of ["_finance_payment_ledger.sql", "_confirm_payment_goal_account_lock.sql", "_payment_account_entries.sql"]) expect(fix.f > read(dep).f, dep).toBe(true);
    expect(fix.code.match(/create or replace function/g)).toHaveLength(1);
    expect(fix.code).toContain("create or replace function public.reverse_payment(p_transaction_id uuid)");
    expect(fix.code).not.toMatch(/\b(drop|alter|truncate|delete from|create table|create index|create trigger)\b/i);
    expect(fix.code).not.toMatch(/function public\.(record_payment|confirm_payment_goal_completion)\(/);
  });

  it("looks the payment up WITHOUT a lock first (a hint only), then locks the account, then locks and re-reads the ledger row", () => {
    const lookup = after.indexOf("select t.account_id into v_hint_account from public.payment_transactions t where t.id = p_transaction_id and t.user_id = auth.uid();");
    const accountLock = after.indexOf("select a.id into v_locked_account from public.payment_accounts a where a.id = v_hint_account and a.user_id = auth.uid() for update;");
    const rowLock = after.indexOf("from public.payment_transactions t where t.id = p_transaction_id and t.user_id = auth.uid() for update;");
    expect(lookup).toBeGreaterThan(-1);
    expect(accountLock).toBeGreaterThan(lookup);
    expect(rowLock).toBeGreaterThan(accountLock);
    // the initial lookup carries no lock of any kind
    expect(after.slice(lookup, after.indexOf(";", lookup))).not.toMatch(/for (update|share|no key update)/);
    // the ledger row is locked exactly once and never before the account
    expect(after.match(/from public\.payment_transactions t[^;]*for update/g)).toHaveLength(1);
  });

  it("revalidates under both locks: row still exists, still on the locked account, and not already reversed, each before any write", () => {
    const stamp = after.indexOf("update public.payment_transactions set reversed_at");
    const checks = [
      "if v_account is distinct from v_locked_account then raise exception 'Payment not found'; end if;",
      "if v_reversed is not null then raise exception 'This payment has already been reversed'; end if;",
    ].map((c) => after.indexOf(c));
    for (const c of checks) {
      expect(c).toBeGreaterThan(-1);
      expect(c).toBeLessThan(stamp);
    }
    // not-found is raised after the unlocked lookup, after the account lock, and after the re-read
    expect(after.match(/if not found then raise exception 'Payment not found'; end if;/g)).toHaveLength(3);
    expect(after.indexOf("v_account is distinct from v_locked_account")).toBeGreaterThan(after.indexOf("into v_account, v_amount, v_applied, v_reversed"));
  });

  it("stamps reversed_at with clock_timestamp(), not now() (the transaction start)", () => {
    expect(after).toContain("update public.payment_transactions set reversed_at = clock_timestamp() where id = p_transaction_id;");
    expect(after).not.toMatch(/\bnow\(\)/);
    expect(before).toContain("set reversed_at = now()"); // the behaviour being replaced
  });

  it("keeps the balance restore, return value, messages, authorization and security settings exactly as before", () => {
    const restore = (s: string) => s.slice(s.indexOf("if v_applied then"), s.indexOf("end;", s.indexOf("if v_applied then")));
    expect(restore(after)).toBe(restore(before));
    expect(after).toContain("if auth.uid() is null then raise exception 'Not authenticated'; end if;");
    expect(after).toContain("language plpgsql security definer set search_path = public");
    expect(after).toContain("return v_balance;");
    for (const msg of ["Not authenticated", "Payment not found", "This payment has already been reversed"]) {
      expect(before, msg).toContain(msg);
      expect(after, msg).toContain(msg);
    }
    const perms = (c: string) => c.match(/(revoke all on function public\.reverse_payment\(uuid\) from public;|grant execute on function public\.reverse_payment\(uuid\) to authenticated;)/g);
    expect(perms(fix.code)).toEqual(perms(ledger.code));
    // anon is revoked explicitly too (Production verified anon = false; PUBLIC stays revoked and authenticated keeps EXECUTE)
    expect(fix.code).toContain("revoke all on function public.reverse_payment(uuid) from anon;");
    expect(fix.code).not.toMatch(/grant[^;]*to (anon|public)/i);
  });
});

describe("lock acquisition order across all three payment functions (latest definitions) has no cycle", () => {
  // The first lock each function takes on each resource, read from the SQL itself.
  const locks = (body: string): string[] => {
    const hits: { at: number; res: string }[] = [];
    const patterns: [RegExp, string][] = [
      [/from public\.goals [^;]*for update/g, "goal"],
      [/from public\.payment_accounts [^;]*for update/g, "account"],
      [/from public\.payment_transactions t [^;]*for update/g, "txn"],
      [/\bupdate public\.goals\b/g, "goal"],
      [/\bupdate public\.payment_accounts\b/g, "account"],
      [/\bupdate public\.payment_transactions\b/g, "txn"],
    ];
    for (const [re, res] of patterns) for (let m = re.exec(body); m; m = re.exec(body)) hits.push({ at: m.index, res });
    const seen = new Set<string>();
    return hits.sort((a, b) => a.at - b.at).map((h) => h.res).filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
  };
  const fns = {
    confirm: locks(norm(fnBody(confirmFix.code, "confirm_payment_goal_completion"))),
    record: locks(norm(fnBody(ledger.code, "record_payment"))),
    reverse: locks(after),
  };

  it("reads the expected sequences from the SQL", () => {
    expect(fns).toEqual({ confirm: ["goal", "account"], record: ["account"], reverse: ["account", "txn"] });
  });

  it("the wait-for graph built from those sequences is acyclic (goal < account < ledger row)", () => {
    const edges = new Map<string, Set<string>>();
    for (const seq of Object.values(fns)) for (let i = 0; i + 1 < seq.length; i++) (edges.get(seq[i]) ?? edges.set(seq[i], new Set()).get(seq[i])!).add(seq[i + 1]);
    const state = new Map<string, number>();
    const visit = (n: string): boolean => {
      if (state.get(n) === 1) return true; // back edge: a cycle
      if (state.get(n) === 2) return false;
      state.set(n, 1);
      for (const m of edges.get(n) ?? []) if (visit(m)) return true;
      state.set(n, 2);
      return false;
    };
    expect([...edges.keys()].some(visit)).toBe(false);
    expect(edges.get("goal")?.has("account")).toBe(true);
    expect(edges.get("account")?.has("txn")).toBe(true);
    expect(edges.get("txn")?.size ?? 0).toBe(0); // nothing ever locks anything after a ledger row
  });

  it("the previous reverse_payment order (ledger row then account) would have created the opposite edge, which is what this change removes", () => {
    expect(locks(before)).toEqual(["txn", "account"]);
  });
});

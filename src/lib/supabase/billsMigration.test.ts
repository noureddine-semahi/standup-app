import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Row Level Security can't be exercised without a live database, so this pins
// the migration's security shape by inspection: every new table is RLS-enabled
// and owner-scoped, clients can't write the ledgers directly, the definer
// functions are scoped to auth.uid(), and nothing destructive or Phase 1 is touched.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_finance_bills.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("finance bills migration", () => {
  it("exists and sorts after the Phase 1 payment ledger migration", () => {
    expect(file).toBeTruthy();
    const phase1 = readdirSync(dir).find((f) => f.endsWith("_finance_payment_ledger.sql"))!;
    expect(file > phase1).toBe(true);
  });

  for (const table of ["bills", "bill_occurrences", "bill_payments"]) {
    it(`${table}: RLS enabled and owner-scoped`, () => {
      expect(code).toContain(`alter table public.${table} enable row level security`);
      expect(code).toMatch(new RegExp(`on public\\.${table} for select using \\(auth\\.uid\\(\\) = user_id\\)`));
      expect(code).toMatch(new RegExp(`create table if not exists public\\.${table}[\\s\\S]*?user_id uuid not null references auth\\.users\\(id\\)`));
    });
  }

  it("bills can be created/edited only by their owner and are never deleted by clients", () => {
    expect(code).toContain("on public.bills for insert with check (auth.uid() = user_id)");
    expect(code).toMatch(/on public\.bills for update using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
    expect(code).not.toMatch(/for delete/i);
  });

  it("occurrences and payments have no client write policies (writes go through definer functions)", () => {
    expect(code).not.toMatch(/on public\.bill_(occurrences|payments) for (insert|update|delete|all)/);
  });

  it("every function is security-definer scoped to auth.uid() with a pinned search_path, and execute is limited to signed-in users", () => {
    for (const fn of ["record_bill_payment", "set_bill_occurrence_amount", "reverse_bill_payment"]) {
      const start = code.indexOf(`function public.${fn}`);
      const def = code.slice(start, code.indexOf("$$;", code.indexOf("$$;", start) + 3));
      expect(def).toContain("security definer set search_path = public");
      expect(def).toContain("auth.uid()");
      expect(code).toContain(`revoke all on function public.${fn}`);
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${fn}[^;]*to authenticated`));
    }
  });

  it("money is fixed-precision, payments are positive, and duplicates are prevented by the database", () => {
    expect(code).toMatch(/expected_amount numeric\(12, 2\)/);
    expect(code).toMatch(/amount_due numeric\(12, 2\)/);
    expect(code).toMatch(/amount numeric\(12, 2\) not null check \(amount > 0\)/);
    expect(code).toContain("unique (bill_id, due_date)");
    expect(code).toContain("bill_payments_client_key_idx");
    expect(code).toMatch(/where client_key is not null/);
    expect(code).toContain("on conflict (bill_id, due_date)");
  });

  it("reversal keeps the row and can't happen twice", () => {
    const rev = code.slice(code.indexOf("function public.reverse_bill_payment"));
    expect(rev).toContain("set reversed_at = now()");
    expect(rev).toContain("already been reversed");
    expect(rev).toContain("for update");
    expect(rev).not.toMatch(/delete from/i);
  });

  it("is additive: no drops/truncates/deletes of data, and Phase 1 tables and functions are untouched", () => {
    expect(code).not.toMatch(/drop table|drop column|truncate|delete from|alter table public\.payment_/i);
    expect(code).not.toMatch(/payment_accounts|payment_transactions|confirm_payment_goal_completion|record_payment\(|reverse_payment\(/);
    // the only change to an existing table: two nullable goal link columns
    expect(code).toMatch(/alter table public\.goals\s+add column if not exists source_bill_id[\s\S]*?add column if not exists source_bill_due_date date;/);
  });

  it("bill payments never touch an account balance", () => {
    expect(code).not.toMatch(/balance/i);
  });
});

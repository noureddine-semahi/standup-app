import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Row Level Security can't be exercised without a live database, so this pins the
// migration's security shape by inspection: every new table is RLS-enabled and
// owner-scoped, clients can't write the payment ledger directly, the definer
// functions are scoped to auth.uid(), and nothing destructive or Phase 1/2 is touched.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_finance_subscriptions.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("finance subscriptions migration", () => {
  it("exists and sorts after the Bills migration it references", () => {
    expect(file).toBeTruthy();
    const bills = readdirSync(dir).find((f) => f.endsWith("_finance_bills.sql"))!;
    expect(file > bills).toBe(true);
  });

  for (const table of ["subscriptions", "subscription_payments"]) {
    it(`${table}: RLS enabled, owner-scoped, user_id required`, () => {
      expect(code).toContain(`alter table public.${table} enable row level security`);
      expect(code).toMatch(new RegExp(`on public\\.${table} for select using \\(auth\\.uid\\(\\) = user_id\\)`));
      expect(code).toMatch(new RegExp(`create table if not exists public\\.${table}[\\s\\S]*?user_id uuid not null references auth\\.users\\(id\\)`));
    });
  }

  it("subscriptions can be created / edited / deleted only by their owner, and a linked bill must also be the owner's", () => {
    expect(code).toMatch(/on public\.subscriptions for insert\s+with check \(\s*auth\.uid\(\) = user_id/);
    expect(code).toMatch(/on public\.subscriptions for update\s+using \(auth\.uid\(\) = user_id\)\s+with check \(\s*auth\.uid\(\) = user_id/);
    expect(code).toContain("on public.subscriptions for delete using (auth.uid() = user_id)");
    expect(code.match(/b\.user_id = auth\.uid\(\)/g)!.length).toBeGreaterThanOrEqual(2); // insert + update
  });

  it("the payment ledger has no client write policies (writes go through definer functions)", () => {
    expect(code).not.toMatch(/on public\.subscription_payments for (insert|update|delete|all)/);
  });

  it("every function is security-definer scoped to auth.uid() with a pinned search_path; execute is limited to signed-in users", () => {
    for (const fn of ["record_subscription_payment", "reverse_subscription_payment"]) {
      const start = code.indexOf(`function public.${fn}`);
      const def = code.slice(start, code.indexOf("$$;", code.indexOf("$$;", start) + 3));
      expect(def).toContain("security definer set search_path = public");
      expect(def).toContain("auth.uid()");
      expect(code).toContain(`revoke all on function public.${fn}`);
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${fn}[^;]*to authenticated`));
    }
  });

  it("money is fixed-precision, payments are positive, and duplicates are prevented by the database", () => {
    expect(code).toMatch(/amount numeric\(12, 2\) check \(amount is null or amount >= 0\)/);
    expect(code).toMatch(/amount numeric\(12, 2\) not null check \(amount > 0\)/);
    expect(code).toContain("subscription_payments_client_key_idx");
    expect(code).toMatch(/where client_key is not null/);
  });

  it("constrains the model: statuses, frequencies, custom interval, trial end, currency, reminder range", () => {
    expect(code).toContain("check (status in ('active', 'paused', 'canceled', 'trial'))");
    expect(code).toContain("check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly', 'custom'))");
    expect(code).toContain("custom_unit in ('days', 'weeks', 'months')");
    expect(code).toContain("subscriptions_custom_has_interval");
    expect(code).toContain("subscriptions_trial_has_end");
    expect(code).toMatch(/currency in \('USD', 'EUR', 'GBP', 'CAD', 'MXN'\)/);
    expect(code).toContain("remind_days_before between 0 and 60");
  });

  it("reversal keeps the row and can't happen twice", () => {
    const rev = code.slice(code.indexOf("function public.reverse_subscription_payment"));
    expect(rev).toContain("set reversed_at = now()");
    expect(rev).toContain("already been reversed");
    expect(rev).toContain("for update");
    expect(rev).not.toMatch(/delete from/i);
  });

  it("is additive: nothing dropped or deleted, and Bills / Phase 1 tables and functions are untouched", () => {
    expect(code).not.toMatch(/drop table|drop column|truncate|delete from/i);
    expect(code).not.toMatch(/alter table public\.(bills|bill_|payment_)/i);
    expect(code).not.toMatch(/payment_accounts|payment_transactions|record_bill_payment|reverse_bill_payment|record_payment\(|reverse_payment\(/);
    // the only change to an existing table: three nullable goal link columns
    expect(code).toMatch(/alter table public\.goals\s+add column if not exists source_subscription_id[\s\S]*?add column if not exists source_subscription_date date;/);
  });

  it("the bill link is an explicit, nullable reference that is cleared (not cascaded) if the bill goes away", () => {
    expect(code).toContain("bill_id uuid references public.bills(id) on delete set null");
  });

  it("a subscription payment never touches an account balance", () => {
    expect(code).not.toMatch(/balance/i);
  });
});

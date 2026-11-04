import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// RLS can't be exercised without a live database, so this pins the migration's security and data shape by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_financial_profiles.sql"))!;
const code = readFileSync(join(dir, file), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("financial profiles migration", () => {
  it("exists and sorts after the Subscriptions migrations", () => {
    expect(file).toBeTruthy();
    for (const earlier of readdirSync(dir).filter((f) => f.includes("subscription"))) expect(file > earlier).toBe(true);
  });

  it("one row per user, owned by an auth user, removed with the account", () => {
    expect(code).toMatch(/create table if not exists public\.financial_profiles/);
    expect(code).toContain("user_id uuid primary key references auth.users(id) on delete cascade");
  });

  it("row level security is on and every policy is scoped to the owner (no public access)", () => {
    expect(code).toContain("alter table public.financial_profiles enable row level security");
    expect(code).toContain("for select using (auth.uid() = user_id)");
    expect(code).toMatch(/for insert with check \(auth\.uid\(\) = user_id\)/);
    expect(code).toMatch(/for update using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
    expect(code).toContain("for delete using (auth.uid() = user_id)");
    expect((code.match(/create policy/g) ?? []).length).toBe(4);
    expect(code).not.toMatch(/to anon|to public|using \(true\)|with check \(true\)/i);
  });

  it("money is fixed-precision and never negative; unanswered amounts may be null", () => {
    for (const col of ["take_home", "income_typical", "income_low", "savings_balance", "savings_monthly"]) {
      expect(code, col).toMatch(new RegExp(`${col} numeric\\(12, 2\\) check \\(${col} is null or ${col} >= 0\\)`));
    }
  });

  it("constrains frequency, basis, step numbers and household size", () => {
    expect(code).toContain("'weekly', 'biweekly', 'semimonthly', 'monthly', 'irregular'");
    expect((code.match(/in \('actual', 'estimate'\)/g) ?? []).length).toBe(2);
    expect(code).toContain("current_step smallint not null default 1 check (current_step between 1 and 5)");
    expect(code).toContain("skipped_steps <@ array[1, 2, 3, 4, 5]::smallint[]");
    expect(code).toContain("adults between 1 and 10");
    expect(code).toContain("dependents between 0 and 15");
  });

  it("the jsonb lists are typed and size-limited", () => {
    expect(code).toContain("jsonb_typeof(expenses) = 'object'");
    expect(code).toContain("jsonb_typeof(debts) = 'array' and jsonb_array_length(debts) <= 20");
    expect(code).toContain("jsonb_typeof(goals) = 'array' and jsonb_array_length(goals) <= 10");
    expect(code.match(/octet_length\(/g)!.length).toBe(3);
  });

  it("consent to read existing records defaults to OFF", () => {
    for (const col of ["use_bills", "use_accounts", "use_subscriptions"]) expect(code).toContain(`${col} boolean not null default false`);
  });

  it("is additive and isolated: no references to, or changes of, other financial tables or records", () => {
    expect(code).not.toMatch(/drop table|drop column|truncate|delete from/i);
    expect(code).not.toMatch(/alter table public\.(?!financial_profiles)/i);
    expect(code).not.toMatch(/references public\./i);
    expect(code).not.toMatch(/public\.(bills|subscriptions|subscription_payments|payment_accounts|payment_transactions|goals)\b/);
    expect(code).not.toMatch(/\b(from|join|update|insert into)\s+public\.(?!financial_profiles)/i);
  });
});

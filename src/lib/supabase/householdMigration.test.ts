import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// RLS can't be exercised without a live database, so this pins the migration's security and data shape by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_household_profiles.sql"))!;
const code = readFileSync(join(dir, file), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("household profiles migration", () => {
  it("exists and sorts after the financial_profiles migration it builds beside", () => {
    expect(file).toBeTruthy();
    const fp = readdirSync(dir).find((f) => f.endsWith("_financial_profiles.sql"))!;
    expect(file > fp).toBe(true);
  });

  it("creates exactly the two household tables, one household per owner", () => {
    expect([...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])).toEqual(["households", "household_members"]);
    expect(code).toContain("owner_id uuid not null unique references auth.users(id) on delete cascade");
  });

  it("members belong to a household, are removed with it, and one partner is allowed per household", () => {
    expect(code).toContain("household_id uuid not null references public.households(id) on delete cascade");
    expect(code).toMatch(/create unique index if not exists household_members_one_partner_idx\s+on public\.household_members \(household_id\) where role = 'partner'/);
    expect(code).toContain("check (role in ('partner'))");
  });

  it("row level security is on for both tables, with four owner-only policies each and no public access", () => {
    expect(code).toContain("alter table public.households enable row level security");
    expect(code).toContain("alter table public.household_members enable row level security");
    expect((code.match(/create policy/g) ?? []).length).toBe(8);
    for (const t of ["households", "household_members"]) {
      expect(code).toMatch(new RegExp(`on public\\.${t} for select using \\(auth\\.uid\\(\\) = owner_id\\)`));
      expect(code).toMatch(new RegExp(`on public\\.${t} for delete using \\(auth\\.uid\\(\\) = owner_id\\)`));
    }
    expect(code).not.toMatch(/to anon|to public|using \(true\)|with check \(true\)/i);
  });

  it("a member can only be attached to a household the caller owns (insert and update)", () => {
    const insert = code.slice(code.indexOf('create policy "household_members_insert_own"'), code.indexOf('create policy "household_members_update_own"'));
    const update = code.slice(code.indexOf('create policy "household_members_update_own"'), code.indexOf('create policy "household_members_delete_own"'));
    for (const p of [insert, update]) {
      expect(p).toContain("auth.uid() = owner_id");
      expect(p).toContain("exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid())");
    }
  });

  it("the partner row holds the same answers as the personal profile, but not the records-consent flags or household size", () => {
    for (const col of ["pay_frequency", "take_home", "income_typical", "income_low", "income_basis", "expenses", "debts", "no_debts", "savings_balance", "savings_monthly", "savings_basis", "goals", "current_step", "skipped_steps", "country", "region"]) {
      expect(code, col).toContain(col);
    }
    for (const col of ["use_bills", "use_accounts", "use_subscriptions", "adults smallint", "dependents smallint"]) expect(code, col).not.toContain(col);
  });

  it("money is fixed-precision and never negative; unanswered amounts may be null", () => {
    for (const col of ["take_home", "income_typical", "income_low", "savings_balance", "savings_monthly"]) {
      expect(code, col).toMatch(new RegExp(`${col} numeric\\(12, 2\\) check \\(${col} is null or ${col} >= 0\\)`));
    }
  });

  it("constrains frequency, basis, step numbers, name and jsonb size", () => {
    expect(code).toContain("'weekly', 'biweekly', 'semimonthly', 'monthly', 'irregular'");
    expect((code.match(/in \('actual', 'estimate'\)/g) ?? []).length).toBe(2);
    expect(code).toContain("check (current_step between 1 and 5)");
    expect(code).toContain("char_length(btrim(display_name)) between 1 and 60");
    expect(code).toContain("jsonb_typeof(expenses) = 'object'");
    expect(code).toContain("jsonb_array_length(debts) <= 20");
    expect(code).toContain("jsonb_array_length(goals) <= 10");
  });

  it("reserves (and does not use) invitation columns, and grants nobody but the owner any access", () => {
    expect(code).toContain("linked_user_id uuid references auth.users(id) on delete set null");
    expect(code).toContain("invite_status text check (invite_status is null or invite_status in ('pending', 'accepted', 'declined'))");
    expect(code).not.toMatch(/linked_user_id\s*=|invite_status\s*=/);
  });

  it("is additive and isolated: no changes to, or references to, personal profiles, Bills, Payments, Subscriptions or goals", () => {
    expect(code).not.toMatch(/drop table|drop column|truncate|delete from/i);
    expect(code).not.toMatch(/alter table public\.(?!households|household_members)/i);
    expect(code).not.toMatch(/references public\.(?!households)/i);
    expect(code).not.toMatch(/\b(from|join|update|insert into)\s+public\.(?!households)/i);
    expect(code).not.toMatch(/public\.(financial_profiles|bills|subscriptions|payment_accounts|payment_transactions|goals)\b/);
  });
});

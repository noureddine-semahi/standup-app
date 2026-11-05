import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The migration is not applied by tests. This pins its safety and shape by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_household_shared.sql"))!;
const code = readFileSync(join(dir, file), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("household shared migration", () => {
  it("exists and sorts after the household profiles migration it extends", () => {
    expect(file).toBeTruthy();
    const base = readdirSync(dir).find((f) => f.endsWith("_household_profiles.sql"))!;
    expect(file > base).toBe(true);
  });

  it("is additive: no drop, delete, truncate, rename or destructive alter, and no new table", () => {
    expect(code).not.toMatch(/drop\s+(table|column|policy|index|constraint)/i);
    expect(code).not.toMatch(/\bdelete\s+from\b|\btruncate\b|rename\s+(to|column)|alter\s+column|drop\s+not\s+null/i);
    expect(code).not.toMatch(/create\s+table/i);
    expect(code).not.toMatch(/\bupdate\s+public\./i); // never rewrites existing rows
    expect(code).not.toMatch(/\binsert\s+into\b/i);
  });

  it("touches only public.households (never members, profiles, bills, payments or subscriptions)", () => {
    const targets = [...code.matchAll(/\b(?:alter table|on|from|into|update)\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(new Set(targets)).toEqual(new Set(["households"]));
    for (const t of ["household_members", "financial_profiles", "bills", "payment_accounts", "subscriptions"]) expect(code).not.toContain("public." + t);
  });

  it("adds each expected column once, with a safe default or nullability", () => {
    const cols = [...code.matchAll(/add column if not exists (\w+) ([^\n]+)/g)];
    expect(cols.map((m) => m[1])).toEqual(["shared_expenses", "no_shared_expenses", "shared_debts", "no_shared_debts", "shared_goals", "adults", "children", "other_members", "revision"]);
    for (const [name, type] of cols.map((m) => [m[1], m[2]])) {
      const safe = /default/.test(type) || /^smallint check \(\w+ is null or/.test(type) || /^jsonb not null default/.test(type);
      expect(safe, name).toBe(true);
    }
    expect(code).toMatch(/adults smallint check \(adults is null or adults between 1 and 10\)/);
    expect(code).toMatch(/children smallint check \(children is null or children between 0 and 15\)/);
    expect(code).toMatch(/other_members smallint check \(other_members is null or other_members between 0 and 15\)/);
  });

  it("bounds the jsonb lists by type, item count and size", () => {
    expect(code).toMatch(/jsonb_typeof\(shared_expenses\) = 'array' and jsonb_array_length\(shared_expenses\) <= 30 and octet_length\(shared_expenses::text\) <= 40000/);
    expect(code).toMatch(/jsonb_typeof\(shared_debts\) = 'array' and jsonb_array_length\(shared_debts\) <= 10/);
    expect(code).toMatch(/jsonb_typeof\(shared_goals\) = 'array' and jsonb_array_length\(shared_goals\) <= 10/);
  });

  it("keeps the existing owner-only protection: no policy is created, changed, widened or dropped", () => {
    expect(code).not.toMatch(/create\s+policy|alter\s+policy|drop\s+policy|disable\s+row\s+level|grant\s|revoke\s/i);
    expect(code).not.toMatch(/to anon|to public|using \(true\)|with check \(true\)/i);
  });

  it("the revision is database-managed: bumped only when shared data changes, otherwise preserved", () => {
    expect(code).toMatch(/create or replace function public\.bump_household_revision/);
    expect(code).toMatch(/before insert or update on public\.households/);
    expect(code).toContain("tg_op = 'INSERT'"); // a client cannot start a row at a chosen revision either
    expect(code).toMatch(/if tg_op = 'INSERT' then\s+new\.revision := 0;/);
    expect(code).toContain("new.revision := old.revision + 1");
    expect(code).toContain("new.revision := old.revision;");
    expect(code).toContain("is distinct from");
    // every shared column is compared, so no change can slip through without a bump
    for (const c of ["shared_expenses", "no_shared_expenses", "shared_debts", "no_shared_debts", "shared_goals", "adults", "children", "other_members"]) {
      expect((code.match(new RegExp(`new\\.${c}\\b`, "g")) ?? []).length, c).toBe(1);
      expect((code.match(new RegExp(`old\\.${c}\\b`, "g")) ?? []).length, c).toBe(1);
    }
  });

  it("is safe to re-run (columns guarded, trigger replaced in place)", () => {
    expect(code).toMatch(/drop trigger if exists trg_bump_household_revision/);
    expect(code).not.toMatch(/add column (?!if not exists)/);
  });
});

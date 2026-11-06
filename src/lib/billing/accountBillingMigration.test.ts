import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Pins the shape of the billing-identifiers migration by inspection (it can't be run without a live database).
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_account_billing.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("account billing migration", () => {
  it("sorts after the entitlement, trial and admin migrations", () => {
    expect(file).toBeTruthy();
    for (const earlier of ["_account_entitlements.sql", "_premium_trial.sql", "_admin_entitlements.sql"]) {
      expect(file > readdirSync(dir).find((f) => f.endsWith(earlier))!).toBe(true);
    }
  });

  it("is additive: one new table, no drops of data, nothing touches entitlements, trial history or user content", () => {
    expect(code.match(/create table/gi)).toHaveLength(1);
    expect(code).toContain("create table if not exists public.account_billing");
    expect(code).not.toMatch(/drop\s+(table|column|policy)|delete\s+from|truncate|alter table public\.(?!account_billing)/i);
    expect(code).not.toMatch(/account_entitlements|account_trial_history|notes|outcome_goals|recurring_goal_templates/);
  });

  it("is one row per account, removed with the account", () => {
    expect(code).toContain("user_id uuid primary key references auth.users(id) on delete cascade");
  });

  it("holds Stripe identifiers, unique and checked for their prefixes, and no secrets", () => {
    expect(code).toMatch(/stripe_customer_id text unique check \(stripe_customer_id is null or stripe_customer_id like 'cus\\_%'\)/);
    expect(code).toMatch(/stripe_subscription_id text unique check \(stripe_subscription_id is null or stripe_subscription_id like 'sub\\_%'\)/);
    expect(code).toMatch(/stripe_price_id text check \(stripe_price_id is null or stripe_price_id like 'price\\_%'\)/);
    expect(code).toContain("plan in ('monthly', 'annual')");
    expect(code).not.toMatch(/secret|api_key|token|password|card|payment_method/i);
  });

  it("is server-only: RLS on, no policies, every privilege revoked from browsers", () => {
    expect(code).toContain("alter table public.account_billing enable row level security");
    expect(code).not.toMatch(/create policy/i);
    expect(code).toContain("revoke all on public.account_billing from anon, authenticated;");
    expect(code).not.toMatch(/grant\s/i);
  });

  it("keeps updated_at current with its own trigger", () => {
    expect(code).toContain("create trigger trg_touch_account_billing");
    expect(code).toContain("before update on public.account_billing");
  });
});

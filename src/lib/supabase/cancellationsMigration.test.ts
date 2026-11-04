import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Pins the security and honesty shape of the cancellations migration by inspection
// (RLS can't be exercised without a live database).
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_subscription_cancellations.sql"))!;
const code = readFileSync(join(dir, file), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("subscription cancellations migration", () => {
  it("sorts after the subscriptions migration it depends on", () => {
    const subs = readdirSync(dir).find((f) => f.endsWith("_finance_subscriptions.sql"))!;
    expect(file > subs).toBe(true);
  });

  it("is owner-scoped with RLS and read-only for clients (all writes go through the function)", () => {
    expect(code).toContain("alter table public.subscription_cancellations enable row level security");
    expect(code).toMatch(/on public\.subscription_cancellations for select using \(auth\.uid\(\) = user_id\)/);
    expect(code).not.toMatch(/on public\.subscription_cancellations for (insert|update|delete|all)/);
  });

  it("the client-callable function cannot write provider_confirmed or automatic", () => {
    const start = code.indexOf("function public.record_subscription_cancellation");
    const fn = code.slice(start);
    expect(fn).toContain("security definer set search_path = public");
    expect(fn).toContain("auth.uid()");
    expect(fn).toContain("p_mode not in ('assisted', 'manual')");
    expect(fn).toContain("p_status not in ('in_progress', 'user_reported', 'failed')");
    expect(fn).not.toMatch(/provider_confirmed/);
    expect(code).toMatch(/revoke all on function public\.record_subscription_cancellation/);
    expect(code).toMatch(/grant execute on function public\.record_subscription_cancellation[^;]*to authenticated/);
  });

  it("the table itself only allows provider_confirmed for an automatic integration with a provider reference", () => {
    expect(code).toContain("status <> 'provider_confirmed' or (mode = 'automatic' and provider_reference is not null)");
    expect(code).toContain("status not in ('user_reported', 'provider_confirmed') or completed_on is not null");
  });

  it("a user-reported cancellation marks the subscription canceled in the same function and never deletes anything", () => {
    expect(code).toMatch(/update public\.subscriptions\s+set status = 'canceled'/);
    expect(code).not.toMatch(/drop table|drop column|truncate|delete from/i);
    expect(code).not.toMatch(/subscription_payments/);
  });

  it("stores no credentials, and cancel links must be https without embedded credentials", () => {
    expect(code).not.toMatch(/password|secret|token|credential/i);
    expect(code.match(/\^https:\/\/\[\^@\\s\]\+\$/g)!.length).toBeGreaterThanOrEqual(2); // cancel_url + guide_url
  });

  it("is additive: only a nullable column on subscriptions, no changes to other tables", () => {
    expect(code).toMatch(/alter table public\.subscriptions\s+add column if not exists cancel_url text/);
    expect(code).not.toMatch(/alter table public\.(bills|goals|payment_)/i);
  });
});

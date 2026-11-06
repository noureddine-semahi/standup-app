import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The atomic claim logic lives in SQL, which can't run without a live database, so this pins its shape and security by inspection.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_stripe_webhook_events.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const fn = (name: string) => code.slice(code.indexOf(`create or replace function public.${name}(`), code.indexOf("$$;", code.indexOf("as $$", code.indexOf(`create or replace function public.${name}(`))));

describe("stripe webhook events migration", () => {
  it("sorts after the billing and feature-flag migrations", () => {
    for (const earlier of ["_account_billing.sql", "_feature_flags.sql"]) expect(file > readdirSync(dir).find((f) => f.endsWith(earlier))!).toBe(true);
  });

  it("is additive: one table, three functions, no drops, deletes or changes to existing objects", () => {
    expect(code.match(/create table/gi)).toHaveLength(1);
    expect(code.match(/create or replace function/gi)).toHaveLength(3);
    expect(code).not.toMatch(/drop\s|delete\s+from|truncate|alter table public\.(?!stripe_webhook_events)/i);
  });

  it("deduplicates on the Stripe event ID: primary key, evt_ prefix, status limited to three values", () => {
    expect(code).toContain("event_id text primary key check (event_id like 'evt\\_%')");
    expect(code).toContain("status in ('processing', 'processed', 'failed')");
  });

  it("stores no payload and no customer data: only ids, types, status, timestamps and a short error code", () => {
    expect(code).not.toMatch(/payload|body|customer|email|metadata|jsonb|secret|signature/i);
    expect(code).toContain("char_length(last_error) <= 100");
  });

  it("is server-only: RLS on, no policies, privileges revoked from browsers, functions executable by the service role only", () => {
    expect(code).toContain("alter table public.stripe_webhook_events enable row level security");
    expect(code).not.toMatch(/create policy/i);
    expect(code).toContain("revoke all on public.stripe_webhook_events from anon, authenticated;");
    for (const sig of ["claim_stripe_event(text, text)", "complete_stripe_event(text)", "fail_stripe_event(text, text)"]) {
      expect(code).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function public.${sig} to service_role;`);
    }
    expect(code).not.toMatch(/grant execute[^;]*\bto\s+(anon|authenticated|public)\b/);
    expect((code.match(/security definer set search_path = public/g) ?? []).length).toBe(3);
  });

  it("claiming is ONE atomic statement: insert ... on conflict do update, re-claiming only failed or expired events", () => {
    const claim = fn("claim_stripe_event");
    expect(claim).toContain("insert into public.stripe_webhook_events as e");
    expect(claim).toContain("on conflict (event_id) do update");
    expect(claim).toContain("where e.status = 'failed' or (e.status = 'processing' and e.claimed_at < now() - interval '5 minutes')");
    expect(claim).toContain("attempts = e.attempts + 1");
    expect(claim).toContain("return 'claimed'");
    expect(claim).toContain("'duplicate'");
    expect(claim).toContain("'in_progress'");
    expect(claim).not.toMatch(/\bselect\b[^;]*\bfor update\b/); // no check-then-act race
  });

  it("a processed event can never be reclaimed, and complete/fail only act on an event being processed", () => {
    expect(fn("claim_stripe_event")).not.toMatch(/status = 'processed'\s+or/);
    expect(fn("complete_stripe_event")).toContain("where event_id = p_event_id and status = 'processing'");
    expect(fn("fail_stripe_event")).toContain("where event_id = p_event_id and status = 'processing'");
    expect(fn("fail_stripe_event")).toContain("left(coalesce(p_error, 'error'), 100)");
  });

  it("touches nothing but its own table: no entitlements, trials, billing rows or user content", () => {
    const writes = [...code.matchAll(/(?:insert into|(?<!do )(?<!before )update)\s+(?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect([...new Set(writes)]).toEqual(["stripe_webhook_events"]);
    expect(code).not.toMatch(/account_entitlements|account_trial_history|account_billing|notes|outcome_goals|recurring_goal_templates/);
  });
});

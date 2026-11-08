import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The attempt rules live in SQL, which can't run without a live database, so this pins their shape and security by inspection
// (a live check against the real database is run separately).
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_checkout_attempts.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const fn = (name: string) => {
  const start = code.indexOf(`create or replace function public.${name}(`);
  return code.slice(start, code.indexOf("$$;", code.indexOf("as $$", start)));
};

describe("checkout attempts migration", () => {
  it("sorts after the billing status migration", () => {
    expect(file > readdirSync(dir).find((f) => f.endsWith("_billing_status.sql"))!).toBe(true);
  });

  it("is additive: one table, three functions, no drops, deletes or changes to existing objects", () => {
    expect(code.match(/create table/gi)).toHaveLength(1);
    expect(code.match(/create or replace function/gi)).toHaveLength(3);
    expect(code).not.toMatch(/drop\s|delete\s+from|truncate|alter table public\.(?!checkout_attempts)/i);
  });

  it("never touches entitlements, trials, trial history, billing records, the webhook ledger or flags", () => {
    const writes = [...code.matchAll(/(?:insert into|(?<!do )(?<!before )update)\s+(?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect([...new Set(writes)]).toEqual(["checkout_attempts"]);
    expect(code).not.toMatch(/account_entitlements|account_trial_history|stripe_webhook_events|feature_flags|admin_audit_log|notes|outcome_goals/);
    expect(fn("begin_checkout_attempt")).toContain("from public.account_billing b where b.user_id = p_user_id"); // read-only
  });

  it("is server-only: RLS on, no policies, privileges revoked from browsers, functions executable by the service role alone", () => {
    expect(code).toContain("alter table public.checkout_attempts enable row level security");
    expect(code).not.toMatch(/create policy/i);
    expect(code).toContain("revoke all on public.checkout_attempts from anon, authenticated;");
    for (const sig of ["begin_checkout_attempt(uuid, text)", "record_checkout_session(uuid, text, timestamptz)", "finish_checkout_attempt(uuid, text)"]) {
      expect(code).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function public.${sig} to service_role;`);
    }
    expect(code).not.toMatch(/grant execute[^;]*\bto\s+(anon|authenticated|public)\b/);
    expect((code.match(/security definer set search_path = public/g) ?? []).length).toBe(3);
  });

  it("holds no Stripe secret or customer detail: only a session reference, the plan, and times", () => {
    expect(code).not.toMatch(/secret|api_key|token|password|card|email|customer_id|payment_method/i);
    expect(code).toContain("stripe_session_id text unique check (stripe_session_id is null or stripe_session_id like 'cs\\_%')");
  });

  it("at most ONE active attempt per member, enforced by the database itself (a partial unique index) as well as by the lock", () => {
    expect(code).toContain("create unique index if not exists checkout_attempts_one_active_per_member");
    expect(code).toContain("on public.checkout_attempts (user_id) where status in ('creating', 'open')");
    expect(fn("begin_checkout_attempt")).toContain("pg_advisory_xact_lock(hashtextextended('checkout_attempt:' || p_user_id::text, 0))");
  });

  describe("begin_checkout_attempt decides in a fixed order", () => {
    const f = fn("begin_checkout_attempt");
    it("validates the plan and the account first", () => {
      expect(f).toContain("p_plan not in ('monthly', 'annual')");
      expect(f).toContain("select 1 from auth.users where id = p_user_id");
      expect(f.indexOf("p_plan not in")).toBeLessThan(f.indexOf("pg_advisory_xact_lock"));
    });
    it("takes the per-member lock, THEN checks the subscription, THEN the in-flight attempt, THEN claims the slot", () => {
      const iLock = f.indexOf("pg_advisory_xact_lock");
      const iSub = f.indexOf("'subscription_exists'");
      const iFlight = f.indexOf("'in_progress'");
      const iPending = f.indexOf("'pending'");
      const iClaim = f.indexOf("insert into public.checkout_attempts");
      expect(iLock).toBeGreaterThan(-1);
      expect(iSub).toBeGreaterThan(iLock);
      expect(iFlight).toBeGreaterThan(iSub);
      expect(iPending).toBeGreaterThan(iFlight);
      expect(iClaim).toBeGreaterThan(iPending);
    });
    it("a subscription blocks unless it is over for good; an unknown or empty status blocks (fail closed)", () => {
      expect(f).toContain("if v_found and (v_status is null or v_status not in ('canceled', 'incomplete_expired')) then");
    });
    it("a claim younger than 2 minutes is 'in progress'; a stale one for the same plan is re-adopted (same attempt => same Stripe idempotency key); another plan's is retired", () => {
      expect(f).toContain("v_a.updated_at > now() - interval '2 minutes'");
      expect(f).toContain("if v_a.plan = p_plan then");
      expect(f).toContain("return query select 'claimed'::text, v_a.id, null::text, v_a.plan;");
      expect(f).toContain("set status = 'expired'");
    });
    it("an open attempt is 'pending' (Stripe decides) until 15 minutes past its expiry, after which it is retired", () => {
      expect(f).toContain("now() <= v_a.expires_at + interval '15 minutes'");
      expect(f).toContain("return query select 'pending'::text, v_a.id, v_a.stripe_session_id, v_a.plan;");
    });
  });

  it("record_checkout_session and finish_checkout_attempt only move an attempt that is still active, and validate their inputs", () => {
    expect(fn("record_checkout_session")).toContain("where id = p_attempt_id and status = 'creating'");
    expect(fn("record_checkout_session")).toContain("p_session_id not like 'cs\\_%'");
    expect(fn("finish_checkout_attempt")).toContain("where id = p_attempt_id and status in ('creating', 'open')");
    expect(fn("finish_checkout_attempt")).toContain("p_status not in ('completed', 'expired', 'failed')");
  });
});

import { describe, it, expect } from "vitest";
import { createHmac, createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The deletion state, trial marker and foreign-key rules live in SQL, which can't run without a live database, so this pins their shape and security
// by inspection, and models the trial-marker rules in TypeScript to show what they guarantee.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_safe_account_deletion.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const fn = (name: string) => {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("$$;", code.indexOf("as $$", start)));
};

describe("tables are server-only", () => {
  it("each new table has RLS on, no policies, and every privilege revoked from anon and authenticated", () => {
    for (const t of ["account_deletions", "deleted_account_trial_marks", "account_deletion_secrets"]) {
      expect(code, t).toContain(`alter table public.${t} enable row level security;`);
      expect(code, t).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
    expect(code).not.toMatch(/create policy/i);
  });

  it("the deletion state is keyed by account, cascades with the Auth user, and is bounded", () => {
    expect(code).toContain("user_id uuid primary key references auth.users(id) on delete cascade");
    expect(code).toContain("check (state in ('pending', 'billing_cancelled', 'data_cleaned'))");
    expect(code).toContain("last_failure in ('billing', 'storage', 'data', 'auth', 'unexpected')");
    expect(code).toContain("attempts between 0 and 10000");
  });
});

describe("the one-time-trial marker is private", () => {
  it("is an HMAC-SHA-256 under a database-only random key, never a raw email and never a plain hash", () => {
    const f = fn("trial_mark_for_email");
    expect(f).toContain("hmac(convert_to(v_norm, 'UTF8'), v_key, 'sha256')");
    expect(f).toContain("from public.account_deletion_secrets");
    expect(code).not.toMatch(/digest\(|sha256\(|md5\(/i); // no plain hashing of an email anywhere
    expect(code).toContain("insert into public.account_deletion_secrets (id, trial_mark_key)");
    expect(code).toContain("gen_random_uuid()"); // key material from the database CSPRNG, no application secret
    expect(code).toContain("octet_length(trial_mark_key) >= 32");
  });

  it("stores only a 64-hex-character mark and a date: no email, no account ID", () => {
    const tableDef = code.slice(code.indexOf("create table if not exists public.deleted_account_trial_marks"), code.indexOf("alter table public.deleted_account_trial_marks"));
    expect(tableDef).toContain("mark text primary key check (mark ~ '^[0-9a-f]{64}$')");
    expect(tableDef).toContain("created_at timestamptz");
    expect(tableDef).not.toMatch(/email|user_id|uuid/i);
  });

  it("a mark is written only for a deleted account that had used its trial", () => {
    const f = fn("begin_account_deletion");
    expect(f).toContain("if exists (select 1 from public.account_trial_history h where h.user_id = p_user_id)");
    expect(f).toContain("insert into public.deleted_account_trial_marks");
  });

  it("has a defined retention: 24 months, purged on later deletions and ignored once older", () => {
    expect(fn("begin_account_deletion")).toContain("delete from public.deleted_account_trial_marks where created_at < now() - interval '24 months'");
    expect(fn("start_my_premium_trial")).toContain("m.created_at > now() - interval '24 months'");
  });

  it("the normaliser can't be called by any API role", () => {
    expect(code).toContain("revoke all on function public.trial_mark_for_email(text) from public, anon, authenticated;");
    expect(code).not.toMatch(/grant execute on function public\.trial_mark_for_email/);
  });
});

describe("trial activation checks the retained record", () => {
  const f = fn("start_my_premium_trial");

  it("keeps every earlier rule (sign-in, flag, one trial per account, already Premium incl. billing) and adds the deletion + marker refusals", () => {
    for (const kept of ["NOT_SIGNED_IN", "TRIAL_ACTIVATION_DISABLED", "premium_trial_activation_enabled", "TRIAL_ALREADY_USED", "from public.account_trial_history where user_id = v_uid", "ALREADY_PREMIUM", "public.billing_grants_premium(v_uid)", "pg_advisory_xact_lock(hashtextextended('premium_trial:'", "interval '336 hours'"]) expect(f, kept).toContain(kept);
    expect(f).toContain("ACCOUNT_DELETING");
    expect(f).toContain("from public.account_deletions where user_id = v_uid");
    expect(f).toContain("public.trial_mark_for_email((select u.email from auth.users u where u.id = v_uid))");
  });

  it("the mark refusal reuses the existing 'already used' error, so the existing message and UI path apply", () => {
    const i = f.indexOf("deleted_account_trial_marks m");
    expect(f.slice(i, i + 300)).toContain("TRIAL_ALREADY_USED");
  });

  it("is executable by signed-in members only, as before", () => {
    expect(code).toContain("revoke all on function public.start_my_premium_trial() from public, anon;");
    expect(code).toContain("grant execute on function public.start_my_premium_trial() to authenticated;");
  });
});

describe("deletion functions are service-role only and safe", () => {
  const names: [string, string][] = [["begin_account_deletion", "uuid"], ["advance_account_deletion", "uuid, text, text"], ["account_deletion_pending", "uuid"], ["cleanup_account_shared_data", "uuid"]];

  it("executable by the service role alone, running with the owner's rights and a fixed search path", () => {
    for (const [n, sig] of names) {
      expect(code).toContain(`revoke all on function public.${n}(${sig}) from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function public.${n}(${sig}) to service_role;`);
      expect(fn(n)).toContain("security definer set search_path = public");
    }
    expect(code).not.toMatch(/grant execute on function public.(begin_account|advance_account|account_deletion|cleanup_account|trial_mark)[^;]*tos+(anon|authenticated|public)/);
  });

  it("begin is atomic and leased: advisory lock, row lock, 'busy' while another lease is live, resume otherwise", () => {
    const f = fn("begin_account_deletion");
    expect(f).toContain("pg_advisory_xact_lock(hashtextextended('account_deletion:'");
    expect(f).toContain("for update");
    expect(f).toContain("v_row.lease_until > now()");
    expect(f).toContain("'busy'");
    expect(f).toContain("interval '3 minutes'");
  });

  it("advance only moves forward and releases the lease on failure", () => {
    const f = fn("advance_account_deletion");
    expect(f).toContain("case when v_rank >= v_current then p_state else v_cur_state end");
    expect(f).toContain("lease_until = case when p_failure is null then now() + interval '3 minutes' else null end");
    expect(f).toContain("p_failure not in ('billing', 'storage', 'data', 'auth', 'unexpected')");
  });

  it("shared-data cleanup hands a team goal to another participant instead of deleting others' content, unblocks the login deletion, and removes stored grants — and touches no billing, trial or payment record", () => {
    const f = fn("cleanup_account_shared_data");
    expect(f).toContain("update public.team_goals g");
    expect(f).toContain("p.user_id <> p_user_id");
    expect(f).toContain("update public.goal_assignments set canceled_by = null where canceled_by = p_user_id");
    expect(f).toContain("delete from public.account_entitlements where user_id = p_user_id");
    expect(f).not.toMatch(/account_billing|account_trial_history|checkout_attempts|stripe/i);
    expect(f.match(/delete from/g)).toHaveLength(1);
  });
});

describe("foreign keys that would block the login deletion", () => {
  it("goal_assignments.canceled_by and any admin_audit_log keys to auth.users become ON DELETE SET NULL (history kept, unlinked)", () => {
    expect(code).toContain("a.attname = 'canceled_by' and c.confdeltype <> 'n'");
    expect(code).toContain("references auth.users(id) on delete set null");
    expect(code).toContain("to_regclass('public.admin_audit_log')");
    expect(code).toContain("alter column %I drop not null");
    expect(code).not.toMatch(/delete\s+from\s+public\.admin_audit_log/i); // audit history is retained
  });
});

describe("what this migration must NOT do", () => {
  it("never deletes or rewrites payment, billing, ledger or sync data, and doesn't touch the sync function", () => {
    expect(code).not.toMatch(/delete\s+from\s+public\.(account_billing|stripe_webhook_events|checkout_attempts|account_trial_history)/i);
    expect(code).not.toMatch(/sync_stripe_subscription|drop\s+table|truncate/i);
  });

  it("a webhook arriving after the login is gone cannot recreate billing or Premium: the existing sync function maps nothing for a missing account", () => {
    const syncSql = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("_billing_sync.sql"))!), "utf8");
    expect(syncSql).toContain("if not exists (select 1 from auth.users where id = p_user_hint) then");
    expect(syncSql).toMatch(/not exists \(select 1 from auth\.users where id = p_user_hint\) then\s+return 'unmapped'/);
    expect(syncSql).toMatch(/if p_user_hint is null then\s+return 'unmapped'/);
  });

  it("all billing tables cascade with the login, so a completed deletion leaves no billing/entitlement/attempt/trial-history row", () => {
    for (const [f, re] of [["_account_billing.sql", /user_id uuid primary key references auth\.users\(id\) on delete cascade/], ["_account_entitlements.sql", /user_id uuid primary key references auth\.users\(id\) on delete cascade/], ["_premium_trial.sql", /user_id uuid primary key references auth\.users\(id\) on delete cascade/], ["_checkout_attempts.sql", /user_id uuid not null references auth\.users\(id\) on delete cascade/]] as const) {
      expect(readFileSync(join(dir, readdirSync(dir).find((x) => x.endsWith(f))!), "utf8")).toMatch(re);
    }
  });
});

// ---- the trial-marker rules, modelled (the SQL normaliser and HMAC, reproduced) ----
const normalise = (email: string) => email.trim().toLowerCase().replace(/^([^@+]+)\+[^@]*@/, "$1@");
const mark = (email: string, key: Buffer) => createHmac("sha256", key).update(normalise(email), "utf8").digest("hex");

describe("trial reuse after re-registration (modelled)", () => {
  const key = Buffer.from("k".repeat(64));
  it("the SQL's normaliser is the one modelled here", () => {
    expect(code).toContain(String.raw`regexp_replace(lower(btrim(p_email)), '^([^@+]+)\+[^@]*@', '\1@')`);
  });

  it("the same address (any case, spaces, +tag) gets the same mark; a different address a different one", () => {
    const m = mark("Person@Example.com", key);
    expect(m).toMatch(/^[0-9a-f]{64}$/);
    for (const v of ["person@example.com", "  PERSON@EXAMPLE.COM ", "person+trial2@example.com", "Person+x+y@Example.com"]) expect(mark(v, key), v).toBe(m);
    for (const v of ["person2@example.com", "person@example.org", "preson@example.com"]) expect(mark(v, key), v).not.toBe(m);
  });

  it("the mark is not a plain hash (a guessed address can't be checked without the key) and not the address", () => {
    const m = mark("person@example.com", key);
    expect(m).not.toBe(createHash("sha256").update("person@example.com").digest("hex"));
    expect(mark("person@example.com", Buffer.from("different-key".padEnd(64, "x")))).not.toBe(m);
    expect(m).not.toContain("person");
  });

  it("flow: a trial user deletes the account and re-registers with the same email -> refused; a non-trial user -> not refused; a current member -> unchanged", () => {
    const marks = new Set<string>();
    const del = (email: string, hadTrial: boolean) => void (hadTrial && marks.add(mark(email, key)));
    const canStartTrial = (email: string, hasHistory: boolean) => !hasHistory && !marks.has(mark(email, key));
    del("a@example.com", true);
    del("b@example.com", false);
    expect(canStartTrial("a@example.com", false)).toBe(false); // re-registered after using the trial
    expect(canStartTrial("A+again@example.com", false)).toBe(false);
    expect(canStartTrial("b@example.com", false)).toBe(true); // never used a trial: still eligible
    expect(canStartTrial("c@example.com", false)).toBe(true); // brand-new member
    expect(canStartTrial("c@example.com", true)).toBe(false); // existing one-trial-per-account rule unchanged
  });
});

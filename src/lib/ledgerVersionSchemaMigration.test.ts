import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here, so this pins the ledger-version schema migration by inspection: three additive ADD COLUMN statements, then five separate
// ADD CONSTRAINT ... CHECK statements, and nothing else.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const file = names.find((n) => n.endsWith("_ledger_version_columns.sql"))!;
const raw = readFileSync(join(dir, file), "utf8");
const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const statements = code.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const flatRaw = raw.replace(/\s+/g, " ");

const REVERSED_CHECK = "check ( reversed_version is null or (reversed_version > 0 and reversed_at is not null and (ledger_version is null or reversed_version > ledger_version)))";

describe("ledger version columns migration", () => {
  it("exists, is forward-only, and sorts after every migration it builds on", () => {
    expect(file).toBeTruthy();
    for (const dep of ["_payment_account_entries.sql", "_payment_ledger_hardening.sql", "_reverse_payment_lock_order.sql", "_revoke_anon_payment_functions.sql"]) {
      expect(file > names.find((n) => n.endsWith(dep))!, dep).toBe(true);
    }
  });

  it("is exactly eight statements: three ADD COLUMN statements (one per table) followed by five separate ADD CONSTRAINT ... CHECK statements", () => {
    expect(statements).toHaveLength(8);
    expect(statements.slice(0, 3).every((s) => s.startsWith("alter table public.") && s.includes(" add column if not exists "))).toBe(true);
    expect(statements.slice(3).every((s) => s.startsWith("alter table public.") && s.includes(" add constraint ") && s.includes(" check ("))).toBe(true);
    // columns are all added before any constraint that uses them
    expect(statements.findIndex((s) => s.includes(" add constraint "))).toBe(3);
  });

  it("adds the columns with no inline constraints: payment_accounts NOT NULL DEFAULT 0, the four ledger columns nullable with no default", () => {
    expect(statements[0]).toBe("alter table public.payment_accounts add column if not exists ledger_version bigint not null default 0");
    expect(statements[1]).toBe("alter table public.payment_transactions add column if not exists ledger_version bigint, add column if not exists reversed_version bigint");
    expect(statements[2]).toBe("alter table public.payment_account_entries add column if not exists ledger_version bigint, add column if not exists reversed_version bigint");
    for (const s of statements.slice(0, 3)) expect(s).not.toMatch(/\bcheck\b|\bconstraint\b/i);
    for (const s of statements.slice(1, 3)) expect(s).not.toMatch(/\bdefault\b|\bnot null\b/i);
  });

  it("adds payment_accounts.ledger_version >= 0 as its own constraint", () => {
    expect(statements[3]).toBe("alter table public.payment_accounts add constraint payment_accounts_ledger_version_nonneg check (ledger_version >= 0)");
  });

  it("adds ledger_version > 0 when set (NULL allowed for legacy rows) on both ledger tables, as separate constraints", () => {
    expect(statements[4]).toBe("alter table public.payment_transactions add constraint payment_transactions_ledger_version_positive check (ledger_version is null or ledger_version > 0)");
    expect(statements[6]).toBe("alter table public.payment_account_entries add constraint payment_account_entries_ledger_version_positive check (ledger_version is null or ledger_version > 0)");
  });

  it("adds reversed_version rules on both ledger tables: positive, needs reversed_at, and greater than the row's own ledger_version when both are set", () => {
    expect(statements[5]).toBe(`alter table public.payment_transactions add constraint payment_transactions_reversed_version_valid ${REVERSED_CHECK}`);
    expect(statements[7]).toBe(`alter table public.payment_account_entries add constraint payment_account_entries_reversed_version_valid ${REVERSED_CHECK}`);
  });

  it("keeps the legacy states valid: NULL versions, a legacy row reversed later, and a row reversed before versioning", () => {
    for (const i of [5, 7]) {
      expect(statements[i]).toContain("reversed_version is null or");
      expect(statements[i]).toContain("(ledger_version is null or reversed_version > ledger_version)");
    }
    for (const i of [4, 6]) expect(statements[i]).toContain("ledger_version is null or ledger_version > 0");
  });

  it("writes no data and changes nothing else: no backfill, no checkpoints, no functions, no policies, grants, indexes or drops", () => {
    expect(code).not.toMatch(/\b(insert|update|delete|truncate|drop|create|grant|revoke|comment)\b/i);
    expect(code).not.toMatch(/\balter (function|policy|index|trigger)\b|\benable row level security\b|\balter column\b|\bdrop constraint\b/i);
    expect(code).not.toMatch(/record_payment|reverse_payment|confirm_payment_goal_completion|payment_account_entries_immutable|checkpoint/i);
    expect(code).not.toMatch(/\bbalance\b|\bamount\b|\bbalance_applied\b|\bclient_key\b/i);
  });

  it("uses no inline column CHECK constraints anywhere", () => {
    expect(code).not.toMatch(/add column[^;]*\b(check|constraint)\b/i);
  });

  it("documents that it is meant to run once through Supabase migrations, why a second run would fail, and that it preserves data", () => {
    expect(flatRaw).toContain("RUN ONCE: this migration is intended to be applied exactly once, through the Supabase migration process");
    expect(flatRaw).toContain("the ADD CONSTRAINT statements are NOT idempotent");
    expect(flatRaw).toContain("It is data-preserving: every existing row satisfies every new constraint");
    expect(flatRaw).not.toContain("safe to re-run");
  });

  it("documents that nothing uses the columns yet, how a NULL legacy row is read, and the follow-up trigger and immutability work", () => {
    expect(flatRaw).toContain("THIS MIGRATION DOES NOT USE THE COLUMNS");
    expect(flatRaw).toContain('NULL on a row means "legacy: recorded before versioning"');
    expect(flatRaw).toContain("the first one produces 1");
    expect(flatRaw).toContain("must cover ledger_version too before it is relied on");
    expect(flatRaw).toContain("immutability trigger on payment_account_entries does not yet list the two new columns");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The database can't run here, so this pins the Step 4A schema by inspection: one new table, owner-scoped read-only access, kind-specific shapes,
// duplicate-prevention indexes, and nothing that touches existing payment tables, functions or data.
const dir = join(process.cwd(), "supabase", "migrations");
const names = readdirSync(dir);
const file = names.find((n) => n.endsWith("_payment_account_entries.sql"))!;
const raw = readFileSync(join(dir, file), "utf8");
const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = code.replace(/\s+/g, " ").trim();
const table = flat.slice(flat.indexOf("create table if not exists public.payment_account_entries"), flat.indexOf("create unique index if not exists payment_account_entries_client_key_idx"));

describe("payment_account_entries schema migration", () => {
  it("exists, is forward-only, and sorts after the migrations it builds on", () => {
    expect(file).toBeTruthy();
    for (const dep of ["_payment_accounts.sql", "_finance_payment_ledger.sql", "_payment_ledger_hardening.sql", "_confirm_payment_goal_account_lock.sql"]) {
      expect(file > names.find((n) => n.endsWith(dep))!, dep).toBe(true);
    }
    expect(code).not.toMatch(/\bdrop (table|column)\b|\btruncate\b|\bdelete from\b/i);
  });

  it("is schema only: no data written, no function that writes, and nothing touches payment_transactions or the payment functions", () => {
    expect(code).not.toMatch(/\binsert into\b|\bupdate public\./i);
    expect(code).not.toMatch(/payment_transactions|record_payment|reverse_payment|confirm_payment_goal_completion/);
    expect(code.match(/create or replace function/g)).toHaveLength(1); // only the immutability trigger function
    expect(code).not.toMatch(/security definer/i);
    expect(code).not.toMatch(/alter table public\.payment_accounts/i); // payment_accounts gets one unique index, nothing else
  });

  it("defines the four kinds, money as numeric(12,2) with bounds, and the timestamps and ordering columns", () => {
    expect(table).toContain("kind text not null check (kind in ('interest', 'fee', 'adjustment', 'checkpoint'))");
    for (const col of ["amount", "balance_delta", "balance_after"]) expect(table, col).toMatch(new RegExp(`${col} numeric\\(12, 2\\)`));
    expect(table).toContain("amount >= 0 and amount <= 99999999.99");
    expect(table).toContain("created_at timestamptz not null default clock_timestamp()");
    expect(table).toContain("seq bigint generated always as identity");
    expect(table).toContain("reversed_at timestamptz");
    expect(table).not.toMatch(/default now\(\)/i);
  });

  it("ties every row to its account's owner with a composite foreign key that cascades, backed by a unique index on payment_accounts", () => {
    expect(flat).toContain("create unique index if not exists payment_accounts_id_user_id_key on public.payment_accounts (id, user_id)");
    expect(table).toContain("foreign key (account_id, user_id) references public.payment_accounts (id, user_id) on delete cascade");
  });

  it("gives each kind exactly one valid shape (adjustments need a reason, interest needs a statement date, checkpoints carry the reconciled balance)", () => {
    expect(table).toContain("when 'interest' then amount > 0 and statement_date is not null and balance_after is null");
    expect(table).toContain("when 'fee' then amount > 0 and balance_after is null");
    expect(table).toContain("balance_delta = case when balance_applied then amount else 0 end");
    expect(table).toContain("when 'adjustment' then amount > 0 and balance_applied and balance_delta <> 0 and abs(balance_delta) = amount and balance_after is null and reason is not null");
    expect(table).toContain("when 'checkpoint' then amount = 0 and balance_delta = 0 and balance_applied and balance_after is not null and statement_date is not null");
    expect(table).toContain("end, false))"); // a NULL result can never slip past the check
    expect(table).toContain("reason is null or char_length(btrim(reason)) between 1 and 500");
  });

  it("a checkpoint can never be reversed", () => {
    expect(table).toContain("check (kind <> 'checkpoint' or reversed_at is null)");
  });

  it("prevents duplicates by client key and by checkpoint per statement; repeated interest per statement is deliberately NOT blocked at the schema level", () => {
    expect(flat).toContain("payment_account_entries_client_key_idx on public.payment_account_entries (user_id, client_key) where client_key is not null");
    expect(flat).not.toContain("payment_account_entries_interest_per_statement_idx");
    expect(flat).not.toMatch(/where kind = 'interest'/);
    expect(flat).toContain("on public.payment_account_entries (account_id, statement_date) where kind = 'checkpoint'");
  });

  it("is read-only for clients: RLS on, one owner-scoped SELECT policy, no write policy, all privileges revoked then only SELECT granted to authenticated", () => {
    expect(flat).toContain("alter table public.payment_account_entries enable row level security");
    expect(code.match(/create policy/g)).toHaveLength(1);
    expect(flat).toContain('create policy "payment_account_entries_select_own" on public.payment_account_entries for select using (user_id = auth.uid())');
    expect(code).not.toMatch(/for (insert|update|delete|all)/i);
    expect(flat).toContain("revoke all on public.payment_account_entries from anon, authenticated");
    expect(flat).toContain("grant select on public.payment_account_entries to authenticated");
    expect(code.match(/\bgrant\b/gi)).toHaveLength(1);
  });

  it("freezes every column except the one-time reversed_at stamp (a trigger, in addition to having no write access)", () => {
    expect(flat).toContain("before update on public.payment_account_entries for each row execute function public.payment_account_entries_immutable()");
    expect(flat).toContain("raise exception 'Ledger entries cannot be edited'");
    expect(flat).toContain("raise exception 'This entry has already been reversed'");
    // every non-reversed_at column is compared
    for (const col of ["id", "account_id", "user_id", "kind", "amount", "balance_delta", "balance_applied", "balance_after", "entry_date", "statement_date", "reason", "note", "client_key", "created_at", "seq"]) {
      expect(flat, col).toContain(`new.${col}`);
      expect(flat, col).toContain(`old.${col}`);
    }
    expect(flat).not.toMatch(/new\.reversed_at, new\./);
  });

  it("documents that created_at and seq are informational, not a cross-table ordering or checkpoint boundary, and what a later step must provide", () => {
    expect(raw).toContain("created_at (clock_timestamp()) and seq are INFORMATIONAL only");
    expect(raw).toContain("do NOT\n-- establish a reliable order between payment_transactions rows and entries rows");
    expect(raw).toContain("nothing here may be used as a checkpoint boundary");
    expect(raw).toContain("serialized on the account row lock, taken BEFORE it writes");
    expect(raw).toContain("reverse_payment does not yet");
    expect(raw).toContain("an explicit boundary strategy, defined and reviewed then");
    expect(raw).toContain("No reconciliation rule or formula is defined or implied by this table.");
  });

  it("no longer claims an ordering rule: no POST/PRE-checkpoint definition and no reconciliation formula remain", () => {
    expect(raw).not.toMatch(/POST-checkpoint|PRE-checkpoint|pre-checkpoint|expected balance is/i);
    expect(raw).not.toMatch(/p\.created_at\s*>\s*cp\.created_at|e\.reversed_at\s*>\s*cp/);
    expect(raw).not.toMatch(/is only sound if/i);
  });
});

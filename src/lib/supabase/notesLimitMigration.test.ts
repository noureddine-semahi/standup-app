import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { FREE_LIMITS } from "@/lib/entitlements";

// The trigger can't run without a live database, so this pins its shape by inspection: where it fires, what it counts, who is
// exempt, how it serializes concurrent creations, and that it never touches existing notes.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_notes_free_limit.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("notes free-limit migration", () => {
  it("exists and sorts after the notes and entitlement migrations it depends on", () => {
    const names = readdirSync(dir);
    expect(file > names.find((f) => f.endsWith("_notes.sql"))!).toBe(true);
    expect(file > names.find((f) => f.endsWith("_account_entitlements.sql"))!).toBe(true);
  });

  it("fires only BEFORE INSERT on notes, so existing notes, editing, pinning and deleting are never affected", () => {
    expect(code).toMatch(/create trigger trg_enforce_note_limit\s+before insert on public\.notes\s+for each row execute function public\.enforce_note_limit\(\)/);
    expect(code.match(/create trigger/g)).toHaveLength(1);
    expect(code).not.toMatch(/before (update|delete)|after (insert|update|delete)|instead of/i);
    expect(code).not.toMatch(/delete from|update public\.notes|alter table|drop table|drop column/i);
  });

  it("the limit equals FREE_LIMITS.notes and refuses the next note with NOTE_LIMIT_REACHED (53400)", () => {
    expect(code).toContain(`if v_count >= ${FREE_LIMITS.notes} then`);
    expect(FREE_LIMITS.notes).toBe(10);
    expect(code).toContain("raise exception 'NOTE_LIMIT_REACHED'");
    expect(code).toContain("errcode = '53400'");
  });

  it("premium and an active premium trial are exempt, using the same effective-tier rule as get_my_account_entitlement()", () => {
    expect(code).toContain("from public.account_entitlements e");
    expect(code).toContain("public.effective_account_tier(coalesce(v_tier, 'free'), v_ends) <> 'free' then");
    // the exemption returns before anything is counted
    expect(code.indexOf("<> 'free' then")).toBeLessThan(code.indexOf("select count(*)"));
  });

  it("counts only the inserting user's notes", () => {
    expect(code).toContain("select count(*) into v_count from public.notes where user_id = new.user_id");
    expect(code.match(/from public\.notes/g)).toHaveLength(1);
  });

  it("serializes concurrent creations per user with a transaction-scoped advisory lock taken BEFORE the count", () => {
    expect(code).toMatch(/pg_advisory_xact_lock\(hashtextextended\('notes_free_limit:' \|\| new\.user_id::text, 0\)\)/);
    expect(code.indexOf("pg_advisory_xact_lock")).toBeLessThan(code.indexOf("select count(*)"));
    expect(code).not.toContain("pg_advisory_lock(");
  });

  it("an insert that claims someone else's user_id is passed through for the insert policy to reject, never counted", () => {
    expect(code).toMatch(/if auth\.uid\(\) is not null and new\.user_id is distinct from auth\.uid\(\) then\s+return new;/);
    expect(code.indexOf("is distinct from auth.uid()")).toBeLessThan(code.indexOf("account_entitlements"));
  });

  it("is security definer with a pinned search_path (so it can read the entitlement row), and creates no policy", () => {
    expect(code).toContain("security definer set search_path = public");
    expect(code).not.toMatch(/create policy|drop policy/i);
  });
});

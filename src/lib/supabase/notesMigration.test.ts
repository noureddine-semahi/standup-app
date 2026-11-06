import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Row Level Security can't be exercised without a live database, so this pins the migration's security shape by
// inspection: owner-only policies for all four operations, no way to reassign an owner, and a database-owned revision.
const dir = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(dir).find((f) => f.endsWith("_notes.sql"))!;
const sql = readFileSync(join(dir, file), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("notes migration", () => {
  it("exists and sorts after the latest earlier migration", () => {
    expect(file).toBeTruthy();
    const earlier = readdirSync(dir).filter((f) => f !== file && f.endsWith(".sql")).sort();
    expect(earlier.every((f) => f < file)).toBe(true);
  });

  it("creates one owner-scoped table with row level security on", () => {
    expect(code).toMatch(/create table if not exists public\.notes[\s\S]*?user_id uuid not null references auth\.users\(id\) on delete cascade/);
    expect(code).toContain("alter table public.notes enable row level security");
  });

  it("has an owner-only policy for each of SELECT, INSERT, UPDATE and DELETE, and nothing broader", () => {
    expect(code).toContain("on public.notes for select using (auth.uid() = user_id)");
    expect(code).toContain("on public.notes for insert with check (auth.uid() = user_id)");
    expect(code).toMatch(/on public\.notes for update using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
    expect(code).toContain("on public.notes for delete using (auth.uid() = user_id)");
    expect(code.match(/create policy/g)).toHaveLength(4);
    expect(code).not.toMatch(/for all/i);
    expect(code).not.toMatch(/using \(true\)|with check \(true\)/i);
    expect(code).not.toMatch(/to anon|to public/i);
  });

  it("a note's owner can't be reassigned (the trigger pins user_id on update)", () => {
    expect(code).toContain("new.user_id := old.user_id");
  });

  it("the database owns revision and updated_at: bumped only on a real change, ignored if a client sends them", () => {
    expect(code).toContain("new.revision := 0");
    expect(code).toContain("new.revision := old.revision + 1");
    expect(code).toMatch(/before insert or update on public\.notes/);
    // pinning moves the revision but not the 'last edited' time
    expect(code).toMatch(/new\.pinned is distinct from old\.pinned then\s+new\.revision := old\.revision \+ 1;\s+new\.updated_at := old\.updated_at/);
  });

  it("limits title and body size, and is additive only", () => {
    expect(code).toContain("char_length(title) <= 200");
    expect(code).toContain("char_length(body) <= 20000");
    expect(code).not.toMatch(/drop table|drop column|truncate|delete from|alter table public\.(?!notes)/i);
    expect(code).not.toMatch(/security definer/i);
  });
});

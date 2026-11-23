import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc.fn(...a), auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } }, error: null }) } },
}));

import { getAssigneeChecklists } from "./supabase/db";

const A1 = "a1", A2 = "a2", A3 = "a3";
beforeEach(() => {
  rpc.fn.mockReset();
});

describe("getAssigneeChecklists", () => {
  it("makes ONE batched, de-duplicated RPC call and groups the rows per assignment, sorted by position with statuses preserved", async () => {
    rpc.fn.mockResolvedValue({
      data: [
        { assignment_id: A1, item_id: "i2", text: "milk", status: "completed", position: 1 },
        { assignment_id: A1, item_id: "i1", text: "bread", status: "completed", position: 0 },
        { assignment_id: A1, item_id: "i3", text: "turkey", status: "missing", position: 2 },
        { assignment_id: A1, item_id: "i4", text: "potatoes", status: "pending", position: 3 },
        { assignment_id: A2, item_id: "j1", text: "x", status: "pending", position: 0 },
      ],
      error: null,
    });
    const out = await getAssigneeChecklists([A1, A2, A1, ""]);
    expect(rpc.fn).toHaveBeenCalledTimes(1);
    expect(rpc.fn).toHaveBeenCalledWith("get_assignee_checklist", { p_assignment_ids: [A1, A2] });
    expect(out[A1]).toEqual({
      state: "ready",
      items: [
        { id: "i1", text: "bread", status: "completed", position: 0 },
        { id: "i2", text: "milk", status: "completed", position: 1 },
        { id: "i3", text: "turkey", status: "missing", position: 2 },
        { id: "i4", text: "potatoes", status: "pending", position: 3 },
      ],
    });
    expect(out[A2]).toEqual({ state: "ready", items: [{ id: "j1", text: "x", status: "pending", position: 0 }] });
  });

  it("an authorized-but-empty checklist (the RPC's null-item marker row) is READY with no items, not unavailable", async () => {
    rpc.fn.mockResolvedValue({ data: [{ assignment_id: A1, item_id: null, text: null, status: null, position: null }], error: null });
    expect((await getAssigneeChecklists([A1]))[A1]).toEqual({ state: "ready", items: [] });
  });

  it("an id the RPC returns nothing for is UNAVAILABLE (not accepted / not yours / the assignee's Task is gone)", async () => {
    rpc.fn.mockResolvedValue({ data: [{ assignment_id: A1, item_id: "i1", text: "a", status: "pending", position: 0 }], error: null });
    const out = await getAssigneeChecklists([A1, A3]);
    expect(out[A3]).toEqual({ state: "unavailable" });
    expect(out[A1].state).toBe("ready");
  });

  it("a failed request THROWS (so the UI can say 'couldn't load'), distinct from empty and unavailable", async () => {
    rpc.fn.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getAssigneeChecklists([A1])).rejects.toMatchObject({ message: "boom" });
  });

  it("an empty request makes no call", async () => {
    expect(await getAssigneeChecklists([])).toEqual({});
    expect(await getAssigneeChecklists(["", ""])).toEqual({});
    expect(rpc.fn).not.toHaveBeenCalled();
  });

  it("ignores rows for ids it did not ask about, and treats an unknown status as pending", async () => {
    rpc.fn.mockResolvedValue({
      data: [
        { assignment_id: "stranger", item_id: "z", text: "leak", status: "completed", position: 0 },
        { assignment_id: A1, item_id: "i1", text: "odd", status: "weird", position: 0 },
      ],
      error: null,
    });
    const out = await getAssigneeChecklists([A1]);
    expect(Object.keys(out)).toEqual([A1]);
    expect(out[A1]).toEqual({ state: "ready", items: [{ id: "i1", text: "odd", status: "pending", position: 0 }] });
  });

  it("only ever calls the read-only RPC (no table access, no writes)", async () => {
    rpc.fn.mockResolvedValue({ data: [], error: null });
    await getAssigneeChecklists([A1]);
    expect(rpc.fn.mock.calls.every((c) => c[0] === "get_assignee_checklist")).toBe(true);
  });
});

describe("migration 20261219000100 (shape)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261219000100_get_assignee_checklist.sql"), "utf8").replace(/\r\n/g, "\n");
  const code = sql.replace(/--[^\n]*/g, ""); // ignore comments
  it("is a SECURITY DEFINER, STABLE function with an empty search_path", () => {
    expect(code).toMatch(/create or replace function public\.get_assignee_checklist\(p_assignment_ids uuid\[\]\)/);
    expect(code).toMatch(/security definer/);
    expect(code).toMatch(/set search_path = ''/);
    expect(code).toMatch(/\bstable\b/);
  });
  it("authorizes by assigner = auth.uid(), accepted only, and starts from the recipient's own goal", () => {
    expect(code).toMatch(/ga\.assigner_id = auth\.uid\(\)/);
    expect(code).toMatch(/ga\.status = 'accepted'/);
    expect(code).toMatch(/rg\.user_id = ga\.recipient_id/);
  });
  it("walks materialized reschedule lineage with a cycle guard and a depth cap", () => {
    expect(code).toMatch(/with recursive/);
    expect(code).toMatch(/gr\.materialized\b/);
    expect(code).toMatch(/gr\.user_id = c\.recipient_id/);
    expect(code).toMatch(/not \(gr\.materialized_goal_id = any \(c\.seen\)\)/);
    expect(code).toMatch(/c\.depth < \d+/);
  });
  it("returns only the five fields and writes nothing", () => {
    expect(code).toMatch(/returns table \(assignment_id uuid, item_id uuid, text text, status text, "position" integer\)/);
    expect(code).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|alter\s+table|create\s+policy|drop\s+)/i);
  });
  it("revokes PUBLIC and anon, grants authenticated only", () => {
    expect(code).toMatch(/revoke all on function public\.get_assignee_checklist\(uuid\[\]\) from public;/);
    expect(code).toMatch(/revoke all on function public\.get_assignee_checklist\(uuid\[\]\) from anon;/);
    expect(code).toMatch(/grant execute on function public\.get_assignee_checklist\(uuid\[\]\) to authenticated;/);
    expect(code).not.toMatch(/to anon/);
  });
});

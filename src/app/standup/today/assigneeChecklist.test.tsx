import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import type { GoalAssignmentWithLiveTasks } from "@/lib/supabase/db";

// The real Today page with its data layer replaced. An ACCEPTED assigned-out Task must show the ASSIGNEE's checklist as THE checklist of
// the assigner's original Task (read-only, refreshed on open/focus) -- while the assigner's own checklist rows are never written.
const api = vi.hoisted(() => ({
  getPlanWithGoals: vi.fn(),
  getMyGoalAssignmentsWithLiveTasks: vi.fn(),
  getAssigneeChecklists: vi.fn(),
  getChecklistItemsForGoals: vi.fn(),
}));
const writes = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/standup/today",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
// Any table query resolves to "no rows"; any rpc to "no data". Every insert/update/delete/upsert is recorded in `writes`.
vi.mock("@/lib/supabase/client", () => {
  const tableProxy = (table: string): unknown => {
    const chain: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(chain, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
        if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
        return () => {
          if (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert") writes.list.push(`${String(prop)}:${table}`);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return {
    supabase: {
      from: (table: string) => tableProxy(table),
      rpc: () => Promise.resolve({ data: [], error: null }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: "dean" } } }, error: null }),
        getUser: () => Promise.resolve({ data: { user: { id: "dean" } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/lib/supabase/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/db")>("@/lib/supabase/db");
  return { ...actual, ...api, getStreakPassCoveredDates: vi.fn().mockResolvedValue(new Set()) };
});
vi.mock("@/lib/supabase/entitlements", () => ({ getMyEntitlement: vi.fn().mockResolvedValue({ tier: "free" }) }));
vi.mock("@/lib/useFeatureFlags", () => ({ useLimitReachedText: () => () => "", useFeatureFlag: () => false, useFeatureFlags: () => ({}) }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import TodayPage from "./page";

const TODAY = "2026-11-18";
const goal = (over: Record<string, unknown> = {}) => ({
  id: "g1", plan_id: "plan1", user_id: "dean", title: "Go to HEB", details: null, status: "not_started", sort_order: 0, priority: 3,
  reviewed_at: null, outcome_goal_id: null, rescheduled_to: null, link_url: null, created_at: "2026-11-18T08:00:00Z", ...over,
});
const assignment = (over: Record<string, unknown> = {}): GoalAssignmentWithLiveTasks =>
  ({
    id: "as1", status: "accepted", direction: "assigned", assignmentType: "exclusive", assignerGoalId: "g1", recipientGoalId: "n1",
    recipientDisplayName: "Nino", recipientId: "nino", assignerId: "dean", assignerDisplayName: "Dean", planDate: TODAY,
    assignerGoalStatus: "not_started", recipientGoalStatus: "not_started", assignerCurrentTask: null, recipientCurrentTask: null,
    snapshotTitle: "Go to HEB", snapshotDetails: null, snapshotPriority: 3, createdAt: "", respondedAt: "", assignerSeenAt: null,
    recipientPlanDate: TODAY, canceledBy: null, cancelReason: null, recipientSeenAt: null, ...over,
  }) as unknown as GoalAssignmentWithLiveTasks;

type Item = { id: string; text: string; status: "pending" | "completed" | "missing"; position: number };
const nino: Item[] = [
  { id: "i1", text: "Bread", status: "completed", position: 0 },
  { id: "i2", text: "Whole milk", status: "completed", position: 1 },
  { id: "i3", text: "Toilet paper", status: "completed", position: 2 },
  { id: "i4", text: "Turkey", status: "missing", position: 3 },
  { id: "i5", text: "Potatoes", status: "missing", position: 4 },
];
// Dean's ORIGINAL checklist (what he built before assigning): 1/2 completed.
const dean = [
  { id: "d1", goal_id: "g1", user_id: "dean", text: "Dean bread", is_checked: true, status: "completed", position: 0, created_at: "" },
  { id: "d2", goal_id: "g1", user_id: "dean", text: "Dean milk", is_checked: false, status: "missing", position: 1, created_at: "" },
];

function mount(assignments: GoalAssignmentWithLiveTasks[], opts: { goalOver?: Record<string, unknown>; entry?: unknown; impl?: () => Promise<unknown> } = {}) {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() });
  api.getPlanWithGoals.mockResolvedValue({ plan: { id: "plan1", user_id: "dean", plan_date: PLAN_DATE, status: "draft" }, goals: [goal(opts.goalOver)] });
  api.getMyGoalAssignmentsWithLiveTasks.mockResolvedValue(assignments);
  api.getChecklistItemsForGoals.mockResolvedValue({ g1: dean });
  if (opts.impl) api.getAssigneeChecklists.mockImplementation(opts.impl);
  else api.getAssigneeChecklists.mockResolvedValue({ as1: opts.entry ?? { state: "ready", items: nino } });
  return render(
    <LanguageProvider>
      <TodayPage />
    </LanguageProvider>
  );
}
const PLAN_DATE = TODAY;
// Today collapses a Completed card (existing behaviour); open it. Tomorrow never does, so this is a no-op there.
async function openIfCollapsed() {
  await screen.findByText("Go to HEB");
  const header = screen.queryByRole("button", { name: /Go to HEB\s*Completed/ });
  if (header) fireEvent.click(header);
}
const controls = (root: HTMLElement) => within(root).queryAllByRole("button", { name: /Edit item|Remove item|Tap to change|Save|^Add$/ });

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  for (const fn of Object.values(api)) fn.mockReset();
  writes.list = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("assigned-out Task: the assigner's original Task shows the assignee's checklist", () => {
  it("accepted: ONE checklist, Nino's 3/5, replacing Dean's own 1/2; no second panel, no 'My checklist'", async () => {
    mount([assignment()]);
    await screen.findByRole("button", { name: /^Checklist \(3\/5\)$/ });
    expect(screen.getAllByRole("button", { name: /^Checklist/ })).toHaveLength(1); // a single checklist control
    expect(screen.queryByText(/My checklist|Mi lista/)).toBeNull();
    const region = screen.getByTestId("assignee-checklist");
    expect(within(region).getByText("Nino's checklist")).toBeTruthy();
    expect(within(region).getAllByTestId("assignee-checklist-row")).toHaveLength(5);
    expect(within(region).getByText("Turkey")).toBeTruthy();
    // Dean's original items are not what is shown...
    expect(screen.queryByText("Dean bread")).toBeNull();
    expect(screen.queryByText("Dean milk")).toBeNull();
    // ...and it is strictly read-only
    expect(controls(region)).toHaveLength(0);
    expect(screen.queryByPlaceholderText("Add item…")).toBeNull();
    expect(api.getAssigneeChecklists).toHaveBeenCalledWith(["as1"]);
  });

  it("the original checklist data is never written or overwritten", async () => {
    mount([assignment()]);
    await screen.findByRole("button", { name: /^Checklist \(3\/5\)$/ });
    fireEvent.click(screen.getByRole("button", { name: /^Checklist/ })); // collapse
    fireEvent.click(screen.getByRole("button", { name: /^Checklist/ })); // expand again
    expect(writes.list.filter((w) => w.endsWith(":goal_checklist_items"))).toEqual([]);
    expect(api.getChecklistItemsForGoals).toHaveBeenCalled(); // Dean's rows are still loaded, just not displayed
  });

  it("reflects the assignee's added, edited and deleted items and status changes after the page regains focus (counts follow)", async () => {
    mount([assignment()]);
    await screen.findByRole("button", { name: /^Checklist \(3\/5\)$/ });
    api.getAssigneeChecklists.mockResolvedValue({
      as1: {
        state: "ready",
        items: [
          { id: "i1", text: "Bread", status: "completed", position: 0 },
          { id: "i2", text: "2% milk", status: "completed", position: 1 }, // edited text
          // "Toilet paper" deleted
          { id: "i4", text: "Turkey", status: "completed", position: 3 }, // Missing -> Completed
          { id: "i5", text: "Potatoes", status: "pending", position: 4 }, // Missing -> Pending
          { id: "i6", text: "Napkins", status: "pending", position: 5 }, // added
        ],
      },
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await screen.findByRole("button", { name: /^Checklist \(3\/5\)$/ }); // 3 of 5 again, but different items:
    expect(screen.getByText("2% milk")).toBeTruthy();
    expect(screen.queryByText("Whole milk")).toBeNull();
    expect(screen.queryByText("Toilet paper")).toBeNull();
    expect(screen.getByText("Napkins")).toBeTruthy();
    const row = (t: string) => screen.getByText(t).closest("[data-testid=assignee-checklist-row]") as HTMLElement;
    expect(row("Turkey").getAttribute("data-status")).toBe("completed");
    expect(row("Potatoes").getAttribute("data-status")).toBe("pending");
    expect(api.getAssigneeChecklists).toHaveBeenCalledTimes(2);
  });

  it("progress counts change with the statuses (Missing and Pending are not Completed)", async () => {
    mount([assignment()], { entry: { state: "ready", items: [...nino, { id: "i6", text: "Napkins", status: "pending", position: 5 }, { id: "i7", text: "Soap", status: "completed", position: 6 }] } });
    await screen.findByRole("button", { name: /^Checklist \(4\/7\)$/ });
  });

  it("works for SHARED and EXCLUSIVE assignments alike (the assigner's own copy is read-only either way)", async () => {
    for (const assignmentType of ["exclusive", "shared"]) {
      mount([assignment({ assignmentType })]);
      await screen.findByRole("button", { name: /^Checklist \(3\/5\)$/ });
      expect(screen.queryByText("Dean bread")).toBeNull();
      expect(controls(screen.getByTestId("assignee-checklist"))).toHaveLength(0);
      cleanup();
      for (const fn of Object.values(api)) fn.mockReset();
    }
  });

  it("a COMPLETED assignment keeps the results visible (independent of Task completion)", async () => {
    mount([assignment({ recipientGoalStatus: "completed" })]);
    await openIfCollapsed();
    await screen.findByRole("button", { name: /^Checklist \(3\/5\)$/ });
    expect(screen.getByText("Turkey")).toBeTruthy();
  });

  it("while loading it shows the assignee's checklist loading, never Dean's stale one", async () => {
    let release: (v: unknown) => void = () => {};
    mount([assignment()], { impl: () => new Promise((r) => (release = r)) });
    fireEvent.click(await screen.findByRole("button", { name: /^Checklist$/ }));
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("Dean bread")).toBeNull();
    await act(async () => {
      release({ as1: { state: "ready", items: nino } });
    });
    await screen.findByRole("button", { name: /^Checklist \(3\/5\)$/ });
  });

  it("when the lookup fails it says so (and does not show Dean's stale list in its place)", async () => {
    mount([assignment()], { impl: () => Promise.reject(new Error("net")) });
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't load this checklist.");
    expect(screen.queryByText("Dean bread")).toBeNull();
  });
});

describe("assignments that are not (or no longer) active keep the original checklist", () => {
  it("PENDING: Dean's original checklist is shown and editable, with no assignee lookup", async () => {
    mount([assignment({ status: "pending", recipientGoalId: null })]);
    await screen.findByText("Dean bread");
    expect(screen.getByRole("button", { name: /^Checklist \(1\/2\)/ })).toBeTruthy();
    expect(screen.queryByTestId("assignee-checklist")).toBeNull();
    expect(within(screen.getByText("Dean bread").closest("div") as HTMLElement).queryAllByRole("button").length).toBeGreaterThan(0); // editable controls
    expect(api.getAssigneeChecklists).not.toHaveBeenCalled();
  });

  it("DECLINED, CANCELED and RECEIVED Tasks keep their own checklist and make no assignee lookup", async () => {
    for (const over of [{ status: "declined" }, { status: "canceled" }, { direction: "received" }]) {
      mount([assignment(over)]);
      await screen.findByText("Dean bread");
      expect(screen.queryByTestId("assignee-checklist")).toBeNull();
      expect(api.getAssigneeChecklists).not.toHaveBeenCalled();
      cleanup();
      for (const fn of Object.values(api)) fn.mockReset();
    }
  });

  it("an accepted assignment whose assignee checklist is UNAVAILABLE (their Task is gone) falls back to the original, read-only", async () => {
    mount([assignment()], { entry: { state: "unavailable" } });
    await screen.findByText("Dean bread");
    expect(screen.queryByTestId("assignee-checklist")).toBeNull();
    const rows = screen.getAllByTestId("checklist-row");
    for (const r of rows) expect(within(r).queryAllByRole("button")).toHaveLength(0); // no status / edit / delete controls
    expect(screen.queryByPlaceholderText("Add item…")).toBeNull();
  });

  it("a Task that was never assigned is completely unchanged", async () => {
    mount([]);
    await screen.findByText("Dean bread");
    expect(screen.queryByTestId("assignee-checklist")).toBeNull();
    expect(api.getAssigneeChecklists).not.toHaveBeenCalled();
  });
});

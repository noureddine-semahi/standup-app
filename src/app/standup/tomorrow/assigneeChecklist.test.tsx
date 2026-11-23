import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { GoalAssignmentWithLiveTasks } from "@/lib/supabase/db";

// The real Today page with its data layer replaced: checks that an accepted, assigned-out Task shows "My checklist" plus the
// assignee's separate, read-only checklist, and that nothing else does.
const api = vi.hoisted(() => ({
  getPlanWithGoals: vi.fn(),
  getMyGoalAssignmentsWithLiveTasks: vi.fn(),
  getAssigneeChecklists: vi.fn(),
  getChecklistItemsForGoals: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/standup/tomorrow",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
// Any table query resolves to "no rows"; any rpc to "no data". Only the functions overridden above return real data.
vi.mock("@/lib/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const result = { data: [], error: null, count: 0 };
  const proxy: unknown = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return {
    supabase: {
      from: () => proxy,
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
import TomorrowPage from "./page";

const TODAY = "2026-11-18";
const TOMORROW = "2026-11-19";
const goal = (over: Record<string, unknown> = {}) => ({
  id: "g1", plan_id: "plan1", user_id: "dean", title: "Go to HEB", details: null, status: "not_started", sort_order: 0, priority: 3,
  reviewed_at: null, outcome_goal_id: null, rescheduled_to: null, link_url: null, created_at: "2026-11-18T08:00:00Z", ...over,
});
const assignment = (over: Record<string, unknown> = {}): GoalAssignmentWithLiveTasks =>
  ({
    id: "as1", status: "accepted", direction: "assigned", assignmentType: "exclusive", assignerGoalId: "g1", recipientGoalId: "n1",
    recipientDisplayName: "Nino", recipientId: "nino", assignerId: "dean", assignerDisplayName: "Dean", planDate: TODAY,
    assignerGoalStatus: "not_started", recipientGoalStatus: "completed", assignerCurrentTask: null, recipientCurrentTask: null,
    snapshotTitle: "Go to HEB", snapshotDetails: null, snapshotPriority: 3, createdAt: "", respondedAt: "", assignerSeenAt: null,
    recipientPlanDate: TODAY, canceledBy: null, cancelReason: null, recipientSeenAt: null, ...over,
  }) as unknown as GoalAssignmentWithLiveTasks;

const nino = [
  { id: "i1", text: "Bread", status: "completed", position: 0 },
  { id: "i2", text: "Whole milk", status: "completed", position: 1 },
  { id: "i3", text: "Toilet paper", status: "completed", position: 2 },
  { id: "i4", text: "Turkey", status: "missing", position: 3 },
  { id: "i5", text: "Potatoes", status: "missing", position: 4 },
];
const dean = [
  { id: "d1", goal_id: "g1", user_id: "dean", text: "Dean bread", is_checked: true, status: "completed", position: 0, created_at: "" },
  { id: "d2", goal_id: "g1", user_id: "dean", text: "Dean milk", is_checked: false, status: "missing", position: 1, created_at: "" },
];

function mount(assignments: GoalAssignmentWithLiveTasks[], goalOver: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() });
  api.getPlanWithGoals.mockResolvedValue({ plan: { id: "plan1", user_id: "dean", plan_date: TOMORROW, status: "draft" }, goals: [goal(goalOver)] });
  api.getMyGoalAssignmentsWithLiveTasks.mockResolvedValue(assignments);
  api.getChecklistItemsForGoals.mockResolvedValue({ g1: dean });
  api.getAssigneeChecklists.mockResolvedValue({ as1: { state: "ready", items: nino } });
  return render(
    <LanguageProvider>
      <TomorrowPage />
    </LanguageProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Tomorrow: assigned-out Task checklists", () => {
  it("shows 'My checklist' and, separately, the assignee's checklist with its own progress (3/5), read-only", async () => {
    mount([assignment({ recipientGoalStatus: "not_started" })]); // before completion: the card is open
    const mine = await screen.findByRole("button", { name: /^My checklist \(1\/2\)/ });
    const theirs = await screen.findByRole("button", { name: /Nino's checklist \(3\/5\)/ });
    expect(mine).not.toBe(theirs);
    fireEvent.click(theirs);
    const region = screen.getByTestId("assignee-checklist");
    expect(within(region).getByText("Turkey")).toBeTruthy();
    expect(within(region).getAllByTestId("assignee-checklist-row")).toHaveLength(5);
    expect(within(region).getAllByRole("button")).toHaveLength(1); // only its own expand/collapse toggle
    expect(api.getAssigneeChecklists).toHaveBeenCalledTimes(1);
    expect(api.getAssigneeChecklists).toHaveBeenCalledWith(["as1"]);
  });

  it("works for a SHARED assignment too, and still shows after the Task is completed", async () => {
    // The assignee finished it: the assigner's mirrored card is Completed; Tomorrow does not collapse it.
    mount([assignment({ recipientGoalStatus: "completed" })]);
    await screen.findByRole("button", { name: /Nino's checklist \(3\/5\)/ });
    expect(screen.getByRole("button", { name: /^My checklist/ })).toBeTruthy();
    cleanup();
    for (const fn of Object.values(api)) fn.mockReset();
    mount([assignment({ assignmentType: "shared" })], { status: "completed" }); // shared: the assigner's own copy is editable and also completed
    await screen.findByRole("button", { name: /Nino's checklist \(3\/5\)/ });
  });

  it("does not show for pending, declined or canceled assignments, nor for a Task you RECEIVED", async () => {
    for (const over of [{ status: "pending" }, { status: "declined" }, { status: "canceled" }, { direction: "received" }]) {
      mount([assignment(over)]);
      await screen.findByText("Go to HEB");
      await waitFor(() => expect(api.getMyGoalAssignmentsWithLiveTasks).toHaveBeenCalled());
      expect(screen.queryByTestId("assignee-checklist")).toBeNull();
      expect(screen.queryByRole("button", { name: /^My checklist/ })).toBeNull();
      expect(api.getAssigneeChecklists).not.toHaveBeenCalled();
      cleanup();
      for (const fn of Object.values(api)) fn.mockReset();
    }
  });

  it("a Task that was never assigned keeps its normal 'Checklist' label and shows no assignee panel", async () => {
    mount([]);
    await screen.findByText("Go to HEB");
    expect(await screen.findByRole("button", { name: /^Checklist/ })).toBeTruthy();
    expect(screen.queryByTestId("assignee-checklist")).toBeNull();
  });
});

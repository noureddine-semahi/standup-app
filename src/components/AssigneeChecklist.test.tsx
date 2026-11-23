import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { es } from "@/lib/i18n/es";

const api = vi.hoisted(() => ({ getAssigneeChecklists: vi.fn() }));
vi.mock("@/lib/supabase/db", () => ({ ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import AssigneeChecklist from "./AssigneeChecklist";
import { useAssigneeChecklists, type AssigneeChecklistEntry } from "@/lib/useAssigneeChecklists";

const items = [
  { id: "1", text: "Bread", status: "completed" as const, position: 0 },
  { id: "2", text: "Whole milk", status: "completed" as const, position: 1 },
  { id: "3", text: "Toilet paper", status: "completed" as const, position: 2 },
  { id: "4", text: "Turkey", status: "missing" as const, position: 3 },
  { id: "5", text: "Potatoes", status: "missing" as const, position: 4 },
  { id: "6", text: "Napkins", status: "pending" as const, position: 5 },
];

function mount(entry: AssigneeChecklistEntry, name: string | null = "Nino", lang?: "es") {
  const store = new Map<string, string>();
  if (lang) store.set("standup-language", lang);
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: () => {}, clear: () => {} });
  return render(
    <LanguageProvider>
      <AssigneeChecklist assigneeName={name} entry={entry} />
    </LanguageProvider>
  );
}
const open = () => fireEvent.click(screen.getByRole("button", { name: /checklist|lista/i }));

beforeEach(() => {
  api.getAssigneeChecklists.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AssigneeChecklist", () => {
  it("shows the assignee's name and Completed/Total progress; Missing and Pending do not count as completed", () => {
    mount({ state: "ready", items });
    expect(screen.getByRole("button", { name: /Nino's checklist \(3\/6\)/ })).toBeTruthy();
  });

  it("lists every item with the same Completed / Missing / Pending look as the editable checklist", () => {
    mount({ state: "ready", items });
    open();
    const row = (t: string) => screen.getByText(t).closest("[data-testid=assignee-checklist-row]") as HTMLElement;
    const box = (t: string) => row(t).querySelector("[data-status]") as HTMLElement;
    expect(row("Bread").getAttribute("data-status")).toBe("completed");
    expect(box("Bread").style.color).toBe("rgb(52, 211, 153)"); // green check
    expect(box("Bread").querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Bread").style.textDecoration).toBe("line-through");
    expect(row("Turkey").getAttribute("data-status")).toBe("missing");
    expect(box("Turkey").style.color).toBe("rgb(248, 113, 113)"); // red X
    expect(box("Turkey").querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Turkey").style.color).toBe("rgb(248, 113, 113)");
    expect(screen.getByText("Turkey").style.textDecoration).toBe("line-through");
    expect(row("Napkins").getAttribute("data-status")).toBe("pending");
    expect(box("Napkins").querySelector("svg")).toBeNull(); // empty box
    expect(screen.getByText("Napkins").style.textDecoration).toBe("none");
    expect(within(row("Whole milk")).getByRole("img").getAttribute("aria-label")).toBe("Completed");
  });

  it("is strictly read-only: no checkbox, edit, delete, status or add control anywhere", () => {
    mount({ state: "ready", items });
    open();
    const region = screen.getByTestId("assignee-checklist");
    expect(within(region).getAllByRole("button")).toHaveLength(1); // only the expand/collapse toggle
    expect(region.querySelector("input, textarea, select")).toBeNull();
    expect(within(region).queryByRole("button", { name: /edit|remove|delete|add|save|tap to change/i })).toBeNull();
    for (const row of screen.getAllByTestId("assignee-checklist-row")) expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });

  it("empty checklist reads as empty, with no progress count", () => {
    mount({ state: "ready", items: [] });
    expect(screen.getByRole("button", { name: /^Nino's checklist$/ })).toBeTruthy();
    open();
    expect(screen.getByText("No items yet.")).toBeTruthy();
  });

  it("loading, unavailable and error each have their own message (unavailable ≠ empty ≠ failed)", () => {
    const { unmount } = mount({ state: "loading" });
    open();
    expect(screen.getByText("Loading…")).toBeTruthy();
    unmount();
    mount({ state: "unavailable" });
    open();
    expect(screen.getByText("This checklist isn't available.")).toBeTruthy();
    expect(screen.queryByText("No items yet.")).toBeNull();
    cleanup();
    mount({ state: "error" });
    open();
    expect(screen.getByRole("alert").textContent).toBe("Couldn't load this checklist.");
  });

  it("falls back to a generic name when the assignee has no display name", () => {
    mount({ state: "ready", items: [] }, null);
    expect(screen.getByRole("button", { name: /Assignee's checklist/ })).toBeTruthy();
  });

  it("is localized in Spanish", () => {
    mount({ state: "ready", items }, "Nino", "es");
    expect(screen.getByRole("button", { name: `${es["assignee.checklistToggle"].replace("{name}", "Nino")} (3/6)` })).toBeTruthy();
    open();
    expect(within(screen.getByText("Turkey").closest("[data-testid=assignee-checklist-row]") as HTMLElement).getByRole("img").getAttribute("aria-label")).toBe(es["checklist.status.missing"]);
  });

  it("keeps showing results for a completed Task: nothing about the component depends on the Task's own status", () => {
    mount({ state: "ready", items });
    expect(screen.getByRole("button", { name: /\(3\/6\)/ })).toBeTruthy();
  });
});

// --- the hook that feeds it -----------------------------------------------------------------------------------------------------
type A = { id: string; direction: string; status: string };
function Probe({ assignments, ids }: { assignments: A[]; ids: string[] }) {
  const get = useAssigneeChecklists(assignments);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id} data-testid={id}>
          {get(id).state}
        </li>
      ))}
    </ul>
  );
}

describe("useAssigneeChecklists", () => {
  const acc = (id: string): A => ({ id, direction: "assigned", status: "accepted" });
  it("requests ONLY accepted assigned-out assignments, in one batch, once", async () => {
    api.getAssigneeChecklists.mockResolvedValue({ a1: { state: "ready", items: [] }, a2: { state: "unavailable" } });
    const list = [acc("a2"), acc("a1"), { id: "r1", direction: "received", status: "accepted" }, { id: "p1", direction: "assigned", status: "pending" }, { id: "c1", direction: "assigned", status: "canceled" }, { id: "d1", direction: "assigned", status: "declined" }];
    const { rerender } = render(<Probe assignments={list} ids={["a1", "a2"]} />);
    expect(screen.getByTestId("a1").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("a1").textContent).toBe("ready"));
    expect(screen.getByTestId("a2").textContent).toBe("unavailable");
    expect(api.getAssigneeChecklists).toHaveBeenCalledTimes(1);
    expect(api.getAssigneeChecklists).toHaveBeenCalledWith(["a1", "a2"]);
    rerender(<Probe assignments={[...list]} ids={["a1", "a2"]} />); // same set of ids: no repeated query
    expect(api.getAssigneeChecklists).toHaveBeenCalledTimes(1);
  });
  it("makes no request when nothing is accepted and assigned out", () => {
    render(<Probe assignments={[{ id: "r1", direction: "received", status: "accepted" }]} ids={["r1"]} />);
    expect(api.getAssigneeChecklists).not.toHaveBeenCalled();
  });
  it("a failed load becomes 'error', and a later refresh recovers", async () => {
    api.getAssigneeChecklists.mockRejectedValueOnce(new Error("net"));
    render(<Probe assignments={[acc("a1")]} ids={["a1"]} />);
    await waitFor(() => expect(screen.getByTestId("a1").textContent).toBe("error"));
    api.getAssigneeChecklists.mockResolvedValue({ a1: { state: "ready", items: [] } });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange")); // tab becomes visible again
    });
    await waitFor(() => expect(screen.getByTestId("a1").textContent).toBe("ready"));
  });
  it("a failed REFRESH keeps what was already shown", async () => {
    api.getAssigneeChecklists.mockResolvedValueOnce({ a1: { state: "ready", items: [{ id: "1", text: "x", status: "pending", position: 0 }] } });
    render(<Probe assignments={[acc("a1")]} ids={["a1"]} />);
    await waitFor(() => expect(screen.getByTestId("a1").textContent).toBe("ready"));
    const calls = api.getAssigneeChecklists.mock.calls.length;
    api.getAssigneeChecklists.mockImplementation(() => Promise.reject(new Error("net")));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(api.getAssigneeChecklists.mock.calls.length).toBe(calls + 1)); // the refresh really ran and failed
    expect(screen.getByTestId("a1").textContent).toBe("ready");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { es } from "@/lib/i18n/es";
import type { Goal } from "@/lib/supabase/db";

const mocks = vi.hoisted(() => ({ move: vi.fn(), reschedule: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/db")>("@/lib/supabase/db");
  return { ...actual, moveGoalToBacklog: mocks.move, rescheduleGoalToDate: mocks.reschedule };
});

import { GoalDeleteBlockedError } from "@/lib/supabase/db";
import RescheduleModal from "./RescheduleModal";

const goal = { id: "g1", title: "Call the bank", details: null, priority: 2 } as unknown as Goal;

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  mocks.move.mockReset();
  mocks.reschedule.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  render(
    <LanguageProvider>
      <RescheduleModal goals={[goal]} onClose={onClose} onSuccess={onSuccess} />
    </LanguageProvider>
  );
  return { onClose, onSuccess };
}
const moveButton = () => screen.getByRole("button", { name: /Move to Backlog|Moving/ });

describe("RescheduleModal: Move to Backlog", () => {
  it("success: moves the one Task, reports 'backlog' and closes", async () => {
    mocks.move.mockResolvedValue({ id: "b1" });
    const { onClose, onSuccess } = setup();
    fireEvent.click(moveButton());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("backlog"));
    expect(mocks.move).toHaveBeenCalledTimes(1);
    expect(mocks.move).toHaveBeenCalledWith(goal);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a Task with reschedule history: an actionable message, no success, no close, and the button works again", async () => {
    mocks.move.mockRejectedValue(new GoalDeleteBlockedError("reschedule"));
    const { onClose, onSuccess } = setup();
    fireEvent.click(moveButton());
    expect(await screen.findByText("This task has reschedule history, so it can't be moved to the Backlog. Pick a date to reschedule it instead.")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((moveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("an assigned Task: its own actionable message", async () => {
    mocks.move.mockRejectedValue(new GoalDeleteBlockedError("assignment"));
    const { onSuccess } = setup();
    fireEvent.click(moveButton());
    expect(await screen.findByText("This task is linked to an assignment, so it can't be moved to the Backlog. Pick a date to reschedule it instead.")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("any other failure shows its own message; an error with no message falls back to the generic one", async () => {
    mocks.move.mockRejectedValueOnce(new Error("network down")).mockRejectedValueOnce({});
    const { onSuccess } = setup();
    fireEvent.click(moveButton());
    expect(await screen.findByText("network down")).toBeTruthy();
    fireEvent.click(moveButton());
    expect(await screen.findByText("Failed to move to Backlog")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("the blocked messages exist in Spanish too and keep the actionable advice", () => {
    expect(es["reschedule.moveBlockedReschedule"]).toMatch(/historial de reprogramación.*Elige una fecha/);
    expect(es["reschedule.moveBlockedAssignment"]).toMatch(/asignación.*Elige una fecha/);
  });
});

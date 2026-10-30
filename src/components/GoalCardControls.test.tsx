import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GoalCardControls from "./GoalCardControls";

function setup(props: Partial<React.ComponentProps<typeof GoalCardControls>> = {}) {
  const handlers = { expand: vi.fn(), collapse: vi.fn(), close: vi.fn() };
  render(
    <GoalCardControls
      groupLabel="Card controls"
      expand={{ label: "Open full screen", onClick: handlers.expand }}
      collapse={{ label: "Collapse card", onClick: handlers.collapse }}
      close={{ label: "Delete task", onClick: handlers.close }}
      {...props}
    />
  );
  return handlers;
}

describe("GoalCardControls", () => {
  it("renders one group of three independent buttons", () => {
    setup();
    const group = screen.getByRole("group", { name: "Card controls" });
    expect(group.querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Open full screen" })).toHaveAttribute("data-state", "normal");
    expect(screen.getByRole("button", { name: "Collapse card" })).toHaveAttribute("data-state", "collapse");
    expect(screen.getByRole("button", { name: "Delete task" })).toHaveAttribute("data-state", "delete");
  });

  it("each chamber calls only its own handler", () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open full screen" }));
    expect(h.expand).toHaveBeenCalledTimes(1);
    expect(h.collapse).not.toHaveBeenCalled();
    expect(h.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Collapse card" }));
    expect(h.collapse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it("full-screen state: purple shows the exit state and still toggles", () => {
    const exit = vi.fn();
    setup({ fullScreen: true, expand: { label: "Exit full screen", onClick: exit } });
    const purple = screen.getByRole("button", { name: "Exit full screen" });
    expect(purple).toHaveAttribute("data-state", "fullscreen");
    expect(purple).toBeEnabled();
    fireEvent.click(purple);
    expect(exit).toHaveBeenCalledTimes(1);
    // there is no separate close/exit-full-screen control: red stays Delete.
    expect(screen.queryByRole("button", { name: /exit full screen/i })).toBe(purple);
  });

  it("collapsed state: green shows restore and stays actionable", () => {
    const restore = vi.fn();
    setup({ collapsed: true, collapse: { label: "Restore card", onClick: restore } });
    const green = screen.getByRole("button", { name: "Restore card" });
    expect(green).toHaveAttribute("data-state", "restore");
    expect(green).toBeEnabled();
    fireEvent.click(green);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("a chamber with no handler (or disabled) is present but inert", () => {
    const h = setup({
      expand: { label: "Open full screen" },
      close: { label: "Delete task", onClick: undefined, disabled: true },
    });
    const purple = screen.getByRole("button", { name: "Open full screen" });
    const red = screen.getByRole("button", { name: "Delete task" });
    expect(purple).toBeDisabled();
    expect(red).toBeDisabled();
    fireEvent.click(red);
    expect(h.close).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

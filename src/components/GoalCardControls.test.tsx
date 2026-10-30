import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import GoalCardControls, { closeGoalCardPills } from "./GoalCardControls";
import ConfirmRemoveModal from "./ConfirmRemoveModal";

function Bar(props: Partial<React.ComponentProps<typeof GoalCardControls>> & { handlers?: Record<string, () => void> }) {
  const { handlers = {}, ...rest } = props;
  return (
    <GoalCardControls
      groupLabel="Card controls"
      expand={{ label: "Open full screen", onClick: handlers.expand }}
      collapse={{ label: "Collapse card", onClick: handlers.collapse }}
      close={{ label: "Remove task", onClick: handlers.close }}
      {...rest}
    />
  );
}

function renderBar(props: Parameters<typeof Bar>[0] = {}) {
  const handlers = { expand: vi.fn(), collapse: vi.fn(), close: vi.fn() };
  const utils = render(
    <LanguageProvider>
      <Bar handlers={handlers} {...props} />
    </LanguageProvider>
  );
  return { handlers, ...utils };
}

afterEach(() => {
  act(() => closeGoalCardPills());
});

describe("GoalCardControls", () => {
  it("renders one group: a pill plus three independent chamber buttons", () => {
    renderBar();
    const group = screen.getByRole("group", { name: "Card controls" });
    expect(group.querySelectorAll("button.goal-ctl")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Show card controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open full screen", hidden: true })).toHaveAttribute("data-state", "normal");
    expect(screen.getByRole("button", { name: "Collapse card", hidden: true })).toHaveAttribute("data-state", "collapse");
    expect(screen.getByRole("button", { name: "Remove task", hidden: true })).toHaveAttribute("data-state", "delete");
  });

  it("starts closed, opens from the pill, and a non-destructive action closes it again", () => {
    const { handlers } = renderBar();
    const group = screen.getByRole("group", { name: "Card controls" });
    expect(group).toHaveAttribute("data-open", "false");
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    expect(group).toHaveAttribute("data-open", "true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse card" }));
    expect(handlers.collapse).toHaveBeenCalledTimes(1);
    expect(group).toHaveAttribute("data-open", "false");
  });

  it("remove does not close the pill by itself and calls only its own handler", () => {
    const { handlers } = renderBar();
    const group = screen.getByRole("group", { name: "Card controls" });
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove task" }));
    expect(handlers.close).toHaveBeenCalledTimes(1);
    expect(handlers.expand).not.toHaveBeenCalled();
    expect(handlers.collapse).not.toHaveBeenCalled();
    expect(group).toHaveAttribute("data-open", "true");
  });

  it("only one card's pill is open at a time", () => {
    render(
      <LanguageProvider>
        <Bar groupLabel="A controls" />
        <Bar groupLabel="B controls" />
      </LanguageProvider>
    );
    const a = screen.getByRole("group", { name: "A controls" });
    const b = screen.getByRole("group", { name: "B controls" });
    fireEvent.click(a.querySelector(".goal-ctl-pill") as HTMLElement);
    expect(a).toHaveAttribute("data-open", "true");
    fireEvent.click(b.querySelector(".goal-ctl-pill") as HTMLElement);
    expect(b).toHaveAttribute("data-open", "true");
    expect(a).toHaveAttribute("data-open", "false");
  });

  it("a tap outside closes the pill and swallows that click", () => {
    const underneath = vi.fn();
    render(
      <LanguageProvider>
        <Bar />
        <button onClick={underneath}>under</button>
      </LanguageProvider>
    );
    const group = screen.getByRole("group", { name: "Card controls" });
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    expect(group).toHaveAttribute("data-open", "true");
    const under = screen.getByText("under");
    fireEvent.pointerDown(under);
    expect(group).toHaveAttribute("data-open", "false");
    fireEvent.click(under);
    expect(underneath).not.toHaveBeenCalled();
    // the swallow is one-shot: the next click works normally
    fireEvent.click(under);
    expect(underneath).toHaveBeenCalledTimes(1);
  });

  it("pinned keeps the chambers open with no outside-tap closing", () => {
    renderBar({ pinned: true });
    const group = screen.getByRole("group", { name: "Card controls" });
    expect(group).toHaveAttribute("data-open", "true");
    fireEvent.pointerDown(document.body);
    expect(group).toHaveAttribute("data-open", "true");
  });

  it("full-screen state: purple shows the exit state; there is no separate exit control", () => {
    const exit = vi.fn();
    renderBar({ fullScreen: true, pinned: true, expand: { label: "Exit full screen", onClick: exit } });
    const purple = screen.getByRole("button", { name: "Exit full screen" });
    expect(purple).toHaveAttribute("data-state", "fullscreen");
    fireEvent.click(purple);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: /exit full screen/i })).toHaveLength(1);
  });

  it("collapsed state: green shows restore and stays actionable", () => {
    const restore = vi.fn();
    renderBar({ collapsed: true, pinned: true, collapse: { label: "Restore card", onClick: restore } });
    const green = screen.getByRole("button", { name: "Restore card" });
    expect(green).toHaveAttribute("data-state", "restore");
    expect(green).toBeEnabled();
    fireEvent.click(green);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("a chamber with no handler (or disabled) is present but inert", () => {
    const { handlers } = renderBar({
      pinned: true,
      expand: { label: "Open full screen" },
      close: { label: "Remove task", onClick: undefined, disabled: true },
    });
    const red = screen.getByRole("button", { name: "Remove task" });
    expect(screen.getByRole("button", { name: "Open full screen" })).toBeDisabled();
    expect(red).toBeDisabled();
    fireEvent.click(red);
    expect(handlers.close).not.toHaveBeenCalled();
  });
});

describe("ConfirmRemoveModal", () => {
  function renderModal(onConfirm: () => void | Promise<void>, onCancel = vi.fn()) {
    render(
      <LanguageProvider>
        <ConfirmRemoveModal open goalTitle="Pick up kids" onCancel={onCancel} onConfirm={onConfirm} />
      </LanguageProvider>
    );
    return onCancel;
  }

  it("names the task and removes nothing until 'Remove Task' is pressed", () => {
    const onConfirm = vi.fn();
    const onCancel = renderModal(onConfirm);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Pick up kids/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Remove Task runs the handler exactly once even if pressed repeatedly", async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderModal(onConfirm);
    const remove = screen.getByRole("button", { name: "Remove Task" });
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => resolve());
  });

  it("Escape cancels", () => {
    const onCancel = renderModal(vi.fn());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

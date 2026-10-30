import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
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

// jsdom has no matchMedia; the pill only exists on phones, so tests choose.
function mockViewport(phone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: phone,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeEach(() => mockViewport(true));

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

  it("desktop: no pill, chambers always exposed, one horizontal row", () => {
    mockViewport(false);
    renderBar();
    expect(screen.queryByRole("button", { name: "Show card controls" })).toBeNull();
    const chambers = document.querySelector(".goal-ctl-chambers") as HTMLElement;
    expect(chambers.style.display).toBe("flex");
    expect(chambers.style.flexDirection).toBe("row");
    expect(screen.getByRole("button", { name: "Open full screen" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Remove task" })).toBeEnabled();
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

// The control module's open/closed state and the card's presentation state are
// independent: opening, closing or tapping away from the pill never touches
// the card, and only the revealed chambers act on it.
function CardHarness({ initial }: { initial: "collapsed" | "normal" }) {
  const [presentation, setPresentation] = useState<"collapsed" | "normal" | "fullscreen">(initial);
  const [goal] = useState({ title: "Pick up kids", count: 3 });
  const [removeRequests, setRemoveRequests] = useState(0);
  const isCollapsed = presentation === "collapsed";
  return (
    <div>
      <div data-testid="card" data-presentation={presentation} data-goal={JSON.stringify(goal)} data-removes={removeRequests} />
      <button data-testid="outside">outside</button>
      <GoalCardControls
        groupLabel="Card controls"
        collapsed={isCollapsed}
        fullScreen={presentation === "fullscreen"}
        expand={{
          label: presentation === "fullscreen" ? "Exit full screen" : "Open full screen",
          onClick: () => setPresentation((p) => (p === "fullscreen" ? "normal" : "fullscreen")),
        }}
        collapse={{
          label: isCollapsed ? "Restore card" : "Collapse card",
          onClick: () => setPresentation((p) => (p === "collapsed" ? "normal" : "collapsed")),
        }}
        close={{ label: "Remove task", onClick: () => setRemoveRequests((n) => n + 1) }}
      />
    </div>
  );
}

function renderCard(initial: "collapsed" | "normal") {
  render(
    <LanguageProvider>
      <CardHarness initial={initial} />
    </LanguageProvider>
  );
  const card = () => screen.getByTestId("card");
  return { card, goalBefore: screen.getByTestId("card").getAttribute("data-goal") };
}

describe("control module vs card presentation (independent states)", () => {
  it.each(["collapsed", "normal"] as const)("opening, closing and tapping away never change a %s card", (initial) => {
    const { card, goalBefore } = renderCard(initial);
    const group = screen.getByRole("group", { name: "Card controls" });
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    expect(group).toHaveAttribute("data-open", "true");
    expect(card()).toHaveAttribute("data-presentation", initial);
    // tap away: closes the pill, card untouched, goal data untouched
    fireEvent.pointerDown(screen.getByTestId("outside"));
    fireEvent.click(screen.getByTestId("outside")); // the swallowed click that follows a tap-away
    expect(group).toHaveAttribute("data-open", "false");
    expect(card()).toHaveAttribute("data-presentation", initial);
    expect(card().getAttribute("data-goal")).toBe(goalBefore);
    expect(card()).toHaveAttribute("data-removes", "0");
  });

  it("green restores a collapsed card and collapses a normal one", () => {
    const { card } = renderCard("collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore card" }));
    expect(card()).toHaveAttribute("data-presentation", "normal");
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse card" }));
    expect(card()).toHaveAttribute("data-presentation", "collapsed");
  });

  it("purple toggles full screen; red only requests removal", () => {
    const { card } = renderCard("normal");
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Open full screen" }));
    expect(card()).toHaveAttribute("data-presentation", "fullscreen");
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(card()).toHaveAttribute("data-presentation", "normal");
    fireEvent.click(screen.getByRole("button", { name: "Show card controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove task" }));
    expect(card()).toHaveAttribute("data-removes", "1");
    expect(card()).toHaveAttribute("data-presentation", "normal");
  });
});

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import StatusSelector, { StatusChipTrigger, STATUS_SELECTOR_OPTIONS, type StatusAction } from "./StatusSelector";
import { statusChipColors, statusLabel } from "@/lib/goalStatus";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Mirrors how Today wires it: the chip toggles, only a choice reports a status.
function Harness({ onSelect, status = "not_started" }: { onSelect: (a: StatusAction) => void; status?: "not_started" | "attempted" }) {
  const [open, setOpen] = useState(false);
  return (
    <LanguageProvider>
      <button data-testid="other">other control</button>
      <StatusChipTrigger
        interactive
        open={open}
        onToggle={() => setOpen((o) => !o)}
        label="Status: Pending. Change status"
      >
        <span>Pending</span>
      </StatusChipTrigger>
      {open && (
        <StatusSelector
          status={status}
          onSelect={(a) => {
            onSelect(a);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </LanguageProvider>
  );
}

const trigger = () => screen.getByRole("button", { name: /change status/i });
const panel = () => screen.queryByRole("group", { name: /update status/i });

describe("StatusSelector", () => {
  it("is closed by default", () => {
    render(<Harness onSelect={vi.fn()} />);
    expect(panel()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens from the current-status trigger and closes when it is tapped again, without selecting", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(trigger());
    expect(panel()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(trigger());
    fireEvent.click(trigger());
    expect(panel()).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("an outside tap closes it without changing status and without activating the control under it", () => {
    const onSelect = vi.fn();
    const onOther = vi.fn();
    render(
      <>
        <Harness onSelect={onSelect} />
        <button data-testid="under" onClick={onOther}>under</button>
      </>
    );
    fireEvent.click(trigger());
    const under = screen.getByTestId("under");
    fireEvent.pointerDown(under);
    expect(panel()).toBeNull();
    fireEvent.click(under);
    expect(onOther).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    // later taps work again
    fireEvent.click(under);
    expect(onOther).toHaveBeenCalledTimes(1);
  });

  it("Escape closes it without changing status", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders eight choices in two-column reading order", () => {
    render(<Harness onSelect={vi.fn()} />);
    fireEvent.click(trigger());
    const options = Array.from(document.querySelectorAll<HTMLElement>("[data-status-option]")).map((el) => el.dataset.statusOption);
    expect(options).toEqual([
      "not_started", "completed",
      "in_progress", "attempted",
      "blocked", "missed",
      "reschedule", "canceled",
    ]);
    expect(STATUS_SELECTOR_OPTIONS).toHaveLength(8);
  });

  it("selecting Attempted reports it once and closes the panel", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Attempted" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("attempted");
    expect(panel()).toBeNull();
  });

  it.each(["not_started", "completed", "in_progress", "blocked", "missed", "reschedule", "canceled"] as const)(
    "existing choice %s still reports itself",
    (action) => {
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);
      fireEvent.click(trigger());
      fireEvent.click(document.querySelector(`[data-status-option="${action}"]`)!);
      expect(onSelect).toHaveBeenCalledWith(action);
    }
  );

  it("marks the current status without relying on color alone", () => {
    render(<Harness onSelect={vi.fn()} status="attempted" />);
    fireEvent.click(trigger());
    const current = screen.getByRole("button", { name: "Attempted" });
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect(current.querySelector(".status-selector-mark")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Completed" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("disabled selector does not report choices", () => {
    const onSelect = vi.fn();
    render(
      <LanguageProvider>
        <StatusSelector status="not_started" disabled onSelect={onSelect} onClose={vi.fn()} />
      </LanguageProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Attempted" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a read-only chip is not a button", () => {
    render(
      <LanguageProvider>
        <StatusChipTrigger interactive={false} open={false} onToggle={vi.fn()} label="x">
          <span>Completed</span>
        </StatusChipTrigger>
      </LanguageProvider>
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Attempted status identity", () => {
  it("has its own copper color, distinct from Missed and Rescheduled", () => {
    const attempted = statusChipColors("attempted");
    expect(attempted.color).toBe("var(--status-attempted)");
    expect(attempted.color).not.toBe(statusChipColors("missed").color);
    expect(attempted.color).not.toBe(statusChipColors("postponed").color);
    // existing statuses keep theirs
    expect(statusChipColors("missed").color).toBe("var(--status-missed)");
    expect(statusChipColors("postponed").color).toBe("var(--status-postponed)");
    expect(statusChipColors("completed").color).toBe("var(--status-completed)");
  });

  it("is labeled Attempted (not Completed)", () => {
    const t = (k: string) => ({ "status.attempted": "Attempted", "status.completed": "Completed" } as Record<string, string>)[k] ?? k;
    expect(statusLabel("attempted", t as never)).toBe("Attempted");
    expect(statusLabel("attempted", t as never)).not.toBe(statusLabel("completed", t as never));
  });
});

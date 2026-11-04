import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import LogoutSwitch, { LogoutConfirmModal } from "./LogoutSwitch";

beforeEach(() => {
  // jsdom has no PointerEvent; a MouseEvent subclass carries clientX like the real one.
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, { bubbles: true, cancelable: true, ...init });
        this.pointerId = init.pointerId ?? 1;
      }
    }
  );
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {}, clear() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Mirrors how Header wires the pair: the switch only requests; the modal owns confirm.
function Harness({ onLogout, loggingOut = false }: { onLogout: () => void; loggingOut?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <LanguageProvider>
      <LogoutSwitch active={open || loggingOut} disabled={loggingOut} onRequest={() => setOpen(true)} />
      {open && <LogoutConfirmModal busy={loggingOut} onCancel={() => setOpen(false)} onConfirm={onLogout} />}
    </LanguageProvider>
  );
}

const sw = () => screen.getByRole("switch", { name: "Logout" });
// Drag the knob `dx` px to the right and release (track travel is 20px).
function slide(dx: number) {
  fireEvent.pointerDown(sw(), { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(sw(), { clientX: 100 + dx, pointerId: 1 });
  fireEvent.pointerUp(sw(), { clientX: 100 + dx, pointerId: 1 });
}

describe("LogoutSwitch", () => {
  it("starts OFF and flipping it only asks for confirmation -- it never logs out by itself", () => {
    const onLogout = vi.fn();
    render(<Harness onLogout={onLogout} />);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    slide(30);
    expect(screen.getByRole("alertdialog").textContent).toContain("Log out of StandUp?");
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("a tap or a partial slide does nothing; only reaching the end asks for confirmation", () => {
    render(<Harness onLogout={vi.fn()} />);
    fireEvent.click(sw(), { detail: 1 }); // pointer tap: only nudges the knob
    slide(10);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sw().getAttribute("aria-checked")).toBe("false");
    slide(20);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("keyboard / assistive activation opens the confirmation without dragging", () => {
    render(<Harness onLogout={vi.fn()} />);
    fireEvent.click(sw(), { detail: 0 });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("Cancel and Escape close the dialog and the switch snaps back to OFF", () => {
    const onLogout = vi.fn();
    render(<Harness onLogout={onLogout} />);
    slide(30);
    expect(sw().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sw().getAttribute("aria-checked")).toBe("false");
    slide(30);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("only the dialog's Logout button runs the logout handler", () => {
    const onLogout = vi.fn();
    render(<Harness onLogout={onLogout} />);
    slide(30);
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("is inert while logging out", () => {
    render(<Harness onLogout={() => {}} loggingOut />);
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Logging out…")).toBeTruthy();
  });

  it("persists nothing", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem, removeItem() {}, clear() {} });
    render(<Harness onLogout={() => {}} />);
    setItem.mockClear();
    slide(30);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setItem).not.toHaveBeenCalled();
  });
});

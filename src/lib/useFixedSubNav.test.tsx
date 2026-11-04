import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useFixedSubNav } from "./useFixedSubNav";

// A tiny layout model stands in for the browser: the header is 66px, the wrapper starts at 139px in the
// document, the bar is 40px tall with an 8px bottom margin, and the wrapper's paddingTop (set by the hook
// while pinned) pushes everything inside it down. Scrolling the sweep through the pin point must flip the
// bar exactly once, and the content under it must never move except by the scroll itself.
const HEADER_BOTTOM = 66;
const WRAP_TOP = 139;
const BAR_H = 40;
const BAR_MARGIN = 8;

let scrollY = 0;
const px = (v: string | undefined) => parseFloat(v ?? "") || 0;

function rectOf(el: HTMLElement): DOMRect {
  const role = el.dataset.role;
  const wrapEl = document.querySelector<HTMLElement>("[data-role=wrap]");
  const wrapTop = WRAP_TOP - scrollY;
  const pad = px(wrapEl?.style.paddingTop);
  let top = 0;
  let height = 0;
  if (role === "wrap") top = wrapTop;
  else if (role === "sentinel") top = wrapTop + pad;
  else if (role === "bar") {
    height = BAR_H;
    top = el.style.position === "fixed" ? px(el.style.top) : wrapTop + pad;
  } else if (role === "content") {
    const bar = document.querySelector<HTMLElement>("[data-role=bar]")!;
    top = wrapTop + pad + (bar.style.position === "fixed" ? 0 : BAR_H + BAR_MARGIN);
  } else if (el.classList.contains("app-header")) {
    return { top: 0, bottom: HEADER_BOTTOM, left: 0, right: 360, width: 360, height: HEADER_BOTTOM, x: 0, y: 0, toJSON: () => ({}) };
  }
  return { top, bottom: top + height, left: 10, right: 350, width: 340, height, x: 10, y: top, toJSON: () => ({}) };
}

function Harness() {
  const { sentinelRef, barRef, wrapperRef, contentRef, barStyle, wrapperStyle } = useFixedSubNav("a");
  return (
    <div>
      <div className="app-header" />
      <div ref={wrapperRef} style={wrapperStyle} data-role="wrap">
        <div ref={sentinelRef} data-role="sentinel" style={{ height: 0 }} />
        <div ref={barRef} data-role="bar" style={{ ...barStyle, marginBottom: BAR_MARGIN }} />
        <div ref={contentRef} data-role="content" />
      </div>
    </div>
  );
}

const q = (role: string) => document.querySelector<HTMLElement>(`[data-role=${role}]`)!;
const isPinned = () => q("bar").style.position === "fixed";
const contentTop = () => rectOf(q("content")).top;

function scrollTo(y: number) {
  scrollY = y;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  scrollY = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return rectOf(this);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useFixedSubNav pin / release", () => {
  it("pins once as the bar reaches the header, with no flicker while scrolling through the threshold", () => {
    render(<Harness />);
    const start = WRAP_TOP - HEADER_BOTTOM; // scroll offset where the bar's natural top meets the header
    const states: boolean[] = [];
    for (let y = start - 40; y <= start + 120; y += 4) {
      scrollTo(y);
      states.push(isPinned());
    }
    const flips = states.filter((s, i) => i > 0 && s !== states[i - 1]).length;
    expect(flips).toBe(1);
    expect(states[0]).toBe(false);
    expect(states[states.length - 1]).toBe(true);
  });

  it("releases once, symmetrically, when scrolling back up", () => {
    render(<Harness />);
    const start = WRAP_TOP - HEADER_BOTTOM;
    scrollTo(start + 120);
    expect(isPinned()).toBe(true);
    const states: boolean[] = [];
    for (let y = start + 120; y >= start - 40; y -= 4) {
      scrollTo(y);
      states.push(isPinned());
    }
    expect(states.filter((s, i) => i > 0 && s !== states[i - 1]).length).toBe(1);
    expect(states[states.length - 1]).toBe(false);
  });

  it("the content under the bar moves only by the scroll amount: pinning (which removes the bar's height AND its bottom margin from the flow) causes no jump", () => {
    render(<Harness />);
    const start = WRAP_TOP - HEADER_BOTTOM;
    scrollTo(start - 40);
    let prevTop = contentTop();
    let prevY = scrollY;
    for (let y = start - 36; y <= start + 120; y += 4) {
      scrollTo(y);
      const top = contentTop();
      expect(top - prevTop + (y - prevY), `at scroll ${y}`).toBeCloseTo(0, 5);
      prevTop = top;
      prevY = y;
    }
  });

  it("the pinned bar sits directly under the header", () => {
    render(<Harness />);
    scrollTo(WRAP_TOP - HEADER_BOTTOM + 80);
    expect(isPinned()).toBe(true);
    expect(q("bar").style.top).toBe(`${HEADER_BOTTOM}px`);
  });
});

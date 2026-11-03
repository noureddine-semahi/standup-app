import { describe, it, expect } from "vitest";
import { computeRevealScroll } from "./revealAboveBar";

const band = { viewportTop: 100, viewportBottom: 700 };

describe("computeRevealScroll", () => {
  it("does not scroll when already fully visible", () => {
    expect(computeRevealScroll({ top: 300, bottom: 540, ...band })).toBe(0);
  });

  it("scrolls down the minimum distance, plus a gap, when hidden behind the bar", () => {
    expect(computeRevealScroll({ top: 500, bottom: 740, ...band, gap: 12 })).toBe(740 - 688);
  });

  it("leaves a comfortable gap even when it only just touches the bar", () => {
    expect(computeRevealScroll({ top: 460, bottom: 700, ...band, gap: 12 })).toBe(12);
  });

  it("scrolls up just enough when its top is under the header", () => {
    expect(computeRevealScroll({ top: 60, bottom: 300, ...band, gap: 12 })).toBe(60 - 112);
  });

  it("aligns the top under the header when taller than the visible band (short/landscape screens)", () => {
    expect(computeRevealScroll({ top: 400, bottom: 800, viewportTop: 60, viewportBottom: 360, gap: 12 })).toBe(400 - 72);
  });
});

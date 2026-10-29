"use client";

import { useRef } from "react";

// Shared glass slide-to-confirm control -- the Pointer Events mechanics
// that used to live inline in Today's page (close out / reopen the day),
// extracted verbatim so Today and Tomorrow share ONE implementation of
// the gesture. Styling is the existing .today-day-slider* family in
// globals.css (the class names predate the extraction).
//
// The component only ever decides WHEN to call onComplete(), exactly
// once per completed gesture or tap; it never knows what the action is.
// One completed gesture always has one meaning -- there is no partial /
// secondary outcome at a shorter drag distance.
//
// atEnd: the glass rests at the right-hand end (Today: day closed). The
// gesture then runs right-to-left instead of left-to-right. touch-action:
// pan-y (CSS) hands vertical touch gestures to native page scroll before
// any JS here runs; the dx/dy intent check below is the equivalent
// safety net for mouse/pen input and the first few px of a touch.
const SLIDER_INTENT_PX = 6;
const SLIDER_THRESHOLD = 0.45;

// Presentation-only lamp state for ONE engraved label. The component never
// decides which tone applies -- the owning page derives it from its own
// canonical state and passes it in:
//   off      powered down, dark (irrelevant / opposite action)
//   dormant  muted amber: the action exists but isn't available yet
//   yellow   neon amber/yellow: action available now
//   red      neon red: requirement not met
//   dimRed   grayed red: unavailable / locked
//   standby  powered-off amber-red: ready, waiting on something external
//   latched  grayed yellow: this stage is complete
//   pulse    breathing neon yellow: previously finalized state changed
//   green    neon green: successful state
// Omitted = the original unthemed engraving.
export type SliderTone = "off" | "dormant" | "yellow" | "red" | "dimRed" | "standby" | "latched" | "pulse" | "green";

type Props = {
  atEnd?: boolean;
  onComplete: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  // Both engraved labels are ALWAYS rendered (never swapped by state): start
  // sits in the half the glass rests over when atEnd is false, end in the
  // other half. They are decorative -- the button's aria-label is the one
  // accessible name. endLabel is omitted for one-way sliders (Tomorrow).
  startLabel: React.ReactNode;
  endLabel?: React.ReactNode;
  ariaLabel: string;
  title?: string;
  startTone?: SliderTone;
  endTone?: SliderTone;
  // One-shot green shimmer on the label whose action just succeeded (owner
  // clears it again after ~1.5s). Purely visual.
  flash?: "start" | "end";
};

export default function GlassSlider({ atEnd = false, onComplete, disabled = false, busy = false, startLabel, endLabel, ariaLabel, title, startTone, endTone, flash }: Props) {
  const glassRef = useRef<HTMLSpanElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    glassWidth: number;
    intent: "none" | "horizontal" | "vertical";
    suppressClick: boolean;
  }>({ pointerId: null, startX: 0, startY: 0, glassWidth: 0, intent: "none", suppressClick: false });

  function pointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.currentTarget.disabled) return;
    const glass = glassRef.current;
    if (!glass) return;
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      glassWidth: glass.offsetWidth,
      intent: "none",
      suppressClick: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function pointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragStateRef.current;
    if (drag.pointerId !== e.pointerId) return;
    const glass = glassRef.current;
    if (!glass) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (drag.intent === "none") {
      if (Math.abs(dx) < SLIDER_INTENT_PX && Math.abs(dy) < SLIDER_INTENT_PX) return;
      // Whichever axis clearly dominates once movement is big enough to
      // judge -- a vertical gesture hands off to the page's own scroll
      // (this function simply stops acting for the rest of the
      // gesture); only a clearly horizontal one claims the drag.
      drag.intent = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (drag.intent === "horizontal") {
        glass.style.transition = "none";
      }
    }

    if (drag.intent !== "horizontal") return;

    e.preventDefault();
    const basePx = atEnd ? drag.glassWidth : 0;
    const targetPx = Math.min(Math.max(basePx + dx, 0), drag.glassWidth);
    glass.style.transform = `translateX(${targetPx}px)`;
  }

  // Hands control back to the CSS rule (keyed off data-state) -- whichever
  // way the real state landed after a completed gesture, clearing the
  // inline override never fights it: the class rule's own transition
  // animates from wherever the inline style last left the glass to the
  // now-correct resting spot, covering both "snap back, nothing
  // happened" and "reconcile after the real action" in one code path.
  function settle(glass: HTMLSpanElement) {
    glass.style.transition = "";
    glass.style.transform = "";
  }

  async function pointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragStateRef.current;
    if (drag.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const glass = glassRef.current;
    const intent = drag.intent;
    dragStateRef.current.pointerId = null;

    if (intent === "none") return; // genuine stationary tap -- native click fallback handles it

    // Any recognized movement -- horizontal OR vertical -- suppresses
    // the synthetic click the browser fires right after pointerup. A
    // vertical gesture is the page being scrolled, not a tap, and must
    // never fall through to the click fallback and accidentally fire the
    // action; a horizontal drag (crossed or not) already decided its own
    // outcome above and must not ALSO fire via a trailing click.
    drag.suppressClick = true;

    if (intent !== "horizontal" || !glass) return; // vertical -- page scrolls, nothing else to do here

    const dx = e.clientX - drag.startX;
    const basePx = atEnd ? drag.glassWidth : 0;
    const targetPx = Math.min(Math.max(basePx + dx, 0), drag.glassWidth);
    const crossed = Math.abs(targetPx - basePx) >= drag.glassWidth * SLIDER_THRESHOLD;

    if (!crossed) {
      settle(glass);
      return;
    }

    // Threshold crossed -- finish the slide toward the opposite resting
    // spot as visual acceptance of the gesture, then invoke the one
    // real handler exactly once. If the action is blocked/fails the real
    // state never changes, so settle() naturally animates the glass back
    // to where it started -- no separate failure/undo path needed.
    glass.style.transition = "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)";
    glass.style.transform = `translateX(${atEnd ? 0 : drag.glassWidth}px)`;
    await onComplete();
    settle(glass);
  }

  function pointerCancel(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragStateRef.current;
    if (drag.pointerId !== e.pointerId) return;
    const glass = glassRef.current;
    dragStateRef.current.pointerId = null;
    if (glass && drag.intent === "horizontal") {
      settle(glass);
    }
  }

  // Tap/click/keyboard fallback -- native <button> semantics mean Enter/
  // Space already synthesize a click, so this one handler covers both.
  // Guarded against the synthetic click a completed drag's pointerup
  // also triggers, so a drag can never ALSO fire this (one drag = one
  // action, never two).
  function click() {
    if (dragStateRef.current.suppressClick) {
      dragStateRef.current.suppressClick = false;
      return;
    }
    void onComplete();
  }

  return (
    <button
      type="button"
      onClick={click}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerCancel}
      disabled={disabled}
      data-state={atEnd ? "closed" : "open"}
      data-busy={busy}
      data-flash={flash}
      aria-label={ariaLabel}
      aria-busy={busy}
      title={title}
      className="today-day-slider"
    >
      <span className="today-day-slider-track">
        <span className="today-day-slider-engrave today-day-slider-engrave-start" data-tone={startTone} aria-hidden="true">
          {startLabel}
        </span>
        {endLabel != null && (
          <span className="today-day-slider-engrave today-day-slider-engrave-end" data-tone={endTone} aria-hidden="true">
            {endLabel}
          </span>
        )}
        <span ref={glassRef} className="today-day-slider-glass" aria-hidden="true">
          <span className="today-day-slider-frost" />
          <span className="today-day-slider-lens" />
        </span>
      </span>
    </button>
  );
}

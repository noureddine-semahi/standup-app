"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Minimum breathing room between the panel and either viewport edge --
// same role on the horizontal axis as the vertical flip's own `6`/`8`
// constants below, just named since it's now used in more than one place.
const VIEWPORT_GUTTER = 8;

/**
 * Renders a dropdown PANEL via a portal to document.body, positioned with
 * `position: fixed` against the trigger's live bounding rect -- sidesteps
 * an ancestor's `overflow: hidden` clipping (e.g. the page's own .card
 * wrapper, which every page uses and which clips any absolutely-positioned
 * descendant regardless of z-index) without touching that ancestor's
 * overflow for anything else on the page, and without an arbitrarily large
 * z-index trying to win a stacking fight overflow:hidden doesn't care about.
 *
 * The trigger itself stays exactly where it already renders (passed
 * through as `children`, unchanged) -- only the panel content moves to the
 * portal. Position is measured from the trigger's wrapping anchor on open
 * and on resize; the panel closes itself on scroll so a stale-positioned
 * panel can never linger visibly in the wrong place.
 *
 * Opens downward by default (unchanged from before); if the panel's own
 * real measured height wouldn't fit in the space below the trigger, it
 * flips to open upward from the trigger's top edge instead -- e.g. a
 * trigger near the bottom of a short card no longer drops its menu over
 * whatever sits below it on the page.
 *
 * Horizontally, `align` only picks a PREFERRED edge to hang the panel
 * from ("right" hangs its right edge off the trigger's right edge,
 * growing leftward -- the default; "left" hangs its left edge off the
 * trigger's left edge, growing rightward). That preference is then
 * clamped to fully fit inside the viewport regardless of where the
 * trigger sits -- a trigger near the left edge of a narrow phone no
 * longer lets a wide panel's preferred leftward growth push it off-
 * screen; same guarantee near the right edge for the other alignment.
 * A hard `max-width` safety net additionally caps the panel at the
 * viewport's own width minus the gutter, so even a panel wider than the
 * whole viewport wraps its content instead of overflowing it.
 *
 * Both axes are measured in a layout effect (before paint), so there's
 * no visible flip/reposition flash -- the panel stays hidden via
 * `visibility` until its final position is settled.
 */
export default function PortalDropdownMenu({
  open,
  onClose,
  anchorRef,
  panelClassName,
  panelStyle,
  align = "right",
  children,
  panel,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  align?: "left" | "right";
  children: ReactNode;
  panel: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setSettled(false);
      return;
    }
    // Rough, unclamped first guess -- just enough for the panel to
    // mount (still hidden via `visibility`) so the layout effect below
    // can measure its real size and correct both axes before anything
    // is shown. `openUp` is carried over across a resize so an already-
    // flipped panel doesn't flash back downward while being re-measured.
    function measure() {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      setRect((prev) => ({
        top: r.bottom + 6,
        left: align === "left" ? r.left : r.right,
        openUp: prev?.openUp ?? false,
      }));
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onClose, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Collision check against the panel's own real measured size, run
  // before paint so any correction is never visible. Re-runs whenever it
  // moves the panel, converging once the computed position matches what
  // was just measured against (same anchor + same panel size -> same
  // result), typically within one extra pass.
  useLayoutEffect(() => {
    if (!open || !rect || !panelRef.current) return;
    const anchorR = anchorRef.current?.getBoundingClientRect();
    if (!anchorR) return;
    const panelRect = panelRef.current.getBoundingClientRect();

    // Vertical -- open down unless the panel's real height wouldn't fit
    // in the space below the trigger; these panels are small enough that
    // a single-direction flip is enough, and the top is clamped so a
    // flipped panel can never go above the viewport either.
    const spaceBelow = window.innerHeight - anchorR.bottom - 6;
    const needsFlip = panelRect.height > spaceBelow;
    const nextTop = needsFlip ? Math.max(VIEWPORT_GUTTER, anchorR.top - panelRect.height - 6) : anchorR.bottom + 6;

    // Horizontal -- start from whichever edge `align` prefers, then
    // clamp fully inside the viewport. The clamp is what's new here:
    // previously the panel was positioned purely relative to the
    // trigger (via a CSS `right` offset for align="right"), with
    // nothing checking whether its own width would then push it past
    // the OPPOSITE edge -- a trigger near the left edge of a narrow
    // phone with a wide panel (e.g. Quick Add's Task picker) could
    // compute a negative left and clip off-screen. Clamping the final
    // left into [gutter, viewportWidth - panelWidth - gutter] makes
    // that impossible regardless of which edge the trigger is near.
    const preferredLeft = align === "left" ? anchorR.left : anchorR.right - panelRect.width;
    const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - panelRect.width - VIEWPORT_GUTTER);
    const nextLeft = Math.min(Math.max(preferredLeft, VIEWPORT_GUTTER), maxLeft);

    if (nextTop !== rect.top || nextLeft !== rect.left || needsFlip !== rect.openUp) {
      setRect({ top: nextTop, left: nextLeft, openUp: needsFlip });
      return; // re-run once more against the corrected position before settling
    }
    setSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rect?.top, rect?.left, rect?.openUp]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Hard ceiling so a panel wider than the viewport itself wraps its
  // content instead of overflowing either edge -- independent of the
  // left-clamp above (which only repositions a panel that already fits
  // within its own natural width). Composed with any maxWidth a caller
  // already passes via `panelStyle` (e.g. Quick Add's own responsive
  // cap) through CSS `min()`, rather than one silently overriding the
  // other.
  const safetyMaxWidth = `calc(100vw - ${VIEWPORT_GUTTER * 2}px)`;
  const callerMaxWidth = panelStyle?.maxWidth;
  const maxWidth = callerMaxWidth ? `min(${String(callerMaxWidth)}, ${safetyMaxWidth})` : safetyMaxWidth;

  return (
    <>
      {children}
      {open &&
        mounted &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            className={panelClassName}
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              transform: "none",
              zIndex: 1000,
              visibility: settled ? "visible" : "hidden",
              boxSizing: "border-box",
              ...panelStyle,
              // `panelClassName` is almost always "conn-card-menu", whose
              // stylesheet rule (globals.css) still carries `right: 0`
              // from before this component existed, when that class was
              // just a plain absolutely-positioned child of a
              // position:relative wrapper. Inline styles only override
              // properties they explicitly set -- since this component
              // never set `right` itself, that stylesheet `right: 0`
              // stayed live alongside our inline `left`, leaving the
              // browser to resolve left+right+width:auto all specified
              // at once. That resolution isn't reliably "ignore right,
              // trust left" across engines, which is exactly why the
              // vertical axis (inline `top`, no competing `bottom`
              // anywhere) always worked while the horizontal one didn't.
              // Forcing `right: auto` here removes the competing value
              // entirely, so `left` is the only horizontal positioning
              // property in play, same as the vertical axis already was.
              right: "auto",
              maxWidth,
            }}
          >
            {panel}
          </div>,
          document.body
        )}
    </>
  );
}

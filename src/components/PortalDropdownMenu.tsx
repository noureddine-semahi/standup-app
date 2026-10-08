"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
 * whatever sits below it on the page. Measured in a layout effect (before
 * paint), so there's no visible flip/flash -- the panel stays hidden via
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
  const [rect, setRect] = useState<{ top: number; left: number; right: number; openUp: boolean } | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setSettled(false);
      return;
    }
    function measure() {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      setRect((prev) => ({ top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right, openUp: prev?.openUp ?? false }));
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

  // Collision check against the panel's own real height, run before paint
  // so the flip (if any) is never visible. Only ever checks "does it
  // overflow below" -- these panels are small, so a single-direction flip
  // is enough; the panel's top is clamped so it can never go above the
  // viewport either.
  useLayoutEffect(() => {
    if (!open || !rect || !panelRef.current) return;
    const anchorR = anchorRef.current?.getBoundingClientRect();
    if (!anchorR) return;
    const panelHeight = panelRef.current.getBoundingClientRect().height;
    const spaceBelow = window.innerHeight - anchorR.bottom - 6;
    const needsFlip = panelHeight > spaceBelow;
    if (needsFlip !== rect.openUp) {
      setRect({
        top: needsFlip ? Math.max(8, anchorR.top - panelHeight - 6) : anchorR.bottom + 6,
        left: anchorR.left,
        right: window.innerWidth - anchorR.right,
        openUp: needsFlip,
      });
      return; // re-run once more against the corrected position before settling
    }
    setSettled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rect?.top, rect?.openUp]);

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
              ...(align === "right" ? { right: rect.right } : { left: rect.left }),
              zIndex: 1000,
              visibility: settled ? "visible" : "hidden",
              ...panelStyle,
            }}
          >
            {panel}
          </div>,
          document.body
        )}
    </>
  );
}

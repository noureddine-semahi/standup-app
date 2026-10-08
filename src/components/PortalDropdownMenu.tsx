"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  const [rect, setRect] = useState<{ top: number; left: number; right: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function measure() {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      setRect({ top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right });
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

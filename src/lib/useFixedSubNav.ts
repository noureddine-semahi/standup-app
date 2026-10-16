"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

// position:sticky for the Community/Tools sub-tab bars was abandoned
// after repeated real-device failures -- runtime diagnosis
// (getComputedStyle/getBoundingClientRect audit) proved the CSS itself
// was correct in isolation, but something about the real app's live
// layout still kept it from engaging. This hook replaces it with a
// manually-driven position:fixed, the one approach already confirmed
// (via an inline-style control test) to actually render the bar in
// the right place.
//
// This is a viewport-width-independent FEATURE, not a mobile-only one
// -- it pins at desktop, tablet, and mobile widths alike. Only the
// scroll threshold (sentinel vs. the header's measured bottom edge)
// decides pin/release; there is no window.innerWidth gate anywhere in
// this hook. Callers may still vary the bar's own CSS (size/padding/
// typography) per breakpoint -- that's ordinary responsive styling,
// unrelated to whether pinning itself is active.
//
// Mechanism: a zero-height sentinel <div> is rendered immediately
// before the tab bar, at the bar's own natural (in-flow) top position.
// An IntersectionObserver watches the sentinel against the ACTUAL
// measured bottom edge of .app-header (not a guessed/estimated
// constant like --header-height) -- once the sentinel scrolls above
// that line, the bar pins; once it scrolls back below, it releases.
// A passive scroll listener backs up the observer so the transition
// is immediate rather than waiting for the next threshold-crossing
// callback. The bar's left/width are captured from its own
// getBoundingClientRect() in the instant before pinning (its last
// real in-flow layout), so it keeps its current column width instead
// of stretching edge-to-edge. The existing outer wrapper div (already
// present on both pages, spanning the tab bar + hero card + all tab
// content -- see the earlier sticky-containment fix) gets an inline
// paddingTop equal to the bar's own height while pinned, exactly
// compensating for the bar leaving normal flow so nothing else shifts.
export interface FixedSubNavResult {
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  barRef: React.RefObject<HTMLDivElement | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  // Ref for the element whose top edge should land directly under the
  // pinned bar after a tab switch (the per-tab hero card on both
  // Community and Tools -- the one thing that's always present right
  // after the tab bar regardless of which sub-tab is active).
  contentRef: React.RefObject<HTMLDivElement | null>;
  pinned: boolean;
  barStyle: CSSProperties | undefined;
  wrapperStyle: CSSProperties | undefined;
}

// activeKey identifies which sub-tab is currently showing (e.g.
// "myFeed", "backlog") -- used ONLY to detect a genuine tab switch (see
// the effect below); it's never read for pin/release, which is still
// driven purely by scroll position as before.
export function useFixedSubNav(activeKey: string, zIndex = 40): FixedSubNavResult {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [metrics, setMetrics] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const evaluate = useCallback(() => {
    const sentinel = sentinelRef.current;
    const header = document.querySelector(".app-header") as HTMLElement | null;
    if (!sentinel || !header) return;

    // Pinning is a feature, not a mobile-only one -- it's available at
    // every viewport width. Only the threshold (sentinel vs. the
    // header's own measured bottom) decides pin/release; there is no
    // width check here on purpose.
    const headerBottom = header.getBoundingClientRect().bottom;
    const sentinelTop = sentinel.getBoundingClientRect().top;
    const shouldPin = sentinelTop <= headerBottom;

    setPinned((prevPinned) => {
      if (shouldPin && !prevPinned) {
        // Transitioning INTO pinned -- the bar is still in normal flow
        // right now, so this is the last moment its real rect reflects
        // its natural column position/width.
        const bar = barRef.current;
        if (bar) {
          const r = bar.getBoundingClientRect();
          setMetrics({ top: headerBottom, left: r.left, width: r.width, height: r.height });
        }
      } else if (shouldPin && prevPinned) {
        // Already pinned -- keep `top` in sync in case the header's
        // own height changes (e.g. hamburger menu opening) while
        // scrolled past the threshold.
        setMetrics((prev) => (prev ? { ...prev, top: headerBottom } : prev));
      }
      return shouldPin;
    });
  }, []);

  useEffect(() => {
    evaluate();

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        evaluate();
        ticking = false;
      });
    };

    // Resize/orientation change: the bar's captured left/width can go
    // stale (different column width at a new viewport size), and the
    // mobile-breakpoint check itself needs re-running. Unpinning first
    // forces a fresh measurement on the next evaluate() rather than
    // reusing a stale metrics snapshot.
    const onResize = () => {
      setPinned(false);
      setMetrics(null);
      requestAnimationFrame(evaluate);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    let observer: IntersectionObserver | null = null;
    if (sentinelRef.current) {
      observer = new IntersectionObserver(() => evaluate(), { threshold: [0, 1] });
      observer.observe(sentinelRef.current);
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [evaluate]);

  // Ref mirror of `pinned`, read (not depended on) by the tab-switch
  // effect below -- it must react ONLY to activeKey changing, never
  // re-fire just because scrolling toggled pinned on its own, but it
  // still needs pinned's CURRENT value at the moment a switch happens.
  const pinnedRef = useRef(pinned);
  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  // Root cause of the "lands in the middle of the new tab" bug: nothing
  // ever moved window.scrollY when the active tab changed -- React just
  // swaps which (differently-sized) block renders in place, so whatever
  // raw scroll offset the user happened to be at against the OLD tab's
  // content became an arbitrary offset into the NEW tab's content the
  // instant it rendered. This effect only runs on a genuine tab switch
  // (prevKeyRef guards the initial mount, where activeKey "changes" from
  // its own starting value to itself) and only corrects scroll while the
  // bar is actually pinned -- unpinned/in-flow switches are already fine
  // without it. requestAnimationFrame defers the measurement one frame
  // past commit, so it reads the NEW tab's real post-render layout
  // (including its real height) rather than a stale pre-render one.
  const prevKeyRef = useRef(activeKey);
  useEffect(() => {
    if (prevKeyRef.current === activeKey) return;
    prevKeyRef.current = activeKey;
    if (!pinnedRef.current) return;

    const frame = requestAnimationFrame(() => {
      const bar = barRef.current;
      const content = contentRef.current;
      if (!bar || !content) return;
      const barBottom = bar.getBoundingClientRect().bottom;
      const contentTop = content.getBoundingClientRect().top;
      const delta = contentTop - barBottom;
      // Minimum adjustment necessary -- skip the no-op case (new tab's
      // content already happens to start in the right place).
      if (Math.abs(delta) > 0.5) {
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeKey]);

  // The housing's own resting background (~0.6 alpha, see
  // .folder-tabbar-tools/.folder-tabbar-community in globals.css) is
  // too translucent once the bar is floating over scrolling content
  // instead of sitting on the page's own canvas -- bumped near-opaque
  // here, inline, ONLY while actually pinned, so the resting
  // (unpinned) housing appearance is completely untouched at every
  // width. --panel-rgb is the same theme-aware token the housing's own
  // CSS already uses, so this resolves correctly in both themes with
  // no separate light-mode branch needed.
  const barStyle: CSSProperties | undefined =
    pinned && metrics
      ? {
          position: "fixed",
          top: metrics.top,
          left: metrics.left,
          width: metrics.width,
          zIndex,
          background: "rgba(var(--panel-rgb), 0.97)",
        }
      : undefined;

  const wrapperStyle: CSSProperties | undefined = pinned && metrics ? { paddingTop: metrics.height } : undefined;

  return { sentinelRef, barRef, wrapperRef, contentRef, pinned, barStyle, wrapperStyle };
}

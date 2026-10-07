"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Single-line text that stays static when it fits its container, and
 * slowly reveals the hidden end (scroll out, pause, scroll back, pause)
 * only when it actually overflows -- never truncates. Falls back to
 * normal text wrapping with no animation under prefers-reduced-motion
 * (see .marquee-text in globals.css), so the full text is always reachable
 * without relying on motion.
 */
export default function MarqueeText({ text, className = "" }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;

    function measure() {
      if (!container || !track) return;
      const diff = Math.ceil(track.scrollWidth - container.clientWidth);
      setOverflowing(diff > 2);
      setShift(diff > 2 ? -diff : 0);
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div ref={containerRef} className={`marquee-text ${overflowing ? "is-overflowing" : ""} ${className}`}>
      <span
        ref={trackRef}
        className="marquee-text-track"
        style={overflowing ? ({ "--marquee-shift": `${shift}px` } as React.CSSProperties) : undefined}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * How far to scroll the page (positive = down) so an element that just opened
 * is fully visible between the fixed header above and the fixed command bar
 * below. Pure geometry (all numbers are viewport-relative px) so the caller
 * passes the REAL measured header/bar edges rather than a guessed height.
 *
 * - Already fully visible -> 0 (never scrolls unnecessarily).
 * - Hidden below the bar -> scrolls down the minimum needed, plus `gap`.
 * - Taller than the visible band -> aligns its top under the header instead,
 *   so the top (title + first rows) is never pushed out of view.
 * - Above the header -> scrolls up just enough to show its top.
 */
export function computeRevealScroll({
  top,
  bottom,
  viewportTop,
  viewportBottom,
  gap = 12,
}: {
  top: number;
  bottom: number;
  viewportTop: number;
  viewportBottom: number;
  gap?: number;
}): number {
  const minTop = viewportTop + gap;
  const maxBottom = viewportBottom - gap;
  if (top >= minTop && bottom <= maxBottom) return 0;
  const height = bottom - top;
  if (height > maxBottom - minTop) return top - minTop;
  if (bottom > maxBottom) return bottom - maxBottom;
  return top - minTop;
}

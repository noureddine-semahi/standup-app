/** Converts a "#rrggbb" hex string into an rgba() string at the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Converts a "#rrggbb" hex string into a bare "r, g, b" triple, for feeding
 * a CSS custom property that's later consumed as rgba(var(--x-rgb), alpha).
 * Needed wherever a dynamically-colored element's CSS replaced color-mix()
 * with plain rgba() (browsers without native color-mix() support, e.g. the
 * Samsung Internet embedded browser confirmed in testing, fall back to a
 * build-tool-injected value that collapses color-mix()-derived text and
 * background to the same raw color -- invisible text) -- CSS alone can't
 * derive rgb() channels from a hex custom property without color-mix()
 * itself, so the RGB triple has to be pre-split here instead.
 */
export function hexToRgbTriple(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

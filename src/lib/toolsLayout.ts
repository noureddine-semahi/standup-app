// Small layout decisions for the Tools page, kept out of the page file so they can be tested.

/** CSS custom property used by the summary tiles to size a value to its tile (see .pay-stat-value). */
export function valueLenStyle(text: string): { "--len": number } {
  return { "--len": Math.max(text.length, 1) };
}

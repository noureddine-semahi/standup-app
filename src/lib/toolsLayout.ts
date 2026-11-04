// Small layout decisions for the Tools page, kept out of the page file so they can be tested.

/**
 * The Tools heading + per-tab description card is hidden on Finances, whose own
 * panel already carries its heading and description (the card above it would
 * just repeat them). Every other tool keeps it. The Finances tab's key is
 * "payments" for historical reasons (its route/state never changed).
 */
export function showToolsIntro(activeTab: string): boolean {
  return activeTab !== "payments";
}

/** CSS custom property used by the summary tiles to size a value to its tile (see .pay-stat-value). */
export function valueLenStyle(text: string): { "--len": number } {
  return { "--len": Math.max(text.length, 1) };
}

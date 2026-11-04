// Small layout decisions for the Tools page, kept out of the page file so they can be tested.

/**
 * The Tools heading + per-tab description card is hidden on Finances and the Planner,
 * whose own panels already carry their heading and description (the card above them
 * would just repeat it). Every other tool keeps it. The Finances tab's key is
 * "payments" for historical reasons (its route/state never changed).
 */
export function showToolsIntro(activeTab: string): boolean {
  return activeTab !== "payments" && activeTab !== "planner";
}

/** CSS custom property used by the summary tiles to size a value to its tile (see .pay-stat-value). */
export function valueLenStyle(text: string): { "--len": number } {
  return { "--len": Math.max(text.length, 1) };
}

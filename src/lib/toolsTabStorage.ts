// Remembers which Tools tab was open so a refresh (or reopening the app) returns to it.

export const TOOLS_TAB_STORAGE_KEY = "standup-tools-active-tab";

/** The saved tab if it is still one of the tabs that exist, otherwise null (first visit, cleared storage, or a tab that was renamed/removed). */
export function parseStoredTab<T extends string>(raw: string | null | undefined, allowed: readonly T[]): T | null {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

export function readStoredTab<T extends string>(allowed: readonly T[]): T | null {
  try {
    return parseStoredTab(window.localStorage.getItem(TOOLS_TAB_STORAGE_KEY), allowed);
  } catch {
    return null; // storage blocked or unavailable: just start on the default tab
  }
}

export function writeStoredTab(tab: string): void {
  try {
    window.localStorage.setItem(TOOLS_TAB_STORAGE_KEY, tab);
  } catch {
    // storage blocked or full: the tab simply isn't remembered
  }
}

/** The raw saved value, whatever it is (used to spot a tab that has since moved to another section). */
export function readStoredTabRaw(): string | null {
  try {
    return window.localStorage.getItem(TOOLS_TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Former Tools tabs that now live in Finances, mapped to their Finances tab key. */
export const FINANCE_TAB_REDIRECT: Readonly<Record<string, string>> = {
  payments: "tab=payments",
  planner: "tab=planner",
  calculator: "tab=calculators",
  salary: "tab=calculators&calc=salary",
};

// The Finances section remembers its own tab the same way (separate key, so the two sections never overwrite each other).
export const FINANCES_TAB_STORAGE_KEY = "standup-finances-active-tab";

export function readFinancesTab<T extends string>(allowed: readonly T[]): T | null {
  try {
    return parseStoredTab(window.localStorage.getItem(FINANCES_TAB_STORAGE_KEY), allowed);
  } catch {
    return null;
  }
}

export function writeFinancesTab(tab: string): void {
  try {
    window.localStorage.setItem(FINANCES_TAB_STORAGE_KEY, tab);
  } catch {
    // storage blocked or full: the tab simply isn't remembered
  }
}

/**
 * Tools tabs that were renamed or folded into another tab. A remembered tab or a ?tab= link using the old name lands on the
 * new place: Recurring is now Routines, and Long-Term lives inside Goals (its own view there).
 */
export const LEGACY_TOOLS_TAB: Readonly<Record<string, { tab: string; view?: string }>> = {
  recurring: { tab: "routines" },
  longTerm: { tab: "goals", view: "longTerm" },
};

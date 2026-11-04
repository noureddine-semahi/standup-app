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

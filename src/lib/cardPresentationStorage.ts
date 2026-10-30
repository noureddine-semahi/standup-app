// Remembers, on THIS device, which Today cards the user collapsed or opened,
// so the choice survives a refresh, closing the app and logging out / in.
// Keyed per user and per goal id; purely presentation -- it never reads or
// writes goal data. Any storage failure (private window, blocked storage,
// corrupt JSON) degrades silently to the default presentation.
const KEY_PREFIX = "standup:card-presentation:v1:";

export type CardPresentationState = {
  /** unresolved cards the user collapsed by hand */
  collapsedPending: string[];
  /** resolved cards the user opened (they are collapsed by default) */
  expandedDone: string[];
};

const EMPTY: CardPresentationState = { collapsedPending: [], expandedDone: [] };

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function loadCardPresentation(userId: string): CardPresentationState {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return { collapsedPending: ids(parsed?.collapsedPending), expandedDone: ids(parsed?.expandedDone) };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Saves the state. When `knownGoalIds` is given (non-empty), ids of goals that
 * no longer exist (other days, deleted tasks) are dropped so the entry can't
 * grow without bound.
 */
export function saveCardPresentation(
  userId: string,
  state: CardPresentationState,
  knownGoalIds?: ReadonlySet<string>
): void {
  try {
    const keep = (list: string[]) => (knownGoalIds && knownGoalIds.size > 0 ? list.filter((id) => knownGoalIds.has(id)) : list);
    const next: CardPresentationState = {
      collapsedPending: keep(state.collapsedPending),
      expandedDone: keep(state.expandedDone),
    };
    if (next.collapsedPending.length === 0 && next.expandedDone.length === 0) {
      window.localStorage.removeItem(KEY_PREFIX + userId);
    } else {
      window.localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(next));
    }
  } catch {
    // storage unavailable: presentation simply isn't remembered
  }
}

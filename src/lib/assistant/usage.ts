// Free-tier usage cap for the AI assistant — kept as pure functions so the
// reset/cap arithmetic is unit-testable without touching Supabase or the
// Anthropic API. See PRODUCT_LOG.md for why this exists: the assistant is
// the first feature in the app with a real per-use cost, and there's no
// billing infrastructure yet to gate it properly, so it ships free with a
// hard cap instead.

export const ASSISTANT_FREE_CAP = 20;
const PERIOD_DAYS = 30;

export type AssistantUsageRow = {
  assistant_uses_this_period: number;
  assistant_period_reset_at: string;
};

export type UsageState = {
  uses: number;
  resetAt: string;
  didReset: boolean;
};

/**
 * A rolling 30-day window per user (not a calendar month) — anchored to
 * their own last reset rather than the 1st of the month, so it never has to
 * deal with "Jan 31 -> Feb 31 doesn't exist" edge cases.
 */
export function computeUsageState(row: AssistantUsageRow, now: Date): UsageState {
  const resetAt = new Date(row.assistant_period_reset_at);

  if (now.getTime() > resetAt.getTime()) {
    const nextReset = new Date(now.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);
    return { uses: 0, resetAt: nextReset.toISOString(), didReset: true };
  }

  return { uses: row.assistant_uses_this_period, resetAt: row.assistant_period_reset_at, didReset: false };
}

export function remainingUses(uses: number): number {
  return Math.max(0, ASSISTANT_FREE_CAP - uses);
}

export function hasUsesRemaining(uses: number): boolean {
  return uses < ASSISTANT_FREE_CAP;
}

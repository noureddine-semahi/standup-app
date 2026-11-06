import { canStartTrial, trialDaysLeft, type AccountTier } from "@/lib/entitlements";

// What the Premium card on the account settings page shows, worked out from the two things the database tells us (the effective
// entitlement and the permanent trial history). Pure: no fetching and no activation here.

export type TrialViewInput = {
  tier: AccountTier;
  trialEndsAt: string | null;
  trialStartedAt: string | null;
  /** Whether a trial has EVER been used on this account (permanent history). */
  trialUsed: boolean;
};

export type TrialView = {
  tier: AccountTier;
  /** The one-time trial can be offered: not Premium, and never used. */
  canStart: boolean;
  /** An active trial: when it ends and how many whole days remain (the last partial day counts). */
  endsAt: string | null;
  daysLeft: number;
  /** A trial was used and is over, and the account is Free again. */
  trialEnded: boolean;
};

export function trialView(input: TrialViewInput, now: Date | number = Date.now()): TrialView {
  const active = input.tier === "premium_trial";
  return {
    tier: input.tier,
    canStart: canStartTrial({ tier: input.tier, trialUsed: input.trialUsed }),
    endsAt: active ? input.trialEndsAt : null,
    daysLeft: active ? trialDaysLeft(input.trialStartedAt, now) : 0,
    trialEnded: input.tier === "free" && input.trialUsed,
  };
}

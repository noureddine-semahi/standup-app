// The monetization / beta feature flags. Pure and shared: the keys, the safe defaults, how a database answer is read, and the rules
// the UI uses. The values themselves live in the database (public.feature_flags) and can be changed only by whoever runs SQL on the
// project, never from the browser, so a client can't turn a flag on. They are enforced where it matters on the server side
// (start_my_premium_trial refuses while premium_trial_activation_enabled is off); the UI rules below only decide what to SHOW.
//
// EVERY FLAG DEFAULTS TO FALSE, and so does anything unreadable, missing or unrecognised: a failure never switches a feature on.

export const FEATURE_FLAGS = ["premium_promotion_enabled", "premium_trial_activation_enabled", "billing_checkout_enabled"] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Readonly<Record<FeatureFlag, boolean>>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  premium_promotion_enabled: false,
  premium_trial_activation_enabled: false,
  billing_checkout_enabled: false,
};

/** Read what the database returned (rows of { r_key, r_enabled }). Only a literal `true` for a known key turns a flag on. */
export function parseFeatureFlags(data: unknown): FeatureFlags {
  const flags: Record<FeatureFlag, boolean> = { ...DEFAULT_FEATURE_FLAGS };
  if (!Array.isArray(data)) return flags;
  for (const row of data) {
    const r = row as { r_key?: unknown; r_enabled?: unknown } | null;
    if (r && (FEATURE_FLAGS as readonly unknown[]).includes(r.r_key) && r.r_enabled === true) flags[r.r_key as FeatureFlag] = true;
  }
  return flags;
}

/** Premium comparison, pricing and the other "get Premium" messaging. Off during the free beta. */
export const showPremiumPromotion = (f: FeatureFlags): boolean => f.premium_promotion_enabled;

/** The free-trial offer and its start button. */
export const showTrialOffer = (f: FeatureFlags): boolean => f.premium_trial_activation_enabled;

/** A checkout / subscribe action. Needs promotion on as well, so nothing can sell Premium while Premium isn't being promoted. */
export const showCheckout = (f: FeatureFlags): boolean => f.billing_checkout_enabled && f.premium_promotion_enabled;

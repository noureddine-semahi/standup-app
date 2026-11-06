// Free / Premium entitlements: the one place that says who gets what.
//
// FOUNDATION ONLY. Nothing here is enforced yet and nothing reads a real account: it is pure, typed definitions and helpers
// that the app, the limits and the upgrade prompts will build on. No billing, no trial activation, no database.
//
// The daily commitment and review experience (the three daily goals, Today, Tomorrow, review) is never limited for anyone. It
// is deliberately NOT a LimitedResource, so no helper here can be asked to cap it.

export const ACCOUNT_TIERS = ["free", "premium_trial", "premium"] as const;
export type AccountTier = (typeof ACCOUNT_TIERS)[number];

/** The things a Free account has a cap on. Premium Trial and Premium have no cap on any of them. */
export const LIMITED_RESOURCES = ["structuredGoals", "routines", "notes"] as const;
export type LimitedResource = (typeof LIMITED_RESOURCES)[number];

/** Free-tier caps: active structured goals, active routines, saved notes. */
export const FREE_LIMITS: Readonly<Record<LimitedResource, number>> = {
  structuredGoals: 3,
  routines: 3,
  notes: 10,
};

/** Parts of StandUp that are available in full to every account, whatever its tier. Informational; never a limit. */
export const ALWAYS_AVAILABLE = ["dailyCommitments", "dailyReview"] as const;

export const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Display pricing, in minor units (cents) so it never passes through floating point. */
export const PRICING = {
  currency: "USD",
  monthly: { amountCents: 599, periodMonths: 1 },
  yearly: { amountCents: 4999, periodMonths: 12 },
} as const;

/** "$5.99", "$49.99". */
export function formatPriceCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  return `$${whole}.${String(frac).padStart(2, "0")}`;
}

/** What the yearly plan costs per month, in cents (rounded down), for "equivalent to $4.16/month" style copy. */
export function yearlyPerMonthCents(): number {
  return Math.floor(PRICING.yearly.amountCents / PRICING.yearly.periodMonths);
}

/** Whole percent saved by paying yearly instead of twelve months, rounded down. */
export function yearlySavingsPercent(): number {
  const twelveMonths = PRICING.monthly.amountCents * PRICING.yearly.periodMonths;
  return Math.floor(((twelveMonths - PRICING.yearly.amountCents) / twelveMonths) * 100);
}

// ── Tier resolution ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The facts a tier is worked out from. Both come from the account record once that exists; until then callers pass nothing
 * and the account is Free.
 *  - premium: the account has an active paid subscription.
 *  - trialStartedAt: when the free trial began (ISO timestamp), or null/undefined if it never has.
 */
export type EntitlementFacts = {
  premium?: boolean | null;
  trialStartedAt?: string | null;
};

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** When a trial that started at `trialStartedAt` ends (ISO), or null if the start isn't a valid date. */
export function trialEndsAt(trialStartedAt: string | null | undefined): string | null {
  const start = parseTime(trialStartedAt);
  return start === null ? null : new Date(start + TRIAL_DAYS * DAY_MS).toISOString();
}

/** True while `now` is within [start, start + 14 days). A start in the future, or an unreadable one, is not an active trial. */
export function isTrialActive(trialStartedAt: string | null | undefined, now: Date | number = Date.now()): boolean {
  const start = parseTime(trialStartedAt);
  if (start === null) return false;
  const t = typeof now === "number" ? now : now.getTime();
  return t >= start && t < start + TRIAL_DAYS * DAY_MS;
}

/** Whole days left in an active trial (rounded up, so the last partial day still counts), or 0 when there is no active trial. */
export function trialDaysLeft(trialStartedAt: string | null | undefined, now: Date | number = Date.now()): number {
  const start = parseTime(trialStartedAt);
  if (start === null || !isTrialActive(trialStartedAt, now)) return 0;
  const t = typeof now === "number" ? now : now.getTime();
  return Math.ceil((start + TRIAL_DAYS * DAY_MS - t) / DAY_MS);
}

/** Premium wins; otherwise an active trial; otherwise Free (including an expired trial). */
export function resolveTier(facts: EntitlementFacts | null | undefined, now: Date | number = Date.now()): AccountTier {
  if (facts?.premium) return "premium";
  if (isTrialActive(facts?.trialStartedAt, now)) return "premium_trial";
  return "free";
}

// ── Limits ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Premium Trial and Premium get everything Premium includes. */
export function hasPremiumAccess(tier: AccountTier): boolean {
  return tier === "premium" || tier === "premium_trial";
}

/** The cap for a resource, or null when the tier has no cap. */
export function limitFor(tier: AccountTier, resource: LimitedResource): number | null {
  return hasPremiumAccess(tier) ? null : FREE_LIMITS[resource];
}

export function isUnlimited(tier: AccountTier, resource: LimitedResource): boolean {
  return limitFor(tier, resource) === null;
}

/** How many more can be created, or null when unlimited. Never negative (an account already over a cap has 0 left). */
export function remaining(tier: AccountTier, resource: LimitedResource, currentCount: number): number | null {
  const limit = limitFor(tier, resource);
  return limit === null ? null : Math.max(0, limit - Math.max(0, currentCount));
}

/** True when one more can be created. An unreadable count (negative or not finite) is treated as 0. */
export function canCreate(tier: AccountTier, resource: LimitedResource, currentCount: number): boolean {
  const limit = limitFor(tier, resource);
  if (limit === null) return true;
  const n = Number.isFinite(currentCount) ? Math.max(0, currentCount) : 0;
  return n < limit;
}

/** True when the account is at or over a cap (what an upgrade prompt would key off). Always false when unlimited. */
export function isAtLimit(tier: AccountTier, resource: LimitedResource, currentCount: number): boolean {
  return !canCreate(tier, resource, currentCount);
}

/** Everything about one resource in one call, for UI that shows "2 of 3 used". */
export type ResourceUsage = {
  resource: LimitedResource;
  count: number;
  limit: number | null;
  remaining: number | null;
  atLimit: boolean;
};

export function usageFor(tier: AccountTier, resource: LimitedResource, currentCount: number): ResourceUsage {
  const count = Number.isFinite(currentCount) ? Math.max(0, currentCount) : 0;
  return { resource, count, limit: limitFor(tier, resource), remaining: remaining(tier, resource, count), atLimit: isAtLimit(tier, resource, count) };
}

import { PRICING } from "@/lib/entitlements";

// The two paid plans and what each one costs. No secrets and no Stripe SDK here, so this is safe to import from anywhere; the amounts come
// from the same PRICING the Settings screen shows, so the UI and the Stripe Prices cannot drift apart without a test noticing.

export const BILLING_PLANS = ["monthly", "annual"] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const PLAN_TERMS: Readonly<Record<BillingPlan, { interval: "month" | "year"; amountCents: number }>> = {
  monthly: { interval: "month", amountCents: PRICING.monthly.amountCents },
  annual: { interval: "year", amountCents: PRICING.yearly.amountCents },
};

export const isBillingPlan = (v: unknown): v is BillingPlan => (BILLING_PLANS as readonly unknown[]).includes(v);

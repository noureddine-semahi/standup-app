import { FREE_LIMITS, PRICING, TRIAL_DAYS, formatPriceCents } from "@/lib/entitlements";
import type { TranslationKey } from "@/lib/i18n/en";

// The Terms of Service: which version is shown, when it takes effect, and the order of its sections. The words themselves live in the translation
// files (terms.* keys, English and Spanish); the numbers in them (prices, trial length, Free limits) come from lib/entitlements.ts, so the Terms can't
// drift from what the app actually does.
//
// PUBLISHING: these Terms are a DRAFT until the owner sets TERMS_EFFECTIVE_DATE below (an ISO date, "YYYY-MM-DD") and bumps TERMS_VERSION. While the
// date is null the page says plainly that the Terms are a draft that has not been legally reviewed and is not yet in effect. The open decisions the
// owner must make first are listed in docs/terms-owner-decisions.md.

export const TERMS_VERSION = "0.1";
export const TERMS_EFFECTIVE_DATE: string | null = null;

export type TermsStatus = { version: string; effectiveDate: string | null };
export const CURRENT_TERMS: TermsStatus = { version: TERMS_VERSION, effectiveDate: TERMS_EFFECTIVE_DATE };

/** Whether these Terms have an effective date (a plain ISO date). Anything else, including a typo, counts as NOT in effect. */
export const isInEffect = (s: TermsStatus): boolean => !!s.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(s.effectiveDate);

/** "Version 0.1" plus either the effective date or the draft marker. `formatDate` turns the ISO date into the reader's language. */
export function termsStatusLine(s: TermsStatus, formatDate: (iso: string) => string, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const version = t("terms.version", { version: s.version });
  const when = isInEffect(s) ? t("terms.effective", { date: formatDate(s.effectiveDate as string) }) : t("terms.notYetInEffect");
  return `${version} · ${when}`;
}

/** Values interpolated into the Terms text. */
export const TERMS_VARS = {
  monthly: formatPriceCents(PRICING.monthly.amountCents),
  annual: formatPriceCents(PRICING.yearly.amountCents),
  days: TRIAL_DAYS,
  goals: FREE_LIMITS.structuredGoals,
  routines: FREE_LIMITS.routines,
  notes: FREE_LIMITS.notes,
} as const;

export type TermsSection = { id: string; title: TranslationKey; paragraphs: TranslationKey[] };

/** The sections, in reading order. Every title/paragraph key exists in both languages (a test pins this, and that both say the same thing). */
export const TERMS_SECTIONS: readonly TermsSection[] = [
  { id: "agreement", title: "terms.agreement.title", paragraphs: ["terms.agreement.p1", "terms.agreement.p2"] },
  { id: "eligibility", title: "terms.eligibility.title", paragraphs: ["terms.eligibility.p1", "terms.eligibility.p2"] },
  { id: "plans", title: "terms.plans.title", paragraphs: ["terms.plans.p1", "terms.plans.p2", "terms.plans.p3", "terms.plans.p4"] },
  { id: "trial", title: "terms.trial.title", paragraphs: ["terms.trial.p1", "terms.trial.p2", "terms.trial.p3"] },
  { id: "prices", title: "terms.prices.title", paragraphs: ["terms.prices.p1", "terms.prices.p2"] },
  { id: "renewal", title: "terms.renewal.title", paragraphs: ["terms.renewal.p1", "terms.renewal.p2", "terms.renewal.p3"] },
  { id: "cancel", title: "terms.cancel.title", paragraphs: ["terms.cancel.p1", "terms.cancel.p2", "terms.cancel.p3"] },
  { id: "refunds", title: "terms.refunds.title", paragraphs: ["terms.refunds.p1", "terms.refunds.p2", "terms.refunds.p3"] },
  { id: "deletion", title: "terms.deletion.title", paragraphs: ["terms.deletion.p1", "terms.deletion.p2", "terms.deletion.p3"] },
  { id: "payments", title: "terms.payments.title", paragraphs: ["terms.payments.p1"] },
  { id: "data", title: "terms.data.title", paragraphs: ["terms.data.p1", "terms.data.p2"] },
  { id: "use", title: "terms.use.title", paragraphs: ["terms.use.p1", "terms.use.p2"] },
  { id: "availability", title: "terms.availability.title", paragraphs: ["terms.availability.p1"] },
  { id: "changes", title: "terms.changes.title", paragraphs: ["terms.changes.p1", "terms.changes.p2"] },
  { id: "law", title: "terms.law.title", paragraphs: ["terms.law.p1"] },
  { id: "contact", title: "terms.contact.title", paragraphs: ["terms.contact.p1"] },
];

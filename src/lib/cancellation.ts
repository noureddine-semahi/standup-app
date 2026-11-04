// Pure logic for "Unsubscribe Me": which cancellation routes exist for a
// subscription, how requests and outcomes are classified, projected savings, and
// input validation. No I/O.
//
// Mirrors supabase/migrations/20261105000200_subscription_cancellations.sql.
//
// Honesty rules this module encodes:
//  - "provider_confirmed" exists only for an authorized integration's acknowledgment.
//    No integration exists today (CANCELLATION_INTEGRATIONS is empty), so automatic
//    cancellation is never offered and nothing here can produce a confirmed outcome.
//  - Opening a cancellation page is only a request. It is never a completed cancellation.
//  - A user's own report is always labeled as user-reported.
//  - Provider passwords are never collected; there is no field for them anywhere.

import { isValidISODate } from "@/lib/bills";
import { annualCents, monthlyCents, BASE_CURRENCY, type Subscription } from "@/lib/subscriptions";

export type CancellationMode = "automatic" | "assisted" | "manual";
export type CancellationStatus = "in_progress" | "user_reported" | "provider_confirmed" | "failed";

export type SubscriptionCancellation = {
  id: string;
  subscriptionId: string;
  mode: CancellationMode;
  status: CancellationStatus;
  requestedAt: string;
  /** The day the user says they canceled (user_reported) or the provider acknowledged it (provider_confirmed). */
  completedOn: string | null;
  guideUrl: string | null;
  providerReference: string | null;
  errorMessage: string | null;
  note: string | null;
};

export const MAX_CANCELLATION_TEXT = 500;
export const MAX_CANCEL_URL = 500;

// ── Routes ───────────────────────────────────────────────────────────────

/**
 * Authorized provider integrations that can cancel on the user's behalf and return
 * an acknowledgment. Deliberately empty: none have been built or authorized, and
 * automatic cancellation must never be simulated. Adding one means implementing
 * the server-side call AND the acknowledgment check before it may set
 * "provider_confirmed".
 */
export const CANCELLATION_INTEGRATIONS: readonly { id: string; names: readonly string[] }[] = [];

/**
 * Provider cancellation pages StandUp itself has checked. Each entry must carry the
 * date it was last verified. Empty until someone verifies real pages; users can
 * save their own link per subscription meanwhile (labeled as theirs).
 */
export type ProviderCancellationPage = { names: readonly string[]; url: string; verifiedOn: string };
export const PROVIDER_CANCELLATION_PAGES: readonly ProviderCancellationPage[] = [];

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function matchesNames(sub: Pick<Subscription, "name" | "provider">, names: readonly string[]): boolean {
  const keys = [norm(sub.name), norm(sub.provider)].filter((k) => k.length >= 3);
  return names.some((n) => keys.includes(norm(n)));
}

/** A link we are willing to send the user to: absolute https, no embedded credentials, sane length. Returns the normalized URL or null. */
export function safeCancelUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > MAX_CANCEL_URL || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
  return url.toString();
}

export type CancellationOptions = {
  automatic: { available: boolean };
  assisted: { url: string | null; source: "verified" | "saved" | null; verifiedOn: string | null };
  manual: { available: true };
};

export function cancellationOptions(sub: Pick<Subscription, "name" | "provider"> & { cancelUrl?: string | null }): CancellationOptions {
  const integration = CANCELLATION_INTEGRATIONS.find((i) => matchesNames(sub, i.names));
  const verified = PROVIDER_CANCELLATION_PAGES.find((p) => matchesNames(sub, p.names) && safeCancelUrl(p.url));
  const saved = safeCancelUrl(sub.cancelUrl);
  return {
    automatic: { available: !!integration },
    assisted: verified
      ? { url: safeCancelUrl(verified.url), source: "verified", verifiedOn: verified.verifiedOn }
      : saved
        ? { url: saved, source: "saved", verifiedOn: null }
        : { url: null, source: null, verifiedOn: null },
    manual: { available: true },
  };
}

// ── Classification ───────────────────────────────────────────────────────

const byNewest = (a: SubscriptionCancellation, b: SubscriptionCancellation) => (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : 0);

/** Newest first. */
export const sortCancellations = (list: readonly SubscriptionCancellation[]) => [...list].sort(byNewest);

/** The open assisted request, if the user started one and hasn't reported back. */
export function pendingRequest(list: readonly SubscriptionCancellation[]): SubscriptionCancellation | null {
  return sortCancellations(list).find((c) => c.status === "in_progress") ?? null;
}

/** The newest request that ended in a cancellation (provider-confirmed or user-reported). */
export function effectiveCancellation(list: readonly SubscriptionCancellation[]): SubscriptionCancellation | null {
  return sortCancellations(list).find((c) => c.status === "provider_confirmed" || c.status === "user_reported") ?? null;
}

/** What the card should say; the newest request decides, but a pending/failed one never hides a later report. */
export type CancellationBadge = "providerConfirmed" | "userReported" | "inProgress" | "failed";
export function cancellationBadge(list: readonly SubscriptionCancellation[]): CancellationBadge | null {
  const newest = sortCancellations(list)[0];
  if (!newest) return null;
  switch (newest.status) {
    case "provider_confirmed":
      return "providerConfirmed";
    case "user_reported":
      return "userReported";
    case "in_progress":
      return "inProgress";
    case "failed":
      return "failed";
  }
}

// ── Projected savings ────────────────────────────────────────────────────

export type SavingsBucket = { monthly: number; yearly: number; count: number };
export type CancellationSavings = {
  /** Acknowledged by the provider through an authorized integration. */
  confirmed: SavingsBucket;
  /** Reported by the user; not verified by the provider. */
  reported: SavingsBucket;
  /** Canceled with a report but no usable price (or not in the totals currency), so no figure can be projected. */
  unpriced: number;
};

/**
 * Projected FUTURE savings from subscriptions that are canceled in StandUp AND have a
 * confirmed or user-reported cancellation. It is a projection of what would no longer
 * be charged going forward (monthly-equivalent and a year of it), not money already
 * saved, and it assumes the cancellation holds. Cancellations that were only started
 * or that failed contribute nothing, and neither does a plain "Mark canceled" with
 * no cancellation record. Same per-subscription rounding as the Subscriptions totals.
 */
export function summarizeSavings(
  subs: readonly Subscription[],
  cancellations: Readonly<Record<string, readonly SubscriptionCancellation[]>>
): CancellationSavings {
  const out: CancellationSavings = {
    confirmed: { monthly: 0, yearly: 0, count: 0 },
    reported: { monthly: 0, yearly: 0, count: 0 },
    unpriced: 0,
  };
  let confirmedAnnual = 0;
  let reportedAnnual = 0;
  for (const s of subs) {
    if (s.status !== "canceled") continue;
    const eff = effectiveCancellation(cancellations[s.id] ?? []);
    if (!eff) continue;
    const annual = s.currency === BASE_CURRENCY ? annualCents(s) : null;
    const monthly = s.currency === BASE_CURRENCY ? monthlyCents(s) : null;
    if (annual === null || monthly === null || annual <= 0) {
      out.unpriced += 1;
      continue;
    }
    const bucket = eff.status === "provider_confirmed" ? out.confirmed : out.reported;
    bucket.count += 1;
    if (eff.status === "provider_confirmed") confirmedAnnual += annual;
    else reportedAnnual += annual;
  }
  out.confirmed.yearly = confirmedAnnual / 100;
  out.reported.yearly = reportedAnnual / 100;
  // Monthly = total yearly / 12 rounded to the cent, matching the Subscriptions tiles.
  out.confirmed.monthly = Math.round(confirmedAnnual / 12) / 100;
  out.reported.monthly = Math.round(reportedAnnual / 12) / 100;
  return out;
}

// ── Input validation ─────────────────────────────────────────────────────

export type CancellationReportError = "date" | "dateFuture" | "note";
export type CancellationReportPayload = { completedOn: string; note: string | null };

export function parseCancellationReport(
  values: { date: string; note: string },
  todayISO: string
): { ok: true; payload: CancellationReportPayload } | { ok: false; error: CancellationReportError } {
  const date = values.date.trim();
  if (!isValidISODate(date)) return { ok: false, error: "date" };
  if (date > todayISO) return { ok: false, error: "dateFuture" };
  const note = values.note.trim();
  if (note.length > MAX_CANCELLATION_TEXT) return { ok: false, error: "note" };
  return { ok: true, payload: { completedOn: date, note: note || null } };
}

export type CancellationFailureError = "required" | "tooLong";
export function parseCancellationFailure(text: string): { ok: true; error: string } | { ok: false; error: CancellationFailureError } {
  const t = text.trim();
  if (!t) return { ok: false, error: "required" };
  if (t.length > MAX_CANCELLATION_TEXT) return { ok: false, error: "tooLong" };
  return { ok: true, error: t };
}

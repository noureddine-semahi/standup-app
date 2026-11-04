import { describe, it, expect } from "vitest";
import {
  CANCELLATION_INTEGRATIONS,
  PROVIDER_CANCELLATION_PAGES,
  cancellationBadge,
  cancellationOptions,
  effectiveCancellation,
  parseCancellationFailure,
  parseCancellationReport,
  pendingRequest,
  safeCancelUrl,
  summarizeSavings,
  type SubscriptionCancellation,
} from "./cancellation";
import type { Subscription } from "./subscriptions";

const TODAY = "2026-11-04";

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1",
  name: "Netflix",
  provider: null,
  category: null,
  planName: null,
  amount: 15.49,
  currency: "USD",
  frequency: "monthly",
  customInterval: null,
  customUnit: null,
  nextBillingDate: "2026-11-20",
  startDate: null,
  status: "canceled",
  trialEndsOn: null,
  remindDaysBefore: 3,
  notes: null,
  billId: null,
  canceledAt: "2026-11-01T00:00:00Z",
  cancelUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const req = (over: Partial<SubscriptionCancellation> = {}): SubscriptionCancellation => ({
  id: "c1",
  subscriptionId: "s1",
  mode: "manual",
  status: "user_reported",
  requestedAt: "2026-11-01T10:00:00Z",
  completedOn: "2026-11-01",
  guideUrl: null,
  providerReference: null,
  errorMessage: null,
  note: null,
  ...over,
});

describe("safeCancelUrl", () => {
  it("accepts a normal https page and normalizes it", () => {
    expect(safeCancelUrl("  https://example.com/account/cancel  ")).toBe("https://example.com/account/cancel");
  });
  it("rejects http, other schemes, embedded credentials, spaces, junk and over-long links", () => {
    for (const bad of [
      "http://example.com/cancel",
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com",
      "https://user:pw@example.com/cancel",
      "https://user@example.com/cancel",
      "https://exa mple.com",
      "https://localhost/cancel",
      "not a url",
      "",
      null,
      undefined,
      "https://example.com/" + "a".repeat(600),
    ]) {
      expect(safeCancelUrl(bad as string), String(bad)).toBeNull();
    }
  });
});

describe("cancellation routes (no integrations exist, and none is faked)", () => {
  it("has no automatic integrations registered, so automatic cancellation is never available", () => {
    expect(CANCELLATION_INTEGRATIONS).toHaveLength(0);
    expect(cancellationOptions(sub({ name: "Netflix" })).automatic.available).toBe(false);
    expect(cancellationOptions(sub({ name: "Spotify", provider: "Spotify AB" })).automatic.available).toBe(false);
  });
  it("any built-in provider page must be https and carry a verification date", () => {
    for (const p of PROVIDER_CANCELLATION_PAGES) {
      expect(safeCancelUrl(p.url), p.url).toBe(p.url);
      expect(p.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.names.length).toBeGreaterThan(0);
    }
  });
  it("assisted uses only a link the user saved, labeled as theirs; no link means no assisted target", () => {
    expect(cancellationOptions(sub()).assisted).toEqual({ url: null, source: null, verifiedOn: null });
    expect(cancellationOptions(sub({ cancelUrl: "https://example.com/cancel" })).assisted).toEqual({
      url: "https://example.com/cancel",
      source: "saved",
      verifiedOn: null,
    });
    // an unsafe stored value is ignored rather than opened
    expect(cancellationOptions(sub({ cancelUrl: "http://example.com/cancel" })).assisted.url).toBeNull();
  });
  it("manual is always available", () => {
    expect(cancellationOptions(sub()).manual.available).toBe(true);
  });
});

describe("classification", () => {
  it("finds the open request and the newest request that ended in a cancellation", () => {
    const list = [
      req({ id: "a", status: "failed", requestedAt: "2026-10-01T00:00:00Z", completedOn: null }),
      req({ id: "b", status: "in_progress", mode: "assisted", requestedAt: "2026-10-05T00:00:00Z", completedOn: null }),
      req({ id: "c", status: "user_reported", requestedAt: "2026-10-03T00:00:00Z" }),
    ];
    expect(pendingRequest(list)?.id).toBe("b");
    expect(effectiveCancellation(list)?.id).toBe("c");
    expect(pendingRequest([req()])).toBeNull();
    expect(effectiveCancellation([req({ status: "failed", completedOn: null })])).toBeNull();
  });
  it("the badge follows the newest request and keeps user-reported distinct from provider-confirmed", () => {
    expect(cancellationBadge([])).toBeNull();
    expect(cancellationBadge([req({ status: "user_reported" })])).toBe("userReported");
    expect(cancellationBadge([req({ status: "in_progress", mode: "assisted", completedOn: null })])).toBe("inProgress");
    expect(cancellationBadge([req({ status: "failed", completedOn: null })])).toBe("failed");
    expect(cancellationBadge([req({ status: "provider_confirmed", mode: "automatic", providerReference: "ref" })])).toBe("providerConfirmed");
  });
});

describe("projected savings", () => {
  it("counts a canceled subscription with a user-reported cancellation as REPORTED, not confirmed", () => {
    const r = summarizeSavings([sub({ amount: 15.49 })], { s1: [req()] });
    expect(r.reported).toEqual({ monthly: 15.49, yearly: 185.88, count: 1 });
    expect(r.confirmed.count).toBe(0);
    expect(r.confirmed.monthly).toBe(0);
  });
  it("counts a provider-confirmed cancellation separately", () => {
    const r = summarizeSavings([sub({ amount: 10 })], { s1: [req({ status: "provider_confirmed", mode: "automatic", providerReference: "r1" })] });
    expect(r.confirmed).toEqual({ monthly: 10, yearly: 120, count: 1 });
    expect(r.reported.count).toBe(0);
  });
  it("normalizes other frequencies to monthly and yearly", () => {
    const r = summarizeSavings([sub({ amount: 120, frequency: "yearly" })], { s1: [req()] });
    expect(r.reported).toEqual({ monthly: 10, yearly: 120, count: 1 });
  });
  it("ignores requests that did not end in a cancellation, and subscriptions that are not canceled", () => {
    const subs = [
      sub({ id: "a" }),
      sub({ id: "b" }),
      sub({ id: "c", status: "active", canceledAt: null }), // reactivated after a report
      sub({ id: "d" }), // plain "Mark canceled": no cancellation record at all
    ];
    const r = summarizeSavings(subs, {
      a: [req({ subscriptionId: "a", status: "in_progress", mode: "assisted", completedOn: null })],
      b: [req({ subscriptionId: "b", status: "failed", completedOn: null })],
      c: [req({ subscriptionId: "c" })],
    });
    expect(r.reported.count + r.confirmed.count + r.unpriced).toBe(0);
  });
  it("reports unpriced and non-USD cancellations instead of inventing a figure", () => {
    const r = summarizeSavings(
      [sub({ id: "a", amount: null }), sub({ id: "b", currency: "EUR" }), sub({ id: "c", amount: 5 })],
      { a: [req({ subscriptionId: "a" })], b: [req({ subscriptionId: "b" })], c: [req({ subscriptionId: "c" })] }
    );
    expect(r.unpriced).toBe(2);
    expect(r.reported.count).toBe(1);
    expect(r.reported.monthly).toBe(5);
  });
  it("sums from per-subscription yearly cents so totals match the Subscriptions tiles", () => {
    const r = summarizeSavings(
      [sub({ id: "a", amount: 9.99 }), sub({ id: "b", amount: 4.99, frequency: "weekly" })],
      { a: [req({ subscriptionId: "a" })], b: [req({ subscriptionId: "b" })] }
    );
    // 9.99*12 = 119.88, 4.99*52 = 259.48 -> 379.36 / 12 = 31.613 -> 31.61
    expect(r.reported.yearly).toBe(379.36);
    expect(r.reported.monthly).toBe(31.61);
  });
});

describe("input validation", () => {
  it("a reported cancellation needs a real date that is not in the future", () => {
    expect(parseCancellationReport({ date: "", note: "" }, TODAY)).toEqual({ ok: false, error: "date" });
    expect(parseCancellationReport({ date: "2026-02-30", note: "" }, TODAY)).toEqual({ ok: false, error: "date" });
    expect(parseCancellationReport({ date: "2026-11-05", note: "" }, TODAY)).toEqual({ ok: false, error: "dateFuture" });
    expect(parseCancellationReport({ date: TODAY, note: "x".repeat(501) }, TODAY)).toEqual({ ok: false, error: "note" });
    expect(parseCancellationReport({ date: "2026-11-01", note: "  emailed support  " }, TODAY)).toEqual({
      ok: true,
      payload: { completedOn: "2026-11-01", note: "emailed support" },
    });
    expect(parseCancellationReport({ date: TODAY, note: "" }, TODAY)).toEqual({ ok: true, payload: { completedOn: TODAY, note: null } });
  });
  it("a failure needs a description", () => {
    expect(parseCancellationFailure("  ")).toEqual({ ok: false, error: "required" });
    expect(parseCancellationFailure("x".repeat(501))).toEqual({ ok: false, error: "tooLong" });
    expect(parseCancellationFailure(" CAPTCHA kept failing ")).toEqual({ ok: true, error: "CAPTCHA kept failing" });
  });
});

import { describe, it, expect } from "vitest";
import { summarizeOperations, type SyncRecord, type WebhookEvent } from "./billingOperations";

const NOW = new Date("2026-11-20T12:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const ev = (o: Partial<WebhookEvent> = {}): WebhookEvent => ({ type: "customer.subscription.updated", status: "processed", attempts: 1, lastError: null, receivedAt: h(1), claimedAt: h(1), processedAt: h(1), ...o });
const rec = (o: Partial<SyncRecord> = {}): SyncRecord => ({ member: "a@x.test", status: "active", cancelAtPeriodEnd: false, syncedAt: h(2), reconcileFailures: 0, lastOutcome: null, lastFailedAt: null, nextAttemptAt: null, ...o });
const run = (events: WebhookEvent[], records: SyncRecord[]) => summarizeOperations({ events, records, now: NOW });

describe("empty", () => {
  it("has zeros and no history flag", () => {
    const o = run([], []);
    expect(o.webhooks).toMatchObject({ recent: [], totalRecorded: 0, lastProcessedAt: null, last24h: { processed: 0, failed: 0, processing: 0 } });
    expect(o.reconciliation).toMatchObject({ tracked: 0, failing: 0, lastCheckAt: null, runHistoryAvailable: false });
    expect(o.backoff).toEqual([]);
    expect(o.unresolved).toEqual({ items: [], total: 0 });
  });
});

describe("webhooks", () => {
  it("counts the last 24 hours by status, newest first, and reports the last processed time", () => {
    const o = run([ev({ receivedAt: h(30), processedAt: h(30) }), ev({ receivedAt: h(2), processedAt: h(2) }), ev({ status: "failed", lastError: "handler_error", receivedAt: h(3), processedAt: null }), ev({ status: "processing", receivedAt: h(0.01), claimedAt: h(0.01), processedAt: null })], []);
    expect(o.webhooks.last24h).toEqual({ processed: 1, failed: 1, processing: 1 });
    expect(o.webhooks.recent.map((e) => e.receivedAt)).toEqual([h(0.01), h(2), h(3), h(30)]);
    expect(o.webhooks.lastProcessedAt).toBe(h(2));
    expect(o.webhooks.recent.find((e) => e.status === "failed")?.error).toBe("handler_error");
  });
  it("limits the recent list to 20", () => {
    expect(run(Array.from({ length: 30 }, (_, i) => ev({ receivedAt: h(i / 10) })), []).webhooks.recent).toHaveLength(20);
  });
  it("lists failed and stuck webhooks as unresolved, but not a fresh in-flight one", () => {
    const o = run([ev({ status: "failed", lastError: "handler_error", processedAt: null }), ev({ status: "processing", claimedAt: h(1), processedAt: null }), ev({ status: "processing", claimedAt: h(0.001), receivedAt: h(0.001), processedAt: null })], []);
    expect(o.unresolved.items.map((i) => i.kind).sort()).toEqual(["webhook_failed", "webhook_stuck"]);
  });
  it("never carries anything but type, status, attempts, short error and times", () => {
    expect(Object.keys(run([ev()], []).webhooks.recent[0]).sort()).toEqual(["attempts", "error", "processedAt", "receivedAt", "status", "type"]);
  });
});

describe("reconciliation health", () => {
  it("separates fresh, stale and never-synced records", () => {
    const o = run([], [rec({ syncedAt: h(2) }), rec({ syncedAt: h(30) }), rec({ syncedAt: h(60), member: "stale@x.test" }), rec({ syncedAt: null, member: "never@x.test", status: "incomplete" })]);
    expect(o.reconciliation).toMatchObject({ tracked: 4, freshWithin24h: 1, stale: 1, neverSynced: 1, lastCheckAt: h(2), oldestCheckAt: h(60) });
    const kinds = o.unresolved.items.map((i) => `${i.kind}:${i.subject}`);
    expect(kinds).toContain("stale_sync:stale@x.test");
    expect(kinds).toContain("never_synced:never@x.test");
  });
  it("counts failing records by outcome and puts the waiting ones first in the backoff list", () => {
    const o = run([], [
      rec({ member: "due@x.test", reconcileFailures: 2, lastOutcome: "stripe_error", lastFailedAt: h(5), nextAttemptAt: h(1) }),
      rec({ member: "wait@x.test", reconcileFailures: 1, lastOutcome: "missing", lastFailedAt: h(1), nextAttemptAt: h(-3) }),
      rec({ member: "ok@x.test" }),
    ]);
    expect(o.reconciliation).toMatchObject({ failing: 2, waitingInBackoff: 1, byOutcome: { missing: 1, stripe_error: 1, conflict: 0, ignored: 0 } });
    expect(o.backoff.map((b) => [b.member, b.waiting])).toEqual([["wait@x.test", true], ["due@x.test", false]]);
  });
  it("flags subscriptions needing attention (incomplete, unpaid, paused) as unresolved", () => {
    const o = run([], [rec({ status: "unpaid", member: "u@x.test" }), rec({ status: "paused", member: "p@x.test" }), rec({ status: "active" })]);
    expect(o.unresolved.items.filter((i) => i.kind === "status_other").map((i) => i.subject).sort()).toEqual(["p@x.test", "u@x.test"]);
  });
  it("caps the lists but reports the real unresolved total", () => {
    const o = run([], Array.from({ length: 40 }, (_, i) => rec({ member: `m${i}@x.test`, syncedAt: null })));
    expect(o.unresolved.items).toHaveLength(25);
    expect(o.unresolved.total).toBe(40);
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/billing/serverAuth", () => ({ authenticateUser: vi.fn(), readFeatureFlagsForUser: vi.fn() }));
vi.mock("@/lib/account/deletionStore", () => ({ createDeletionStore: vi.fn() }));

import { DeletionStepError, handleDeleteAccountRequest, parseDeleteBody, runAccountDeletion, shutDownBilling, type DeleteDeps, type DeletionStripe, type SessionLite, type SubLite } from "./deleteAccount";
import type { BillingRefs, DeletionBegin, DeletionFailure, DeletionState, DeletionStore } from "./deletionStore";

const ME = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const T0 = 1_800_000_000;
const ORIGIN = "https://standup-app-two.vercel.app";

type Sub = SubLite & { customer: string };
type Sess = SessionLite & { created: number };
type FailOn = Partial<Record<"cancel" | "expire" | "stripeList" | "storage" | "cleanup" | "auth" | "advance" | "begin" | "refs", boolean>>;

/** An in-memory Stripe + database + storage + auth model that records EVERY call in order, so ordering guarantees can be asserted. */
function world(init: { refs?: Partial<BillingRefs>; subs?: Sub[]; sessions?: Sess[]; state?: DeletionState | null; fail?: FailOn; entitlement?: boolean; files?: number } = {}) {
  const log: string[] = [];
  const fail: FailOn = { ...(init.fail ?? {}) };
  const subs = new Map<string, Sub>((init.subs ?? []).map((s) => [s.id, { ...s }]));
  const sessions = new Map<string, Sess>((init.sessions ?? []).map((s) => [s.id, { ...s }]));
  const cancels: { id: string; params: unknown; options: unknown }[] = [];
  const expired: string[] = [];
  const db = {
    state: init.state === undefined ? (null as DeletionState | null) : init.state,
    leased: false,
    failure: null as DeletionFailure | null,
    entitlement: init.entitlement ?? false,
    files: init.files ?? 0,
    authUsers: new Set([ME, OTHER]),
    advances: [] as string[],
  };
  const hooks: { afterListPass?: (n: number) => void } = {};
  let listPasses = 0;

  const store: DeletionStore = {
    async begin(userId): Promise<DeletionBegin> {
      log.push("db.begin");
      if (fail.begin) throw new Error("db down");
      if (!db.authUsers.has(userId)) return { result: "invalid" };
      if (db.leased) return { result: "busy" };
      db.leased = true; // (a lease is held until the run ends or fails)
      db.state = db.state ?? "pending";
      return { result: "acquired", state: db.state };
    },
    async advance(userId, state, failure) {
      log.push(`db.advance:${state}${failure ? ":" + failure : ""}`);
      if (fail.advance && !failure) throw new Error("db down");
      db.advances.push(`${state}:${failure ?? "ok"}`);
      const rank = { pending: 1, billing_cancelled: 2, data_cleaned: 3 };
      if (rank[state] >= rank[db.state ?? "pending"]) db.state = state;
      db.failure = failure;
      if (failure) db.leased = false;
      void userId;
    },
    async isPending() {
      return db.state !== null;
    },
    async billingRefs(userId) {
      log.push("db.billingRefs");
      if (fail.refs) throw new Error("db down");
      void userId;
      return { customerId: init.refs?.customerId ?? null, subscriptionId: init.refs?.subscriptionId ?? null, sessionIds: init.refs?.sessionIds ?? [] };
    },
    async cleanupData() {
      log.push("db.cleanupData");
      if (fail.cleanup) throw new Error("db down");
      db.entitlement = false;
    },
    async removeStorage() {
      log.push("storage.remove");
      if (fail.storage) throw new Error("storage down");
      db.files = 0;
    },
    async deleteAuthUser(userId) {
      log.push("auth.delete");
      if (fail.auth) throw new Error("auth down");
      db.authUsers.delete(userId);
    },
  };

  const stripe: DeletionStripe = {
    checkout: {
      sessions: {
        async list(p) {
          log.push("stripe.sessions.list" + (p.status ? ":open" : ""));
          if (fail.stripeList) throw Object.assign(new Error("stripe down sk_test_SECRET"), { type: "StripeConnectionError" });
          const all = [...sessions.values()].filter((s) => s.created >= p.created.gte && (!p.status || s.status === p.status)).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
          const start = p.starting_after ? all.findIndex((s) => s.id === p.starting_after) + 1 : 0;
          const page = all.slice(start, start + p.limit);
          return { data: page, has_more: start + p.limit < all.length };
        },
        async retrieve(id) {
          log.push("stripe.sessions.retrieve");
          const s = sessions.get(id);
          if (!s) throw Object.assign(new Error("No such session"), { code: "resource_missing", statusCode: 404 });
          return { ...s };
        },
        async expire(id) {
          log.push("stripe.sessions.expire");
          if (fail.expire) throw Object.assign(new Error("cannot expire"), { type: "StripeAPIError", statusCode: 500 });
          const s = sessions.get(id);
          if (s) s.status = "expired";
          expired.push(id);
        },
      },
    },
    subscriptions: {
      async list(p) {
        log.push("stripe.subscriptions.list");
        listPasses++;
        const data = [...subs.values()].filter((s) => s.customer === p.customer).map((s) => ({ id: s.id, status: s.status }));
        queueMicrotask(() => hooks.afterListPass?.(listPasses));
        return { data };
      },
      async retrieve(id) {
        log.push("stripe.subscriptions.retrieve");
        const s = subs.get(id);
        if (!s) throw Object.assign(new Error("No such subscription"), { code: "resource_missing", statusCode: 404 });
        return { id: s.id, status: s.status };
      },
      async cancel(id, params, options) {
        log.push("stripe.subscriptions.cancel");
        if (fail.cancel) throw Object.assign(new Error("stripe down cus_SECRET"), { type: "StripeAPIError", statusCode: 500 });
        cancels.push({ id, params, options });
        const s = subs.get(id);
        if (s) s.status = "canceled";
        return {};
      },
    },
  };
  return { log, store, stripe, db, subs, sessions, cancels, expired, hooks, fail, now: () => new Date(T0 * 1000) };
}
type W = ReturnType<typeof world>;
const sub = (id: string, status: string, customer = "cus_ME"): Sub => ({ id, status, customer });
const sess = (id: string, status: string, who: string | null = ME, extra: Partial<Sess> = {}): Sess => ({ id, status, client_reference_id: who, created: T0 - 3600, customer: null, subscription: null, ...extra });
const run = (w: W) => runAccountDeletion(ME, w.store, w.stripe, w.now);
/** The core guarantee: nothing irreversible (storage, data, login) happened before every Stripe operation and the billing advance. */
const authLast = (w: W, opts: { resumed?: boolean } = {}) => {
  const i = w.log.indexOf("auth.delete");
  if (i < 0) return;
  const stripeLast = Math.max(...w.log.map((l, n) => (l.startsWith("stripe.") ? n : -1)));
  expect(stripeLast, "a Stripe call came AFTER the login was deleted").toBeLessThan(i);
  if (opts.resumed) return; // a resumed run doesn't repeat steps that were durably recorded earlier
  expect(w.log.indexOf("db.advance:billing_cancelled")).toBeGreaterThan(-1);
  expect(w.log.indexOf("db.advance:billing_cancelled")).toBeLessThan(w.log.indexOf("storage.remove"));
  expect(w.log.indexOf("storage.remove")).toBeLessThan(i);
};

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const m of ["error", "info", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe("the sequence", () => {
  it("a Free account: begin, billing check (nothing to cancel), advance, storage, data, then the login — in that order", async () => {
    const w = world({ files: 3 });
    const r = await run(w);
    expect(r).toEqual({ kind: "deleted" });
    expect(w.cancels).toEqual([]);
    const marks = w.log.filter((l) => /^(db\.begin|db\.advance|storage\.remove|db\.cleanupData|auth\.delete)/.test(l));
    expect(marks).toEqual(["db.begin", "db.advance:billing_cancelled", "storage.remove", "db.cleanupData", "db.advance:data_cleaned", "auth.delete"]);
    expect(w.db.authUsers.has(ME)).toBe(false);
    expect(w.db.authUsers.has(OTHER)).toBe(true);
    expect(w.db.files).toBe(0);
    authLast(w);
  });

  it("active, trialing, past_due, unpaid, paused and incomplete subscriptions are each canceled IMMEDIATELY (no proration, no refund), idempotently, before the login goes", async () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
      const w = world({ refs: { customerId: "cus_ME", subscriptionId: "sub_1" }, subs: [sub("sub_1", status)] });
      expect(await run(w), status).toEqual({ kind: "deleted" });
      expect(w.cancels).toEqual([{ id: "sub_1", params: { prorate: false, invoice_now: false }, options: { idempotencyKey: "standup-delete-cancel-sub_1" } }]);
      expect(w.subs.get("sub_1")!.status).toBe("canceled");
      authLast(w);
    }
  });

  it("every subscription of the member's customer is canceled, including ones the billing record doesn't know", async () => {
    const w = world({ refs: { customerId: "cus_ME", subscriptionId: "sub_1" }, subs: [sub("sub_1", "active"), sub("sub_2", "past_due"), sub("sub_old", "canceled"), sub("sub_x", "active", "cus_OTHER")] });
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.cancels.map((c) => c.id).sort()).toEqual(["sub_1", "sub_2"]);
    expect(w.subs.get("sub_x")!.status).toBe("active"); // another customer's subscription is never touched
  });

  it("an already-canceled (or expired) subscription needs no cancellation", async () => {
    for (const status of ["canceled", "incomplete_expired"]) {
      const w = world({ refs: { customerId: "cus_ME", subscriptionId: "sub_1" }, subs: [sub("sub_1", status)] });
      expect(await run(w)).toEqual({ kind: "deleted" });
      expect(w.cancels).toEqual([]);
    }
  });

  it("a subscription ID Stripe no longer has can't charge anyone: deletion proceeds", async () => {
    const w = world({ refs: { subscriptionId: "sub_gone" } });
    expect(await run(w)).toEqual({ kind: "deleted" });
  });

  it("a manual Premium grant does not survive: the stored grant row is removed in the data step (and Premium ends with the account)", async () => {
    const w = world({ entitlement: true });
    expect(w.db.entitlement).toBe(true);
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.db.entitlement).toBe(false);
    expect(w.log).toContain("db.cleanupData");
  });

  it("shared data cleanup runs once, after billing, before the login", async () => {
    const w = world();
    await run(w);
    expect(w.log.filter((l) => l === "db.cleanupData")).toHaveLength(1);
    expect(w.log.indexOf("db.cleanupData")).toBeGreaterThan(w.log.indexOf("db.advance:billing_cancelled"));
    expect(w.log.indexOf("db.cleanupData")).toBeLessThan(w.log.indexOf("auth.delete"));
  });
});

describe("Checkout sessions", () => {
  it("open sessions the app recorded are expired", async () => {
    const w = world({ refs: { sessionIds: ["cs_rec"] }, sessions: [sess("cs_rec", "open")] });
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.expired).toEqual(["cs_rec"]);
    expect(w.sessions.get("cs_rec")!.status).toBe("expired");
  });

  it("open sessions NOT recorded locally are found in Stripe by client_reference_id and expired; other members' sessions are left alone", async () => {
    const w = world({ sessions: [sess("cs_unrec", "open", ME), sess("cs_other", "open", OTHER), sess("cs_anon", "open", null)] });
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.expired).toEqual(["cs_unrec"]);
    expect(w.sessions.get("cs_other")!.status).toBe("open");
    expect(w.sessions.get("cs_anon")!.status).toBe("open");
  });

  it("the Stripe scan looks back 26 hours (a session lives at most 24) and pages through all results", async () => {
    const many = Array.from({ length: 130 }, (_, i) => sess(`cs_o${i}`, "open", OTHER, { created: T0 - 60 - i }));
    const w = world({ sessions: [...many, sess("cs_mine", "open", ME, { created: T0 - 70_000 }), sess("cs_tooold", "open", ME, { created: T0 - 27 * 3600 })] });
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.expired).toEqual(["cs_mine"]); // found on page 2; the 27-hour-old one is already dead by Stripe's own rule
    expect(w.log.filter((l) => l === "stripe.sessions.list").length).toBeGreaterThanOrEqual(2);
  });

  it("a session that was already PAID (complete) but whose billing record never arrived: its subscription is found through the session and canceled", async () => {
    const w = world({ sessions: [sess("cs_paid", "complete", ME, { customer: "cus_NEW", subscription: "sub_NEW" })], subs: [sub("sub_NEW", "active", "cus_NEW")] });
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.cancels.map((c) => c.id)).toEqual(["sub_NEW"]);
  });

  it("an open session that gets PAID between the scan and the expire call: the expire is refused, the session is re-read as complete, and its subscription is canceled", async () => {
    const w = world({ sessions: [sess("cs_race", "open", ME)] });
    w.subs.set("sub_PAID", sub("sub_PAID", "active", "cus_PAID"));
    w.stripe.checkout.sessions.expire = async (id) => {
      w.log.push("stripe.sessions.expire");
      Object.assign(w.sessions.get(id)!, { status: "complete", customer: "cus_PAID", subscription: "sub_PAID" }); // payment landed first
      throw Object.assign(new Error("Only open sessions can be expired"), { statusCode: 400 });
    };
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.cancels.map((c) => c.id)).toEqual(["sub_PAID"]);
    expect(w.subs.get("sub_PAID")!.status).toBe("canceled");
    authLast(w);
  });

  it("a subscription created during the sweep is canceled by the following pass; the sweep only finishes when a full pass finds nothing", async () => {
    const w = world({ refs: { customerId: "cus_ME" }, subs: [sub("sub_1", "active")] });
    w.hooks.afterListPass = (n) => {
      if (n === 1) w.subs.set("sub_2", sub("sub_2", "active"));
    };
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.cancels.map((c) => c.id).sort()).toEqual(["sub_1", "sub_2"]);
    const lastPassCancels = w.log.slice(w.log.lastIndexOf("stripe.subscriptions.list"));
    expect(lastPassCancels).not.toContain("stripe.subscriptions.cancel"); // the final pass was a clean verification
  });

  it("Stripe that never settles (new live subscriptions keep appearing) fails closed: the login is NOT deleted", async () => {
    const w = world({ refs: { customerId: "cus_ME" }, subs: [sub("sub_0", "active")] });
    let n = 0;
    w.hooks.afterListPass = () => void w.subs.set(`sub_n${++n}`, sub(`sub_n${n}`, "active"));
    const r = await run(w);
    expect(r).toMatchObject({ kind: "incomplete", failure: "billing" });
    expect(w.log).not.toContain("auth.delete");
    expect(w.log).not.toContain("storage.remove");
  });
});

describe("failures never delete the login", () => {
  it("Stripe cancellation failure: nothing else happens, the state is recorded for a retry, and the response category is 'billing'", async () => {
    const w = world({ refs: { customerId: "cus_ME", subscriptionId: "sub_1" }, subs: [sub("sub_1", "active")], fail: { cancel: true } });
    const r = await run(w);
    expect(r).toEqual({ kind: "incomplete", failure: "billing", state: "pending" });
    expect(w.log).not.toContain("auth.delete");
    expect(w.log).not.toContain("storage.remove");
    expect(w.log).not.toContain("db.cleanupData");
    expect(w.db.authUsers.has(ME)).toBe(true);
    expect(w.db.state).toBe("pending"); // still deletion-pending: Checkout stays refused, no automatic restore
    expect(w.db.failure).toBe("billing");
    expect(w.db.leased).toBe(false); // released so the member can retry at once
    expect(JSON.stringify(logs)).not.toMatch(/sk_test|cus_SECRET|cus_ME|sub_1/);
  });

  it("a Stripe cancel error that still ended the subscription (a race) is not a failure", async () => {
    const w = world({ refs: { subscriptionId: "sub_1" }, subs: [sub("sub_1", "active")] });
    const real = w.stripe.subscriptions.cancel;
    w.stripe.subscriptions.cancel = async (id, p, o) => {
      await real(id, p, o);
      throw Object.assign(new Error("already canceled"), { statusCode: 400 });
    };
    expect(await run(w)).toEqual({ kind: "deleted" });
  });

  it("Checkout expiration failure while the session is still open: nothing is deleted", async () => {
    const w = world({ sessions: [sess("cs_1", "open")], fail: { expire: true } });
    expect(await run(w)).toMatchObject({ kind: "incomplete", failure: "billing" });
    expect(w.log).not.toContain("auth.delete");
    expect(w.db.authUsers.has(ME)).toBe(true);
  });

  it("an expire error for a session that is no longer open (expired or completed in the meantime) is not a failure", async () => {
    const w = world({ sessions: [sess("cs_1", "open")] });
    w.stripe.checkout.sessions.expire = async (id) => {
      w.sessions.get(id)!.status = "expired";
      throw Object.assign(new Error("already expired"), { statusCode: 400 });
    };
    expect(await run(w)).toEqual({ kind: "deleted" });
  });

  it("Stripe unreachable for the scan: nothing is deleted", async () => {
    const w = world({ fail: { stripeList: true } });
    expect(await run(w)).toMatchObject({ kind: "incomplete", failure: "billing" });
    expect(w.log).not.toContain("auth.delete");
    expect(JSON.stringify(logs)).not.toContain("sk_test_SECRET");
  });

  it("a database failure reading the billing references: nothing is deleted", async () => {
    const w = world({ fail: { refs: true } });
    expect(await run(w)).toMatchObject({ kind: "incomplete", failure: "billing" });
    expect(w.log).not.toContain("auth.delete");
  });

  it("storage cleanup failure: billing is already settled (recorded), the login is NOT deleted, and the retry resumes after billing", async () => {
    const w = world({ fail: { storage: true } });
    expect(await run(w)).toEqual({ kind: "incomplete", failure: "storage", state: "billing_cancelled" });
    expect(w.log).not.toContain("auth.delete");
    expect(w.db.state).toBe("billing_cancelled");
    expect(w.db.authUsers.has(ME)).toBe(true);
  });

  it("data cleanup failure: the login is NOT deleted, category 'data'", async () => {
    const w = world({ fail: { cleanup: true } });
    expect(await run(w)).toEqual({ kind: "incomplete", failure: "data", state: "billing_cancelled" });
    expect(w.log).not.toContain("auth.delete");
  });

  it("failing to record the billing step: the login is NOT deleted and nothing after billing runs", async () => {
    const w = world({ fail: { advance: true } });
    expect(await run(w)).toMatchObject({ kind: "incomplete", failure: "unexpected" });
    expect(w.log).not.toContain("auth.delete");
    expect(w.log).not.toContain("storage.remove");
  });

  it("login deletion failure: everything before it is done and recorded (data_cleaned), so a retry only repeats the last step", async () => {
    const w = world({ fail: { auth: true } });
    expect(await run(w)).toEqual({ kind: "incomplete", failure: "auth", state: "data_cleaned" });
    expect(w.db.state).toBe("data_cleaned");
    expect(w.db.authUsers.has(ME)).toBe(true);
  });

  it("an unknown account (already deleted) is reported as gone and nothing is called", async () => {
    const w = world();
    w.db.authUsers.delete(ME);
    expect(await run(w)).toEqual({ kind: "gone" });
    expect(w.log).toEqual(["db.begin"]);
  });

  it("a database failure before the deletion even starts surfaces as an error to the caller (the handler answers 'unavailable'), changing nothing", async () => {
    const w = world({ fail: { begin: true } });
    await expect(run(w)).rejects.toThrow();
    expect(w.log).toEqual(["db.begin"]);
  });
});

describe("retry, resume and duplicates", () => {
  it("a retry after a storage failure re-verifies Stripe FIRST, then resumes at storage, and finishes (no duplicate cancellation)", async () => {
    const w = world({ refs: { subscriptionId: "sub_1", customerId: "cus_ME" }, subs: [sub("sub_1", "active")], fail: { storage: true } });
    expect(await run(w)).toMatchObject({ kind: "incomplete", failure: "storage" });
    expect(w.cancels).toHaveLength(1);
    w.fail.storage = false;
    w.log.length = 0;
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.cancels).toHaveLength(1); // not canceled twice
    expect(w.log.indexOf("stripe.sessions.list")).toBeLessThan(w.log.indexOf("storage.remove")); // Stripe was re-read before the retry resumed
    expect(w.log).not.toContain("db.advance:billing_cancelled"); // already recorded: not re-recorded
    authLast(w, { resumed: true });
  });

  it("a retry after a login-deletion failure re-checks billing and then only deletes the login", async () => {
    const w = world({ fail: { auth: true } });
    await run(w);
    w.fail.auth = false;
    w.log.length = 0;
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.log).not.toContain("storage.remove");
    expect(w.log).not.toContain("db.cleanupData");
    expect(w.log.at(-1)).toBe("auth.delete");
    authLast(w, { resumed: true });
  });

  it("a retry after a billing failure starts from the beginning and succeeds once Stripe answers", async () => {
    const w = world({ refs: { subscriptionId: "sub_1" }, subs: [sub("sub_1", "active")], fail: { cancel: true } });
    expect(await run(w)).toMatchObject({ failure: "billing" });
    w.fail.cancel = false;
    expect(await run(w)).toEqual({ kind: "deleted" });
    expect(w.subs.get("sub_1")!.status).toBe("canceled");
  });

  it("a duplicate request while the first holds the lease is turned away ('busy') without touching Stripe or any data", async () => {
    const w = world();
    w.db.leased = true;
    const r = await run(w);
    expect(r).toEqual({ kind: "busy" });
    expect(w.log).toEqual(["db.begin"]);
  });

  it("two simultaneous requests: exactly one runs the deletion, the other is told it is in progress", async () => {
    const w = world({ refs: { subscriptionId: "sub_1" }, subs: [sub("sub_1", "active")] });
    const [a, b] = await Promise.all([run(w), run(w)]);
    expect([a.kind, b.kind].sort()).toEqual(["busy", "deleted"]);
    expect(w.cancels).toHaveLength(1);
    expect(w.log.filter((l) => l === "auth.delete")).toHaveLength(1);
  });

  it("a request after the deletion completed (the login is gone) finds nothing to do", async () => {
    const w = world();
    await run(w);
    w.db.leased = false;
    w.log.length = 0;
    expect(await run(w)).toEqual({ kind: "gone" });
  });
});

describe("shutDownBilling in isolation", () => {
  it("returns only after a complete pass found nothing left, and reports only the 'billing' category on failure", async () => {
    const w = world({ refs: { customerId: "cus_ME" }, subs: [sub("sub_1", "active")] });
    await expect(shutDownBilling(ME, w.store, w.stripe, w.now)).resolves.toBeUndefined();
    const w2 = world({ refs: { customerId: "cus_ME" }, subs: [sub("sub_1", "active")], fail: { cancel: true } });
    await expect(shutDownBilling(ME, w2.store, w2.stripe, w2.now)).rejects.toBeInstanceOf(DeletionStepError);
    await expect(shutDownBilling(ME, w2.store, w2.stripe, w2.now)).rejects.toMatchObject({ category: "billing" });
  });

  it("never refunds, never deletes a Stripe customer, never touches payment objects: the Stripe surface it is given has no such operations", () => {
    const w = world();
    expect(Object.keys(w.stripe).sort()).toEqual(["checkout", "subscriptions"]);
    expect(Object.keys(w.stripe.subscriptions).sort()).toEqual(["cancel", "list", "retrieve"]);
    expect(Object.keys(w.stripe.checkout.sessions).sort()).toEqual(["expire", "list", "retrieve"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
describe("POST /api/account/delete (authorization, validation, answers)", () => {
  const req = (o: { body?: string; origin?: string | null; auth?: string | null } = {}) =>
    new Request(`${ORIGIN}/api/account/delete`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }), ...(o.auth === null ? {} : { authorization: o.auth ?? "Bearer good-token" }) },
      body: o.body ?? JSON.stringify({ confirm: "DELETE" }),
    });
  const mk = (w: W, over: Partial<DeleteDeps> = {}): DeleteDeps => ({
    env: { NODE_ENV: "production" },
    authenticate: vi.fn(async (t: string) => (t === "good-token" ? { id: ME } : t === "other-token" ? { id: OTHER } : null)),
    store: () => w.store,
    stripe: () => w.stripe,
    now: w.now,
    ...over,
  });

  it("a verified member with the confirmation: deleted (200), only THEIR account", async () => {
    const w = world();
    const res = await handleDeleteAccountRequest(req(), mk(w));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "deleted" });
    expect(w.db.authUsers.has(ME)).toBe(false);
    expect(w.db.authUsers.has(OTHER)).toBe(true);
  });

  it("the account comes from the session, never the body: another member's token deletes only that member", async () => {
    const w = world();
    expect((await handleDeleteAccountRequest(req({ auth: "Bearer other-token" }), mk(w))).status).toBe(200);
    expect(w.db.authUsers.has(OTHER)).toBe(false);
    expect(w.db.authUsers.has(ME)).toBe(true);
  });

  it("no sign-in, a bad token, a malformed header: 401 and nothing runs", async () => {
    for (const auth of [null, "", "Bearer", "Bearer bad", "Basic abc", "good-token"]) {
      const w = world();
      const res = await handleDeleteAccountRequest(req({ auth }), mk(w));
      expect(res.status, String(auth)).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
      expect(w.log).toEqual([]);
    }
  });

  it("an untrusted, missing or look-alike Origin: 403 and nothing runs", async () => {
    for (const origin of ["https://evil.example", "https://standup-app-two.vercel.app.evil.example", "http://standup-app-two.vercel.app", "null", null]) {
      const w = world();
      const res = await handleDeleteAccountRequest(req({ origin }), mk(w));
      expect(res.status, String(origin)).toBe(403);
      expect(w.log).toEqual([]);
    }
  });

  it("the body must be exactly the confirmation: any account, customer, subscription or other field, or a missing/wrong confirmation, is 400 and nothing runs", async () => {
    const bad = [
      { user_id: OTHER },
      { confirm: "DELETE", user_id: OTHER },
      { confirm: "DELETE", customer: "cus_x" },
      { confirm: "DELETE", subscription: "sub_x" },
      { confirm: "delete" },
      { confirm: true },
      { confirm: "DELETE " },
      {},
      [],
      "DELETE",
    ];
    for (const b of bad) {
      const w = world();
      const res = await handleDeleteAccountRequest(req({ body: JSON.stringify(b) }), mk(w));
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(w.log).toEqual([]);
    }
    for (const raw of ["", "not json", "x".repeat(100)]) expect((await handleDeleteAccountRequest(req({ body: raw }), mk(world()))).status).toBe(400);
    expect(parseDeleteBody('{"confirm":"DELETE"}')).toBe(true);
    expect(parseDeleteBody('{"confirm":"DELETE","x":1}')).toBe(false);
  });

  it("a Stripe failure is 502 billing_failed with retryable:true, and the account still exists", async () => {
    const w = world({ refs: { subscriptionId: "sub_1" }, subs: [sub("sub_1", "active")], fail: { cancel: true } });
    const res = await handleDeleteAccountRequest(req(), mk(w));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "billing_failed", retryable: true });
    expect(w.db.authUsers.has(ME)).toBe(true);
  });

  it("a storage/data/login failure after billing is 502 cleanup_failed with retryable:true", async () => {
    for (const fail of [{ storage: true }, { cleanup: true }, { auth: true }] as FailOn[]) {
      const w = world({ fail });
      const res = await handleDeleteAccountRequest(req(), mk(w));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "cleanup_failed", retryable: true });
      expect(w.db.authUsers.has(ME)).toBe(true);
    }
  });

  it("a duplicate request is 409 deletion_in_progress", async () => {
    const w = world();
    w.db.leased = true;
    const res = await handleDeleteAccountRequest(req(), mk(w));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "deletion_in_progress", retryable: true });
  });

  it("without the durable store, Stripe, or the database: 503 unavailable and nothing is touched", async () => {
    const w = world();
    const a = await handleDeleteAccountRequest(req(), mk(w, { store: () => { throw new Error("missing env"); } }));
    const b = await handleDeleteAccountRequest(req(), mk(w, { stripe: () => { throw new Error("bad stripe config"); } }));
    const c = await handleDeleteAccountRequest(req(), mk(world({ fail: { begin: true } })));
    for (const r of [a, b, c]) {
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: "unavailable" });
    }
    expect(w.db.authUsers.has(ME)).toBe(true);
  });

  it("an unknown (already deleted) account is 401, not an error leak", async () => {
    const w = world();
    w.db.authUsers.delete(ME);
    expect((await handleDeleteAccountRequest(req(), mk(w))).status).toBe(401);
  });

  it("logs carry categories and outcomes only: never an account, customer, subscription or key", async () => {
    const w = world({ refs: { customerId: "cus_ME", subscriptionId: "sub_1" }, subs: [sub("sub_1", "active")], fail: { cancel: true } });
    await handleDeleteAccountRequest(req(), mk(w));
    const text = JSON.stringify(logs);
    for (const s of [ME, "cus_ME", "sub_1", "sk_test", "good-token", "cus_SECRET"]) expect(text, s).not.toContain(s);
    expect(logs.some((l) => l[0] === "account deletion incomplete" && JSON.stringify(l[1]) === JSON.stringify({ failure: "billing", state: "pending" }))).toBe(true);
  });
});

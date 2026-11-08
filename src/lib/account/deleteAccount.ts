import "server-only";
import { resolveTrustedOrigin } from "@/lib/billing/origins";
import { authenticateUser } from "@/lib/billing/serverAuth";
import { getStripe } from "@/lib/billing/stripe";
import { blocksNewCheckout } from "@/lib/billing/subscriptionStates";
import { createDeletionStore, type DeletionFailure, type DeletionState, type DeletionStore } from "@/lib/account/deletionStore";

// POST /api/account/delete: delete the signed-in member's account safely (Phase 5.7 step 2).
//
// Request:  { "confirm": "DELETE" }   with   Authorization: Bearer <Supabase access token>   and a trusted Origin header.
// Response: 200 { "status": "deleted" }   or   { "error": <code> } with 400/401/403/409/502/503. Nothing else is accepted: no account, customer or
//           subscription ID can be named; the account is the one the verified sign-in proves.
//
// THE SEQUENCE (durable and resumable: the state lives in the database, public.account_deletions, with a 3-minute lease):
//   1. begin: mark the account deletion-pending. From this moment Checkout and free-trial activation refuse for it, and a second request is
//      turned away while this one holds the lease ("busy"). The trial marker (keyed, non-reversible) is recorded in the same step.
//   2. billing: find and expire every open Checkout session of the member (the ones this app recorded AND the ones found by scanning Stripe for the
//      member's client_reference_id), then cancel EVERY live subscription immediately (no proration, no automatic refund; the Stripe customer and its
//      payment records are kept). The sweep repeats until a whole pass finds nothing left to do: that last pass IS the verification that Stripe holds
//      nothing that could charge again. Any Stripe failure stops here and nothing further happens.
//   3. advance to billing_cancelled.
//   4. data: remove the member's Storage objects (all four user buckets, verified empty), hand shared team goals to another participant, clear
//      references that would block the Auth deletion, remove any stored Premium grant/trial row. Advance to data_cleaned.
//   5. delete the Supabase Auth user. Every other personal row goes with it by the existing ON DELETE CASCADE keys; the deletion state goes too.
// The Auth user is deleted ONLY in step 5, which is reached only after step 3 was durably recorded in this same run. A retry resumes at the recorded
// state but re-runs the (idempotent) billing sweep first, so the irreversible step never relies on an old check. After a failure nothing is
// automatically undone: the account stays deletion-pending (Checkout stays refused) until a retry completes it.

export type DeletionStripe = {
  checkout: {
    sessions: {
      list(params: { limit: number; created: { gte: number }; starting_after?: string; status?: "open" }): Promise<{ data: SessionLite[]; has_more: boolean }>;
      retrieve(id: string): Promise<SessionLite>;
      expire(id: string): Promise<unknown>;
    };
  };
  subscriptions: {
    list(params: { customer: string; status: "all"; limit: number }): Promise<{ data: SubLite[] }>;
    retrieve(id: string): Promise<SubLite>;
    cancel(id: string, params: { prorate: false; invoice_now: false }, options: { idempotencyKey: string }): Promise<unknown>;
  };
};
type Ref = string | { id: string } | null | undefined;
export type SessionLite = { id: string; status: string | null; client_reference_id: string | null; customer?: Ref; subscription?: Ref };
export type SubLite = { id: string; status: string };

export type DeleteDeps = {
  env: Readonly<Record<string, string | undefined>>;
  authenticate(accessToken: string): Promise<{ id: string } | null>;
  store(): DeletionStore;
  stripe(): DeletionStripe;
  now(): Date;
};

const realDeps = (): DeleteDeps => ({
  env: process.env,
  authenticate: authenticateUser,
  store: () => createDeletionStore(),
  stripe: () => getStripe() as unknown as DeletionStripe,
  now: () => new Date(),
});

/** A step failed. `category` is the only thing ever logged or returned about it (messages can carry identifiers or keys). */
export class DeletionStepError extends Error {
  constructor(readonly category: DeletionFailure) {
    super("account deletion step failed: " + category);
    this.name = "DeletionStepError";
  }
}

const idOf = (r: Ref): string | null => (typeof r === "string" && r ? r : r && typeof r === "object" && typeof r.id === "string" ? r.id : null);
const isNotFound = (e: unknown): boolean => {
  const err = e as { code?: string; statusCode?: number } | null;
  return err?.code === "resource_missing" || err?.statusCode === 404;
};
const SESSION_WINDOW_SECONDS = 26 * 3600; // a Checkout session lives at most 24 hours
const SESSION_PAGES = 10;
const MAX_PASSES = 4;

async function scanSessions(stripe: DeletionStripe, userId: string, nowS: number, open?: boolean): Promise<SessionLite[]> {
  const found: SessionLite[] = [];
  let after: string | undefined;
  for (let page = 0; page < SESSION_PAGES; page++) {
    const res = await stripe.checkout.sessions.list({ limit: 100, created: { gte: nowS - SESSION_WINDOW_SECONDS }, ...(after ? { starting_after: after } : {}), ...(open ? { status: "open" as const } : {}) });
    for (const s of res.data) if (s.client_reference_id === userId) found.push(s);
    if (!res.has_more || res.data.length === 0) break;
    after = res.data[res.data.length - 1].id;
  }
  return found;
}

/**
 * Make sure Stripe holds nothing that can charge this member again. Returns normally only when a complete pass found nothing left to do.
 * Throws DeletionStepError("billing") on any Stripe failure or if the state won't settle.
 */
export async function shutDownBilling(userId: string, store: DeletionStore, stripe: DeletionStripe, now: () => Date): Promise<void> {
  try {
    const refs = await store.billingRefs(userId);
    const customers = new Set<string>(refs.customerId ? [refs.customerId] : []);
    const subs = new Set<string>(refs.subscriptionId ? [refs.subscriptionId] : []);
    const sessionIds = new Set<string>(refs.sessionIds);

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let actions = 0;
      const nowS = Math.floor(now().getTime() / 1000);

      // 1. Checkout sessions: the ones we recorded plus everything Stripe knows with this member's client_reference_id
      for (const s of await scanSessions(stripe, userId, nowS)) sessionIds.add(s.id);
      for (const id of sessionIds) {
        let s: SessionLite;
        try {
          s = await stripe.checkout.sessions.retrieve(id);
        } catch (e) {
          if (isNotFound(e)) continue;
          throw e;
        }
        if (s.client_reference_id !== null && s.client_reference_id !== userId) continue; // never touch anything that isn't this member's
        if (s.status === "open") {
          try {
            await stripe.checkout.sessions.expire(id);
          } catch (e) {
            if ((await stripe.checkout.sessions.retrieve(id)).status === "open") throw e; // lost a race to an expiry/completion: fine; still open: failure
          }
          actions++;
          s = await stripe.checkout.sessions.retrieve(id);
        }
        const c = idOf(s.customer);
        const sub = idOf(s.subscription);
        if (c) customers.add(c);
        if (sub) subs.add(sub);
      }

      // 2. subscriptions of the member's customers and the ones named directly
      const live = new Map<string, string>(); // id -> status
      for (const c of customers) for (const s of (await stripe.subscriptions.list({ customer: c, status: "all", limit: 100 })).data) subs.add(s.id);
      for (const id of subs) {
        try {
          live.set(id, (await stripe.subscriptions.retrieve(id)).status);
        } catch (e) {
          if (!isNotFound(e)) throw e; // a subscription Stripe doesn't have can't charge
        }
      }

      // 3. cancel everything that could still charge (immediately; no proration; no refund)
      for (const [id, status] of live) {
        if (!blocksNewCheckout(status)) continue;
        try {
          await stripe.subscriptions.cancel(id, { prorate: false, invoice_now: false }, { idempotencyKey: "standup-delete-cancel-" + id });
        } catch (e) {
          const after = await stripe.subscriptions.retrieve(id).catch(() => null);
          if (after && blocksNewCheckout(after.status)) throw e; // still live: failure
        }
        actions++;
      }

      if (actions === 0) return; // a full pass found nothing to expire or cancel: Stripe is settled
    }
    throw new Error("billing state did not settle");
  } catch (e) {
    if (e instanceof DeletionStepError) throw e;
    const err = e as { type?: string; code?: string; statusCode?: number } | null;
    console.error("account deletion: billing step failed", { type: err?.type, code: err?.code, status: err?.statusCode }); // kind only
    throw new DeletionStepError("billing");
  }
}

export type DeletionResult = { kind: "deleted" } | { kind: "busy" } | { kind: "gone" } | { kind: "incomplete"; failure: DeletionFailure; state: DeletionState };

async function step<T>(category: DeletionFailure, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof DeletionStepError ? e : new DeletionStepError(category);
  }
}

/** Run (or resume) the deletion for an account the caller has already verified. */
export async function runAccountDeletion(userId: string, store: DeletionStore, stripe: DeletionStripe, now: () => Date): Promise<DeletionResult> {
  const begun = await store.begin(userId);
  if (begun.result === "busy") return { kind: "busy" };
  if (begun.result === "invalid") return { kind: "gone" };
  let state: DeletionState = begun.state;
  try {
    // billing is (re-)verified on EVERY run, before anything irreversible, whatever the recorded state says
    await shutDownBilling(userId, store, stripe, now);
    if (state === "pending") {
      await step("unexpected", () => store.advance(userId, "billing_cancelled", null));
      state = "billing_cancelled";
    }
    if (state === "billing_cancelled") {
      await step("storage", () => store.removeStorage(userId));
      await step("data", () => store.cleanupData(userId));
      await step("unexpected", () => store.advance(userId, "data_cleaned", null));
      state = "data_cleaned";
    }
    await step("auth", () => store.deleteAuthUser(userId)); // the only irreversible step: reached only after the billing sweep above
    return { kind: "deleted" };
  } catch (e) {
    const failure = e instanceof DeletionStepError ? e.category : "unexpected";
    await store.advance(userId, state, failure).catch(() => undefined); // release the lease and record the category; a failure here only delays the retry
    return { kind: "incomplete", failure, state };
  }
}

export type DeleteError = "forbidden_origin" | "unauthenticated" | "invalid_request" | "deletion_in_progress" | "billing_failed" | "cleanup_failed" | "unavailable";
const STATUS: Record<DeleteError, number> = { forbidden_origin: 403, unauthenticated: 401, invalid_request: 400, deletion_in_progress: 409, billing_failed: 502, cleanup_failed: 502, unavailable: 503 };
const respond = (body: Record<string, unknown>, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (error: DeleteError, extra: Record<string, unknown> = {}) => respond({ error, ...extra }, STATUS[error]);

/** The body must be exactly { "confirm": "DELETE" }; anything else (an account, customer, subscription, URL…) is refused. */
export function parseDeleteBody(text: string): boolean {
  if (text.length === 0 || text.length > 64) return false;
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const keys = Object.keys(body);
    return keys.length === 1 && keys[0] === "confirm" && (body as { confirm?: unknown }).confirm === "DELETE";
  } catch {
    return false;
  }
}

const bearer = (header: string | null): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
};

export async function handleDeleteAccountRequest(req: Request, deps: DeleteDeps = realDeps()): Promise<Response> {
  if (!resolveTrustedOrigin(req.headers.get("origin"), deps.env)) return fail("forbidden_origin");

  const token = bearer(req.headers.get("authorization"));
  if (!token) return fail("unauthenticated");
  const user = await deps.authenticate(token).catch(() => null);
  if (!user) return fail("unauthenticated");

  if (!parseDeleteBody(await req.text().catch(() => ""))) return fail("invalid_request");

  let store: DeletionStore;
  let stripe: DeletionStripe;
  try {
    store = deps.store();
    stripe = deps.stripe();
  } catch {
    return fail("unavailable"); // without the durable state or Stripe there is no safe deletion: nothing is touched
  }

  let result: DeletionResult;
  try {
    result = await runAccountDeletion(user.id, store, stripe, deps.now);
  } catch {
    return fail("unavailable"); // could not even start (database unreachable): nothing was changed
  }

  if (result.kind === "deleted") {
    console.info("account deletion", { outcome: "deleted" });
    return respond({ status: "deleted" }, 200);
  }
  if (result.kind === "busy") return fail("deletion_in_progress", { retryable: true });
  if (result.kind === "gone") return fail("unauthenticated");
  console.error("account deletion incomplete", { failure: result.failure, state: result.state }); // categories only
  return fail(result.failure === "billing" ? "billing_failed" : "cleanup_failed", { retryable: true });
}

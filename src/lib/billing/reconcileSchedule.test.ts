// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/billing/reconcileStore", () => ({ createReconcileStore: vi.fn() }));
vi.mock("@/lib/billing/webhookStore", () => ({ createWebhookStore: vi.fn() }));

import { CRON_SECRET_ENV, DEFAULT_BUDGET_MS, DEFAULT_LIMIT, MAX_LIMIT, RECONCILE_SECRET_ENV, failureCategory, handleReconcileRequest, type ReconcileRouteDeps, type ReconcileSummary } from "./reconcile";

const RECON = "reconcile-secret-0123456789-abcdefghijklmnop";
const CRON = "cron-secret-9876543210-zyxwvutsrqponmlkjihgfe";
const summary = (o: Partial<ReconcileSummary> = {}): ReconcileSummary => ({ examined: 3, outcomes: { changed: 1, unchanged: 2, stale: 0, missing: 0, conflict: 0, ignored: 0, stripe_error: 0, store_error: 0 }, moreDue: false, backedOff: 0, aborted: false, ...o });
const URL_ = "https://standup-app-two.vercel.app/api/billing/reconcile";

function mk(env: Record<string, string | undefined> = { [RECONCILE_SECRET_ENV]: RECON, [CRON_SECRET_ENV]: CRON }, run?: ReconcileRouteDeps["run"]) {
  const fn = vi.fn(run ?? (async () => summary()));
  return { run: fn, deps: { env, run: fn } as ReconcileRouteDeps };
}
const cronReq = (init: { auth?: string | null; origin?: string; query?: string; ua?: string } = {}) => {
  const headers: Record<string, string> = { "user-agent": init.ua ?? "vercel-cron/1.0" };
  if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${CRON}`;
  if (init.origin) headers.origin = init.origin;
  return new Request(URL_ + (init.query ?? ""), { method: "GET", headers });
};
const postReq = (auth: string | null = `Bearer ${RECON}`, body?: string) => new Request(URL_, { method: "POST", headers: auth ? { authorization: auth } : {}, body });

let logs: { level: string; args: unknown[] }[];
beforeEach(() => {
  logs = [];
  for (const level of ["error", "info", "log", "warn"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push({ level, args }));
});
afterEach(() => vi.restoreAllMocks());
const logText = () => JSON.stringify(logs);

describe("the schedule itself (vercel.json)", () => {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[] };

  it("is exactly one daily cron job that calls the reconcile endpoint, with no query string and nothing secret in the file", () => {
    expect(Object.keys(cfg)).toEqual(["crons"]);
    expect(cfg.crons).toHaveLength(1);
    expect(cfg.crons![0].path).toBe("/api/billing/reconcile");
    expect(readFileSync(join(process.cwd(), "vercel.json"), "utf8")).not.toMatch(/secret|token|bearer|key|\?/i);
  });

  it("runs once a day (a fixed minute and hour, every day/month/weekday): the cadence Vercel's Hobby plan allows", () => {
    const f = cfg.crons![0].schedule.split(" ");
    expect(f).toHaveLength(5);
    expect(f[0]).toMatch(/^\d{1,2}$/); // minute
    expect(f[1]).toMatch(/^\d{1,2}$/); // hour
    expect(f.slice(2)).toEqual(["*", "*", "*"]);
    expect(Number(f[0])).toBeLessThan(60);
    expect(Number(f[1])).toBeLessThan(24);
  });

  it("the route allows a run to use its whole 20 s budget plus headroom, and nothing like a body or limit is configured for the scheduled call", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/billing/reconcile/route.ts"), "utf8");
    const max = Number(/export const maxDuration = (\d+);/.exec(route)?.[1]);
    expect(max).toBeGreaterThan(DEFAULT_BUDGET_MS / 1000);
    expect(max).toBeLessThanOrEqual(60); // within what the Hobby plan permits
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
    expect(route).toMatch(/export async function GET/);
  });

  it("the bounds are unchanged: 10 records by default, 25 at most, a 20 second budget", () => {
    expect([DEFAULT_LIMIT, MAX_LIMIT, DEFAULT_BUDGET_MS]).toEqual([10, 25, 20_000]);
  });
});

describe("authorization of the scheduled (GET) call", () => {
  it("Vercel Cron's request, carrying CRON_SECRET as its Bearer token, runs once with the default bound", async () => {
    const { run, deps } = mk();
    const res = await handleReconcileRequest(cronReq(), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(summary());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({}); // no limit passed: the 10-record default applies
  });

  it("works with only CRON_SECRET configured, and with only BILLING_RECONCILE_SECRET configured", async () => {
    for (const [env, token] of [[{ [CRON_SECRET_ENV]: CRON }, CRON], [{ [RECONCILE_SECRET_ENV]: RECON }, RECON]] as const) {
      const { run, deps } = mk(env);
      expect((await handleReconcileRequest(cronReq({ auth: `Bearer ${token}` }), deps)).status).toBe(200);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });

  it("the manual (POST) call accepts either secret too", async () => {
    for (const token of [RECON, CRON]) {
      const { run, deps } = mk();
      expect((await handleReconcileRequest(postReq(`Bearer ${token}`), deps)).status).toBe(200);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });

  it("is switched off (503) unless at least one secret of 32+ characters is configured, and nothing runs", async () => {
    for (const env of [{}, { [CRON_SECRET_ENV]: "short" }, { [RECONCILE_SECRET_ENV]: "x".repeat(31) }, { [CRON_SECRET_ENV]: "  ", [RECONCILE_SECRET_ENV]: "" }]) {
      const { run, deps } = mk(env);
      const res = await handleReconcileRequest(cronReq({ auth: "Bearer short" }), deps);
      expect(res.status, JSON.stringify(env)).toBe(503);
      expect(await res.json()).toEqual({ error: "reconcile_unavailable" });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("a cron request with no Authorization header (Vercel sends none when CRON_SECRET isn't set), a wrong token, a similar token, or another scheme is 401 and nothing runs", async () => {
    for (const auth of [null, "", "Bearer", "Bearer wrong", `Bearer ${CRON}x`, `Bearer ${CRON.slice(0, -1)}`, `Basic ${CRON}`, CRON, `Bearer ${CRON.toUpperCase()}`]) {
      const { run, deps } = mk();
      const res = await handleReconcileRequest(cronReq({ auth }), deps);
      expect(res.status, String(auth)).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("the cron user-agent proves nothing: without the secret it is still 401", async () => {
    const { run, deps } = mk();
    expect((await handleReconcileRequest(cronReq({ auth: null, ua: "vercel-cron/1.0" }), deps)).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("a browser request (with an Origin) is refused even with the right secret", async () => {
    const { run, deps } = mk();
    expect((await handleReconcileRequest(cronReq({ origin: "https://standup-app-two.vercel.app" }), deps)).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("the scheduled call carries nothing: ANY query string (a limit, an account, a customer) is refused, so nothing from the URL can steer a run", async () => {
    for (const query of ["?limit=25", "?user_id=11111111-1111-4111-8111-111111111111", "?customer=cus_x", "?subscription=sub_x", "?", "?x=1&y=2"]) {
      const { run, deps } = mk();
      const res = await handleReconcileRequest(cronReq({ query }), deps);
      expect(res.status, query).toBe(query === "?" ? 200 : 400); // a bare '?' parses to an empty search string
      if (query !== "?") expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(run).toHaveBeenCalledTimes(query === "?" ? 1 : 0);
    }
  });

  it("other methods are not routed here (the route exports only GET and POST)", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/billing/reconcile/route.ts"), "utf8");
    expect([...route.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]).sort()).toEqual(["GET", "POST"]);
  });
});

describe("bounded execution and failed records (the scheduled call uses the same engine)", () => {
  it("the scheduled run is exactly the manual default run: same options, so the same limit, budget, cooldown, backoff and healthy-first ordering apply", async () => {
    const a = mk();
    const b = mk();
    await handleReconcileRequest(cronReq(), a.deps);
    await handleReconcileRequest(postReq(`Bearer ${RECON}`), b.deps);
    expect(a.run.mock.calls[0]).toEqual(b.run.mock.calls[0]);
  });

  it("a run that leaves work behind or has records waiting out a backoff is a normal 200 that reports moreDue / backedOff (it never fails the schedule)", async () => {
    const { deps } = mk(undefined, async () => summary({ moreDue: true, backedOff: 4 }));
    const res = await handleReconcileRequest(cronReq(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moreDue).toBe(true);
    expect(body.backedOff).toBe(4);
  });

  it("failing records in the counts (missing / conflict / Stripe error) don't make the scheduled call fail: only a database abort does", async () => {
    const { deps } = mk(undefined, async () => summary({ outcomes: { changed: 0, unchanged: 2, stale: 0, missing: 3, conflict: 1, ignored: 0, stripe_error: 1, store_error: 0 } }));
    expect((await handleReconcileRequest(cronReq(), deps)).status).toBe(200);
  });
});

describe("overlapping runs", () => {
  it("a second request while a run is in progress is turned away (409 already_running) and starts nothing; afterwards a new run is allowed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { run, deps } = mk(undefined, async () => {
      await gate;
      return summary();
    });
    const first = handleReconcileRequest(cronReq(), deps);
    await Promise.resolve();
    await Promise.resolve();
    const second = await handleReconcileRequest(cronReq(), deps);
    const manual = await handleReconcileRequest(postReq(`Bearer ${RECON}`), deps);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "already_running" });
    expect(manual.status).toBe(409);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    expect((await first).status).toBe(200);
    expect((await handleReconcileRequest(cronReq(), deps)).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("an unauthorised request never takes the lock, so it can't block a legitimate run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { run, deps } = mk(undefined, async () => {
      await gate;
      return summary();
    });
    const first = handleReconcileRequest(cronReq(), deps);
    await Promise.resolve();
    await Promise.resolve();
    expect((await handleReconcileRequest(cronReq({ auth: "Bearer nope" }), deps)).status).toBe(401); // not 409: it's rejected before the lock
    release();
    await first;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the lock is released when a run throws or aborts, so the next scheduled run isn't blocked", async () => {
    const { deps: bad } = mk(undefined, async () => {
      throw new Error("boom");
    });
    expect((await handleReconcileRequest(cronReq(), bad)).status).toBe(503);
    const { run, deps: ok } = mk();
    expect((await handleReconcileRequest(cronReq(), ok)).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    const { deps: aborted } = mk(undefined, async () => summary({ aborted: true }));
    expect((await handleReconcileRequest(cronReq(), aborted)).status).toBe(503);
    expect((await handleReconcileRequest(cronReq(), ok)).status).toBe(200);
  });

  it("two simultaneous runs over the same data are also safe at the database (overlap across instances): see the concurrency tests in reconcile.test.ts and the live Step 9.1/9.2 results", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261119000100_billing_sync.sql"), "utf8");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("v_row.subscription_synced_at > p_fetched_at");
  });
});

describe("failures are logged safely (counts and categories only)", () => {
  const SECRETS = [RECON, CRON, "sk_test_abcdef", "cus_123456", "sub_123456", "11111111-1111-4111-8111-111111111111", "SUPABASE_SERVICE_ROLE_KEY=eyJ"];
  const noLeak = () => {
    for (const s of SECRETS) expect(logText(), s).not.toContain(s);
  };

  it("a successful scheduled run logs one info line with the trigger and counts (the line to monitor)", async () => {
    const { deps } = mk(undefined, async () => summary({ moreDue: true, backedOff: 2 }));
    await handleReconcileRequest(cronReq(), deps);
    const info = logs.filter((l) => l.level === "info");
    expect(info).toHaveLength(1);
    expect(info[0].args[0]).toBe("billing reconcile");
    expect(info[0].args[1]).toEqual({ trigger: "cron", examined: 3, changed: 1, unchanged: 2, stale: 0, missing: 0, conflict: 0, ignored: 0, stripe_error: 0, store_error: 0, moreDue: true, backedOff: 2, aborted: false });
    noLeak();
  });

  it("a manual run is labelled 'manual'", async () => {
    const { deps } = mk();
    await handleReconcileRequest(postReq(), deps);
    expect(logs.find((l) => l.level === "info")!.args[1]).toMatchObject({ trigger: "manual" });
  });

  it("a thrown error is logged as a category (not_configured / database / unexpected), never its message, and the response is generic", async () => {
    const cases: [Error, string][] = [
      [Object.assign(new Error(`Stripe billing is not configured: STRIPE_SECRET_KEY=${"sk_test_abcdef"}`), { name: "BillingConfigError" }), "not_configured"],
      [Object.assign(new Error("db: cus_123456 sub_123456"), { name: "ReconcileStoreUnavailableError" }), "database"],
      [Object.assign(new Error("webhook store"), { name: "WebhookStoreUnavailableError" }), "database"],
      [new Error(`weird ${RECON} 11111111-1111-4111-8111-111111111111`), "unexpected"],
    ];
    for (const [err, category] of cases) {
      logs = [];
      const { deps } = mk(undefined, async () => {
        throw err;
      });
      const res = await handleReconcileRequest(cronReq(), deps);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "reconcile_failed" });
      expect(logs.find((l) => l.level === "error")!.args).toEqual(["billing reconcile failed", { trigger: "cron", category }]);
      noLeak();
    }
  });

  it("failureCategory never returns anything but the three categories", () => {
    for (const e of [null, undefined, "str", 5, {}, new Error("x"), { name: "BillingConfigError" }, { name: "ReconcileStoreUnavailableError" }]) expect(["not_configured", "database", "unexpected"]).toContain(failureCategory(e));
  });

  it("a database abort inside a run is logged as a failure with the 'database' category as well as the counts line", async () => {
    const { deps } = mk(undefined, async () => summary({ aborted: true }));
    const res = await handleReconcileRequest(cronReq(), deps);
    expect(res.status).toBe(503);
    expect(logs.find((l) => l.level === "error")!.args).toEqual(["billing reconcile failed", { trigger: "cron", category: "database" }]);
    expect(logs.find((l) => l.level === "info")!.args[1]).toMatchObject({ aborted: true });
  });

  it("rejected requests are logged by reason only (no header, token, URL or body)", async () => {
    const { deps } = mk();
    await handleReconcileRequest(cronReq({ auth: "Bearer guess-guess-guess-guess-guess-guess" }), deps);
    await handleReconcileRequest(cronReq({ origin: "https://evil.example" }), deps);
    await handleReconcileRequest(cronReq({ query: "?user_id=11111111-1111-4111-8111-111111111111" }), deps);
    await handleReconcileRequest(cronReq(), mk({}).deps);
    expect(logs.map((l) => l.args)).toEqual([
      ["billing reconcile rejected", { trigger: "cron", reason: "unauthorized" }],
      ["billing reconcile rejected", { trigger: "cron", reason: "forbidden" }],
      ["billing reconcile rejected", { trigger: "cron", reason: "invalid_request" }],
      ["billing reconcile rejected", { trigger: "cron", reason: "unavailable" }],
    ]);
    expect(logText()).not.toMatch(/guess|evil|user_id|authorization|bearer/i);
  });
});

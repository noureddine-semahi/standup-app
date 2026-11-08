import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

// Stripe secrets must never reach a browser. These pin the rules by inspecting the source tree.
const root = process.cwd();
const src = join(root, "src");
const billingDir = join(src, "lib", "billing");

const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(p);
  }
})(src);
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => relative(root, p).split(sep).join("/");

describe("Stripe stays on the server", () => {
  it("the config and the client import server-only, so a client component importing them fails the build", () => {
    for (const f of ["config.ts", "stripe.ts"]) expect(read(join(billingDir, f))).toMatch(/^import "server-only";/);
  });

  it("no 'use client' file imports the Stripe SDK or the server billing modules", () => {
    const offenders = files.filter((f) => /^\s*["']use client["']/.test(read(f)) && /from\s+["'](stripe|@\/lib\/billing\/(config|stripe|checkout|serverAuth|origins))["']/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the Stripe SDK is imported only by the server client module", () => {
    const importers = files.filter((f) => /^import (?!type)[^\n]*from\s+["']stripe["']/m.test(read(f)));
    expect(importers.map(rel)).toEqual(["src/lib/billing/stripe.ts"]);
  });

  it("Stripe environment variables are read only inside src/lib/billing", () => {
    const outside = files.filter((f) => !f.startsWith(billingDir) && /process\.env\.STRIPE_|STRIPE_(SECRET|WEBHOOK|PRICE)/.test(read(f)));
    expect(outside.map(rel)).toEqual([]);
  });

  it("no Stripe variable is ever given a NEXT_PUBLIC_ name, and next.config doesn't inline any env", () => {
    for (const f of files) expect(read(f)).not.toMatch(/NEXT_PUBLIC_\w*STRIPE|NEXT_PUBLIC_\w*PRICE_ID/i);
    const cfg = readFileSync(join(root, "next.config.ts"), "utf8");
    expect(cfg).not.toMatch(/STRIPE/i);
    expect(cfg).not.toMatch(/\benv\s*:/);
  });

  const billingFiles = () => readdirSync(billingDir).filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n));
  const billingCode = () => billingFiles().map((n) => read(join(billingDir, n))).join("\n");
  // The one module allowed to name account_billing and use .from(): the Customer Portal's read-only customer lookup (pinned by its own test below).
  const billingCodeWithoutPortalStore = () => billingFiles().filter((n) => n !== "portalStore.ts" && n !== "reconcileStore.ts").map((n) => read(join(billingDir, n))).join("\n");

  it("Checkout sessions are created in one place only, Customer Portal sessions in one place only, and nothing changes a subscription, invoice or payment from the app", () => {
    expect(billingFiles().filter((n) => /checkout\.sessions\.create/.test(read(join(billingDir, n))))).toEqual(["checkout.ts"]);
    expect(billingFiles().filter((n) => /billingPortal/.test(read(join(billingDir, n))))).toEqual(["portal.ts"]);
    expect(billingFiles().filter((n) => /billingPortal\.sessions\.create/.test(read(join(billingDir, n))))).toEqual(["portal.ts"]);
    // the portal cannot be pointed at a flow that changes things for the member (flow_data), and the app never calls Stripe to change a subscription itself
    expect(billingCode()).not.toMatch(/flow_data|subscriptions\.(create|update|cancel|resume)|invoices\.|paymentIntents\.|billingPortal\.configurations/);
  });

  it("the Customer Portal's customer comes only from the member's own account_billing row: one read-only select by the verified account, never anything from the request", () => {
    const store = read(join(billingDir, "portalStore.ts"));
    expect(store).toMatch(/^import "server-only";/);
    expect(store.match(/\.from\(/g)).toHaveLength(1);
    expect(store).toMatch(/\.from\("account_billing"\)\.select\("stripe_customer_id, subscription_status"\)\.eq\("user_id", userId\)/);
    expect(store).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    const portal = read(join(billingDir, "portal.ts"));
    expect(portal).toMatch(/customerFor\(user\.id\)/); // the id verified from the sign-in
    expect(portal).not.toMatch(/req\.json\(\)|searchParams|req\.url|headers\.get\("(x-|referer|host)/i); // nothing but Origin and Authorization is read from the request
    expect(portal).not.toMatch(/account_billing|\.from\(|SERVICE_ROLE|service_role/);
  });

  it("webhook signatures are verified in one place only (the Stripe client module), and the webhook handler never trusts an unverified body", () => {
    expect(billingFiles().filter((n) => /webhooks\.constructEvent/.test(read(join(billingDir, n))))).toEqual(["stripe.ts"]);
    const handler = read(join(billingDir, "webhook.ts"));
    expect(handler.indexOf("deps.verifier(config)(rawBody, signature)")).toBeGreaterThan(-1);
    expect(handler).not.toMatch(/JSON\.parse|req\.json\(\)|\.json\(\)\s*\)?\s*;?\s*\n?\s*const event/); // the body is only ever read as raw text
    expect(handler.indexOf("deps.store()")).toBeGreaterThan(handler.indexOf("deps.verifier(config)(rawBody, signature)"));
  });

  it("billing code can never write an entitlement or any data: no entitlement tables or functions, no inserts/updates/upserts/deletes", () => {
    const code = billingCode();
    expect(billingCodeWithoutPortalStore()).not.toMatch(/account_entitlements|account_billing|admin_set_entitlement|start_my_premium_trial/);
    expect(read(join(billingDir, "portalStore.ts"))).not.toMatch(/account_entitlements|admin_set_entitlement|start_my_premium_trial/);
    // (hashing the idempotency key with createHash(...).update(...) is not a database write)
    expect(code.replace(/createHash\([^)]*\)\.update\(/g, "")).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    // the database functions billing code may call: directly (.rpc("name")) or through the event store's call("op", "name", ...) helper
    const fnNames = [...code.matchAll(/(?:\.rpc\(\s*|\bcall\(\s*"[a-z]+",\s*)"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(fnNames)].sort()).toEqual(["begin_checkout_attempt", "claim_stripe_event", "complete_stripe_event", "fail_stripe_event", "finish_checkout_attempt", "get_feature_flags", "record_checkout_session", "sync_stripe_subscription"]);
    expect(billingCodeWithoutPortalStore()).not.toMatch(/\.from\(\s*["']/);
  });

  it("Supabase is touched only by serverAuth.ts (as the calling user), webhookStore.ts, checkoutStore.ts, portalStore.ts and reconcileStore.ts; the service role lives in those four stores alone", () => {
    expect(billingFiles().filter((n) => /from\s+["'](@supabase\/|@\/lib\/supabase)/.test(read(join(billingDir, n))))).toEqual(["checkoutStore.ts", "portalStore.ts", "reconcileStore.ts", "serverAuth.ts", "webhookStore.ts"]);
    expect(billingFiles().filter((n) => /service_role|SERVICE_ROLE/i.test(read(join(billingDir, n))))).toEqual(["checkoutStore.ts", "portalStore.ts", "reconcileStore.ts", "webhookStore.ts"]);
    const outside = files.filter((f) => !/(webhookStore|checkoutStore|portalStore|reconcileStore)\.ts$/.test(f) && /SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(read(f)));
    expect(outside.map(rel)).toEqual([]);
    // the service role may only call the three event-ledger functions
    expect([...read(join(billingDir, "webhookStore.ts")).matchAll(/\bcall\(\s*"[a-z]+",\s*"([a-z_]+)"/g)].map((m) => m[1]).sort()).toEqual(["claim_stripe_event", "complete_stripe_event", "fail_stripe_event", "sync_stripe_subscription"]);
    expect(read(join(billingDir, "webhookStore.ts")).match(/db\.rpc\(/g)).toHaveLength(1); // every database call goes through the one diagnosing helper
    // the checkout store may only call the three attempt functions, through its one diagnosing helper
    const cs = read(join(billingDir, "checkoutStore.ts"));
    expect([...cs.matchAll(/\bcall\(\s*"[a-z]+",\s*"([a-z_]+)"/g)].map((m) => m[1]).sort()).toEqual(["begin_checkout_attempt", "finish_checkout_attempt", "record_checkout_session"]);
    expect(cs.match(/db\.rpc\(/g)).toHaveLength(1);
    expect(read(join(billingDir, "serverAuth.ts"))).not.toMatch(/service_role|SERVICE_ROLE/i);
  });

  it("the webhook route exposes POST only and delegates to the handler; the secret key and webhook secret are never sent to a client", () => {
    const route = read(join(src, "app", "api", "stripe", "webhook", "route.ts"));
    expect([...route.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])).toEqual(["POST"]);
    expect(route).toContain("handleStripeWebhook");
    expect(files.filter((f) => /"use client"|'use client'/.test(read(f)) && /webhook|SERVICE_ROLE/i.test(read(f)) && f.startsWith(billingDir))).toEqual([]);
  });

  it("the checkout route exposes POST only and delegates to the handler", () => {
    const route = read(join(src, "app", "api", "billing", "checkout", "route.ts"));
    expect([...route.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])).toEqual(["POST"]);
    expect(route).toContain("handleCheckoutRequest");
  });

  it("reconciliation: one read-only select by stored subscription state; writes go only through the existing sync function; nothing from the request names an account, customer or subscription", () => {
    const store = read(join(billingDir, "reconcileStore.ts"));
    expect(store).toMatch(/^import "server-only";/);
    expect(store.match(/\.from\(/g)).toHaveLength(1);
    expect(store).toMatch(/\.from\("account_billing"\)/);
    expect(store).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    const code = read(join(billingDir, "reconcile.ts"));
    const noComments = code.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(noComments).not.toMatch(/account_billing|account_entitlements|\.from\(|SERVICE_ROLE|service_role|\.rpc\(|checkout\.sessions|subscriptions\.(create|update|cancel|resume)|billingPortal|customers\./);
    expect(noComments).toMatch(/subscriptions\.retrieve\(id\)/);
    expect(noComments).toMatch(/\bdeps\.sync\(built\.args\)/); // the one write: the same database function the webhooks use
    expect(noComments).not.toMatch(/searchParams|req\.url|\.json\(\)/); // nothing but headers and a tiny validated body is read from the request
    const sync = read(join(billingDir, "subscriptionSync.ts"));
    expect(sync).toContain("cancellationScheduled(sub as unknown as Obj, periodEnd, fetchedAt)"); // the normalisation lives in the shared builder both paths use
  });

  it("the reconcile route exposes POST only and delegates to the handler", () => {
    const route = read(join(src, "app", "api", "billing", "reconcile", "route.ts"));
    expect([...route.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])).toEqual(["POST"]);
    expect(route).toContain("handleReconcileRequest");
  });

  it("the portal route exposes POST only and delegates to the handler", () => {
    const route = read(join(src, "app", "api", "billing", "portal", "route.ts"));
    expect([...route.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])).toEqual(["POST"]);
    expect(route).toContain("handlePortalRequest");
  });

  it("the settings UI components never import the Stripe SDK or any server billing module, never read secrets or environment variables, and talk to the server only through the existing endpoint helper", () => {
    for (const f of ["PremiumTrialCard.tsx", "PremiumPlans.tsx", "CheckoutReturn.tsx", "BillingStatus.tsx", "PortalReturn.tsx"]) {
      const code = read(join(src, "components", f));
      expect(code).not.toMatch(/from\s+["']stripe["']|lib\/billing\/(config|stripe|checkout|checkoutStore|portal|portalStore|serverAuth|webhook|webhookStore|origins)["']/);
      expect(code).not.toMatch(/process\.env|STRIPE_|SERVICE_ROLE|sk_(test|live)_|whsec_/);
      expect(code).not.toMatch(/\bfetch\(/); // no second checkout implementation: the one network call lives in startCheckout.ts
    }
    const helper = read(join(src, "lib", "startCheckout.ts"));
    const helperCode = helper.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"); // (the header comment also names the endpoint)
    expect(helperCode.match(/\/api\/billing\/checkout/g)).toHaveLength(1);
    expect(helperCode).not.toMatch(/process\.env|STRIPE_(SECRET|WEBHOOK|PRICE)|SERVICE_ROLE|price_|checkout\.sessions/);
    // the helper may follow only a Stripe Checkout URL, and the member's token never leaves the one request
    expect(helper).toContain("https:\\/\\/checkout\\.stripe\\.com\\/");
    // the portal helper: one network call, no body at all (so no customer, subscription or account can be named), and it follows only a Stripe billing page
    const portalHelper = read(join(src, "lib", "startPortal.ts"));
    const portalCode = portalHelper.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(portalCode.match(/\/api\/billing\/portal/g)).toHaveLength(1);
    expect(portalCode).not.toMatch(/body\s*:\s*JSON|process\.env|STRIPE_(SECRET|WEBHOOK|PRICE|PORTAL_CONFIG)|SERVICE_ROLE|cus_|sub_|customer/);
    expect(portalHelper).toContain("https:\\/\\/billing\\.stripe\\.com\\/");
  });
});

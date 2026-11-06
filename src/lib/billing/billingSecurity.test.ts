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

  it("Checkout sessions are created in one place only, and there is no webhook, portal or subscription-changing code yet", () => {
    expect(billingFiles().filter((n) => /checkout\.sessions\.create/.test(read(join(billingDir, n))))).toEqual(["checkout.ts"]);
    expect(billingCode()).not.toMatch(/billingPortal|webhooks\.constructEvent|subscriptions\.(create|update|cancel|resume)|invoices\.|paymentIntents\./);
  });

  it("billing code can never write an entitlement or any data: no entitlement tables or functions, no inserts/updates/upserts/deletes", () => {
    const code = billingCode();
    expect(code).not.toMatch(/account_entitlements|account_billing|admin_set_entitlement|start_my_premium_trial/);
    // (hashing the idempotency key with createHash(...).update(...) is not a database write)
    expect(code.replace(/createHash\([^)]*\)\.update\(/g, "")).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(code.match(/\.rpc\(\s*"[a-z_]+"/g)).toEqual(['.rpc("get_feature_flags"']);
  });

  it("Supabase is touched only by serverAuth.ts, as the calling user (no service role)", () => {
    expect(billingFiles().filter((n) => /from\s+["'](@supabase\/|@\/lib\/supabase)/.test(read(join(billingDir, n))))).toEqual(["serverAuth.ts"]);
    expect(billingCode()).not.toMatch(/service_role|SERVICE_ROLE/);
  });

  it("the checkout route exposes POST only and delegates to the handler", () => {
    const route = read(join(src, "app", "api", "billing", "checkout", "route.ts"));
    expect([...route.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1])).toEqual(["POST"]);
    expect(route).toContain("handleCheckoutRequest");
  });

  it("the settings UI components don't reference Stripe or the billing config", () => {
    for (const f of ["PremiumTrialCard.tsx", "PremiumPlans.tsx"]) expect(read(join(src, "components", f))).not.toMatch(/stripe|lib\/billing\/(config|stripe)/i);
  });
});

import { describe, it, expect, vi } from "vitest";
import { startCheckout } from "./startCheckout";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const URL_OK = "https://checkout.stripe.com/c/pay/cs_test_abc";

describe("startCheckout", () => {
  it("posts only the plan to the existing endpoint, with the member's token, and follows a Stripe Checkout URL", async () => {
    const fetchImpl = vi.fn(async () => json(200, { url: URL_OK }));
    const r = await startCheckout("annual", { getAccessToken: async () => "tok-123", fetchImpl: fetchImpl as never });
    expect(r).toEqual({ kind: "redirect", url: URL_OK });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/billing/checkout");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ plan: "annual" }); // nothing else: no price, amount, user or redirect
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-123");
  });
  it("with no session (expired or signed out) it never calls the server: the member is sent to sign in again", async () => {
    const fetchImpl = vi.fn();
    expect(await startCheckout("monthly", { getAccessToken: async () => null, fetchImpl: fetchImpl as never })).toEqual({ kind: "login" });
    expect(await startCheckout("monthly", { getAccessToken: async () => Promise.reject(new Error("x")), fetchImpl: fetchImpl as never })).toEqual({ kind: "login" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("a 401 from the server means the session expired: sign in again", async () => {
    const r = await startCheckout("monthly", { getAccessToken: async () => "tok", fetchImpl: (async () => json(401, { error: "unauthenticated" })) as never });
    expect(r).toEqual({ kind: "login" });
  });
  it("passes the server's refusal through as a code: already subscribed, in progress, disabled", async () => {
    for (const [status, code] of [[409, "already_subscribed"], [409, "checkout_in_progress"], [403, "checkout_disabled"], [503, "billing_unavailable"], [502, "checkout_failed"]] as const) {
      const r = await startCheckout("monthly", { getAccessToken: async () => "tok", fetchImpl: (async () => json(status, { error: code })) as never });
      expect(r).toEqual({ kind: "error", code });
    }
  });
  it("never follows a URL that isn't a Stripe Checkout page, even from a 200", async () => {
    for (const url of ["https://evil.example/pay", "http://checkout.stripe.com/x", "javascript:alert(1)", "//checkout.stripe.com/x", "https://checkout.stripe.com.evil.example/x", null, 5]) {
      const r = await startCheckout("monthly", { getAccessToken: async () => "tok", fetchImpl: (async () => json(200, { url })) as never });
      expect(r.kind).toBe("error");
    }
  });
  it("a network failure or a non-JSON answer is a generic failure", async () => {
    expect(await startCheckout("monthly", { getAccessToken: async () => "tok", fetchImpl: (async () => Promise.reject(new Error("offline"))) as never })).toEqual({ kind: "error", code: "checkout_failed" });
    expect(await startCheckout("monthly", { getAccessToken: async () => "tok", fetchImpl: (async () => new Response("<html>", { status: 500 })) as never })).toEqual({ kind: "error", code: "checkout_failed" });
  });
  it("never exposes the token in a result", async () => {
    const r = await startCheckout("monthly", { getAccessToken: async () => "SECRET-TOKEN", fetchImpl: (async () => json(502, { error: "checkout_failed" })) as never });
    expect(JSON.stringify(r)).not.toContain("SECRET-TOKEN");
  });
});

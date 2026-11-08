import { describe, it, expect, vi } from "vitest";
import { startPortal } from "./startPortal";
import { portalErrorMessageKey } from "./portalMessages";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const URL_OK = "https://billing.stripe.com/p/session/test_abc";

describe("startPortal", () => {
  it("posts to the existing endpoint with the member's token and NO body, and follows a Stripe billing URL", async () => {
    const fetchImpl = vi.fn(async () => json(200, { url: URL_OK }));
    const r = await startPortal({ getAccessToken: async () => "tok-123", fetchImpl: fetchImpl as never });
    expect(r).toEqual({ kind: "redirect", url: URL_OK });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/billing/portal");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined(); // nothing about which customer, subscription or account: the server decides
    expect(init.headers).toEqual({ authorization: "Bearer tok-123" });
  });

  it("with no session (expired or signed out) it never calls the server: the member is sent to sign in again", async () => {
    const fetchImpl = vi.fn();
    expect(await startPortal({ getAccessToken: async () => null, fetchImpl: fetchImpl as never })).toEqual({ kind: "login" });
    expect(await startPortal({ getAccessToken: async () => Promise.reject(new Error("x")), fetchImpl: fetchImpl as never })).toEqual({ kind: "login" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a 401 from the server means the session expired: sign in again", async () => {
    expect(await startPortal({ getAccessToken: async () => "tok", fetchImpl: (async () => json(401, { error: "unauthenticated" })) as never })).toEqual({ kind: "login" });
  });

  it("passes the server's refusal through as a code", async () => {
    for (const [status, code] of [[409, "no_subscription"], [403, "portal_disabled"], [503, "billing_unavailable"], [502, "portal_failed"]] as const) {
      expect(await startPortal({ getAccessToken: async () => "tok", fetchImpl: (async () => json(status, { error: code })) as never })).toEqual({ kind: "error", code });
    }
  });

  it("never follows a URL that isn't a Stripe billing page, even from a 200", async () => {
    for (const url of ["https://evil.example/p", "http://billing.stripe.com/p", "javascript:alert(1)", "//billing.stripe.com/p", "https://billing.stripe.com.evil.example/p", "https://checkout.stripe.com/c/pay/x", null, 5]) {
      expect((await startPortal({ getAccessToken: async () => "tok", fetchImpl: (async () => json(200, { url })) as never })).kind).toBe("error");
    }
  });

  it("a network failure or a non-JSON answer is a generic failure, and the token never appears in a result", async () => {
    expect(await startPortal({ getAccessToken: async () => "SECRET-TOKEN", fetchImpl: (async () => Promise.reject(new Error("offline SECRET-TOKEN"))) as never })).toEqual({ kind: "error", code: "portal_failed" });
    const r = await startPortal({ getAccessToken: async () => "SECRET-TOKEN", fetchImpl: (async () => new Response("<html>", { status: 500 })) as never });
    expect(r).toEqual({ kind: "error", code: "portal_failed" });
    expect(JSON.stringify(r)).not.toContain("SECRET-TOKEN");
  });
});

describe("portal messages (EN and ES)", () => {
  it("each error code maps to its own message, anything else to the generic failure", () => {
    expect(portalErrorMessageKey("no_subscription")).toBe("portal.noSubscription");
    expect(portalErrorMessageKey("portal_disabled")).toBe("portal.unavailable");
    expect(portalErrorMessageKey("billing_unavailable")).toBe("portal.unavailable");
    for (const c of ["portal_failed", "invalid_request", "forbidden_origin", "weird", null, undefined]) expect(portalErrorMessageKey(c)).toBe("portal.failed");
  });

  it("every portal string exists in English and Spanish, differs between them, and names no Stripe identifier or technical error", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("portal.") || k.startsWith("faq.q37.")) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      const e = en[k];
      const s = (es as Record<string, string>)[k];
      expect(typeof s, k).toBe("string");
      expect(s.length, k).toBeGreaterThan(0);
      expect(s, k).not.toBe(e);
      for (const text of [e, s]) expect(text, k).not.toMatch(/cus_|sub_|price_|sk_test|whsec_|undefined/);
    }
  });
});

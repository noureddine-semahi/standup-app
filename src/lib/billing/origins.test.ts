import { describe, it, expect } from "vitest";
import { PRODUCTION_ORIGIN, checkoutReturnUrls, getTrustedOrigins, resolveTrustedOrigin } from "./origins";

describe("trusted origins", () => {
  it("production trusts only the production origin by default", () => {
    expect(getTrustedOrigins({ NODE_ENV: "production" })).toEqual([PRODUCTION_ORIGIN]);
  });
  it("development also trusts localhost", () => {
    const o = getTrustedOrigins({ NODE_ENV: "development" });
    expect(o).toContain("http://localhost:3000");
    expect(o).toContain(PRODUCTION_ORIGIN);
  });
  it("the owner can add https origins; http is accepted only for localhost; junk is ignored", () => {
    const o = getTrustedOrigins({ NODE_ENV: "production", BILLING_TRUSTED_ORIGINS: "https://app.example.com/, http://evil.example, not a url, http://localhost:4000, ftp://x.example , https://b.example.com/path" });
    expect(o).toEqual([PRODUCTION_ORIGIN, "https://app.example.com", "http://localhost:4000", "https://b.example.com"]);
  });
  it("resolves only an exact match of the Origin header", () => {
    const env = { NODE_ENV: "production" };
    expect(resolveTrustedOrigin(PRODUCTION_ORIGIN, env)).toBe(PRODUCTION_ORIGIN);
    for (const bad of [null, undefined, "", "null", "https://evil.example", `${PRODUCTION_ORIGIN}/`, `${PRODUCTION_ORIGIN}.evil.example`, "http://standup-app-two.vercel.app", "https://standup-app-two.vercel.app:444"]) {
      expect(resolveTrustedOrigin(bad, env)).toBeNull();
    }
  });
  it("return URLs are the trusted origin plus a fixed path", () => {
    expect(checkoutReturnUrls(PRODUCTION_ORIGIN)).toEqual({
      success: `${PRODUCTION_ORIGIN}/standup/settings?checkout=success`,
      cancel: `${PRODUCTION_ORIGIN}/standup/settings?checkout=cancelled`,
    });
  });
});

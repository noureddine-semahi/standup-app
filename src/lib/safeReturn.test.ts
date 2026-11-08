import { describe, it, expect } from "vitest";
import { loginUrlWithReturn, returnPathFromSearch, safeReturnPath } from "./safeReturn";

describe("safeReturnPath", () => {
  it("accepts a path inside the signed-in app, with its query and hash", () => {
    for (const ok of ["/standup/settings", "/standup/settings?checkout=success", "/standup/today?x=1&y=2#top", "/standup", "/standup/", "/standup?a=b"]) {
      expect(safeReturnPath(ok)).toBe(ok);
    }
  });
  it("refuses another site, a protocol-relative URL, a scheme, or anything outside the app", () => {
    for (const bad of [
      "https://evil.example/standup/settings",
      "//evil.example/standup/settings",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "standup/settings",
      "/login",
      "/",
      "/standupx",
      "/standup@evil.example",
      "/api/billing/checkout",
      "/%2F%2Fevil.example",
      "",
      " /standup/settings",
    ]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });
  it("refuses control characters, backslashes and over-long values", () => {
    for (const bad of ["/standup/settings\n", "/standup/set\ttings", "/standup/settings\u0000", "/standup\\..\\x", "/standup/" + "a".repeat(400)]) expect(safeReturnPath(bad)).toBeNull();
  });
  it("refuses non-strings", () => {
    for (const bad of [null, undefined, 5 as never, {} as never]) expect(safeReturnPath(bad)).toBeNull();
  });
});

describe("loginUrlWithReturn", () => {
  it("builds the sign-in URL with an encoded destination, only for a safe one", () => {
    expect(loginUrlWithReturn("/standup/settings?checkout=success")).toBe("/login?next=%2Fstandup%2Fsettings%3Fcheckout%3Dsuccess");
    for (const bad of ["https://evil.example", "//evil.example", "/login", null, undefined, ""]) expect(loginUrlWithReturn(bad)).toBe("/login");
  });
});

describe("returnPathFromSearch", () => {
  it("reads the destination back out and round-trips what loginUrlWithReturn wrote", () => {
    const url = loginUrlWithReturn("/standup/settings?checkout=success");
    expect(returnPathFromSearch(url.slice(url.indexOf("?")))).toBe("/standup/settings?checkout=success");
  });
  it("ignores a missing, empty or hostile next", () => {
    for (const search of ["", "?", "?next=", "?next=https%3A%2F%2Fevil.example", "?next=%2F%2Fevil.example", "?next=%2Flogin", "?other=%2Fstandup%2Fsettings"]) expect(returnPathFromSearch(search)).toBeNull();
  });
});

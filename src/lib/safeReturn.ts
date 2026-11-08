// Where to send a member after they sign in again (an expired session while subscribing, or on returning from Stripe). The destination
// travels in the URL, so it is treated as untrusted input: only a path inside the signed-in app is ever accepted. Anything else (another
// site, a protocol-relative "//host", a scheme, a backslash trick, control characters, an over-long value) is ignored and the member
// lands on the normal default instead. Client-safe and secret-free.

const MAX_LENGTH = 300;
const APP_ROOT = /^\/standup(?:[/?#]|$)/;

/** The path (with its query) to return to, or null if it isn't a safe in-app destination. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null; // control characters and backslashes (some browsers treat "\" as "/")
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (!APP_ROOT.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://app.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://app.invalid") return null; // it must stay on this site
  return url.pathname + url.search + url.hash;
}

/** The sign-in page URL that brings the member back to `returnTo` afterwards (only if it is a safe destination). */
export function loginUrlWithReturn(returnTo: string | null | undefined): string {
  const safe = safeReturnPath(returnTo);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

/** Read the `next` destination from a query string such as window.location.search. */
export function returnPathFromSearch(search: string): string | null {
  try {
    return safeReturnPath(new URLSearchParams(search).get("next"));
  } catch {
    return null;
  }
}

// Which origins Stripe may send a customer back to after Checkout. The browser never supplies a redirect URL: the server builds one from
// the request's Origin ONLY if that origin is on this list, and the path is fixed. No secrets here.
//
// Trusted: StandUp's production origin, localhost in development/test only (never in a production build), and any extra origins the
// owner lists in BILLING_TRUSTED_ORIGINS (comma-separated, https only; http only for localhost).

export const PRODUCTION_ORIGIN = "https://standup-app-two.vercel.app";
export const TRUSTED_ORIGINS_ENV = "BILLING_TRUSTED_ORIGINS";
export const CHECKOUT_RETURN_PATH = "/standup/settings";

type Env = Readonly<Record<string, string | undefined>>;

const DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3100"];

/** The canonical origin of a URL-ish string, or null if it isn't an acceptable one (not http(s), or http on a non-localhost host). */
function normalizeOrigin(value: string): string | null {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin;
  return null;
}

export function getTrustedOrigins(env: Env = process.env): string[] {
  const out = new Set<string>([PRODUCTION_ORIGIN]);
  if (env.NODE_ENV !== "production") for (const o of DEV_ORIGINS) out.add(o);
  for (const raw of (env[TRUSTED_ORIGINS_ENV] ?? "").split(",")) {
    const o = raw.trim() ? normalizeOrigin(raw) : null;
    if (o) out.add(o);
  }
  return [...out];
}

/** The request's Origin header if (and only if) it exactly matches a trusted origin; otherwise null. */
export function resolveTrustedOrigin(originHeader: string | null | undefined, env: Env = process.env): string | null {
  if (!originHeader) return null;
  const o = normalizeOrigin(originHeader);
  return o && o === originHeader.trim() && getTrustedOrigins(env).includes(o) ? o : null;
}

export function checkoutReturnUrls(origin: string): { success: string; cancel: string } {
  return { success: `${origin}${CHECKOUT_RETURN_PATH}?checkout=success`, cancel: `${origin}${CHECKOUT_RETURN_PATH}?checkout=cancelled` };
}

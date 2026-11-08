// The browser side of "Manage subscription": ask the server endpoint (POST /api/billing/portal) for a Stripe Customer Portal URL. The browser
// sends NOTHING about who or what to open: the server verifies the sign-in, finds the member's own Stripe customer in its own records and
// chooses the return URL. This follows only a URL that really is a Stripe billing page.

export type StartPortalResult =
  | { kind: "redirect"; url: string }
  /** No usable sign-in (expired or signed out): send the member to sign in again, then back to Settings. */
  | { kind: "login" }
  | { kind: "error"; code: string };

export type StartPortalDeps = {
  /** The member's current access token, or null when there is no (longer a) session. */
  getAccessToken(): Promise<string | null>;
  fetchImpl?: typeof fetch;
};

const STRIPE_PORTAL_URL = /^https:\/\/billing\.stripe\.com\//;

export async function startPortal(deps: StartPortalDeps): Promise<StartPortalResult> {
  let token: string | null = null;
  try {
    token = await deps.getAccessToken();
  } catch {
    token = null;
  }
  if (!token) return { kind: "login" };

  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)("/api/billing/portal", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch {
    return { kind: "error", code: "portal_failed" };
  }

  const body: { url?: unknown; error?: unknown } | null = await res
    .json()
    .then((j) => j as { url?: unknown; error?: unknown } | null)
    .catch(() => null);

  if (res.status === 401) return { kind: "login" };
  if (res.ok && typeof body?.url === "string" && STRIPE_PORTAL_URL.test(body.url)) return { kind: "redirect", url: body.url };
  return { kind: "error", code: typeof body?.error === "string" ? body.error : "portal_failed" };
}

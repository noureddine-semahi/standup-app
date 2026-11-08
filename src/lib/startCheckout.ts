import type { BillingPlan } from "@/lib/billing/plans";

// The browser side of "Subscribe": ask the EXISTING server endpoint (POST /api/billing/checkout) for a Stripe Checkout URL. It is the only
// way the app starts a checkout; this module adds no second implementation. The server decides everything that matters (the sign-in is
// verified there, both beta flags are enforced there, the duplicate-subscription guard runs there, the Price and redirect URLs are chosen
// there): the browser sends the plan, nothing else, and only follows a URL that really is a Stripe Checkout page.

export type StartCheckoutResult =
  | { kind: "redirect"; url: string }
  /** No usable sign-in (expired or signed out): send the member to sign in again, then back to Settings. */
  | { kind: "login" }
  | { kind: "error"; code: string };

export type StartCheckoutDeps = {
  /** The member's current access token, or null when there is no (longer a) session. */
  getAccessToken(): Promise<string | null>;
  fetchImpl?: typeof fetch;
};

const STRIPE_CHECKOUT_URL = /^https:\/\/checkout\.stripe\.com\//;

export async function startCheckout(plan: BillingPlan, deps: StartCheckoutDeps): Promise<StartCheckoutResult> {
  let token: string | null = null;
  try {
    token = await deps.getAccessToken();
  } catch {
    token = null;
  }
  if (!token) return { kind: "login" };

  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan }),
    });
  } catch {
    return { kind: "error", code: "checkout_failed" };
  }

  const body: { url?: unknown; error?: unknown } | null = await res
    .json()
    .then((j) => j as { url?: unknown; error?: unknown } | null)
    .catch(() => null);

  if (res.status === 401) return { kind: "login" }; // the server rejected the sign-in: it expired
  if (res.ok && typeof body?.url === "string" && STRIPE_CHECKOUT_URL.test(body.url)) return { kind: "redirect", url: body.url };
  return { kind: "error", code: typeof body?.error === "string" ? body.error : "checkout_failed" };
}

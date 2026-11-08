import type { TranslationKey } from "@/lib/i18n/en";

// What to tell a member when "Manage subscription" can't open the portal. Client-safe (no secrets, no Stripe): maps the endpoint's error code to
// a message, so the wording lives in one place with its EN/ES translations. None of them mention an identifier or Stripe's own error text.

export function portalErrorMessageKey(code: string | null | undefined): TranslationKey {
  switch (code) {
    case "no_subscription":
      return "portal.noSubscription";
    case "portal_disabled":
    case "billing_unavailable":
      return "portal.unavailable";
    default:
      return "portal.failed";
  }
}

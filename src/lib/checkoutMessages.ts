import type { TranslationKey } from "@/lib/i18n/en";

// What to tell a member when a checkout request is refused. Client-safe (no secrets, no Stripe): the future Subscribe button maps the endpoint's
// error code to one of these, so the duplicate-subscription wording lives in one place with its EN/ES translations.

export function checkoutErrorMessageKey(code: string | null | undefined): TranslationKey {
  switch (code) {
    case "already_subscribed":
      return "checkout.alreadySubscribed";
    case "checkout_in_progress":
      return "checkout.inProgress";
    case "checkout_disabled":
    case "billing_unavailable":
      return "checkout.unavailable";
    default:
      return "checkout.failed";
  }
}

import type { TranslationKey } from "@/lib/i18n/en";

// The browser side of "Delete Account": ask the server endpoint (POST /api/account/delete) to delete the signed-in member's account. The browser
// sends only the typed confirmation; the server derives the account from the verified sign-in, cancels any subscription in Stripe FIRST, and only then
// removes the login. If anything fails the account is NOT deleted and the member can simply try again.

export type AccountDeletionResult =
  | { kind: "deleted" }
  /** No usable sign-in (expired or signed out): send the member to sign in again, then back to Settings. */
  | { kind: "login" }
  | { kind: "error"; code: string };

export type AccountDeletionDeps = {
  /** The member's current access token, or null when there is no (longer a) session. */
  getAccessToken(): Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export async function requestAccountDeletion(deps: AccountDeletionDeps): Promise<AccountDeletionResult> {
  let token: string | null = null;
  try {
    token = await deps.getAccessToken();
  } catch {
    token = null;
  }
  if (!token) return { kind: "login" };

  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)("/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
  } catch {
    return { kind: "error", code: "unavailable" };
  }

  const body: { status?: unknown; error?: unknown } | null = await res
    .json()
    .then((j) => j as { status?: unknown; error?: unknown } | null)
    .catch(() => null);

  if (res.ok && body?.status === "deleted") return { kind: "deleted" };
  if (res.status === 401) return { kind: "login" };
  return { kind: "error", code: typeof body?.error === "string" ? body.error : "unavailable" };
}

/** What to tell a member when the deletion didn't complete. None of these mention an identifier or Stripe's own error text. */
export function accountDeletionErrorKey(code: string | null | undefined): TranslationKey {
  switch (code) {
    case "billing_failed":
      return "account.delete.billingFailed";
    case "cleanup_failed":
      return "account.delete.cleanupFailed";
    case "deletion_in_progress":
      return "account.delete.inProgress";
    case "unavailable":
    case "forbidden_origin":
    case "invalid_request":
      return "account.delete.unavailable";
    default:
      return "settings.failedDeleteAccount";
  }
}

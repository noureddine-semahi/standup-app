import { describe, it, expect, vi } from "vitest";
import { accountDeletionErrorKey, requestAccountDeletion } from "./startAccountDeletion";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("requestAccountDeletion", () => {
  it("posts only the typed confirmation to the existing endpoint with the member's token; no account, customer or subscription is sent", async () => {
    const fetchImpl = vi.fn(async () => json(200, { status: "deleted" }));
    expect(await requestAccountDeletion({ getAccessToken: async () => "tok-1", fetchImpl: fetchImpl as never })).toEqual({ kind: "deleted" });
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/account/delete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ confirm: "DELETE" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("with no session it never calls the server: sign in again", async () => {
    const fetchImpl = vi.fn();
    expect(await requestAccountDeletion({ getAccessToken: async () => null, fetchImpl: fetchImpl as never })).toEqual({ kind: "login" });
    expect(await requestAccountDeletion({ getAccessToken: async () => Promise.reject(new Error("x")), fetchImpl: fetchImpl as never })).toEqual({ kind: "login" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a 401 means the session expired", async () => {
    expect(await requestAccountDeletion({ getAccessToken: async () => "t", fetchImpl: (async () => json(401, { error: "unauthenticated" })) as never })).toEqual({ kind: "login" });
  });

  it("success needs the server's explicit 'deleted'; a 200 without it is an error, never a silent success", async () => {
    expect(await requestAccountDeletion({ getAccessToken: async () => "t", fetchImpl: (async () => json(200, {})) as never })).toEqual({ kind: "error", code: "unavailable" });
  });

  it("passes the server's refusal through as a code", async () => {
    for (const [status, code] of [[502, "billing_failed"], [502, "cleanup_failed"], [409, "deletion_in_progress"], [503, "unavailable"], [400, "invalid_request"]] as const) {
      expect(await requestAccountDeletion({ getAccessToken: async () => "t", fetchImpl: (async () => json(status, { error: code, retryable: true })) as never })).toEqual({ kind: "error", code });
    }
  });

  it("a network failure or a non-JSON answer is the generic 'unavailable', and the token never appears in a result", async () => {
    const a = await requestAccountDeletion({ getAccessToken: async () => "SECRET-TOKEN", fetchImpl: (async () => Promise.reject(new Error("offline SECRET-TOKEN"))) as never });
    const b = await requestAccountDeletion({ getAccessToken: async () => "SECRET-TOKEN", fetchImpl: (async () => new Response("<html>", { status: 500 })) as never });
    expect(a).toEqual({ kind: "error", code: "unavailable" });
    expect(b).toEqual({ kind: "error", code: "unavailable" });
    expect(JSON.stringify([a, b])).not.toContain("SECRET-TOKEN");
  });
});

describe("messages (EN and ES)", () => {
  it("each error code maps to its own message", () => {
    expect(accountDeletionErrorKey("billing_failed")).toBe("account.delete.billingFailed");
    expect(accountDeletionErrorKey("cleanup_failed")).toBe("account.delete.cleanupFailed");
    expect(accountDeletionErrorKey("deletion_in_progress")).toBe("account.delete.inProgress");
    for (const c of ["unavailable", "forbidden_origin", "invalid_request"]) expect(accountDeletionErrorKey(c)).toBe("account.delete.unavailable");
    for (const c of ["weird", null, undefined]) expect(accountDeletionErrorKey(c)).toBe("settings.failedDeleteAccount");
  });

  it("every deletion string exists in English and Spanish, differs between them, and never mentions an identifier or Stripe's own error text", () => {
    const keys = [...Object.keys(en).filter((k) => k.startsWith("account.delete.")), "settings.dangerZoneBody", "settings.dangerZoneNote", "faq.q19.answer", "faq.q38.question", "faq.q38.answer", "privacy.yourControlBody"] as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThanOrEqual(11);
    for (const k of keys) {
      const e = en[k];
      const s = (es as Record<string, string>)[k];
      expect(typeof s, k).toBe("string");
      expect(s, k).not.toBe(e);
      for (const text of [e, s]) expect(text, k).not.toMatch(/cus_|sub_|sk_test|whsec_|undefined|\{\w+\}/);
    }
  });

  it("the disclosures separate account-data deletion from retained payment records, state immediate cancellation and no automatic refund, and make no unsupported legal promise", () => {
    for (const [t, L] of [[en, "en"], [es, "es"]] as const) {
      const all = ["settings.dangerZoneBody", "settings.dangerZoneNote", "faq.q38.answer", "privacy.billingBody"].map((k) => (t as Record<string, string>)[k]).join(" ");
      if (L === "en") {
        expect(all).toMatch(/canceled immediately/i);
        expect(all).toMatch(/don't automatically refund|nothing here automatically refunds/i);
        expect(all).toMatch(/financial or legal rules/i);
        expect(all).toMatch(/contact us if you think you're owed/i);
        expect(all).not.toMatch(/no refunds?\b|non-refundable|never refund|guarantee/i);
        expect(all).toMatch(/never your email address/);
        expect(all).toMatch(/24 months/);
      } else {
        expect(all).toMatch(/de inmediato/i);
        expect(all).toMatch(/no reembolsamos|reembolsa un pago automáticamente/i);
        expect(all).toMatch(/normas financieras o legales/i);
        expect(all).toMatch(/contáctanos si crees que te corresponde/i);
        expect(all).not.toMatch(/sin reembolso|no reembolsable|garantiz/i);
        expect(all).toMatch(/nunca tu correo electrónico/);
        expect(all).toMatch(/24 meses/);
      }
    }
  });

  it("the old, now-false claims are gone: no 'doesn't remove the login', no 'wipe all associated data' with billing records left behind", () => {
    expect(en["settings.dangerZoneNote"]).not.toMatch(/doesn't remove the login/i);
    expect(es["settings.dangerZoneNote"]).not.toMatch(/no elimina el inicio de sesión/i);
    expect(en["privacy.billingBody"]).not.toMatch(/Deleting your content from Settings doesn't remove these billing records/);
    expect(es["privacy.billingBody"]).not.toMatch(/Borrar tu contenido desde Ajustes no elimina estos registros/);
  });
});

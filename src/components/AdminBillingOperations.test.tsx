import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const m = vi.hoisted(() => ({ ops: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: m.getSession } } }));
vi.mock("@/lib/admin/billingAdminClient", () => ({ getBillingOperations: m.ops }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import AdminBillingOperations from "./AdminBillingOperations";
import type { OperationsOverview } from "@/lib/admin/billingOperations";

const data = (o: Partial<OperationsOverview> = {}): OperationsOverview => ({
  generatedAt: "2026-11-20T12:00:00.000Z",
  webhooks: { recent: [{ type: "invoice.paid", status: "processed", attempts: 1, error: null, receivedAt: "2026-11-20T10:00:00Z", processedAt: "2026-11-20T10:00:01Z" }, { type: "customer.subscription.updated", status: "failed", attempts: 3, error: "handler_error", receivedAt: "2026-11-20T09:00:00Z", processedAt: null }], last24h: { processed: 1, failed: 1, processing: 0 }, lastProcessedAt: "2026-11-20T10:00:01Z", totalRecorded: 2 },
  reconciliation: { tracked: 5, freshWithin24h: 3, stale: 1, neverSynced: 1, lastCheckAt: "2026-11-20T04:00:00Z", oldestCheckAt: "2026-11-17T04:00:00Z", failing: 2, waitingInBackoff: 1, byOutcome: { missing: 1, conflict: 0, stripe_error: 1, ignored: 0 }, runHistoryAvailable: false },
  backoff: [{ member: "w@x.test", outcome: "missing", failures: 2, lastFailedAt: "2026-11-20T05:00:00Z", nextAttemptAt: "2026-11-21T05:00:00Z", waiting: true }, { member: "d@x.test", outcome: "stripe_error", failures: 1, lastFailedAt: "2026-11-19T05:00:00Z", nextAttemptAt: "2026-11-20T05:00:00Z", waiting: false }],
  unresolved: { items: [{ kind: "webhook_failed", subject: "customer.subscription.updated", detail: "handler_error", at: "2026-11-20T09:00:00Z" }, { kind: "stale_sync", subject: "s@x.test", detail: "active", at: "2026-11-17T04:00:00Z" }], total: 30 },
  ...o,
});
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const mount = async (lang: "en" | "es" = "en") => {
  if (lang === "es") localStorage.setItem("standup-language", "es");
  render(<LanguageProvider><AdminBillingOperations /></LanguageProvider>);
  await flush();
};
const txt = (id: string) => screen.getByTestId(id).textContent;
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  m.ops.mockResolvedValue({ kind: "ok", data: data() });
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("standup-language");
});

describe("states", () => {
  it("loading, then content", async () => {
    let done!: (v: unknown) => void;
    m.ops.mockReturnValue(new Promise((r) => (done = r)));
    await mount();
    expect(txt("adminops-ops-loading")).toBe(en["adminBillOps.ops.loading"]);
    await act(async () => done({ kind: "ok", data: data() }));
    expect(screen.getByTestId("adminops-webhooks")).toBeTruthy();
  });
  it("error with retry", async () => {
    m.ops.mockResolvedValueOnce({ kind: "error" });
    await mount();
    expect(screen.getByTestId("adminops-ops-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("adminops-ops-retry"));
    await flush();
    expect(screen.getByTestId("adminops-recon")).toBeTruthy();
  });
  it("clear empty states for every section", async () => {
    m.ops.mockResolvedValue({ kind: "ok", data: data({ webhooks: { recent: [], last24h: { processed: 0, failed: 0, processing: 0 }, lastProcessedAt: null, totalRecorded: 0 }, reconciliation: { ...data().reconciliation, tracked: 0, failing: 0 }, backoff: [], unresolved: { items: [], total: 0 } }) });
    await mount();
    expect(txt("adminops-webhooks-empty")).toBe(en["adminBillOps.webhooks.none"]);
    expect(txt("adminops-recon-empty")).toBe(en["adminBillOps.recon.empty"]);
    expect(txt("adminops-backoff-empty")).toBe(en["adminBillOps.backoff.none"]);
    expect(txt("adminops-unresolved-empty")).toBe(en["adminBillOps.unresolved.none"]);
  });
});

describe("content", () => {
  it("shows webhook results, reconciliation health, backoff and unresolved items", async () => {
    await mount();
    expect(txt("adminops-webhooks-24h")).toBe("Last 24 hours: 1 processed, 1 failed, 0 in progress");
    expect(screen.getAllByTestId("adminops-webhook")).toHaveLength(2);
    expect(screen.getAllByTestId("adminops-webhook")[1].textContent).toContain("Failed (handler_error)");
    expect([txt("adminops-recon-tracked"), txt("adminops-recon-fresh"), txt("adminops-recon-stale"), txt("adminops-recon-never"), txt("adminops-recon-failing"), txt("adminops-recon-waiting")]).toEqual(["5", "3", "1", "1", "2", "1"]);
    expect(txt("adminops-recon-outcomes")).toContain("Not found in Stripe 1");
    expect(txt("adminops-recon-outcomes")).toContain("Stripe error 1");
    const items = screen.getAllByTestId("adminops-backoff-item");
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toContain(en["adminBillOps.backoff.due"]);
    expect(screen.getAllByTestId("adminops-unresolved-item")).toHaveLength(2);
    expect(txt("adminops-unresolved-more")).toBe("Showing 2 of 30");
  });
  it("is honest that run history is not stored, and offers no action", async () => {
    await mount();
    expect(screen.getByText(en["adminBillOps.recon.note"])).toBeTruthy();
    expect(screen.queryAllByRole("button").filter((b) => b.getAttribute("data-testid") !== "adminops-ops-retry")).toEqual([]);
  });
  it("renders in Spanish", async () => {
    await mount("es");
    expect(screen.getByText(es["adminBillOps.ops.title"])).toBeTruthy();
    expect(txt("adminops-webhooks-24h")).toBe("Últimas 24 horas: 1 procesados, 1 fallidos, 0 en curso");
    expect(txt("adminops-unresolved-more")).toBe("Mostrando 2 de 30");
  });
});

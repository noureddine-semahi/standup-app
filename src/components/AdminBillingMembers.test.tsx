import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, within } from "@testing-library/react";

const m = vi.hoisted(() => ({ members: vi.fn(), premium: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: m.getSession } } }));
vi.mock("@/lib/admin/billingAdminClient", () => ({ getBillingMembers: m.members, setMemberPremium: m.premium }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import AdminBillingMembers from "./AdminBillingMembers";
import type { MemberRow } from "@/lib/admin/memberBilling";

const row = (o: Partial<MemberRow> = {}): MemberRow => ({ id: "id-1", email: "one@x.test", displayName: "One", plan: "free", source: "none", alsoStripe: false, manualGrant: false, stripeStatus: null, stripeKind: null, scheduledCancellationAt: null, lastSyncAt: null, deletionPending: null, ...o });
const page = (items: MemberRow[], o = {}) => ({ kind: "ok", data: { generatedAt: "2026-11-20T12:00:00Z", items, total: items.length, page: 1, pageSize: 20, pages: 1, ...o } });
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const mount = async (lang: "en" | "es" = "en") => {
  if (lang === "es") localStorage.setItem("standup-language", "es");
  render(<LanguageProvider><AdminBillingMembers /></LanguageProvider>);
  await flush();
};
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  m.members.mockResolvedValue(page([row()]));
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("standup-language");
  vi.useRealTimers();
});

describe("states", () => {
  it("shows loading first, then the members", async () => {
    let done!: (v: unknown) => void;
    m.members.mockReturnValue(new Promise((r) => (done = r)));
    await mount();
    expect(screen.getByTestId("adminops-members-loading").textContent).toBe(en["adminBillOps.members.loading"]);
    await act(async () => done(page([row()])));
    expect(screen.getAllByTestId("adminops-member")).toHaveLength(1);
    expect(screen.queryByTestId("adminops-members-loading")).toBeNull();
  });
  it("shows a clear empty state", async () => {
    m.members.mockResolvedValue(page([]));
    await mount();
    expect(screen.getByTestId("adminops-members-empty").textContent).toBe(en["adminBillOps.members.empty"]);
  });
  it("shows an error with a working retry", async () => {
    m.members.mockResolvedValueOnce({ kind: "error" });
    await mount();
    expect(screen.getByTestId("adminops-members-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("adminops-members-retry"));
    await flush();
    expect(screen.getAllByTestId("adminops-member")).toHaveLength(1);
  });
});

describe("row content", () => {
  it("shows plan, source, Stripe status, scheduled cancellation, last sync and deletion state", async () => {
    m.members.mockResolvedValue(page([
      row({ id: "a", email: "sub@x.test", plan: "premium", source: "stripe", stripeStatus: "active", stripeKind: "scheduledCancellation", scheduledCancellationAt: "2026-12-10T00:00:00Z", lastSyncAt: "2026-11-20T04:00:00Z" }),
      row({ id: "b", email: "man@x.test", plan: "premium", source: "manual", manualGrant: true, alsoStripe: true, stripeStatus: "past_due", stripeKind: "pastDue", lastSyncAt: null, deletionPending: "pending" }),
    ]));
    await mount();
    const [a, b] = screen.getAllByTestId("adminops-member");
    expect(within(a).getByTestId("adminops-plan-badge").textContent).toBe("Premium");
    expect(within(a).getByTestId("adminops-source").textContent).toBe("Stripe subscription");
    expect(within(a).getByTestId("adminops-stripe").textContent).toBe("Active");
    expect(within(a).getByTestId("adminops-cancels").textContent).toMatch(/2026/);
    expect(within(a).getByTestId("adminops-sync").textContent).toMatch(/2026/);
    expect(within(b).getByTestId("adminops-source").textContent).toBe("Manual grant (also has a Stripe subscription)");
    expect(within(b).getByTestId("adminops-stripe").textContent).toBe("Past due");
    expect(within(b).getByTestId("adminops-sync").textContent).toBe("Never");
    expect(within(b).getByTestId("adminops-deletion").textContent).toBe("Deletion started");
  });
  it("renders in Spanish", async () => {
    m.members.mockResolvedValue(page([row({ plan: "premium", source: "manual", manualGrant: true })]));
    await mount("es");
    expect(screen.getByText(es["adminBillOps.members.title"])).toBeTruthy();
    expect(screen.getByTestId("adminops-source").textContent).toBe(es["adminBillOps.source.manual"]);
    expect(screen.getByTestId("adminops-revoke").textContent).toBe(es["adminBillOps.action.revoke"]);
  });
});

describe("search, filters and paging reach the server query", () => {
  it("sends filters and page changes", async () => {
    m.members.mockImplementation(async (q: { page: number }) => page([row()], { total: 45, pages: 3, page: q.page }));
    await mount();
    fireEvent.change(screen.getByTestId("adminops-plan"), { target: { value: "premium" } });
    await flush();
    expect(m.members).toHaveBeenLastCalledWith(expect.objectContaining({ plan: "premium", page: 1 }), expect.anything());
    fireEvent.change(screen.getByTestId("adminops-flag"), { target: { value: "pastDue" } });
    await flush();
    expect(m.members).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "pastDue" }), expect.anything());
    fireEvent.click(screen.getByTestId("adminops-next"));
    await flush();
    expect(m.members).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything());
    fireEvent.change(screen.getByTestId("adminops-pagesize"), { target: { value: "50" } });
    await flush();
    expect(m.members).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50, page: 1 }), expect.anything());
  });
  it("debounces the search box", async () => {
    await mount();
    vi.useFakeTimers();
    const before = m.members.mock.calls.length;
    fireEvent.change(screen.getByTestId("adminops-search"), { target: { value: "ab" } });
    fireEvent.change(screen.getByTestId("adminops-search"), { target: { value: "abc" } });
    expect(m.members.mock.calls.length).toBe(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(m.members).toHaveBeenLastCalledWith(expect.objectContaining({ search: "abc" }), expect.anything());
    expect(m.members.mock.calls.length).toBe(before + 1);
  });
  it("disables Previous on the first page and Next on the last", async () => {
    await mount();
    expect((screen.getByTestId("adminops-prev") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("adminops-next") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("adminops-pageof").textContent).toBe("Page 1 of 1");
  });
});

describe("manual grant / revoke", () => {
  it("offers Grant for a non-granted member and Revoke for a granted one", async () => {
    m.members.mockResolvedValue(page([row({ id: "a" }), row({ id: "b", manualGrant: true, plan: "premium", source: "manual" })]));
    await mount();
    const [a, b] = screen.getAllByTestId("adminops-member");
    expect(within(a).getByTestId("adminops-grant")).toBeTruthy();
    expect(within(b).getByTestId("adminops-revoke")).toBeTruthy();
  });
  it("asks for confirmation, then grants through the endpoint and refreshes", async () => {
    m.premium.mockResolvedValue({ kind: "ok", data: { status: "ok", manualGrant: true, effectiveTier: "premium" } });
    await mount();
    fireEvent.click(screen.getByTestId("adminops-grant"));
    expect(screen.getByTestId("adminops-confirm").textContent).toContain("one@x.test");
    expect(m.premium).not.toHaveBeenCalled();
    const calls = m.members.mock.calls.length;
    fireEvent.click(screen.getByTestId("adminops-confirm-go"));
    await flush();
    expect(m.premium).toHaveBeenCalledWith("id-1", "grant", expect.anything());
    expect(screen.getByTestId("adminops-notice").textContent).toBe("Premium granted to one@x.test.");
    expect(m.members.mock.calls.length).toBe(calls + 1);
    expect(screen.queryByTestId("adminops-confirm")).toBeNull();
  });
  it("cancel changes nothing", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("adminops-grant"));
    fireEvent.click(screen.getByTestId("adminops-cancel"));
    expect(m.premium).not.toHaveBeenCalled();
    expect(screen.queryByTestId("adminops-confirm")).toBeNull();
  });
  it("revokes after confirmation", async () => {
    m.members.mockResolvedValue(page([row({ manualGrant: true, plan: "premium", source: "manual" })]));
    m.premium.mockResolvedValue({ kind: "ok", data: { status: "ok", manualGrant: false, effectiveTier: "free" } });
    await mount();
    fireEvent.click(screen.getByTestId("adminops-revoke"));
    fireEvent.click(screen.getByTestId("adminops-confirm-go"));
    await flush();
    expect(m.premium).toHaveBeenCalledWith("id-1", "revoke", expect.anything());
    expect(screen.getByTestId("adminops-notice").textContent).toBe("Manual Premium revoked for one@x.test.");
  });
  it("a deletion-pending account cannot be granted from the UI (no Grant button, an explanation instead)", async () => {
    m.members.mockResolvedValue(page([row({ deletionPending: "pending" })]));
    await mount();
    expect(screen.queryByTestId("adminops-grant")).toBeNull();
    expect(screen.getByTestId("adminops-blocked").textContent).toBe(en["adminBillOps.action.blocked"]);
  });
  it("if the server refuses a grant for deletion, the refusal is explained and nothing is shown as granted", async () => {
    m.premium.mockResolvedValue({ kind: "refused", code: "deletion_pending" });
    await mount();
    fireEvent.click(screen.getByTestId("adminops-grant"));
    fireEvent.click(screen.getByTestId("adminops-confirm-go"));
    await flush();
    expect(screen.getByTestId("adminops-notice").textContent).toBe(en["adminBillOps.err.deletion_pending"]);
  });
  it("a failed change says nothing was changed", async () => {
    m.premium.mockResolvedValue({ kind: "error" });
    await mount();
    fireEvent.click(screen.getByTestId("adminops-grant"));
    fireEvent.click(screen.getByTestId("adminops-confirm-go"));
    await flush();
    expect(screen.getByTestId("adminops-notice").textContent).toBe(en["adminBillOps.err.change_failed"]);
  });
});

describe("a not-authorised response", () => {
  it("tells the page", async () => {
    m.members.mockResolvedValue({ kind: "forbidden" });
    const onUnauthorized = vi.fn();
    render(<LanguageProvider><AdminBillingMembers onUnauthorized={onUnauthorized} /></LanguageProvider>);
    await flush();
    expect(onUnauthorized).toHaveBeenCalled();
  });
});

describe("copy", () => {
  it("has English and Spanish for every adminBillOps key", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("adminBillOps."));
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) {
      expect((es as Record<string, string>)[k], k).toBeTruthy();
      expect([...(en as Record<string, string>)[k].matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort(), k).toEqual([...(es as Record<string, string>)[k].matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort());
    }
  });
});

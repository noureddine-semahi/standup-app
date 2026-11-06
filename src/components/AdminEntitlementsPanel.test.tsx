import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ getAdminEntitlement: vi.fn(), setAdminEntitlement: vi.fn() }));
vi.mock("@/lib/supabase/adminEntitlements", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase/adminEntitlements")>()), ...api }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { AdminEntitlementError } from "@/lib/supabase/adminEntitlements";
import AdminEntitlementsPanel from "./AdminEntitlementsPanel";

const members = [
  { id: "u1", email: "ana@example.com", displayName: "Ana" },
  { id: "u2", email: "bo@example.com", displayName: null },
];
const base = { trialStartedAt: null, trialEndsAt: null, trialUsed: false, updatedAt: null };
const free = { ...base, storedTier: "free", effectiveTier: "free" };
const premium = { ...base, storedTier: "premium", effectiveTier: "premium" };
const expired = { storedTier: "premium_trial", effectiveTier: "free", trialStartedAt: "2026-09-01T00:00:00Z", trialEndsAt: "2026-09-15T00:00:00Z", trialUsed: true, updatedAt: null };

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};
async function mount(canChange: boolean, ent: unknown = free) {
  api.getAdminEntitlement.mockResolvedValue(ent);
  render(
    <LanguageProvider>
      <AdminEntitlementsPanel members={members} canChange={canChange} />
    </LanguageProvider>
  );
  fireEvent.change(screen.getByTestId("admin-ent-member"), { target: { value: "u1" } });
  await settle();
}

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe("viewing", () => {
  it("shows nothing and calls nothing until a member is chosen", () => {
    render(
      <LanguageProvider>
        <AdminEntitlementsPanel members={members} canChange />
      </LanguageProvider>
    );
    expect(screen.queryByTestId("admin-ent-view")).toBeNull();
    expect(api.getAdminEntitlement).not.toHaveBeenCalled();
  });
  it("shows effective and stored plan, trial status and expiration (an ended trial is Free now but remembered)", async () => {
    await mount(false, expired);
    expect(api.getAdminEntitlement).toHaveBeenCalledWith("u1");
    expect(screen.getByTestId("admin-ent-effective").textContent).toBe("Free");
    expect(screen.getByTestId("admin-ent-stored").textContent).toBe("Premium Trial");
    expect(screen.getByTestId("admin-ent-trial").textContent).toBe("Used");
    expect(screen.getByTestId("admin-ent-expires").textContent).toContain("2026");
  });
  it("a plain admin sees the plan but is offered no controls", async () => {
    await mount(false);
    expect(screen.getByTestId("admin-ent-view")).toBeTruthy();
    expect(screen.queryByTestId("admin-ent-grant")).toBeNull();
    expect(screen.queryByTestId("admin-ent-revoke")).toBeNull();
  });
  it("a refused read shows a permission message and no data", async () => {
    api.getAdminEntitlement.mockRejectedValue(new AdminEntitlementError("not_admin"));
    render(
      <LanguageProvider>
        <AdminEntitlementsPanel members={members} canChange />
      </LanguageProvider>
    );
    fireEvent.change(screen.getByTestId("admin-ent-member"), { target: { value: "u1" } });
    await settle();
    expect(screen.getByTestId("admin-ent-error").textContent).toContain("permission");
    expect(screen.queryByTestId("admin-ent-view")).toBeNull();
    expect(screen.queryByTestId("admin-ent-grant")).toBeNull();
  });
});

describe("changing the plan (Sys Admin)", () => {
  it("only offers the change that makes sense", async () => {
    await mount(true, free);
    expect((screen.getByTestId("admin-ent-grant") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("admin-ent-revoke") as HTMLButtonElement).disabled).toBe(true);
  });
  it("clicking only opens a confirmation; cancelling changes nothing", async () => {
    await mount(true, free);
    fireEvent.click(screen.getByTestId("admin-ent-grant"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Ana");
    fireEvent.click(within(dialog).getByText("Cancel", { exact: false }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.setAdminEntitlement).not.toHaveBeenCalled();
  });
  it("confirming grants Premium once and shows the new plan", async () => {
    await mount(true, free);
    api.setAdminEntitlement.mockResolvedValue(premium);
    fireEvent.click(screen.getByTestId("admin-ent-grant"));
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Grant Premium")));
    await settle();
    expect(api.setAdminEntitlement).toHaveBeenCalledTimes(1);
    expect(api.setAdminEntitlement).toHaveBeenCalledWith("u1", "premium");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("admin-ent-effective").textContent).toBe("Premium");
    expect(screen.getByTestId("admin-ent-notice").textContent).toBe("Premium granted.");
  });
  it("revoking says nothing is deleted, and sets Free", async () => {
    await mount(true, premium);
    api.setAdminEntitlement.mockResolvedValue(free);
    fireEvent.click(screen.getByTestId("admin-ent-revoke"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Nothing they created is deleted or deactivated");
    await act(async () => fireEvent.click(within(dialog).getByText("Set to Free")));
    await settle();
    expect(api.setAdminEntitlement).toHaveBeenCalledWith("u1", "free");
    expect(screen.getByTestId("admin-ent-effective").textContent).toBe("Free");
  });
  it("a refusal by the database is shown, and the displayed plan is not changed", async () => {
    await mount(true, free);
    api.setAdminEntitlement.mockRejectedValue(new AdminEntitlementError("not_sys_admin"));
    fireEvent.click(screen.getByTestId("admin-ent-grant"));
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByText("Grant Premium")));
    await settle();
    expect(screen.getByRole("alertdialog").textContent).toContain("permission");
    expect(screen.getByTestId("admin-ent-effective").textContent).toBe("Free");
  });
});

describe("Spanish", () => {
  it("renders the panel in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    try {
      await mount(true, free);
      expect(screen.getByTestId("admin-ent").textContent).toContain("Planes");
      expect(screen.getByTestId("admin-ent-effective").textContent).toBe("Gratis");
      expect(screen.getByTestId("admin-ent-grant").textContent).toBe("Conceder Premium");
    } finally {
      localStorage.removeItem("standup-language");
    }
  });
});

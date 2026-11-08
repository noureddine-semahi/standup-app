import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const m = vi.hoisted(() => ({ push: vi.fn(), getSession: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { getSession: m.getSession } } }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import AuthGate from "./AuthGate";

async function mount() {
  render(
    <LanguageProvider>
      <AuthGate>
        <p data-testid="inside">inside</p>
      </AuthGate>
    </LanguageProvider>
  );
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
const at = (url: string) => window.history.pushState({}, "", url);

beforeEach(() => {
  m.push.mockReset();
  m.getSession.mockReset();
});
afterEach(() => {
  cleanup();
  at("/");
});

describe("AuthGate: an expired or missing session", () => {
  it("sends the member to sign in and remembers where they were going, including the checkout return parameter", async () => {
    m.getSession.mockResolvedValue({ data: { session: null }, error: null });
    at("/standup/settings?checkout=success");
    await mount();
    expect(m.push).toHaveBeenCalledWith("/login?next=%2Fstandup%2Fsettings%3Fcheckout%3Dsuccess");
    expect(screen.queryByTestId("inside")).toBeNull();
  });
  it("remembers an ordinary app page too", async () => {
    m.getSession.mockResolvedValue({ data: { session: null }, error: null });
    at("/standup/goals");
    await mount();
    expect(m.push).toHaveBeenCalledWith("/login?next=%2Fstandup%2Fgoals");
  });
  it("never remembers a destination outside the app", async () => {
    m.getSession.mockResolvedValue({ data: { session: null }, error: null });
    at("/somewhere-else");
    await mount();
    expect(m.push).toHaveBeenCalledWith("/login");
  });
  it("with a valid session it shows the page and doesn't redirect", async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    at("/standup/settings");
    await mount();
    expect(screen.getByTestId("inside")).toBeTruthy();
    expect(m.push).not.toHaveBeenCalled();
  });
});

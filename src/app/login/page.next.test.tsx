import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const m = vi.hoisted(() => ({ push: vi.fn(), signIn: vi.fn(), otp: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { signInWithPassword: m.signIn, signInWithOtp: m.otp } } }));

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import LoginPage from "./page";

async function signIn() {
  render(
    <LanguageProvider>
      <LoginPage />
    </LanguageProvider>
  );
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@example.com" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw-123456" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
const at = (search: string) => window.history.pushState({}, "", "/login" + search);

beforeEach(() => {
  m.push.mockReset();
  m.signIn.mockReset();
  m.signIn.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});
afterEach(() => {
  cleanup();
  at("");
});

describe("sign-in return destination", () => {
  it("without one, goes to Today as before", async () => {
    at("");
    await signIn();
    expect(m.push).toHaveBeenCalledWith("/standup/today");
  });
  it("brings the member back to where they were going (Settings after Stripe, with its checkout parameter)", async () => {
    at("?next=%2Fstandup%2Fsettings%3Fcheckout%3Dsuccess");
    await signIn();
    expect(m.push).toHaveBeenCalledWith("/standup/settings?checkout=success");
  });
  it("ignores a hostile destination and goes to Today", async () => {
    for (const next of ["https%3A%2F%2Fevil.example", "%2F%2Fevil.example%2Fstandup", "%2Fapi%2Fbilling%2Fcheckout", "javascript%3Aalert(1)", "%2Fstandup%5C..%5Cx"]) {
      cleanup();
      m.push.mockReset();
      at("?next=" + next);
      await signIn();
      expect(m.push).toHaveBeenCalledWith("/standup/today");
    }
  });
  it("a failed sign-in goes nowhere", async () => {
    at("?next=%2Fstandup%2Fsettings");
    m.signIn.mockResolvedValue({ data: null, error: { message: "Invalid login" } });
    await signIn();
    expect(m.push).not.toHaveBeenCalled();
  });
});

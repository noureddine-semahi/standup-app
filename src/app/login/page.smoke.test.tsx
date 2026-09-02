import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createSupabaseMock } from "../../../test/mocks/supabase";

vi.mock("@/lib/supabase/client", () => ({
  supabase: createSupabaseMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  it("renders without throwing and shows the sign-in form", () => {
    render(<LoginPage />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import PaymentConfirmModal, { AMOUNT_PATTERN } from "./PaymentConfirmModal";

const onConfirm = vi.fn();
async function mount(suggested = 25) {
  render(
    <LanguageProvider>
      <PaymentConfirmModal accountName="Visa" suggestedAmount={suggested} saving={false} error={null} onCancel={() => {}} onConfirm={onConfirm} />
    </LanguageProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
}
const input = () => screen.getByRole("spinbutton") as HTMLInputElement;
const confirm = () => screen.getByRole("button", { name: "Confirm Payment" }) as HTMLButtonElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });

beforeEach(() => {
  onConfirm.mockReset();
  localStorage.removeItem("standup-language");
});
afterEach(() => cleanup());

describe("payment confirmation accepts whole cents only", () => {
  it("a valid two-decimal amount confirms with exactly that number", async () => {
    await mount(25);
    expect(input().value).toBe("25.00"); // the prefilled minimum payment is valid
    type("25.01");
    expect(confirm().disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(25.01);
  });

  it("whole numbers, one decimal, leading-dot and $0 are still accepted (the $0 behaviour is unchanged)", async () => {
    await mount();
    for (const [v, n] of [["25", 25], ["25.5", 25.5], [".5", 0.5], ["0", 0], ["0.00", 0], ["100000", 100000]] as const) {
      type(v);
      expect(confirm().disabled, v).toBe(false);
      fireEvent.click(confirm());
      expect(onConfirm).toHaveBeenLastCalledWith(n);
    }
  });

  it("a three-decimal amount is rejected with a clear message and cannot be submitted", async () => {
    await mount();
    for (const v of ["25.005", "25.001", "0.999", "1.234"]) {
      type(v);
      expect(confirm().disabled, v).toBe(true);
      expect(screen.getByRole("alert").textContent).toBe("Enter an amount with at most two decimal places (whole cents), for example 25.50.");
      expect(input().getAttribute("aria-invalid")).toBe("true");
    }
    fireEvent.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("other malformed amounts are rejected too (negative, exponent, text, blank), blank without a scolding message", async () => {
    await mount();
    for (const v of ["-1", "1e2", "abc", "25.", "1,5"]) {
      type(v);
      expect(confirm().disabled, v).toBe(true);
    }
    type("");
    expect(confirm().disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the message clears as soon as the amount is corrected", async () => {
    await mount();
    type("25.005");
    expect(screen.getByRole("alert")).toBeTruthy();
    type("25.00");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(confirm().disabled).toBe(false);
  });

  it("shows the message in Spanish", async () => {
    localStorage.setItem("standup-language", "es");
    await mount();
    type("25.005");
    expect(screen.getByRole("alert").textContent).toBe("Ingresa un monto con un máximo de dos decimales (centavos enteros), por ejemplo 25.50.");
  });

  it("the pattern is the client-side twin of the database rule: at most two decimals", () => {
    for (const ok of ["0", "1", "1.5", "1.50", ".25", "99999999.99"]) expect(AMOUNT_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["1.505", "-1", "1e2", "", " ", "1.", "1.2.3", "+1"]) expect(AMOUNT_PATTERN.test(bad), bad).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

const db = vi.hoisted(() => ({ getPaymentAccounts: vi.fn(), confirmPaymentGoalCompletion: vi.fn() }));
vi.mock("@/lib/supabase/db", () => db);

import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { usePaymentGoalCompletion } from "./usePaymentGoalCompletion";

const goal = { id: "g1", title: "Pay Visa", source_payment_account_id: "a1" } as never;
const wrapper = ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
async function open(options?: Parameters<typeof usePaymentGoalCompletion>[0]) {
  const hook = renderHook(() => usePaymentGoalCompletion(options), { wrapper });
  await act(async () => hook.result.current.openPaymentConfirm(goal));
  await settle();
  return hook;
}

beforeEach(() => {
  db.getPaymentAccounts.mockReset();
  db.confirmPaymentGoalCompletion.mockReset();
  db.getPaymentAccounts.mockResolvedValue([{ id: "a1", name: "Visa", balance: 500, minimumPayment: 25 }]);
});
afterEach(() => cleanup());

describe("confirming a payment goal", () => {
  it("normal confirmation: one server call with the confirmed amount, then onConfirmed with the new balance", async () => {
    db.confirmPaymentGoalCompletion.mockResolvedValue(475);
    const onConfirmed = vi.fn();
    const { result } = await open({ onConfirmed });
    await act(async () => result.current.confirmPayment(25));
    expect(db.confirmPaymentGoalCompletion).toHaveBeenCalledTimes(1);
    expect(db.confirmPaymentGoalCompletion).toHaveBeenCalledWith("g1", 25);
    expect(onConfirmed).toHaveBeenCalledWith(goal, 475);
    expect(result.current.paymentSaving).toBe(false);
    expect(result.current.payingGoal).toBeNull();
  });

  it("repeated submissions in the same tick send ONE request (the synchronous in-flight guard)", async () => {
    const d = deferred<number>();
    db.confirmPaymentGoalCompletion.mockReturnValue(d.promise);
    const { result } = await open();
    const confirm = result.current.confirmPayment; // the same closure a double tap would call
    await act(async () => {
      void confirm(25);
      void confirm(25);
      void confirm(25);
    });
    expect(db.confirmPaymentGoalCompletion).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(475));
    await settle();
    expect(db.confirmPaymentGoalCompletion).toHaveBeenCalledTimes(1);
    expect(result.current.paymentSaving).toBe(false);
  });

  it("the guard is released after a failure, so a deliberate retry goes through", async () => {
    db.confirmPaymentGoalCompletion.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(475);
    const onConfirmed = vi.fn();
    const { result } = await open({ onConfirmed });
    await act(async () => result.current.confirmPayment(25));
    expect(result.current.paymentError).toBe("network");
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(result.current.payingGoal).not.toBeNull(); // the modal stays open for the retry
    await act(async () => result.current.confirmPayment(25));
    expect(db.confirmPaymentGoalCompletion).toHaveBeenCalledTimes(2);
    expect(onConfirmed).toHaveBeenCalledWith(goal, 475);
  });

  it("a duplicate the server rejects (already confirmed) is shown as an error and never reported as confirmed", async () => {
    db.confirmPaymentGoalCompletion.mockRejectedValue(new Error("This payment has already been confirmed for this Task."));
    const onConfirmed = vi.fn();
    const onError = vi.fn();
    const { result } = await open({ onConfirmed, onError });
    await act(async () => result.current.confirmPayment(25));
    expect(result.current.paymentError).toContain("already been confirmed");
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.paymentSaving).toBe(false);
  });
});
